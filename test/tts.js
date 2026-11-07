// The radio's speech (server/radio/tts.js): names made speakable for the
// English voice, sentences spoken by the speech service and cached, the
// fixed lines prepared in the background and served by key only - and a
// missing or failing service never gets in the way: the radio just goes
// text, comes back with the service, and admins learn how it is doing.
// The speech service is played here by a small fake.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };
const until = async (ok, ms = 5000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 10)); return ok(); };

// A fake speech service: answers with the text as "audio", or says it is busy.
let calls = 0, busy = false;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    if (req.url === '/health') { res.writeHead(200).end('ok'); return; }
    calls++;
    if (busy) { res.writeHead(503).end('busy'); return; }
    const { text, voice } = JSON.parse(body);
    res.writeHead(200, { 'content-type': 'audio/mpeg' }).end(`MP3:${voice}:${text}`);
  });
});
await new Promise(ok => fake.listen(0, '127.0.0.1', ok));
const port = fake.address().port;
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ho-tts-test-'));
process.env.HO_TTS = `http://127.0.0.1:${port}`;
process.env.HO_TTS_CACHE = cache;

const tts = await import('../server/radio/tts.js');
const { speak, speakable, ttsFile, ttsStatus, onTtsStatus, startTts, stopTts, checkTts } = tts;
const { handleRadio, radioManifest } = await import('../server/radio/index.js');
const { radioTurn, namedLine } = await import('../server/radio/chatter.js');
const { createGame, startGame } = await import('../server/game/game.js');
const { addPlayer } = await import('../server/game/players.js');

// ------------------------------------------------------------ names
assert(speakable('Kepler Prime') === 'Kepler Prime', 'plain name stays');
assert(speakable('Santísima Trinidad') === 'Santisima Trinidad', 'accents dropped');
assert(speakable('Gjøa') === 'Gjoa', 'ø spelled out');
assert(speakable('Олена') === 'Olena', `Cyrillic spelled out (${speakable('Олена')})`);
assert(speakable('Запоріжжя') === 'Zaporizhzhya', `Ukrainian spelled out (${speakable('Запоріжжя')})`);
assert(speakable('🚀🚀') === null, 'nothing speakable: null');
assert(speakable('x'.repeat(60)) === null, 'too long: null');
assert(speakable('Bob<script>') === 'Bob script', 'only letters, digits and a few signs');

// ------------------------------------------------------- templates
const voice = { voice: 'bm_george', speed: 1, templates: { victory: ['{planet} is mine now, {player}.', 'Raise my flag over {planet}.', '{ship} reporting.'] } };
let n = namedLine(voice, { event: 'victory' }, { planet: 'Kepler', player: 'Олена', ship: null }, () => 0);
assert(n?.say === 'Kepler is mine now, Olena.' && n.text === 'Kepler is mine now, Олена.',
  `spoken spelled out, subtitle as written (${n?.say} / ${n?.text})`);
assert(!namedLine(voice, { event: 'victory' }, { planet: null, player: 'A', ship: null }, () => 0), 'without the planet no template fits');
n = namedLine(voice, { event: 'victory' }, { planet: null, player: 'A', ship: 'Nostromo' }, () => 0);
assert(n?.say === 'Nostromo reporting.', `only the template whose names are known (${n?.say})`);
assert(!namedLine(voice, { event: 'victory' }, { planet: 'K', player: 'A' }, () => 0.99), 'by chance: none');

// ---------------------------------------------------------- speaking
assert(ttsStatus().state === 'checking', `before the first check: checking (${ttsStatus().state})`);
const clip = await speak('Kepler is mine now, Olena.', 'bm_george', 1);
assert(/^tts\/[0-9a-f]{20}\.mp3$/.test(clip.file) && clip.v, `a clip address (${clip.file})`);
const key = clip.v;
assert(fs.readFileSync(ttsFile(key), 'utf8') === 'MP3:bm_george:Kepler is mine now, Olena.', 'cached on disk');
let before = calls;
await speak('Kepler is mine now, Olena.', 'bm_george', 1);
assert(calls === before, 'the second time from the cache');
await Promise.all([speak('Same', 'am_puck'), speak('Same', 'am_puck')]);
assert(calls === before + 1, 'asked twice at once: spoken once');
assert(ttsFile('../../etc/passwd') === null && ttsFile('abc') === null, 'only keys reach the disk');
busy = true;
let failed = false;
try { await speak('Never cached', 'bm_george'); } catch { failed = true; }
assert(failed && ttsStatus().state !== 'down', 'busy: this line fails, the service counts as alive');
busy = false;

