// End-to-end encryption of the messages between friends.
//
// Every browser (device) has its own key pair: ECDH on P-256. The private key
// is created non-extractable and stays in IndexedDB - not even this page's
// own code can read it out, let alone the server. The public key goes to the
// server so friends can encrypt for this device.
//
// A message gets a random AES-GCM key of its own. The text is encrypted with
// it once; the key itself is wrapped once per receiving device - every device
// of the friend and every device of the sender - with a key that only the
// two devices involved can derive (ECDH -> HKDF -> AES-GCM). The server
// stores and forwards the envelope and can read none of it.
//
// A new device only reads what arrives from then on: older messages were not
// wrapped for it. Whether the server hands out the right public keys can be
// checked with the safety code - the same on both sides if nobody swapped one.
//
// Plain WebCrypto: runs in the browser and, for the tests, in Node.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const INFO = enc.encode('ho-e2e-v1');
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };

export const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** A fresh device: id, key pair (private part not extractable) and the public key as base64. */
export async function createDevice() {
  const keys = await subtle.generateKey(CURVE, false, ['deriveBits']);
  const id = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join('');
  return { id, keys, pub: b64(await subtle.exportKey('raw', keys.publicKey)) };
}

/**
 * The key two devices share: ECDH, then HKDF. Kept per partner key - deriving
 * it costs a few milliseconds, a conversation needs it for every message.
 */
async function pairKey(device, pub) {
  device.cache ||= new Map();
  if (device.cache.has(pub)) return device.cache.get(pub);
  const promise = (async () => {
    const other = await subtle.importKey('raw', unb64(pub), CURVE, false, []);
    const bits = await subtle.deriveBits({ name: 'ECDH', public: other }, device.keys.privateKey, 256);
    const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO },
      hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  })();
  device.cache.set(pub, promise);
  return promise;
}

const iv = () => globalThis.crypto.getRandomValues(new Uint8Array(12));

/**
 * Encrypts a text for these devices ({id, pub}, own ones included).
 * @returns the envelope the server stores and forwards
 */
export async function encrypt(device, text, recipients) {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const content = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const ivText = iv();
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: ivText }, content, enc.encode(text));
  const keys = {};
  for (const r of recipients) {
    if (keys[r.id]) continue;
    const ivKey = iv();
    const wrapped = await subtle.encrypt({ name: 'AES-GCM', iv: ivKey }, await pairKey(device, r.pub), raw);
    keys[r.id] = { iv: b64(ivKey), k: b64(wrapped) };
  }
  return { v: 1, dev: device.id, pub: device.pub, iv: b64(ivText), ct: b64(ct), keys };
}

/** The text of an envelope, or null if it was not meant for this device or does not open. */
export async function decrypt(device, env) {
  const mine = env?.keys?.[device.id];
  if (!mine) return null;
  try {
    const raw = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(mine.iv) }, await pairKey(device, env.pub), unb64(mine.k));
    const content = await subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    return dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, content, unb64(env.ct)));
  } catch {
    return null;
  }
}

/**
 * Safety code of two friends: a hash over all device keys of both, in a fixed
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

const DB = 'ho-e2e', STORE = 'device';

function openDb() {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
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

/**
 * This browser's device, per account: loaded, or created and stored. Without
 * IndexedDB (private windows in some browsers) a key lives only as long as
 * the page - `stored` says which.
 */
export async function loadDevice(account) {
  try {
    const db = await openDb();
    const saved = await tx(db, 'readonly', s => s.get(account));
    if (saved?.keys && saved.id && saved.pub) return { ...saved, stored: true };
    const device = await createDevice();
    await tx(db, 'readwrite', s => s.put({ id: device.id, keys: device.keys, pub: device.pub }, account));
    return { ...device, stored: true };
  } catch {
    return { ...(await createDevice()), stored: false };
  }
}
