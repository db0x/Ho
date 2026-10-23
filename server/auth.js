// Access to the game. In front of the lobby there is a sign-in with name and
// password; without a valid session the server hands out neither the client
// nor the WebSocket.
//
// Sessions live only in memory: that way no key ends up on disk, and the host
// really only stores name and hash. A restart signs everyone out - that is
// bearable, since all games are gone with it too.
import crypto from 'node:crypto';
import {
  verifyUser, getUser, setPassword, stampOf, checkPassword, displayName, validName, addUser, MIN_PASSWORD
} from './userstore.js';
import { peekInvite, consumeInvite, restoreInvite } from './invites.js';
import { nameAllowed } from './profile.js';

/**
 * Look up an account without an unreadable file killing the server: it is read
 * on every request, and a throw there would reach all the way into the HTTP
 * server. When in doubt nobody gets in - better locked out than open.
 */
function account(name) {
  try { return getUser(name); } catch (e) {
    console.error('Account file unreadable:', e.message);
    return null;
  }
}

const COOKIE = 'ho_sid';
const SESSION_MS = (Number(process.env.HO_SESSION_DAYS) || 30) * 86400 * 1000;
const MAX_BODY = 4096;

// From the fifth failed attempt on, there is a lockout, and an ever longer one:
// 30 s, 1 min, 2 min ... up to 15 min. Counted per account and per origin, so
// that neither one account can be brute-forced nor attempts spread from one place.
const FREE_ATTEMPTS = 4;
const LOCK_MAX = 15 * 60 * 1000;
const FORGET_AFTER = 60 * 60 * 1000;

/** @type {Map<string, {user: string, stamp: string, mustChange: boolean, created: number, seen: number}>} */
const sessions = new Map();
/** @type {Map<string, {fails: number, until: number, seen: number}>} */
const attempts = new Map();

/** Can be switched off for development and tests - in production it stays on. */
export function authEnabled() {
  return process.env.HO_AUTH !== 'off';
}

// What goes out without sign-in: the sign-in page and what it needs to
// display. Everything else - game client, rules, WebSocket - stays closed.
const PUBLIC_EXACT = new Set([
  '/login.html', '/js/login.js', '/js/i18n.js', '/js/ui/scene.js', '/shared/i18n.js', '/favicon.ico',
  '/manifest.webmanifest'
]);
const PUBLIC_PREFIX = ['/css/', '/img/', '/i18n/'];

function isPublic(urlPath) {
  return PUBLIC_EXACT.has(urlPath) || PUBLIC_PREFIX.some(p => urlPath.startsWith(p));
}

// ----------------------------------------------------------------- Sessions

