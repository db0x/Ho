// End-to-end encryption of the messages between friends.
//
// Every account has one key pair: ECDH on P-256. So that the same account
// reads its messages on every device, the server keeps the private key too -
// but only wrapped: AES-GCM with a key derived from the account's password
// (PBKDF2, its own salt). The sign-in page opens it with the password just
// typed and keeps it in IndexedDB as a non-extractable key; from then on not
// even this page's own code can read it out. The public key is plain on the
// server so friends can encrypt for each other.
//
// Two friends share one key: ECDH of the one's private and the other's public
// key, then HKDF - both sides arrive at the same one. A message is encrypted
// with it directly; the envelope names both public keys it was made for, so
// after a key change it is clear which messages no longer open.
//
// What the server holds: public keys, wrapped private keys, ciphertext. A
// leaked copy of it is only of use with the password. Whoever runs the server
// sees the password at sign-in, though, and hands out this code - against
// that, browser end-to-end encryption cannot protect. Whether the server
// hands out the right public keys can be checked with the safety code.
//
// Plain WebCrypto: runs in the browser and, for the tests, in Node.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
// OWASP's figure for PBKDF2-SHA256: about half a second on a phone, once per sign-in.
export const KDF_ITER = 600_000;

export const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** The key that wraps the private key: PBKDF2 over the password. */
async function passwordKey(password, salt, iter) {
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** The private key as it goes to the server: {pub, salt, iv, key, iter}. */
async function wrap(pkcs8, pub, password) {
  const salt = random(16), iv = random(12);
  const key = await subtle.encrypt({ name: 'AES-GCM', iv }, await passwordKey(password, salt, KDF_ITER), pkcs8);
  return { pub, salt: b64(salt), iv: b64(iv), key: b64(key), iter: KDF_ITER };
}

/** The raw private key out of what the server keeps - or null if the password does not open it. */
async function unwrapRaw(saved, password) {
  try {
    const kek = await passwordKey(password, unb64(saved.salt), saved.iter);
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(saved.iv) }, kek, unb64(saved.key)));
  } catch {
    return null;
  }
}

/**
 * Opens a stored key with the password: {privateKey, pub}, the private part
 * not extractable. Null if the password does not fit - or if the private key
 * does not belong to the public key next to it.
 */
export async function unwrapKey(saved, password) {
  const raw = await unwrapRaw(saved, password);
  if (!raw) return null;
  try {
    const jwk = await subtle.exportKey('jwk', await subtle.importKey('pkcs8', raw, CURVE, true, ['deriveBits']));
    const point = new Uint8Array([4, ...b64url(jwk.x), ...b64url(jwk.y)]);
    if (b64(point) !== saved.pub) return null;
    return { privateKey: await subtle.importKey('pkcs8', raw, CURVE, false, ['deriveBits']), pub: saved.pub };
  } catch {
    return null;
  }
}

/** A new key for an account: {key, saved} - `saved` is what the server keeps. */
export async function createKey(password) {
  const pair = await subtle.generateKey(CURVE, true, ['deriveBits']);
  const pub = b64(await subtle.exportKey('raw', pair.publicKey));
  const pkcs8 = await subtle.exportKey('pkcs8', pair.privateKey);
  const saved = await wrap(pkcs8, pub, password);
  return { key: { privateKey: await subtle.importKey('pkcs8', pkcs8, CURVE, false, ['deriveBits']), pub }, saved };
}

/** The same key under a new password - for a password change. Null if the old one does not open it. */
export async function rewrapKey(saved, oldPassword, newPassword) {
  const raw = await unwrapRaw(saved, oldPassword);
  return raw && wrap(raw, saved.pub, newPassword);
}

/**
 * The key two friends share: ECDH, then HKDF. Kept per partner key - deriving
 * it costs a few milliseconds, a conversation needs it for every message.
 */
