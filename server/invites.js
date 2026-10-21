// One-time invite links: an admin creates one, a new player uses it to pick
// a name and password and becomes a known player.
//
// The file only holds a hash of each token - like the passwords, the link
// itself exists in plain text just once, when it is created. Whoever reads
// invites.json cannot build a working link from it.
//
// Every invite can be used exactly once and expires after INVITE_TTL_MS.
// It lives next to the account file, so it survives a server restart.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { userFile } from './userstore.js';

export const INVITE_TTL_MS = 24 * 3600 * 1000;
const NOTE_MAX = 60;

export function inviteFile() {
  return path.join(path.dirname(userFile()), 'invites.json');
}

const hashOf = (token) => crypto.createHash('sha256').update(String(token ?? '')).digest('hex');

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(inviteFile(), 'utf8'));
    return Array.isArray(raw?.invites) ? raw.invites : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error(`invites.json is unreadable (${inviteFile()}): ${e.message}`);
  }
}

/** Writes next to it first and then renames - an abort leaves the old file in place. */
function save(invites) {
  const file = inviteFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, invites }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** All invites that can still be used; expired ones are dropped from the file on the way. */
function live(now = Date.now()) {
  const all = load();
  const valid = all.filter(i => i.expires > now);
  if (valid.length !== all.length) save(valid);
  return valid;
}

/**
 * Creates an invite. Returns the token - the only time it exists in plain
 * text - plus the public part of the entry.
 */
export function createInvite(by, note = '') {
  const token = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const invite = {
    hash: hashOf(token),
    id: crypto.randomBytes(6).toString('hex'),
    by,
    note: String(note ?? '').trim().slice(0, NOTE_MAX),
    created: now,
    expires: now + INVITE_TTL_MS
  };
  save([...live(now), invite]);
  return { token, invite: publicView(invite) };
}

/** What the admin panel may see: everything but the hash. */
function publicView(i) {
  return { id: i.id, by: i.by, note: i.note, created: i.created, expires: i.expires };
}

export function listInvites() {
  return live().map(publicView).sort((a, b) => a.created - b.created);
}

export function revokeInvite(id) {
  const all = live();
  const rest = all.filter(i => i.id !== id);
  if (rest.length === all.length) return false;
  save(rest);
  return true;
}

/** Is this token a usable invite? Does not use it up. */
export function peekInvite(token) {
  const h = hashOf(token);
  const i = live().find(x => x.hash === h);
  return i ? publicView(i) : null;
}

/**
 * Uses up an invite: it is removed before anything else happens, so the same
 * link can never create two accounts. Synchronous on purpose - no other
 * request can get in between the check and the removal.
 * Returns the invite, or null if there is none (any more).
 */
export function consumeInvite(token) {
  const h = hashOf(token);
  const all = live();
  const i = all.find(x => x.hash === h);
  if (!i) return null;
  save(all.filter(x => x !== i));
  return i;
}

/** Puts an invite back - when creating the account failed after all. */
export function restoreInvite(invite) {
  if (invite.expires <= Date.now()) return;
  save([...live(), invite]);
}
