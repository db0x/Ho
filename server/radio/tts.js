// Every radio line is spoken by the speech service (tts/, service tts in
// docker-compose.yml) and kept in a cache folder; the browser fetches it by
// its key (GET /api/radio/tts/<key>.mp3). The fixed lines are prepared in the
// background when the server starts, lines with names when they are needed.
//
// A missing or broken service must never get in the way of a game: every
// call has a timeout, nothing throws past this module, and while the service
// is down the radio simply stays silent. A health check notices when it is
// back. Its state (off, checking, down, warming, ok) is shown to admins in
// the lobby.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_ = process.env.HO_TTS || '';
const CACHE = process.env.HO_TTS_CACHE || path.join(os.tmpdir(), 'ho-radio-tts');
// How long a line may take to be spoken.
const TIMEOUT_MS = 6000;
// Health check: often while it is down, rarely while all is well.
const CHECK_DOWN_MS = 30000;
const CHECK_OK_MS = 120000;
// The cache stays below this many sentences with names; the oldest go first.
// The fixed lines do not count and never go.
const MAX_NAMED = 3000;

const pending = new Map();        // key -> Promise
const fixed = new Map();          // key -> {text, voice, speed}: may be spoken on request
const listeners = new Set();
let status = { state: URL_ ? 'checking' : 'off', done: 0, total: 0 };
let timer = null, warming = false, made = 0, started = false;

export const ttsEnabled = () => !!URL_;
export const ttsStatus = () => ({ ...status });

/** Calls fn(status) whenever the state of the speech service changes. */
export function onTtsStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setStatus(next) {
  const changed = next.state !== status.state || next.done !== status.done || next.total !== status.total;
  status = { ...status, ...next };
  if (changed) for (const fn of listeners) { try { fn(ttsStatus()); } catch (e) { console.warn('tts status:', e.message); } }
}

export function ttsKey(text, voice, speed = 1) {
  return crypto.createHash('sha256').update(`${voice}|${speed}|${text}`).digest('hex').slice(0, 20);
}

/** The cache file of a key - only well-formed keys reach the disk. */
export function ttsFile(key) {
  return /^[0-9a-f]{20}$/.test(key) ? path.join(CACHE, key + '.mp3') : null;
}

/** Is this sentence already spoken? */
export const ttsReady = key => !!ttsFile(key) && fs.existsSync(ttsFile(key));

/**
 * The fixed lines (server/radio/lines.json): they may be spoken on request
 * of a browser, are prepared in the background and never pruned.
 * @param {{text: string, voice: string, speed: number}[]} lines
 */
export function registerFixed(lines) {
  fixed.clear();
  for (const l of lines) fixed.set(ttsKey(l.text, l.voice, l.speed), l);
}

/** A fixed line by its key, or null. */
export const fixedLine = key => fixed.get(key) ?? null;

/**
 * The sentence as a clip: {file, v} for the browser - from the cache, or
 * spoken now. Rejects when the service is missing, down, slow or busy.
 */
