// Profil eines Spielers: Anzeigename und Bild.
//
// Mit Anmeldung gehoert beides zum Konto - der Name steht als `nick` in der
// Kontendatei, das Bild als Datei daneben (avatars/<konto>.<endung>), damit es
// jede Sitzung und jedes Geraet wiederfindet. Ohne Anmeldung haelt der
// Browser beides selbst und reicht es beim Verbinden herein; der Server
// merkt sich das Bild dann nur im Speicher.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getUser, listUsers, normalizeName, setProfile, userFile } from './userstore.js';

export const NAME_MAX = 18;
// Ein verkleinertes Bild (128 px, WebP) liegt bei 5-15 kB. Was weit darueber
// liegt, hat der Client nicht verkleinert.
export const AVATAR_MAX = 64 * 1024;

const ARTEN = {
  png: { mime: 'image/png', passt: b => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  jpeg: { mime: 'image/jpeg', passt: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { mime: 'image/webp', passt: b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' }
};

/**
 * Namen landen ueberall per innerHTML im Client - also nichts, was dort als
 * Markup gelesen werden koennte, keine Steuerzeichen, kein Leerraum am Rand.
 */
export function cleanName(name) {
  return String(name ?? '')
    .replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

/**
 * Darf ein Konto so heissen? Frei, nur nicht wie ein anderes Konto - sonst
 * spielte jemand unter dem Namen eines Mitspielers.
 */
export function nameAllowed(name, ownKey) {
  const n = normalizeName(name);
  if (n.length < 2) return 'profile.err.short';
  for (const u of listUsers()) {
    if (u.name === ownKey) continue;
    if (u.name === n || normalizeName(u.display) === n || normalizeName(getUser(u.name)?.nick) === n) {
      return 'profile.err.taken';
    }
  }
  return null;
}

/** In einer Partie heisst jeder anders: notfalls mit angehaengter Nummer. */
export function uniqueName(game, name, selfId) {
  const belegt = new Set(game.players.filter(p => p.id !== selfId).map(p => p.name.toLowerCase()));
  if (!belegt.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const anhang = ' ' + i;
    const kandidat = name.slice(0, NAME_MAX - anhang.length).trim() + anhang;
    if (!belegt.has(kandidat.toLowerCase())) return kandidat;
  }
}

// ------------------------------------------------------------------- Bilder

/** id -> { buf, mime } ; Gaeste nur hier, Konten zusaetzlich auf der Platte. */
const bilder = new Map();
const GAESTE_MAX = 400;

function ordner() {
  return path.join(path.dirname(userFile()), 'avatars');
}

/** Ein data:-URL vom Client in geprueftes Bild verwandeln - oder Fehlerschluessel. */
export function parseAvatar(dataUrl) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) return { error: 'profile.err.image' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > AVATAR_MAX) return { error: 'profile.err.imageSize' };
  // Dem Etikett allein wird nicht geglaubt: die ersten Bytes muessen passen.
  if (!ARTEN[m[1]].passt(buf)) return { error: 'profile.err.image' };
  return { buf, art: m[1] };
}

function url(id, version) {
  return `api/avatar/${id}?v=${version}`;
}

/** Bild eines Gastes ablegen; zurueck kommt die Adresse fuer die Spielsicht. */
export function putGuestAvatar(bild, alteId) {
  if (alteId) bilder.delete(alteId);
  const id = 'g-' + crypto.randomBytes(9).toString('base64url');
  bilder.set(id, { buf: bild.buf, mime: ARTEN[bild.art].mime });
  // Aelteste Gaeste zuerst vergessen - sie laden ihr Bild beim naechsten
  // Verbinden ohnehin neu hoch.
  while (bilder.size > GAESTE_MAX) {
    const aelteste = [...bilder.keys()].find(k => k.startsWith('g-'));
    if (!aelteste) break;
    bilder.delete(aelteste);
  }
  return url(id, 1);
}

/** Bild eines Kontos speichern (null: entfernen); zurueck kommt die Adresse. */
export function putAccountAvatar(key, bild) {
  const dir = ordner();
  for (const art of Object.keys(ARTEN)) {
    try { fs.unlinkSync(path.join(dir, `${key}.${art}`)); } catch { /* war keins */ }
  }
  bilder.delete('u-' + key);
  if (!bild) { setProfile(key, { avatar: null }); return null; }
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${key}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, bild.buf, { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, `${key}.${bild.art}`));
  const version = Date.now().toString(36);
  setProfile(key, { avatar: version });
  return url('u-' + key, version);
}

/** Adresse des Kontobilds oder null. */
export function accountAvatarUrl(key) {
  const v = getUser(key)?.avatar;
  return v ? url('u-' + key, v) : null;
}

function lade(id) {
  if (bilder.has(id)) return bilder.get(id);
  if (!id.startsWith('u-')) return null;
  const key = id.slice(2);
  if (normalizeName(key) !== key || key.includes('/') || key.includes('.')) return null;
  for (const [art, a] of Object.entries(ARTEN)) {
    try {
      const buf = fs.readFileSync(path.join(ordner(), `${key}.${art}`));
      if (!a.passt(buf)) continue;
      const bild = { buf, mime: a.mime };
      bilder.set(id, bild);
      return bild;
    } catch { /* naechste Endung */ }
  }
  return null;
}

/** GET /api/avatar/<id>. Gibt true zurueck, wenn die Anfrage beantwortet ist. */
export function handleAvatar(req, res, pfad) {
  if (!pfad.startsWith('/api/avatar/')) return false;
  const id = pfad.slice('/api/avatar/'.length);
  const bild = /^[gu]-[A-Za-z0-9._-]{1,40}$/.test(id) ? lade(id) : null;
  if (!bild || req.method !== 'GET') { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return true; }
  res.writeHead(200, {
    'content-type': bild.mime,
    'x-content-type-options': 'nosniff',
    // Die Adresse traegt die Version - ein neues Bild hat eine neue.
    'cache-control': 'private, max-age=31536000, immutable'
  }).end(bild.buf);
  return true;
}