// ------------------------------------------- preparing the fixed lines
const states = [];
onTtsStatus(s => states.push(s.state));
const fixed = Object.values(radioManifest()).flatMap(ev => Object.values(ev).flat());
startTts();
assert(await until(() => ttsStatus().state === 'ok'), `prepared (${JSON.stringify(ttsStatus())})`);
assert(states.includes('warming') && ttsStatus().done === fixed.length && ttsStatus().total === fixed.length,
  `warming, then ok with every line (${ttsStatus().done}/${ttsStatus().total})`);
assert(fixed.every(c => fs.existsSync(ttsFile(c.key))), 'every fixed line cached');

// ----------------------------------------------------------- serving
const get = (url) => new Promise((resolve) => {
  const u = new URL(url, 'http://x');
  const res = {
    code: 0, headers: {}, body: null,
    writeHead(code, h) { this.code = code; Object.assign(this.headers, h || {}); return this; },
    end(b) { this.body = b; resolve(this); }
  };
  if (!handleRadio({ method: 'GET' }, res, u.pathname)) resolve(null);
});
let r = await get(`/api/radio/tts/${key}.mp3?v=${key}`);
assert(r.code === 200 && r.headers['content-type'] === 'audio/mpeg' && String(r.body).startsWith('MP3:'), 'served');
r = await get('/api/radio/tts/..%2f..%2fx.mp3');
assert(r.code === 404, 'a foreign path: 404');
r = await get('/api/radio/tts/0123456789abcdef0123.mp3');
assert(r.code === 404, 'an unknown key: 404');
// A fixed line not cached (any more): spoken on request.
const one = fixed[5];
fs.unlinkSync(ttsFile(one.key));
r = await get(`/api/radio/${one.file}`);
assert(r.code === 200 && String(r.body) === `MP3:${one.voice}:${one.say}`, 'a fixed line is spoken on request');
r = await get('/api/radio/list');
assert(r.code === 200 && JSON.parse(r.body).vulture?.war?.[0]?.file?.startsWith('tts/'), 'the list for the debug dialog');

// ----------------------------------------------- in the turn's chatter
{
  const g = createGame('TTS');
  g.settings.seed = 3;
  addPlayer(g, { name: 'Олена' });
  addPlayer(g, { name: 'Wobblebeard', isBot: true, persona: 'conqueror' });
  startGame(g);
  const [h, con] = g.players;
  const home = g.galaxy.planets[h.homeworld];
  const out = radioTurn(g, [{ type: 'invade', playerIds: [con.id, h.id], planetId: home.id, key: 'log.invadeFrom', params: {} }], () => 0);
  const m = out.get(h.id)?.find(x => !x.short);
  assert(m?.named?.say && m.named.voice === 'bm_george', `a line with names (${m?.named?.say})`);
  assert(m.line?.say && radioManifest().conqueror.victory.some(c => c.file === m.file), 'the fixed line stays as fallback');
}

// ------------------------------------------------ the service goes away
await new Promise(ok => { fake.closeAllConnections?.(); fake.close(ok); });
failed = false;
try { await speak('Nobody listens', 'bm_george'); } catch { failed = true; }
assert(failed && ttsStatus().state === 'down', `gone: the line fails, the state is down (${ttsStatus().state})`);
const t0 = Date.now();
failed = false;
try { await speak('Still nobody', 'bm_george'); } catch { failed = true; }
assert(failed && Date.now() - t0 < 100, 'while down: refused right away, nobody waits');
await speak('Kepler is mine now, Olena.', 'bm_george', 1).then(() => {}, () => assert(false, 'cached lines still come while down'));
fs.unlinkSync(ttsFile(fixed[6].key));
r = await get(`/api/radio/${fixed[6].file}`);
assert(r.code === 503, `an uncached line while down: 503 (${r.code})`);
// ... and comes back.
await new Promise(ok => fake.listen(port, '127.0.0.1', ok));
await checkTts();
assert(await until(() => ttsStatus().state === 'ok'), `back: ok again (${ttsStatus().state})`);
assert(fs.existsSync(ttsFile(fixed[6].key)), 'back: the missing line prepared again');
stopTts();