async function pairKey(key, pub) {
  key.cache ||= new Map();
  if (key.cache.has(pub)) return key.cache.get(pub);
  const promise = (async () => {
    const other = await subtle.importKey('raw', unb64(pub), CURVE, false, []);
    const bits = await subtle.deriveBits({ name: 'ECDH', public: other }, key.privateKey, 256);
    const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const info = enc.encode('ho-e2e-v2|' + [key.pub, pub].sort().join('|'));
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info },
      hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  })();
  key.cache.set(pub, promise);
  return promise;
}

/**
 * Encrypts a text for a friend.
 * @returns the envelope the server stores and forwards: sender key `a`, recipient key `b`
 */
export async function encrypt(key, text, friendPub) {
  const iv = random(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await pairKey(key, friendPub), enc.encode(text));
  return { v: 2, a: key.pub, b: friendPub, iv: b64(iv), ct: b64(ct) };
}

/** The text of an envelope, or null if it was made for another key or does not open. */
export async function decrypt(key, env) {
  const other = env?.a === key.pub ? env.b : env?.b === key.pub ? env.a : null;
  if (!other) return null;
  try {
    return dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, await pairKey(key, other), unb64(env.ct)));
  } catch {
    return null;
  }
}

/**
 * Safety code of two friends: a hash over the keys of both, in a fixed
 * order - so both see the same twelve digits. Different digits mean a key
 * the other one does not know about.
 */
export async function safetyCode(a, b) {
  const side = s => `${s.handle}:${[...s.pubs].sort().join(',')}`;
  const text = [side(a), side(b)].sort().join('|');
  const hash = new Uint8Array(await subtle.digest('SHA-256', enc.encode(text)));
  let digits = '';
  for (let i = 0; digits.length < 12; i += 4) {
    const n = ((hash[i] << 24) | (hash[i + 1] << 16) | (hash[i + 2] << 8) | hash[i + 3]) >>> 0;
    digits += String(n % 100000).padStart(5, '0');
  }
  return digits.slice(0, 12).replace(/(\d{4})(?=\d)/g, '$1 ');
}

// ------------------------------------------------------------ Key storage

// Version 2: one key per account instead of one per device - the old store goes.
const DB = 'ho-e2e', STORE = 'account';

function openDb() {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains('device')) db.deleteObjectStore('device');
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

function tx(db, mode, run) {
  return new Promise((ok, fail) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => ok(req?.result);
    t.onerror = () => fail(t.error);
  });
}

/** The account's key in this browser, by handle - or null. */
export async function loadKey(handle) {
  try {
    const saved = await (tx(await openDb(), 'readonly', s => s.get(handle)));
    return saved?.privateKey && saved.pub ? { privateKey: saved.privateKey, pub: saved.pub, stored: true } : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the key in this browser. Without IndexedDB (private windows in some
 * browsers) it lives only as long as the page - `stored` says which.
 */
export async function storeKey(handle, key) {
  try {
    await tx(await openDb(), 'readwrite', s => s.put({ privateKey: key.privateKey, pub: key.pub }, handle));
    return { ...key, stored: true };
  } catch {
    return { ...key, stored: false };
  }
}

/** Forgets the key in this browser - on signing out, or when it no longer fits. */
export async function dropKey(handle) {
  try { await tx(await openDb(), 'readwrite', s => s.delete(handle)); } catch { /* nothing stored */ }
}

/**
 * The key after a sign-in: opens the stored one with the password, or makes
 * one if the account has none yet and hands it to `upload` for the server.
 * `upload` resolves to the key the server keeps - another device may have
 * been quicker, then that one counts. Throws 'wrong' if the password does
 * not open the stored key.
 */
export async function setupKey(handle, password, saved, upload) {
  let key = null;
  if (!saved) {
    const made = await createKey(password);
    saved = await upload(made.saved);
    if (saved?.pub === made.key.pub) key = made.key;
  }
  key ||= saved && await unwrapKey(saved, password);
  if (!key) throw new Error('wrong');
  return storeKey(handle, key);
}
