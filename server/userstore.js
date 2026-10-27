// User accounts. The host only stores who may play (name) and how a password
// can be checked (scrypt hash with salt and parameters) - no plain text, no
// session keys, no email addresses.
//
// Accounts are created and deleted from outside with server/users.js, i.e. via
// `docker exec`. The server only reads the file and notices from mtime and size
// when it has changed: a deleted account is thereby also kicked out of a
// running session.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { releaseOf } from '../shared/version.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The release new accounts start at - they have nothing to catch up on.
const RELEASE = releaseOf(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);

// scrypt with N=16384: about 40 ms and 16 MB per check. Enough of a brake
// against guessing and still below the maxmem Node allows by default.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/**
 * Names as keys stay lowercase and plain - they end up in files and URLs, and
 * the spelling does not matter when signing in. How the name is displayed
 * (BATMAN instead of batman) is stored alongside in `display`.
 */
export const NAME_RE = /^[a-z0-9][a-z0-9._-]{1,23}$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

// Characters that cannot be confused (no 0/O, no 1/l/I) - the first password
// gets typed in or read out loud.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function userFile() {
  return process.env.HO_USERS_FILE || path.join(ROOT, 'data', 'users.json');
}

export function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase();
}

export function validName(name) {
  return NAME_RE.test(normalizeName(name));
}

/** This is what the account is called on screen. */
export function displayName(key, user) {
  return user?.display || key;
}

/** Null if the password is fine, otherwise the key of the complaint. */
export function checkPassword(password, name) {
  const pw = String(password ?? '');
  if (pw.length < MIN_PASSWORD) return 'auth.err.tooShort';
  if (pw.length > MAX_PASSWORD) return 'auth.err.tooLong';
  if (name && pw.toLowerCase() === normalizeName(name)) return 'auth.err.sameAsUser';
  return null;
}

/**
 * Handle: a short, unique ID per account that says nothing about it - shown
 * in the lobby so players of an instance can find each other. Drawn at random
 * rather than derived from the name: a hash of a short name could be found
 * again simply by trying names. Capital letters and digits without the
 * look-alikes 0/O and 1/I: 32^6, about a billion possibilities.
 */
const HANDLE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const HANDLE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

/** Gives every account without a valid handle one. Returns how many. */
function assignHandles(db) {
  const missing = Object.values(db.users).filter(u => !HANDLE_RE.test(u.handle || ''));
  for (const u of missing) u.handle = newHandle(db.users);
  return missing.length;
}

/**
 * On boot: accounts from before 0.9.0 get their handle once and for good, so
 * it is there before anyone signs in. Returns how many were assigned.
 */
export function ensureHandles() {
  const file = userFile();
  if (!fs.existsSync(file)) return 0;
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!db?.users || typeof db.users !== 'object') return 0;
  const n = assignHandles(db);
  if (n) save(db);
  return n;
}

function newHandle(users) {
  const taken = new Set(Object.values(users).map(u => u.handle));
  for (;;) {
    const h = Array.from({ length: 6 }, () => HANDLE_ALPHABET[crypto.randomInt(HANDLE_ALPHABET.length)]).join('');
    if (!taken.has(h)) return h;
  }
}

/** First password: three groups of five characters, about 73 bits. */
export function generatePassword() {
  const char = () => ALPHABET[crypto.randomInt(ALPHABET.length)];
  return [0, 1, 2].map(() => Array.from({ length: 5 }, char).join('')).join('-');
}

// ------------------------------------------------------------------- Hashes

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return new Promise((ok, fail) => {
    crypto.scrypt(password, salt, SCRYPT.keylen, SCRYPT, (e, key) => {
      if (e) return fail(e);
      ok(['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
        salt.toString('base64'), key.toString('base64')].join('$'));
    });
  });
}

/**
 * Checks a password against a stored hash. Takes the full time even with
 * garbage in the hash and compares in constant time - otherwise the duration
 * would reveal whether an account exists at all.
 */