// ------------------------------------------------ no service at all
const off = execFileSync(process.execPath, ['--input-type=module', '-e', `
  const { ttsStatus, speak } = await import('./server/radio/tts.js');
  const { radioTurn } = await import('./server/radio/chatter.js');
  const { handleRadio, radioManifest } = await import('./server/radio/index.js');
  const { createGame, startGame } = await import('./server/game/game.js');
  const { addPlayer } = await import('./server/game/players.js');

  const { deliverRadio } = await import('./server/hub/games.js');
  const { conns } = await import('./server/hub/connections.js');
  const g = createGame('Off'); addPlayer(g, { name: 'Олена' }); addPlayer(g, { isBot: true, persona: 'raider' }); addPlayer(g, { isBot: true, persona: 'vulture' }); startGame(g);
  const [h, bot, other] = g.players, home = g.galaxy.planets[h.homeworld];
  const sent = [];
  conns.set('c1', { ws: { readyState: 1, send: s => sent.push(JSON.parse(s)) }, gameId: g.id });
  h.connId = 'c1';
  const out = radioTurn(g, [
    { type: 'combat', planetId: home.id, playerIds: [bot.id, other.id, h.id], key: 'log.battle', params: { planet: home.name, sides: [{ left: 3 }, { left: 0 }, { left: 2 }] } },
    { type: 'invade', playerIds: [bot.id, h.id], planetId: home.id, key: 'log.invadeFrom', params: {} }
  ], () => 0);
  const picked = out.get(h.id) || [];
  await deliverRadio(g, out);
  const text = sent.length === 1 && sent.every(m => m.textOnly && !m.file && !m.v && !m.short && m.text);
  let refused = false; try { await speak('x', 'am_puck'); } catch { refused = true; }
  const file = radioManifest().raider.war[0].file;
  const code = await new Promise(ok => handleRadio({ method: 'GET' }, { writeHead(c) { ok(c); return this; }, end() {} }, '/api/radio/' + file));
  console.log(JSON.stringify({ state: ttsStatus().state, picked: picked.length, text, sent, refused, code }));
`], { env: { ...process.env, HO_TTS: '', HO_TTS_CACHE: path.join(cache, 'off') }, cwd: new URL('..', import.meta.url).pathname }).toString();
const o = JSON.parse(off.trim().split('\n').pop());
assert(o.state === 'off' && o.refused && o.code === 503, `without a service: off, nothing spoken, 503 (${off.trim()})`);
assert(o.picked === 2 && o.text, `without a service: the line comes as text, the short call stays out (${JSON.stringify(o.sent)})`);
assert(o.sent[0]?.text.includes('Олена') || !/\{/.test(o.sent[0]?.text || '{'), `text with names as written (${o.sent[0]?.text})`);

// ------------------------------------------- switched off in the .env
const sw = execFileSync(process.execPath, ['--input-type=module', '-e', `
  const { ttsStatus, ttsEnabled, startTts } = await import('./server/radio/tts.js');
  const { radioTurn } = await import('./server/radio/chatter.js');
  const { createGame, startGame } = await import('./server/game/game.js');
  const { addPlayer } = await import('./server/game/players.js');
  startTts();
  const { deliverRadio } = await import('./server/hub/games.js');
  const { conns } = await import('./server/hub/connections.js');
  const g = createGame('Off'); addPlayer(g, { name: 'Олена' }); addPlayer(g, { isBot: true, persona: 'raider' }); addPlayer(g, { isBot: true, persona: 'vulture' }); startGame(g);
  const [h, bot, other] = g.players, home = g.galaxy.planets[h.homeworld];
  const sent = [];
  conns.set('c1', { ws: { readyState: 1, send: s => sent.push(JSON.parse(s)) }, gameId: g.id });
  h.connId = 'c1';
  const out = radioTurn(g, [
    { type: 'combat', planetId: home.id, playerIds: [bot.id, other.id, h.id], key: 'log.battle', params: { planet: home.name, sides: [{ left: 3 }, { left: 0 }, { left: 2 }] } },
    { type: 'invade', playerIds: [bot.id, h.id], planetId: home.id, key: 'log.invadeFrom', params: {} }
  ], () => 0);
  const picked = out.get(h.id) || [];
  await deliverRadio(g, out);
  const text = sent.length === 1 && sent.every(m => m.textOnly && !m.file && !m.v && !m.short && m.text);
  console.log(JSON.stringify({ state: ttsStatus().state, enabled: ttsEnabled(), text }));
`], { env: { ...process.env, HO_SPEECH: 'off', HO_TTS: `http://127.0.0.1:${port}`, HO_TTS_CACHE: path.join(cache, 'sw') },
  cwd: new URL('..', import.meta.url).pathname }).toString();
const w = JSON.parse(sw.trim().split('\n').pop());
assert(w.state === 'disabled' && !w.enabled && w.text, `HO_SPEECH=off: disabled, the service left alone, the radio as text (${sw.trim()})`);

fake.close();
fs.rmSync(cache, { recursive: true, force: true });
if (errors) { console.error(`${errors} error(s).`); process.exit(1); }
console.log(`Radio speech: ${fixed.length} lines prepared, names speakable, served by key only - text without the service, voices back with it.`);