function cookies(req) {
  const raw = req.headers.cookie;
  if (!raw) return {};
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Behind a reverse proxy, X-Forwarded-Proto decides about the Secure flag. */
function secure(req) {
  if (process.env.HO_SECURE_COOKIES === '1') return true;
  if (process.env.HO_SECURE_COOKIES === '0') return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https' || !!req.socket.encrypted;
}

function setCookie(req, res, token) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`];
  if (secure(req)) parts.push('Secure');
  res.setHeader('set-cookie', parts.join('; '));
}

function clearCookie(req, res) {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure(req)) parts.push('Secure');
  res.setHeader('set-cookie', parts.join('; '));
}

function newSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(token, {
    user: user.name, stamp: user.stamp, mustChange: user.mustChange, created: now, seen: now
  });
  return token;
}

/**
 * The session behind a request - or null. Every time it is also checked that
 * the account still exists and the password has not been reset in the
 * meantime; a `docker exec ... del` therefore takes effect immediately.
 */
export function sessionOf(req) {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (now - s.created > SESSION_MS) { sessions.delete(token); return null; }
  const user = account(s.user);
  if (!user || stampOf(user.hash) !== s.stamp) { sessions.delete(token); return null; }
  s.seen = now;
  s.mustChange = !!user.mustChange;
  // The spelling fresh from the account file: a `users.js name` thus takes
  // effect without signing in again.
  return { ...s, token, display: displayName(s.user, user) };
}

/** Is this session still alive? For open WebSockets that get kicked out afterwards. */
export function sessionAlive(token) {
  if (!authEnabled()) return true;
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  const user = account(s.user);
  if (!user || stampOf(user.hash) !== s.stamp || Date.now() - s.created > SESSION_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/** End all sessions of an account. */
export function revoke(user) {
  for (const [token, s] of sessions) if (s.user === user) sessions.delete(token);
}

// ----------------------------------------------------------------- Throttle

function origin(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || '?';
}

function lockedFor(...keys) {
  const now = Date.now();
  let until = 0;
  for (const k of keys) {
    const v = attempts.get(k);
    if (v && v.until > now) until = Math.max(until, v.until);
  }
  return until ? Math.ceil((until - now) / 1000) : 0;
}

function failedAttempt(...keys) {
  const now = Date.now();
  for (const k of keys) {
    const v = attempts.get(k) || { fails: 0, until: 0, seen: now };
    v.fails++;
    v.seen = now;
    if (v.fails > FREE_ATTEMPTS) {
      v.until = now + Math.min(LOCK_MAX, 30_000 * 2 ** (v.fails - FREE_ATTEMPTS - 1));
    }
    attempts.set(k, v);
  }
}

function succeeded(...keys) {
  for (const k of keys) attempts.delete(k);
}

// Throw away old counters and expired sessions.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (now - v.seen > FORGET_AFTER && v.until < now) attempts.delete(k);
  for (const [token, s] of sessions) if (now - s.created > SESSION_MS) sessions.delete(token);
}, 10 * 60 * 1000).unref?.();

// ---------------------------------------------------------------- Endpoints

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }).end(text);
}

// Exactly these three types can be produced by a form on a foreign page.
// Excluding them protects against forged sign-ins; anything else may come as
// long as it contains JSON - otherwise sign-in would fail over some detail in
// the header that no human ever sees.
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

function body(req) {
  return new Promise((ok, fail) => {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (FORM_TYPES.some(f => ct.startsWith(f))) {
      return fail(new Error(`form data instead of JSON (content-type: ${ct})`));
    }
    let raw = '';
    req.on('data', (d) => {
      raw += d;
      if (raw.length > MAX_BODY) {
        fail(new Error(`body too large (over ${MAX_BODY} characters)`));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { ok(JSON.parse(raw || '{}')); } catch {
        fail(new Error(`no JSON in body (content-type: ${ct || 'missing'}, ${raw.length} characters)`));
      }
    });
    req.on('error', (e) => fail(new Error('connection aborted: ' + e.message)));
  });
}

/**
 * Handles /api/auth/*. Returns true if the request has been answered.
 */
export function handleAuth(req, res, urlPath) {
  if (!urlPath.startsWith('/api/auth/')) return false;
  if (!authEnabled()) { json(res, 404, { error: 'auth.err.off' }); return true; }

  const route = urlPath.slice('/api/auth/'.length);
  if (route === 'me' && req.method === 'GET') {
    const s = sessionOf(req);
    if (!s) json(res, 401, { error: 'auth.err.noSession' });
    else json(res, 200, { user: s.user, display: s.display, mustChange: s.mustChange, minPassword: MIN_PASSWORD });
    return true;
  }
  if (route === 'login' && req.method === 'POST') { login(req, res); return true; }
  if (route === 'change' && req.method === 'POST') { change(req, res); return true; }
  if (route.startsWith('invite') && req.method === 'GET') { checkInvite(req, res); return true; }
  if (route === 'redeem' && req.method === 'POST') { redeem(req, res); return true; }
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

// ---------------------------------------------------------------- Invites

/** GET /api/auth/invite?token=… - is this link still good? Uses nothing up. */
function checkInvite(req, res) {
  const ip = origin(req);
  const wait = lockedFor(`v:${ip}`);
  if (wait) return json(res, 429, { error: 'auth.err.locked', params: { n: wait } });
  const token = new URL(req.url, 'http://x').searchParams.get('token') || '';
  let invite = null;
  try { invite = peekInvite(token); } catch (e) { console.error(e.message); }
  if (!invite) {
    // Guessing tokens is throttled like guessing passwords - with a counter
    // of its own, so it locks out invites, not the regular sign-in.
    failedAttempt(`v:${ip}`);
    return json(res, 404, { error: 'auth.err.inviteInvalid' });
  }
  // Who invited and their note are meant for the new player too - the note
  // is the admin's own words, sent as text.
  json(res, 200, { ok: true, expires: invite.expires, by: invite.by, note: invite.note, minPassword: MIN_PASSWORD });
}

/**
 * POST /api/auth/redeem {token, user, password} - creates the account and
 * signs the new player in. Everything that can be checked without using the
 * invite up is checked first: a taken name or a short password leaves the
 * link valid for another try.
 */
async function redeem(req, res) {
  let data;
  try { data = await body(req); } catch (e) {
    console.warn('Invite redemption not understood:', e.message);
    return json(res, 400, { error: 'auth.err.badRequest' });
  }
  const ip = origin(req);
  const wait = lockedFor(`v:${ip}`);
  if (wait) return json(res, 429, { error: 'auth.err.locked', params: { n: wait } });

  const token = String(data.token ?? '');
  const name = String(data.user ?? '').trim();
  const password = String(data.password ?? '');
  let invite = null;
  try { invite = peekInvite(token); } catch (e) { console.error(e.message); }
  if (!invite) {
    failedAttempt(`v:${ip}`);
    return json(res, 404, { error: 'auth.err.inviteInvalid' });
  }
  if (!name || !password) return json(res, 400, { error: 'auth.err.needFields' });
  if (!validName(name)) return json(res, 400, { error: 'auth.cli.badName' });
  try {
    // Neither an account name nor anyone's display name may be taken over.
    const taken = nameAllowed(name, null);
    if (taken) return json(res, 400, { error: taken });
  } catch (e) {
    console.error(e.message);
    return json(res, 500, { error: 'auth.err.server' });
  }
  const problem = checkPassword(password, name);
  if (problem) return json(res, 400, { error: problem, params: { n: MIN_PASSWORD } });

  // From here on the invite is used up - synchronously, before the first
  // await, so a second request with the same link finds nothing.
  const used = consumeInvite(token);
  if (!used) return json(res, 404, { error: 'auth.err.inviteInvalid' });
  let user;
  try {
    user = await addUser(name, password, { mustChange: false, invitedBy: used.by });
  } catch (e) {
    restoreInvite(used);
    if (e.message === 'auth.cli.exists') return json(res, 400, { error: 'profile.err.taken' });
    console.error('Creating an account from an invite failed:', e.message);
    return json(res, 500, { error: 'auth.err.server' });
  }
  const stored = account(user.name);
  setCookie(req, res, newSession({ name: user.name, stamp: stampOf(stored.hash), mustChange: false }));
  console.log(`Account ${user.display} created via invite of ${used.by}`);
  json(res, 200, { ok: true, user: user.name });
}

async function login(req, res) {
  let data;
  try { data = await body(req); } catch (e) {
    console.warn('Sign-in not understood:', e.message);
    return json(res, 400, { error: 'auth.err.badRequest' });
  }
  const name = String(data.user ?? '').trim().toLowerCase();
  const pw = String(data.password ?? '');
  if (!name || !pw) return json(res, 400, { error: 'auth.err.needFields' });

  const ip = origin(req);
  const wait = lockedFor(`u:${name}`, `i:${ip}`);
  if (wait) return json(res, 429, { error: 'auth.err.locked', params: { n: wait } });

  let user = null;
  try { user = await verifyUser(name, pw); } catch (e) {
    console.error('Sign-in failed:', e.message);
    return json(res, 500, { error: 'auth.err.server' });
  }
  if (!user) {
    failedAttempt(`u:${name}`, `i:${ip}`);
    console.warn(`Sign-in rejected: ${name} from ${ip}`);
    return json(res, 401, { error: 'auth.err.badLogin' });
  }
  succeeded(`u:${name}`, `i:${ip}`);
  setCookie(req, res, newSession(user));
  console.log(`Signed in: ${user.name}${user.mustChange ? ' (password change due)' : ''}`);
  json(res, 200, { ok: true, user: user.name, mustChange: user.mustChange });
}

async function change(req, res) {
  const s = sessionOf(req);
  if (!s) return json(res, 401, { error: 'auth.err.noSession' });
  let data;
  try { data = await body(req); } catch (e) {
    console.warn('Password change not understood:', e.message);
    return json(res, 400, { error: 'auth.err.badRequest' });
  }
  const oldPw = String(data.password ?? '');
  const newPw = String(data.newPassword ?? '');

  const ip = origin(req);
  const wait = lockedFor(`u:${s.user}`, `i:${ip}`);
  if (wait) return json(res, 429, { error: 'auth.err.locked', params: { n: wait } });

  // Ask for the current password once more: otherwise a foreign browser with
  // an open session could take over the account.
  let user = null;
  try { user = await verifyUser(s.user, oldPw); } catch (e) {
    console.error('Password check failed:', e.message);
    return json(res, 500, { error: 'auth.err.server' });
  }
  if (!user) {
    failedAttempt(`u:${s.user}`, `i:${ip}`);
    return json(res, 401, { error: 'auth.err.badLogin' });
  }
  if (newPw === oldPw) return json(res, 400, { error: 'auth.err.sameAsOld' });
  const problem = checkPassword(newPw, s.user);
  if (problem) return json(res, 400, { error: problem, params: { n: MIN_PASSWORD } });

  try { await setPassword(s.user, newPw, { mustChange: false }); } catch (e) {
    console.error('Password change failed:', e.message);
    return json(res, 500, { error: 'auth.err.server' });
  }
  succeeded(`u:${s.user}`, `i:${ip}`);
  // All sessions of the account expire with the new hash - including our own,
  // so issue a fresh one right away.
  revoke(s.user);
  const fresh = account(s.user);
  setCookie(req, res, newSession({ name: s.user, stamp: stampOf(fresh.hash), mustChange: false }));
  console.log(`Password changed: ${s.user}`);
  json(res, 200, { ok: true, user: s.user, mustChange: false });
}

// ------------------------------------------------------------ Gatekeeper

/**
 * May this request pass through to the files? Otherwise the response has
 * already been written: a redirect to the sign-in page if a browser wants to
 * fetch a page, a bare 401 otherwise.
 */
export function gate(req, res, urlPath) {
  if (!authEnabled()) return true;
  // Stylesheet, wordmark and catalogs go out without touching the account
  // file for them.
  if (isPublic(urlPath) && urlPath !== '/login.html') return true;
  const s = sessionOf(req);
  if (isPublic(urlPath)) {
    // Signed in with nothing left to do? Then you belong in the game, not on
    // the sign-in page.
    const invite = new URL(req.url, 'http://x').searchParams.has('invite');
    if (urlPath === '/login.html' && s && !s.mustChange && !invite) {
      res.writeHead(302, { location: './', 'cache-control': 'no-store' }).end();
      return false;
    }
    return true;
  }
  if (s && !s.mustChange) return true;

  const wantsPage = String(req.headers.accept || '').includes('text/html');
  if (!wantsPage) {
    json(res, 401, { error: s ? 'auth.err.mustChange' : 'auth.err.noSession' });
    return false;
  }
  // Relative redirects: behind a proxy under /ho/, '/login.html' would point
  // out of the game otherwise. For deeper paths, go back up to the root.
  const up = '../'.repeat(Math.max(0, urlPath.split('/').length - 2)) || './';
  const target = urlPath === '/' || urlPath === '/index.html' ? 'login.html'
    : `${up}login.html?next=${encodeURIComponent(urlPath)}`;
  res.writeHead(302, { location: target, 'cache-control': 'no-store' }).end();
  return false;
}

/**
 * Checks the upgrade to a WebSocket. Without this the sign-in would mean
 * nothing: the game runs over the socket, not over HTTP.
 */
export function checkUpgrade(req) {
  if (!authEnabled()) return { user: null, display: null, token: null };
  const s = sessionOf(req);
  if (!s || s.mustChange) return null;
  return { user: s.user, display: s.display, token: s.token };
}

/** For tests only: reset the state. */
export function resetAuthState() {
  sessions.clear();
  attempts.clear();
}
