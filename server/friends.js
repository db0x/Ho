// Friendships between accounts: a request, an answer, and from then on a
// list with status and direct messages.
//
// Stored by account name next to the account file. Outside the server only
// handles are used (userstore.js) - a sign-in name is half a login and has no
// business in somebody else's browser.
//
// The file is read once and then held in memory; only this server process
// writes it. Messages are kept per pair, the newest MESSAGES_KEPT of them,
// and for no longer than MESSAGE_TTL - read or not.
//
// Messages are end-to-end encrypted (client/js/e2e.js): what is stored here
// is an envelope - ciphertext and the public keys of sender and recipient.
// The keys themselves belong to the accounts (userstore.js); here no more
// than the shape of an envelope is checked.
import fs from 'node:fs';
import path from 'node:path';
import { userFile, normalizeName, keyOf } from './userstore.js';

export const MESSAGE_MAX = 500;
// Ciphertext of MESSAGE_MAX characters of the widest UTF-8, as base64, with room.
const CIPHER_MAX = 3000;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
export const MESSAGES_KEPT = 200;
// The server is a mailbox, not an archive: the less ciphertext lies around,
// the less a key stolen later can open.
export const MESSAGE_TTL = 14 * 24 * 3600 * 1000;
export const PENDING_MAX = 20;

export function friendsFile() {
  return path.join(path.dirname(userFile()), 'friends.json');
}

let db = null;
let dbFile = null;

function empty() { return { version: 3, links: [], messages: {}, read: {} }; }

function data() {
  // Tests point HO_USERS_FILE elsewhere - then the friends follow.
  if (db && dbFile === friendsFile()) return db;
  dbFile = friendsFile();
  try {
    const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    db = { ...empty(), ...raw };
    // Version 1 kept messages in plain text, version 2 encrypted them per
    // device. Both go - from version 3 on, one key per account encrypts.
    if (raw.version !== 3) {
      db.version = 3;
      db.messages = {};
      db.read = {};
      delete db.devices;
      save();
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`friends.json is unreadable (${dbFile}): ${e.message}`);
    db = empty();
  }
  return db;
}