export function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  const usable = parts.length === 6 && parts[0] === 'scrypt';
  const N = usable ? Number(parts[1]) : SCRYPT.N;
  const r = usable ? Number(parts[2]) : SCRYPT.r;
  const p = usable ? Number(parts[3]) : SCRYPT.p;
  const salt = usable ? Buffer.from(parts[4], 'base64') : Buffer.alloc(16);
  const expected = usable ? Buffer.from(parts[5], 'base64') : Buffer.alloc(SCRYPT.keylen);
  if (!Number.isInteger(N) || N < 2 || N > 1 << 20 || !Number.isInteger(r) || r < 1 || r > 32
    || !Number.isInteger(p) || p < 1 || p > 16 || !expected.length) {
    return Promise.resolve(false);
  }
  return new Promise((ok) => {
    crypto.scrypt(password, salt, expected.length, { N, r, p, maxmem: 160 * 1024 * 1024 }, (e, key) => {
      if (e) return ok(false);
      ok(usable && crypto.timingSafeEqual(key, expected));
    });
  });
}

// --------------------------------------------------------------------- File

let cache = null;              // { db, mtimeMs, size }

function empty() { return { version: 1, users: {} }; }

/** Reads the file; if unchanged, it comes from the cache. */
export function load() {
  const file = userFile();
  let st = null;
  try { st = fs.statSync(file); } catch { cache = null; return empty(); }
  if (cache && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.db;
  let db = empty();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw.users === 'object' && raw.users) db = { version: 1, users: raw.users };
  } catch (e) {
    // Better to fail loudly than to silently lock everyone out or, worse,
    // let everyone in.
    throw new Error(`users.json is unreadable (${file}): ${e.message}`);
  }
  // Accounts from before handles existed get theirs on the first read -
  // the server does that on boot (ensureHandles), this catches whatever is
  // added to the file by hand while it runs.
  if (assignHandles(db)) { save(db); return load(); }
  cache = { db, mtimeMs: st.mtimeMs, size: st.size };
  return db;
}

/** Writes next to it first and then renames - an abort leaves the old file in place. */
export function save(db) {
  const file = userFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  cache = null;
  return file;
}

// ----------------------------------------------------------------- Accounts

export function getUser(name) {
  return load().users[normalizeName(name)] || null;
}

