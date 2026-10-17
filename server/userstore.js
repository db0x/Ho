// Benutzerkonten. Auf dem Host steht nur, wer mitspielen darf (Name) und wie
// sich ein Passwort pruefen laesst (scrypt-Hash samt Salz und Parametern) -
// kein Klartext, keine Sitzungsschluessel, keine Mailadressen.
//
// Angelegt und geloescht wird von aussen mit server/users.js, also per
// `docker exec`. Der Server liest die Datei nur und merkt an mtime und Groesse,
// wenn sie sich geaendert hat: ein geloeschtes Konto fliegt dadurch auch aus
// einer laufenden Sitzung.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// scrypt mit N=16384: rund 40 ms und 16 MB je Pruefung. Genug Bremse gegen
// Rateversuche und noch unter dem maxmem, das Node von sich aus zulaesst.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Namen bleiben klein geschrieben und schlicht - sie landen in Dateien und URLs. */
export const NAME_RE = /^[a-z0-9][a-z0-9._-]{1,23}$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

// Zeichen ohne Verwechslungsgefahr (kein 0/O, kein 1/l/I) - das erste Passwort
// wird abgetippt oder vorgelesen.
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

/** Null, wenn das Passwort taugt, sonst der Schluessel der Beanstandung. */
export function checkPassword(password, name) {
  const pw = String(password ?? '');
  if (pw.length < MIN_PASSWORD) return 'auth.err.tooShort';
  if (pw.length > MAX_PASSWORD) return 'auth.err.tooLong';
  if (name && pw.toLowerCase() === normalizeName(name)) return 'auth.err.sameAsUser';
  return null;
}

/** Erstes Passwort: drei Gruppen zu fuenf Zeichen, rund 73 Bit. */
export function generatePassword() {
  const zeichen = () => ALPHABET[crypto.randomInt(ALPHABET.length)];
  return [0, 1, 2].map(() => Array.from({ length: 5 }, zeichen).join('')).join('-');
}

// ------------------------------------------------------------------- Hashes

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return new Promise((ok, fehler) => {
    crypto.scrypt(password, salt, SCRYPT.keylen, SCRYPT, (e, key) => {
      if (e) return fehler(e);
      ok(['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
        salt.toString('base64'), key.toString('base64')].join('$'));
    });
  });
}

/**
 * Prueft ein Passwort gegen einen gespeicherten Hash. Laeuft auch bei Unsinn
 * im Hash die volle Zeit ab und vergleicht zeitunabhaengig - sonst verraet
 * die Dauer, ob ein Konto ueberhaupt existiert.
 */
export function verifyPassword(password, stored) {
  const teile = String(stored ?? '').split('$');
  const brauchbar = teile.length === 6 && teile[0] === 'scrypt';
  const N = brauchbar ? Number(teile[1]) : SCRYPT.N;
  const r = brauchbar ? Number(teile[2]) : SCRYPT.r;
  const p = brauchbar ? Number(teile[3]) : SCRYPT.p;
  const salt = brauchbar ? Buffer.from(teile[4], 'base64') : Buffer.alloc(16);
  const soll = brauchbar ? Buffer.from(teile[5], 'base64') : Buffer.alloc(SCRYPT.keylen);
  if (!Number.isInteger(N) || N < 2 || N > 1 << 20 || !Number.isInteger(r) || r < 1 || r > 32
    || !Number.isInteger(p) || p < 1 || p > 16 || !soll.length) {
    return Promise.resolve(false);
  }
  return new Promise((ok) => {
    crypto.scrypt(password, salt, soll.length, { N, r, p, maxmem: 160 * 1024 * 1024 }, (e, key) => {
      if (e) return ok(false);
      ok(brauchbar && crypto.timingSafeEqual(key, soll));
    });
  });
}

// -------------------------------------------------------------------- Datei

let cache = null;              // { db, mtimeMs, size }

function leer() { return { version: 1, users: {} }; }