export function speak(text, voice, speed = 1) {
  const key = ttsKey(text, voice, speed);
  const clip = { file: `tts/${key}.mp3`, v: key };
  if (ttsReady(key)) return Promise.resolve(clip);
  if (!URL_) return Promise.reject(new Error('no speech service'));
  if (status.state === 'down') return Promise.reject(new Error('speech service down'));
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    let res;
    try {
      res = await fetch(new URL('/speak', URL_), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Fixed lines the service may keep for good - lines with names it forgets.
        body: JSON.stringify({ text, voice, speed, keep: fixed.has(key) }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (e) {
      lost(e);                                    // unreachable or hanging
      throw e;
    }
    if (!res.ok) throw new Error(`speech service: ${res.status}`);   // busy or refused - it lives
    const audio = Buffer.from(await res.arrayBuffer());
    const file = ttsFile(key);
    await fs.promises.mkdir(CACHE, { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.promises.writeFile(tmp, audio);
    await fs.promises.rename(tmp, file);
    if (!fixed.has(key) && ++made % 100 === 0) prune();
    return clip;
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

/** The service stopped answering: silent until the health check finds it again. */
function lost(e) {
  if (status.state === 'down' || status.state === 'off') return;
  console.warn(`Speech service lost (${e.name === 'TimeoutError' ? 'timeout' : e.message}) - radio silent until it is back.`);
  setStatus({ state: 'down' });
  schedule(CHECK_DOWN_MS);
}

/** Starts watching the service and preparing the fixed lines. Harmless without one. */
export function startTts() {
  if (!URL_ || started) return;
  started = true;
  check();
}

export function stopTts() {
  clearTimeout(timer);
  timer = null;
  started = false;
}

function schedule(ms) {
  if (!started) return;
  clearTimeout(timer);
  timer = setTimeout(check, ms);
  timer.unref?.();
}

/** Looks at the service right now (otherwise it happens on its own schedule). */
export const checkTts = () => check();

async function check() {
  let ok = false;
  try {
    const res = await fetch(new URL('/health', URL_), { signal: AbortSignal.timeout(3000) });
    ok = res.ok;
  } catch { ok = false; }
  if (!ok) {
    if (status.state !== 'down') console.warn('Speech service not reachable - radio silent until it is back.');
    setStatus({ state: 'down' });
    schedule(CHECK_DOWN_MS);
    return;
  }
  if (status.state === 'down') console.log('Speech service reachable again.');
  schedule(CHECK_OK_MS);
  warm();
}

/** Speaks every fixed line that is not cached yet - one after the other, in the background. */
async function warm() {
  if (warming) return;
  warming = true;
  try {
    const todo = [...fixed.entries()].filter(([key]) => !ttsReady(key))
      .sort(([, a], [, b]) => (b.first ? 1 : 0) - (a.first ? 1 : 0));
    const total = fixed.size;
    let done = total - todo.length;
    setStatus({ state: todo.length ? 'warming' : 'ok', done, total });
    if (todo.length) console.log(`Speech service: preparing ${todo.length} of ${total} radio lines.`);
    for (const [, l] of todo) {
      if (status.state === 'down' || !started) return;
      try {
        await speak(l.text, l.voice, l.speed);
        done++;
        setStatus({ state: 'warming', done, total });
      } catch (e) {
        if (status.state === 'down') return;     // lost - the health check starts over
        console.warn(`Radio line not prepared (${e.message}): ${l.text}`);
      }
    }
    setStatus({ state: 'ok', done, total });
  } finally {
    warming = false;
  }
}

/** Keeps the cache small: the oldest sentences with names go, the fixed lines stay. */
function prune() {
  fs.promises.readdir(CACHE).then(async (names) => {
    const named = names.filter(n => n.endsWith('.mp3') && !fixed.has(n.slice(0, -4)));
    if (named.length <= MAX_NAMED) return;
    const files = await Promise.all(named.map(async n => {
      const p = path.join(CACHE, n);
      return { p, t: (await fs.promises.stat(p)).mtimeMs };
    }));
    files.sort((a, b) => a.t - b.t);
    for (const f of files.slice(0, files.length - MAX_NAMED)) fs.promises.unlink(f.p).catch(() => {});
  }).catch(() => {});
}

/**
 * A name as the English voice can say it: accents dropped, Cyrillic and
 * Greek spelled out in Latin letters, anything else left out. Null when
 * nothing speakable is left - the sentence is then not used.
 */
export function speakable(name) {
  if (!name) return null;
  let s = String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = [...s].map(ch => TRANSLIT[ch.toLowerCase()] !== undefined
    ? (ch === ch.toLowerCase() ? TRANSLIT[ch.toLowerCase()] : cap(TRANSLIT[ch.toLowerCase()]))
    : ch).join('');
  s = s.replace(/[ßẞ]/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'o').replace(/[œŒ]/g, 'oe')
    .replace(/[’`´]/g, "'").replace(/[^A-Za-z0-9 '\-.]/g, ' ').replace(/\s+/g, ' ').trim();
  return /[A-Za-z]{2}/.test(s) && s.length <= 40 ? s : null;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const TRANSLIT = Object.fromEntries([
  ['а', 'a'], ['б', 'b'], ['в', 'v'], ['г', 'h'], ['ґ', 'g'], ['д', 'd'], ['е', 'e'], ['є', 'ye'], ['ё', 'yo'],
  ['ж', 'zh'], ['з', 'z'], ['и', 'y'], ['і', 'i'], ['ї', 'yi'], ['й', 'y'], ['к', 'k'], ['л', 'l'], ['м', 'm'],
  ['н', 'n'], ['о', 'o'], ['п', 'p'], ['р', 'r'], ['с', 's'], ['т', 't'], ['у', 'u'], ['ф', 'f'], ['х', 'kh'],
  ['ц', 'ts'], ['ч', 'ch'], ['ш', 'sh'], ['щ', 'shch'], ['ь', ''], ['ъ', ''], ['ы', 'y'], ['э', 'e'], ['ю', 'yu'],
  ['я', 'ya'],
  ['α', 'a'], ['β', 'v'], ['γ', 'g'], ['δ', 'd'], ['ε', 'e'], ['ζ', 'z'], ['η', 'i'], ['θ', 'th'], ['ι', 'i'],
  ['κ', 'k'], ['λ', 'l'], ['μ', 'm'], ['ν', 'n'], ['ξ', 'x'], ['ο', 'o'], ['π', 'p'], ['ρ', 'r'], ['σ', 's'],
  ['ς', 's'], ['τ', 't'], ['υ', 'y'], ['φ', 'f'], ['χ', 'ch'], ['ψ', 'ps'], ['ω', 'o']
]);
