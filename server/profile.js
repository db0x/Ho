// A player's profile: display name and image.
//
// With sign-in both belong to the account - the name is stored as `nick` in
// the account file, the image as a file next to it (avatars/<account>.<ext>),
// so every session and every device finds it again. Without sign-in the
// browser keeps both itself and hands them in when connecting; the server
// then only keeps the image in memory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getUser, listUsers, normalizeName, setProfile, userFile } from './userstore.js';

export const NAME_MAX = 18;
// A downscaled image (128 px, WebP) is around 5-15 kB. Anything far above
// that has not been downscaled by the client.
export const AVATAR_MAX = 64 * 1024;

const FORMATS = {
  png: { mime: 'image/png', matches: b => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  jpeg: { mime: 'image/jpeg', matches: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { mime: 'image/webp', matches: b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' }
};

/**
 * Names end up everywhere in the client via innerHTML - so nothing that could
 * be read as markup there, no control characters, no whitespace at the edges.
 * An apostrophe (' or `) becomes the letter apostrophe ʼ instead of vanishing:
 * Мар'яна and O'Brien stay readable, and nothing can break out of an
 * attribute or a string.
 */
export function cleanName(name) {
  return String(name ?? '')
    .replace(/['`]/g, 'ʼ')
    .replace(/[\u0000-\u001f\u007f<>&"\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

/**
 * Names nobody may take: they would pass for messages of the game or of
 * the instance's admins in chat and lobby.
 */
const RESERVED = new Set(['system', 'admin', 'administrator', 'server', 'ho!!', 'ho']);
export function reservedName(name) {
  return RESERVED.has(normalizeName(name));
}

/**
 * May an account use this name? Any name, just not that of another account -
 * otherwise someone would play under a fellow player's name.
 */
export function nameAllowed(name, ownKey) {
  const n = normalizeName(name);
  if (n.length < 2) return 'profile.err.short';
  if (reservedName(n)) return 'profile.err.reserved';
  for (const u of listUsers()) {
    if (u.name === ownKey) continue;
    if (u.name === n || normalizeName(u.display) === n || normalizeName(getUser(u.name)?.nick) === n) {
      return 'profile.err.taken';
    }
  }
  return null;
}

/** Within a game everyone has a different name: with a number appended if need be. */
export function uniqueName(game, name, selfId) {
  const taken = new Set(game.players.filter(p => p.id !== selfId).map(p => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const suffix = ' ' + i;
    const candidate = name.slice(0, NAME_MAX - suffix.length).trim() + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

// ------------------------------------------------------------------- Images

/** id -> { buf, mime } ; guests only here, accounts additionally on disk. */
const images = new Map();
const GUESTS_MAX = 400;

function folder() {
  return path.join(path.dirname(userFile()), 'avatars');
}

/** Turn a data: URL from the client into a checked image - or an error key. */
export function parseAvatar(dataUrl) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) return { error: 'profile.err.image' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > AVATAR_MAX) return { error: 'profile.err.imageSize' };
  // The label alone is not trusted: the first bytes have to match.
  if (!FORMATS[m[1]].matches(buf)) return { error: 'profile.err.image' };
  return { buf, format: m[1] };
}

function url(id, version) {
  return `api/avatar/${id}?v=${version}`;
}

/** Store a guest's image; returns the address for the game view. */
export function putGuestAvatar(image, oldId) {
  if (oldId) images.delete(oldId);
  const id = 'g-' + crypto.randomBytes(9).toString('base64url');
  images.set(id, { buf: image.buf, mime: FORMATS[image.format].mime });
  // Forget the oldest guests first - they upload their image again on the
  // next connect anyway.
  while (images.size > GUESTS_MAX) {
    const oldest = [...images.keys()].find(k => k.startsWith('g-'));
    if (!oldest) break;
    images.delete(oldest);
  }
  return url(id, 1);
}

/** Save an account's image (null: remove it); returns the address. */
export function putAccountAvatar(key, image) {
  const dir = folder();
  for (const ext of Object.keys(FORMATS)) {
    try { fs.unlinkSync(path.join(dir, `${key}.${ext}`)); } catch { /* there was none */ }
  }
  images.delete('u-' + key);
  if (!image) { setProfile(key, { avatar: null }); return null; }
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${key}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, image.buf, { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, `${key}.${image.format}`));
  const version = Date.now().toString(36);
  setProfile(key, { avatar: version });
  return url('u-' + key, version);
}

/** Address of the account image, or null. */
export function accountAvatarUrl(key) {
  const v = getUser(key)?.avatar;
  return v ? url('u-' + key, v) : null;
}

function loadImage(id) {
  if (images.has(id)) return images.get(id);
  if (!id.startsWith('u-')) return null;
  const key = id.slice(2);
  if (normalizeName(key) !== key || key.includes('/') || key.includes('.')) return null;
  for (const [ext, f] of Object.entries(FORMATS)) {
    try {
      const buf = fs.readFileSync(path.join(folder(), `${key}.${ext}`));
      if (!f.matches(buf)) continue;
      const image = { buf, mime: f.mime };
      images.set(id, image);
      return image;
    } catch { /* next extension */ }
  }
  return null;
}

/** GET /api/avatar/<id>. Returns true if the request has been answered. */
export function handleAvatar(req, res, urlPath) {
  if (!urlPath.startsWith('/api/avatar/')) return false;
  const id = urlPath.slice('/api/avatar/'.length);
  const image = /^[gu]-[A-Za-z0-9._-]{1,40}$/.test(id) ? loadImage(id) : null;
  if (!image || req.method !== 'GET') { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return true; }
  res.writeHead(200, {
    'content-type': image.mime,
    'x-content-type-options': 'nosniff',
    // The address carries the version - a new image gets a new one.
    'cache-control': 'private, max-age=31536000, immutable'
  }).end(image.buf);
  return true;
}
