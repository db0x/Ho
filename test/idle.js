// Zombie games: the server discards games nobody has moved in for
// HO_IDLE_HOURS - here shortened to a few seconds.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const IDLE_S = 3.6;                      // HO_IDLE_HOURS=0.001
const PORT = 8411 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), HO_AUTH: 'off', HO_IDLE_HOURS: '0.001' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => console.error('[server]', d.toString().trim()));
await new Promise(r => server.stdout.once('data', r));

const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(50); }
  return false;
};
function client() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const c = { ws, views: [], errors: [], ended: null, code: null };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'hello') resolve(c);
      if (m.t === 'joined') c.code = m.code;
      if (m.t === 'view') c.views.push(m.view);
      if (m.t === 'error') c.errors.push(m.key);
      if (m.t === 'ended') c.ended = m;
    });
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));

// --- A running game with a turn timer of one second
const a = await client(), b = await client();
send(a, { t: 'create', name: 'Anna', settings: { turnTimer: 1, planetsPerPlayer: 4 } });
check(await until(() => a.code, 2000), 'No game code');
send(b, { t: 'join', code: a.code, name: 'Bert' });
await wait(200);
send(a, { t: 'start' });
check(await until(() => a.views.length > 0, 3000), 'Game did not start');

// As long as someone moves, the game stays - well beyond the idle time.
for (let i = 0; i < 6; i++) {
  send(i % 2 ? a : b, { t: 'chat', text: 'still here ' + i });
  await wait(1000);
}
check(!a.ended && !b.ended, 'An active game was discarded');
console.log(`Active for ${6} s (idle limit ${IDLE_S} s): the game stays.`);

// Now silence. The timer keeps resolving turns - that must not count.
const turn = a.views.at(-1).turn;
check(await until(() => a.ended && b.ended, (IDLE_S + 3) * 1000), 'Idle game was not discarded');
check(a.views.at(-1).turn > turn, 'The turn timer did not run while idle - the test proves nothing');
check(a.ended.key === 'notice.endedIdle' && a.ended.params.code === a.code,
  `Wrong reason: ${JSON.stringify(a.ended)}`);
send(b, { t: 'join', code: a.code, name: 'Bert' });
check(await until(() => b.errors.includes('err.gameNotFound'), 2000), 'The discarded game can still be joined');
console.log(`Silent with the turn timer running: discarded after the idle limit, players told why.`);

// --- Nobody connected: gone after half the idle time
const c = await client();
send(c, { t: 'create', name: 'Carla', settings: {} });
check(await until(() => c.code, 2000), 'No game code');
const code = c.code;
c.ws.close();
await wait((IDLE_S / 2 + 1.5) * 1000);
const d = await client();
send(d, { t: 'join', code, name: 'Dora' });
check(await until(() => d.errors.includes('err.gameNotFound'), 2000), 'An abandoned game survived half the idle limit');
console.log('Abandoned game (nobody connected): gone after half the idle limit.');

console.log('\nAll idle checks passed.');
cleanup(0);

function check(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); cleanup(1); }
}
function cleanup(code) {
  server.kill();
  process.exit(code);
}
