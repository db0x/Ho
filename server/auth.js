// Zugang zum Spiel. Vor der Lobby steht eine Anmeldung mit Name und Passwort;
// ohne gueltige Sitzung gibt der Server weder den Client noch die WebSocket
// heraus.
//
// Sitzungen stehen nur im Speicher: so landet kein Schluessel auf der Platte,
// auf dem Host liegt wirklich nur Name und Hash. Ein Neustart meldet alle ab -
// das ist zu verkraften, denn mit ihm sind auch alle Partien weg.
import crypto from 'node:crypto';
import {
  verifyUser, getUser, setPassword, stampOf, checkPassword, displayName, MIN_PASSWORD
} from './userstore.js';

/**
 * Konto nachschlagen, ohne dass eine unlesbare Datei den Server umbringt: sie
 * wird in jeder Anfrage gelesen, ein Wurf dort reichte bis in den HTTP-Server.
 * Im Zweifel kommt niemand herein - lieber ausgesperrt als offen.
 */
function konto(name) {
  try { return getUser(name); } catch (e) {
    console.error('Kontendatei unlesbar:', e.message);
    return null;
  }
}

const COOKIE = 'ho_sid';
const SESSION_MS = (Number(process.env.HO_SESSION_DAYS) || 30) * 86400 * 1000;
const MAX_BODY = 4096;

// Ab dem fuenften Fehlversuch wird gesperrt, und zwar immer laenger: 30 s, 1 min,
// 2 min ... bis 15 min. Gezaehlt wird nach Konto und nach Herkunft, damit weder
// ein Konto durchprobiert noch von einer Stelle aus gestreut werden kann.
const FREI = 4;
const SPERRE_MAX = 15 * 60 * 1000;
const VERGESSEN = 60 * 60 * 1000;

/** @type {Map<string, {user: string, stamp: string, mustChange: boolean, created: number, seen: number}>} */
const sessions = new Map();
/** @type {Map<string, {fails: number, until: number, seen: number}>} */
const versuche = new Map();

/** Abschaltbar fuer die Entwicklung und die Tests - im Betrieb bleibt sie an. */
export function authEnabled() {
  return process.env.HO_AUTH !== 'off';
}

// Was ohne Anmeldung herausgeht: die Anmeldeseite und was sie zum Anzeigen
// braucht. Alles andere - Spielclient, Regeln, WebSocket - bleibt zu.
const OFFEN_GENAU = new Set([
  '/login.html', '/js/login.js', '/js/i18n.js', '/shared/i18n.js', '/favicon.ico'
]);
const OFFEN_PRAEFIX = ['/css/', '/img/', '/i18n/'];

function offen(pfad) {
  return OFFEN_GENAU.has(pfad) || OFFEN_PRAEFIX.some(p => pfad.startsWith(p));
}

// ---------------------------------------------------------------- Sitzungen

function cookies(req) {
  const roh = req.headers.cookie;
  if (!roh) return {};
  const out = {};
  for (const teil of roh.split(';')) {
    const i = teil.indexOf('=');
    if (i < 1) continue;
    out[teil.slice(0, i).trim()] = decodeURIComponent(teil.slice(i + 1).trim());
  }
  return out;
}

/** Hinter einem Reverse-Proxy entscheidet X-Forwarded-Proto ueber das Secure-Flag. */
function secure(req) {
  if (process.env.HO_SECURE_COOKIES === '1') return true;
  if (process.env.HO_SECURE_COOKIES === '0') return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https' || !!req.socket.encrypted;
}