/** Liest die Datei; unveraendert kommt sie aus dem Zwischenspeicher. */
export function load() {
  const file = userFile();
  let st = null;
  try { st = fs.statSync(file); } catch { cache = null; return leer(); }
  if (cache && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.db;
  let db = leer();
  try {
    const roh = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (roh && typeof roh.users === 'object' && roh.users) db = { version: 1, users: roh.users };
  } catch (e) {
    // Lieber laut scheitern als stillschweigend alle aussperren oder, schlimmer,
    // alle hereinlassen.
    throw new Error(`users.json ist unlesbar (${file}): ${e.message}`);
  }
  cache = { db, mtimeMs: st.mtimeMs, size: st.size };
  return db;
}

/** Schreibt erst daneben und schiebt dann um - ein Abbruch laesst die alte Datei stehen. */
export function save(db) {
  const file = userFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  cache = null;
  return file;
}

// ------------------------------------------------------------------- Konten

export function getUser(name) {
  return load().users[normalizeName(name)] || null;
}

export function listUsers() {
  const users = load().users;
  return Object.keys(users).sort().map(name => ({
    name,
    mustChange: !!users[name].mustChange,
    created: users[name].created || null,
    changed: users[name].changed || null
  }));
}

/**
 * Legt ein Konto an. Ohne Passwort wird eines gewuerfelt und zurueckgegeben -
 * es ist der einzige Moment, in dem es im Klartext existiert.
 */
export async function addUser(name, password) {
  const key = normalizeName(name);
  if (!validName(key)) throw new Error('auth.cli.badName');
  const db = load();
  if (db.users[key]) throw new Error('auth.cli.exists');
  const gewuerfelt = !password;
  const pw = password || generatePassword();
  const rüge = password ? checkPassword(pw, key) : null;
  if (rüge) throw new Error(rüge);
  db.users[key] = {
    hash: await hashPassword(pw),
    mustChange: true,
    created: new Date().toISOString(),
    changed: null
  };
  save(db);
  return { name: key, password: pw, generated: gewuerfelt };
}

export function deleteUser(name) {
  const key = normalizeName(name);
  const db = load();
  if (!db.users[key]) return false;
  delete db.users[key];
  save(db);
  return true;
}

/**
 * Setzt ein Passwort. `mustChange` heisst: beim naechsten Anmelden muss der
 * Spieler ein eigenes waehlen - so ist es beim Anlegen und beim Zuruecksetzen.
 */
export async function setPassword(name, password, { mustChange = false } = {}) {
  const key = normalizeName(name);
  const db = load();
  if (!db.users[key]) throw new Error('auth.cli.unknown');
  const rüge = checkPassword(password, key);
  if (rüge) throw new Error(rüge);
  db.users[key] = {
    ...db.users[key],
    hash: await hashPassword(password),
    mustChange,
    changed: new Date().toISOString()
  };
  save(db);
  return { name: key };
}

/** Wie beim Anlegen: neues Zufallspasswort, das wieder gewechselt werden muss. */
export async function resetPassword(name) {
  const pw = generatePassword();
  await setPassword(name, pw, { mustChange: true });
  return { name: normalizeName(name), password: pw };
}

/**
 * Anmeldedaten pruefen. Laeuft bei unbekanntem Namen gegen einen Blindhash,
 * damit die Antwortzeit nicht verraet, welche Konten es gibt.
 */
export async function verifyUser(name, password) {
  const user = getUser(name);
  const ok = await verifyPassword(String(password ?? ''), user?.hash ?? 'x');
  if (!ok || !user) return null;
  return { name: normalizeName(name), mustChange: !!user.mustChange, stamp: stampOf(user.hash) };
}

/**
 * Kurzer Fingerabdruck des Hashes. Eine Sitzung merkt sich ihn und gilt nur
 * weiter, solange er passt - ein zurueckgesetztes Passwort meldet damit alle
 * alten Sitzungen ab.
 */
export function stampOf(hash) {
  return crypto.createHash('sha256').update(String(hash ?? '')).digest('base64url').slice(0, 16);
}