/** Writes next to it first and then renames - an abort leaves the old file in place. */
function save() {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const tmp = `${dbFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, dbFile);
}

const pairKey = (a, b) => [a, b].sort().join('|');
const linkOf = (a, b) => data().links.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
const other = (l, me) => (l.a === me ? l.b : l.a);

/**
 * How `me` stands to `them`: 'self', 'friends', 'outgoing' (asked, waiting),
 * 'incoming' (they asked) or 'none'.
 */
export function relation(me, them) {
  me = normalizeName(me); them = normalizeName(them);
  if (me === them) return 'self';
  const l = linkOf(me, them);
  if (!l) return 'none';
  if (l.state === 'friends') return 'friends';
  return l.from === me ? 'outgoing' : 'incoming';
}

/**
 * Sends a friend request. If the other one has already asked, that is a yes
 * on both sides. Returns the new relation or throws an error key.
 */
export function request(me, them) {
  const rel = relation(me, them);
  if (rel === 'self') throw new Error('friends.err.self');
  if (rel === 'friends' || rel === 'outgoing') return rel;
  if (rel === 'incoming') return answer(me, them, true);
  const open = data().links.filter(l => l.state === 'pending' && l.from === me).length;
  if (open >= PENDING_MAX) throw new Error('friends.err.tooMany');
  data().links.push({ a: me, b: them, from: me, state: 'pending', since: Date.now() });
  save();
  return 'outgoing';
}

/** Accepts or declines a request from `them`. */
export function answer(me, them, accept) {
  const l = linkOf(me, them);
  if (!l || l.state !== 'pending' || l.from === me) throw new Error('friends.err.noRequest');
  if (accept) {
    l.state = 'friends';
    l.since = Date.now();
  } else {
    db.links.splice(db.links.indexOf(l), 1);
  }
  save();
  return accept ? 'friends' : 'none';
}

/**
 * Ends whatever there is between the two: withdraws a request, declines one
 * or ends a friendship. The messages go with it.
 */
export function remove(me, them) {
  const l = linkOf(me, them);
  if (!l) return false;
  data().links.splice(db.links.indexOf(l), 1);
  delete db.messages[pairKey(me, them)];
  for (const [x, y] of [[me, them], [them, me]]) if (db.read[x]) delete db.read[x][y];
  save();
  return true;
}

/** Everyone `me` is linked to, by kind. */
export function linksOf(me) {
  const out = { friends: [], incoming: [], outgoing: [] };
  for (const l of data().links) {
    if (l.a !== me && l.b !== me) continue;
    const name = other(l, me);
    if (l.state === 'friends') out.friends.push({ name, since: l.since });
    else if (l.from === me) out.outgoing.push({ name, since: l.since });
    else out.incoming.push({ name, since: l.since });
  }
  return out;
}

// ----------------------------------------------------------------- Messages

/** The public message key of an account, or null if it has none yet. */
export function publicKey(name) {
  return keyOf(name)?.pub || null;
}

/**
 * Checks an envelope's shape: made with the sender's key for the recipient's,
 * ciphertext within bounds. Reading it is impossible here.
 */
function checkEnvelope(me, them, env) {
  const bad = () => { throw new Error('friends.err.badMessage'); };
  if (!env || typeof env !== 'object' || env.v !== 2) bad();
  const mine = publicKey(me), theirs = publicKey(them);
  if (!mine || !theirs || env.a !== mine || env.b !== theirs) bad();
  if (typeof env.iv !== 'string' || !B64_RE.test(env.iv) || env.iv.length > 24) bad();
  if (typeof env.ct !== 'string' || !B64_RE.test(env.ct) || env.ct.length > CIPHER_MAX) bad();
  return { v: 2, a: env.a, b: env.b, iv: env.iv, ct: env.ct };
}

/** A direct message between friends, as an encrypted envelope. Returns the stored entry. */
export function addMessage(me, them, env) {
  if (relation(me, them) !== 'friends') throw new Error('friends.err.notFriends');
  const clean = checkEnvelope(me, them, env);
  const key = pairKey(me, them);
  const list = data().messages[key] || (db.messages[key] = []);
  const msg = { from: me, env: clean, at: Date.now() };
  list.push(msg);
  if (list.length > MESSAGES_KEPT) list.splice(0, list.length - MESSAGES_KEPT);
  // Whoever writes has read everything up to there.
  (db.read[me] || (db.read[me] = {}))[them] = msg.at;
  save();
  return msg;
}

/** The messages of a pair - only the ones not yet expired, even between two sweeps. */
export function history(me, them) {
  const since = Date.now() - MESSAGE_TTL;
  return (data().messages[pairKey(me, them)] || []).filter(m => m.at > since);
}

/** Deletes the messages older than MESSAGE_TTL. Returns how many went. */
export function expire(now = Date.now()) {
  const d = data();
  let gone = 0;
  for (const [key, list] of Object.entries(d.messages)) {
    const keep = list.filter(m => m.at > now - MESSAGE_TTL);
    if (keep.length === list.length) continue;
    gone += list.length - keep.length;
    if (keep.length) d.messages[key] = keep;
    else delete d.messages[key];
  }
  if (gone) save();
  return gone;
}

/** Everything from `them` up to now counts as read. */
export function markRead(me, them) {
  const list = history(me, them);
  const last = list.length ? list[list.length - 1].at : 0;
  if (!last || (db.read[me]?.[them] || 0) >= last) return;
  (db.read[me] || (db.read[me] = {}))[them] = last;
  save();
}

/** Messages from `them` that `me` has not seen yet. */
export function unread(me, them) {
  const since = data().read[me]?.[them] || 0;
  return history(me, them).filter(m => m.from === them && m.at > since).length;
}

/** Everything of one account goes - when it is deleted. */
export function forget(name) {
  const me = normalizeName(name);
  for (const l of linksOf(me).friends.concat(linksOf(me).incoming, linksOf(me).outgoing)) remove(me, l.name);
  delete data().read[me];
  save();
}

/**
 * Drops everything that belongs to accounts that no longer exist - deleting
 * an account takes its friendships and messages along.
 */
export function purge(existing) {
  const keep = new Set(existing);
  const d = data();
  const before = JSON.stringify(d);
  d.links = d.links.filter(l => keep.has(l.a) && keep.has(l.b));
  for (const key of Object.keys(d.messages)) {
    if (!key.split('|').every(n => keep.has(n))) delete d.messages[key];
  }
  for (const me of Object.keys(d.read)) {
    if (!keep.has(me)) { delete d.read[me]; continue; }
    for (const them of Object.keys(d.read[me])) if (!keep.has(them)) delete d.read[me][them];
  }
  if (JSON.stringify(d) !== before) save();
}