function setCookie(req, res, token) {
  const teile = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`];
  if (secure(req)) teile.push('Secure');
  res.setHeader('set-cookie', teile.join('; '));
}

function clearCookie(req, res) {
  const teile = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure(req)) teile.push('Secure');
  res.setHeader('set-cookie', teile.join('; '));
}

function neueSitzung(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(token, {
    user: user.name, stamp: user.stamp, mustChange: user.mustChange, created: now, seen: now
  });
  return token;
}

/**
 * Die Sitzung hinter einer Anfrage - oder null. Geprueft wird jedes Mal auch,
 * ob das Konto noch existiert und das Passwort nicht zwischenzeitlich
 * zurueckgesetzt wurde; ein `docker exec ... del` wirkt damit sofort.
 */
export function sessionOf(req) {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (now - s.created > SESSION_MS) { sessions.delete(token); return null; }
  const user = konto(s.user);
  if (!user || stampOf(user.hash) !== s.stamp) { sessions.delete(token); return null; }
  s.seen = now;
  s.mustChange = !!user.mustChange;
  // Die Schreibweise frisch aus der Kontendatei: ein `users.js name` wirkt
  // damit ohne neues Anmelden.
  return { ...s, token, display: displayName(s.user, user) };
}

/** Lebt diese Sitzung noch? Fuer offene WebSockets, die nachtraeglich fliegen. */
export function sessionAlive(token) {
  if (!authEnabled()) return true;
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  const user = konto(s.user);
  if (!user || stampOf(user.hash) !== s.stamp || Date.now() - s.created > SESSION_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/** Alle Sitzungen eines Kontos beenden. */
export function revoke(user) {
  for (const [token, s] of sessions) if (s.user === user) sessions.delete(token);
}

// ------------------------------------------------------------------- Bremse

function herkunft(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || '?';
}

function gesperrt(...schluessel) {
  const now = Date.now();
  let bis = 0;
  for (const k of schluessel) {
    const v = versuche.get(k);
    if (v && v.until > now) bis = Math.max(bis, v.until);
  }
  return bis ? Math.ceil((bis - now) / 1000) : 0;
}

function fehlversuch(...schluessel) {
  const now = Date.now();
  for (const k of schluessel) {
    const v = versuche.get(k) || { fails: 0, until: 0, seen: now };
    v.fails++;
    v.seen = now;
    if (v.fails > FREI) {
      v.until = now + Math.min(SPERRE_MAX, 30_000 * 2 ** (v.fails - FREI - 1));
    }
    versuche.set(k, v);
  }
}

function gelungen(...schluessel) {
  for (const k of schluessel) versuche.delete(k);
}

// Alte Zaehler und abgelaufene Sitzungen wegwerfen.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of versuche) if (now - v.seen > VERGESSEN && v.until < now) versuche.delete(k);
  for (const [token, s] of sessions) if (now - s.created > SESSION_MS) sessions.delete(token);
}, 10 * 60 * 1000).unref?.();

// ---------------------------------------------------------------- Endpunkte

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }).end(text);
}

// Genau diese drei Arten kann ein Formular auf einer fremden Seite erzeugen.
// Sie auszuschliessen schuetzt vor untergeschobenen Anmeldungen; alles andere
// darf kommen, solange JSON darin steht - sonst scheitert die Anmeldung an
// einer Kleinigkeit in der Kopfzeile, die kein Mensch sieht.
const FORMULAR = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

function body(req) {
  return new Promise((ok, fehler) => {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (FORMULAR.some(f => ct.startsWith(f))) {
      return fehler(new Error(`Formulardaten statt JSON (content-type: ${ct})`));
    }
    let roh = '';
    req.on('data', (d) => {
      roh += d;
      if (roh.length > MAX_BODY) {
        fehler(new Error(`Rumpf zu gross (ueber ${MAX_BODY} Zeichen)`));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { ok(JSON.parse(roh || '{}')); } catch {
        fehler(new Error(`kein JSON im Rumpf (content-type: ${ct || 'fehlt'}, ${roh.length} Zeichen)`));
      }
    });
    req.on('error', (e) => fehler(new Error('Verbindung abgebrochen: ' + e.message)));
  });
}

/**
 * Behandelt /api/auth/*. Gibt true zurueck, wenn die Anfrage beantwortet ist.
 */
export function handleAuth(req, res, pfad) {
  if (!pfad.startsWith('/api/auth/')) return false;
  if (!authEnabled()) { json(res, 404, { error: 'auth.err.off' }); return true; }

  const route = pfad.slice('/api/auth/'.length);
  if (route === 'me' && req.method === 'GET') {
    const s = sessionOf(req);
    if (!s) json(res, 401, { error: 'auth.err.noSession' });
    else json(res, 200, { user: s.user, display: s.display, mustChange: s.mustChange, minPassword: MIN_PASSWORD });
    return true;
  }
  if (route === 'login' && req.method === 'POST') { login(req, res); return true; }
  if (route === 'change' && req.method === 'POST') { change(req, res); return true; }
  if (route === 'logout' && req.method === 'POST') {
    const token = cookies(req)[COOKIE];
    if (token) sessions.delete(token);
    clearCookie(req, res);
    json(res, 200, { ok: true });
    return true;
  }
  json(res, 404, { error: 'auth.err.unknownRoute' });
  return true;
}

async function login(req, res) {
  let daten;
  try { daten = await body(req); } catch (e) {
    console.warn('Anmeldung unverstaendlich:', e.message);
    return json(res, 400, { error: 'auth.err.badRequest' });
  }
  const name = String(daten.user ?? '').trim().toLowerCase();
  const pw = String(daten.password ?? '');
  if (!name || !pw) return json(res, 400, { error: 'auth.err.needFields' });

  const ip = herkunft(req);
  const wartet = gesperrt(`u:${name}`, `i:${ip}`);
  if (wartet) return json(res, 429, { error: 'auth.err.locked', params: { n: wartet } });

  let user = null;
  try { user = await verifyUser(name, pw); } catch (e) {
    console.error('Anmeldung fehlgeschlagen:', e.message);
    return json(res, 500, { error: 'auth.err.server' });
  }
  if (!user) {
    fehlversuch(`u:${name}`, `i:${ip}`);
    console.warn(`Anmeldung abgewiesen: ${name} von ${ip}`);
    return json(res, 401, { error: 'auth.err.badLogin' });
  }
  gelungen(`u:${name}`, `i:${ip}`);
  setCookie(req, res, neueSitzung(user));
  console.log(`Angemeldet: ${user.name}${user.mustChange ? ' (Passwortwechsel faellig)' : ''}`);
  json(res, 200, { ok: true, user: user.name, mustChange: user.mustChange });
}

async function change(req, res) {
  const s = sessionOf(req);
  if (!s) return json(res, 401, { error: 'auth.err.noSession' });
  let daten;
  try { daten = await body(req); } catch (e) {
    console.warn('Passwortwechsel unverstaendlich:', e.message);
    return json(res, 400, { error: 'auth.err.badRequest' });
  }
  const alt = String(daten.password ?? '');
  const neu = String(daten.newPassword ?? '');

  const ip = herkunft(req);
  const wartet = gesperrt(`u:${s.user}`, `i:${ip}`);
  if (wartet) return json(res, 429, { error: 'auth.err.locked', params: { n: wartet } });

  // Das bisherige Passwort noch einmal verlangen: sonst koennte ein fremder
  // Browser mit offener Sitzung das Konto uebernehmen.
  let user = null;
  try { user = await verifyUser(s.user, alt); } catch (e) {
    console.error('Passwortpruefung fehlgeschlagen:', e.message);
    return json(res, 500, { error: 'auth.err.server' });
  }
  if (!user) {
    fehlversuch(`u:${s.user}`, `i:${ip}`);
    return json(res, 401, { error: 'auth.err.badLogin' });
  }
  if (neu === alt) return json(res, 400, { error: 'auth.err.sameAsOld' });
  const rüge = checkPassword(neu, s.user);
  if (rüge) return json(res, 400, { error: rüge, params: { n: MIN_PASSWORD } });

  try { await setPassword(s.user, neu, { mustChange: false }); } catch (e) {
    console.error('Passwortwechsel fehlgeschlagen:', e.message);
    return json(res, 500, { error: 'auth.err.server' });
  }
  gelungen(`u:${s.user}`, `i:${ip}`);
  // Alle Sitzungen des Kontos verfallen mit dem neuen Hash - auch die eigene,
  // also gleich eine frische ausstellen.
  revoke(s.user);
  const frisch = konto(s.user);
  setCookie(req, res, neueSitzung({ name: s.user, stamp: stampOf(frisch.hash), mustChange: false }));
  console.log(`Passwort geaendert: ${s.user}`);
  json(res, 200, { ok: true, user: s.user, mustChange: false });
}

// ------------------------------------------------------------- Torwaechter

/**
 * Darf diese Anfrage durch zu den Dateien? Sonst ist die Antwort schon
 * geschrieben: ein Verweis auf die Anmeldeseite, wenn ein Browser eine Seite
 * holen will, sonst ein nackter 401.
 */
export function gate(req, res, pfad) {
  if (!authEnabled()) return true;
  // Stylesheet, Wortmarke und Kataloge gehen heraus, ohne dass dafuer die
  // Kontendatei angefasst wird.
  if (offen(pfad) && pfad !== '/login.html') return true;
  const s = sessionOf(req);
  if (offen(pfad)) {
    // Angemeldet und nichts mehr zu tun? Dann gehoert man ins Spiel, nicht auf
    // die Anmeldeseite.
    if (pfad === '/login.html' && s && !s.mustChange) {
      res.writeHead(302, { location: '/', 'cache-control': 'no-store' }).end();
      return false;
    }
    return true;
  }
  if (s && !s.mustChange) return true;

  const willSeite = String(req.headers.accept || '').includes('text/html');
  if (!willSeite) {
    json(res, 401, { error: s ? 'auth.err.mustChange' : 'auth.err.noSession' });
    return false;
  }
  const ziel = pfad === '/' || pfad === '/index.html' ? '/login.html'
    : `/login.html?next=${encodeURIComponent(pfad)}`;
  res.writeHead(302, { location: ziel, 'cache-control': 'no-store' }).end();
  return false;
}

/**
 * Prueft das Upgrade auf eine WebSocket. Ohne das hiesse die Anmeldung nichts:
 * das Spiel laeuft ueber die Socket, nicht ueber HTTP.
 */
export function checkUpgrade(req) {
  if (!authEnabled()) return { user: null, display: null, token: null };
  const s = sessionOf(req);
  if (!s || s.mustChange) return null;
  return { user: s.user, display: s.display, token: s.token };
}

/** Nur fuer Tests: Zustand zuruecksetzen. */
export function resetAuthState() {
  sessions.clear();
  versuche.clear();
}