/** The account behind a handle, or null. */
export function userByHandle(handle) {
  const h = String(handle ?? '').trim().replace(/^#/, '').toUpperCase();
  if (!HANDLE_RE.test(h)) return null;
  const users = load().users;
  const name = Object.keys(users).find(k => users[k].handle === h);
  return name ? { name, ...users[name] } : null;
}

export function listUsers() {
  const users = load().users;
  return Object.keys(users).sort().map(name => ({
    name,
    handle: users[name].handle,
    display: displayName(name, users[name]),
    nick: users[name].nick || null,
    invitedBy: users[name].invitedBy || null,
    avatar: users[name].avatar || null,          // image version; the image is in profile.js
    admin: !!users[name].admin,
    mustChange: !!users[name].mustChange,
    created: users[name].created || null,
    changed: users[name].changed || null
  }));
}

/** Does this account administer the instance? Read fresh from the file every time. */
export function isAdmin(name) {
  return !!getUser(name)?.admin;
}

/**
 * Grants or revokes the admin flag. Admins see all running games and all
 * accounts in their lobby; the flag changes nothing about how they play.
 */
export function setAdmin(name, on) {
  const key = normalizeName(name);
  const db = load();
  if (!db.users[key]) throw new Error('auth.cli.unknown');
  if (on) db.users[key].admin = true;
  else delete db.users[key].admin;
  save(db);
  return { name: key, admin: !!on };
}

/**
 * Creates an account. Without a password one is generated and returned -
 * this is the only moment it exists in plain text.
 * Options: `mustChange` (default true - a password someone else chose has
 * to be replaced), `invitedBy` (the admin whose invite link was used).
 */
export async function addUser(name, password, { mustChange = true, invitedBy = null } = {}) {
  const key = normalizeName(name);
  if (!validName(key)) throw new Error('auth.cli.badName');
  if (load().users[key]) throw new Error('auth.cli.exists');
  const generated = !password;
  const pw = password || generatePassword();
  const problem = password ? checkPassword(pw, key) : null;
  if (problem) throw new Error(problem);
  const spelling = String(name).trim();
  const hash = await hashPassword(pw);
  // Hashing takes a while: check again right before writing, in one go, so
  // two simultaneous sign-ups with the same name cannot overwrite each other.
  const db = load();
  if (db.users[key]) throw new Error('auth.cli.exists');
  db.users[key] = {
    hash,
    handle: newHandle(db.users),
    mustChange,
    created: new Date().toISOString(),
    changed: null,
    news: RELEASE,
    ...(spelling !== key ? { display: spelling } : {}),
    ...(invitedBy ? { invitedBy } : {})
  };
  save(db);
  return { name: key, display: displayName(key, db.users[key]), password: pw, generated };
}

/**
 * Sets the spelling in which an account is displayed. Only a different
 * capitalization of the same name is allowed - renaming would mean a player
 * keeps playing under someone else's name.
 */
export function setDisplay(name, spelling) {
  const key = normalizeName(name);
  const db = load();
  if (!db.users[key]) throw new Error('auth.cli.unknown');
  const shown = String(spelling ?? '').trim();
  if (normalizeName(shown) !== key) throw new Error('auth.cli.badSpelling');
  if (shown === key) delete db.users[key].display;
  else db.users[key].display = shown;
  save(db);
  return { name: key, display: displayName(key, db.users[key]) };
}

/**
 * Profile of an account: freely chosen display name (`nick`) and the version
 * of the image (`avatar`, the image itself is handled in server/profile.js).
 * null removes the entry, undefined leaves it in place.
 */
export function setProfile(name, { nick, avatar } = {}) {
  const key = normalizeName(name);
  const db = load();
  const user = db.users[key];
  if (!user) throw new Error('auth.cli.unknown');
  for (const [field, value] of Object.entries({ nick, avatar })) {
    if (value === undefined) continue;
    if (value === null || value === '') delete user[field];
    else user[field] = String(value);
  }
  save(db);
  return { name: key, nick: user.nick || null, avatar: user.avatar || null };
}

/**
 * The change notes of this release have been shown to the account - they
 * appear once per account, not once per browser.
 */
export function setNewsSeen(name, release) {
  const key = normalizeName(name);
  const db = load();
  if (!db.users[key] || db.users[key].news === release) return;
  db.users[key].news = release;
  save(db);
}

export function deleteUser(name) {
  const key = normalizeName(name);
  const db = load();
  if (!db.users[key]) return false;
  delete db.users[key];
  save(db);
  // The profile image belongs to the account and goes with it (see server/profile.js).
  for (const ext of ['png', 'jpeg', 'webp']) {
    try { fs.unlinkSync(path.join(path.dirname(userFile()), 'avatars', `${key}.${ext}`)); } catch { /* none */ }
  }
  return true;
}

/**
 * Sets a password. `mustChange` means: on the next sign-in the player has to
 * choose their own - that is how it is after creating and after resetting.
 */
export async function setPassword(name, password, { mustChange = false } = {}) {
  const key = normalizeName(name);
  const db = load();
  if (!db.users[key]) throw new Error('auth.cli.unknown');
  const problem = checkPassword(password, key);
  if (problem) throw new Error(problem);
  db.users[key] = {
    ...db.users[key],
    hash: await hashPassword(password),
    mustChange,
    changed: new Date().toISOString()
  };
  save(db);
  return { name: key };
}

/** As when creating: a new random password that has to be changed again. */
export async function resetPassword(name) {
  const pw = generatePassword();
  await setPassword(name, pw, { mustChange: true });
  return { name: normalizeName(name), password: pw };
}

/**
 * Check sign-in data. With an unknown name it runs against a dummy hash so
 * the response time does not reveal which accounts exist.
 */
export async function verifyUser(name, password) {
  const user = getUser(name);
  const ok = await verifyPassword(String(password ?? ''), user?.hash ?? 'x');
  if (!ok || !user) return null;
  const key = normalizeName(name);
  return { name: key, display: displayName(key, user), mustChange: !!user.mustChange, stamp: stampOf(user.hash) };
}

/**
 * Short fingerprint of the hash. A session remembers it and only stays valid
 * as long as it matches - a reset password thereby signs out all old sessions.
 */
export function stampOf(hash) {
  return crypto.createHash('sha256').update(String(hash ?? '')).digest('base64url').slice(0, 16);
}
