// Starts the real server and lets 16 WebSocket clients play a game.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 8111 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), HO_AUTH: 'off' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => console.error('[server]', d.toString().trim()));
await new Promise(r => server.stdout.once('data', r));

// The pages carry the version from package.json, never the placeholder.
{
  const { readFile } = await import('node:fs/promises');
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const page of ['/', '/login.html']) {
    const html = await (await fetch(`http://localhost:${PORT}${page}`)).text();
    check(!html.includes('__HO_VERSION__'), `${page}: version placeholder not replaced`);
    check(html.includes('v' + version), `${page}: version ${version} missing`);
  }
  console.log(`Version ${version} appears on the start and sign-in pages.`);
}

const N = 16;
const clients = [];
let failed = null;

function makeClient(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const c = { name, ws, views: [], lobby: null, code: null, id: null, errors: [] };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'hello') resolve(c);
      if (m.t === 'joined') { c.code = m.code; c.id = m.playerId; }
      if (m.t === 'lobby') { c.lobby = m.lobby; c.host = m.host; }
      if (m.t === 'view') c.views.push(m.view);
      if (m.t === 'error') c.errors.push(m.key || m.msg);
      if (m.t === 'chat') (c.chats ||= []).push(m);
    });
    clients.push(c);
  });
}

const send = (c, m) => c.ws.send(JSON.stringify(m));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(25); }
  return false;
};

// --- Set up the lobby
const host = await makeClient('Host');
send(host, { t: 'create', name: 'Host', settings: { planetsPerPlayer: 5, turnTimer: 0 } });
check(await until(() => host.code), 'Host gets no game code');
const code = host.code;
console.log(`Game ${code} opened on port ${PORT}`);

for (let i = 1; i < N; i++) {
  const c = await makeClient('Player ' + (i + 1));
  send(c, { t: 'join', code, name: 'Player ' + (i + 1) });
}
check(await until(() => host.lobby?.players.length === N), `Lobby does not fill up (${host.lobby?.players.length}/${N})`);
console.log(`${host.lobby.players.length} players in the lobby, colors unique: ${new Set(host.lobby.players.map(p => p.color)).size === N}`);

// The 17th player must be turned away
const extra = await makeClient('TooMany');
send(extra, { t: 'join', code, name: 'TooMany' });
check(await until(() => extra.errors.length > 0), 'The 17th player was not turned away');
check(extra.errors[0] === 'err.gameFull',
  `Rejection came as '${extra.errors[0]}' instead of the key err.gameFull`);
console.log('17th player turned away with key:', extra.errors[0]);

// --- Free color choice: each only once, swapping only by the host
{
  const guest = clients[1], third = clients[2];
  const color = (c) => host.lobby.players.find(p => p.id === c.id)?.color;
  const hostColor = color(host), guestColor = color(guest);
  guest.errors.length = 0;
  send(guest, { t: 'color', color: hostColor });
  check(await until(() => guest.errors.includes('lobby.colorTaken')), 'Guest takes the host\'s color without asking');
  check(color(host) === hostColor, 'Host color changed anyway');
  send(host, { t: 'color', color: guestColor });
  check(await until(() => color(host) === guestColor && color(guest) === hostColor), 'Host cannot swap with the guest');
  send(third, { t: 'color', color: '#123456' });
  await wait(100);
  check(!host.lobby.players.some(p => p.color === '#123456'), 'Color outside the palette accepted');
  check(new Set(host.lobby.players.map(p => p.color)).size === N, 'Colors no longer unique after the swap');
  // The same name within the same game gets a number
  send(third, { t: 'profile', name: 'Host' });
  check(await until(() => host.lobby.players.find(p => p.id === third.id)?.name === 'Host 2'),
    `Duplicate name not numbered (${host.lobby.players.find(p => p.id === third.id)?.name})`);
  console.log('Color choice: unique, swapping only by the host; duplicate names get numbered.');
}

// --- Fairness: nobody chooses or sees the map seed, nobody is called "System"
{
  send(host, { t: 'settings', settings: { seed: 42, planetsPerPlayer: 5 } });
  await wait(150);
  check(!('seed' in host.lobby.settings), `The lobby reveals or accepts a seed (${JSON.stringify(host.lobby.settings)})`);
  const third = clients[2];
  third.errors.length = 0;
  send(third, { t: 'profile', name: 'System' });
  check(await until(() => third.errors.includes('profile.err.reserved')), 'A player can call themselves "System"');
  console.log('Fairness: no seed in the lobby, reserved names refused.');
}

// --- Start
send(host, { t: 'start' });
check(await until(() => clients.every(c => c === extra || c.views.length > 0), 6000), 'Not all clients received the starting view');
const v0 = host.views.at(-1);
console.log(`Game started: turn ${v0.turn}, ${v0.planets.length} worlds, ${v0.players.length} empires`);

// Everyone sees only their own homeworld
for (const c of clients) {
  if (c === extra) continue;
  const v = c.views.at(-1);
  const own = v.planets.filter(p => p.owner === v.you);
  check(own.length === 1, `${c.name} does not start with exactly one world (${own.length})`);
  check(v.me.id === c.id, 'View belongs to the wrong player');
  const foreignDetail = v.fleets.filter(f => !f.mine && f.ships.some(s => s.hp !== undefined));
  check(foreignDetail.length === 0, 'Foreign fleet details visible');
}
console.log('Every player sees exactly their own starting world; no foreign ship details.');

// --- Simultaneous turns: the turn may only change once everyone is done
const turnBefore = host.views.at(-1).turn;
for (const c of clients.slice(0, N - 1)) {
  if (c === extra) continue;
  send(c, { t: 'orders', research: { budgetPct: 35 } });
  send(c, { t: 'ready', value: true });
}
await wait(500);
check(host.views.at(-1).turn === turnBefore, 'Turn was resolved although one player was not done yet');
console.log('Turn correctly waits for the last player.');

send(clients[N - 1], { t: 'ready', value: true });
check(await until(() => host.views.at(-1).turn === turnBefore + 1, 4000), 'Turn was not resolved after the last player');
console.log('The turn was resolved after the last player.');

// --- Play a few turns with orders
for (let t = 0; t < 8; t++) {
  for (const c of clients) {
    if (c === extra) continue;
    const v = c.views.at(-1);
    const home = v.planets.find(p => p.owner === v.you);
    if (home) send(c, { t: 'orders', build: { planetId: home.id, type: 'fighter', count: 1 } });
    const fleet = v.fleets.find(f => f.mine && !f.dest);
    const target = v.planets.filter(p => p.id !== fleet?.at)
      .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0];
    if (fleet && target) send(c, { t: 'orders', move: { fleetId: fleet.id, planetId: target.id } });
    send(c, { t: 'ready', value: true });
  }
  const want = host.views.at(-1).turn + 1;
  check(await until(() => host.views.at(-1).turn >= want, 5000), `Turn ${want} did not happen`);
}
const vEnd = host.views.at(-1);
console.log(`Played 8 more turns (now turn ${vEnd.turn}).`);

// --- Disconnect and rejoin
const victim = clients[5];
const token = victim.token;
console.log(`Disconnecting ${victim.name} …`);
victim.ws.close();
await wait(400);
const vAfter = host.views.at(-1);
check(vAfter.players.find(p => p.id === victim.id).connected === false, 'Disconnect is not shown');
console.log('The disconnect is shown to the other players.');

// --- Chat reaches everyone
let chatSeen = 0;
for (const c of clients) {
  if (c === extra || c === victim) continue;
  c.ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'chat' && m.text === 'Hello galaxy') chatSeen++; });
}
send(host, { t: 'chat', text: 'Hello galaxy' });
check(await until(() => chatSeen >= N - 2), `Chat reached only ${chatSeen} of ${N - 2} players`);
console.log(`Chat reached ${chatSeen} players.`);
// System messages carry a flag of their own - player chat never does.
const said = host.chats || [];
check(said.some(m => m.key === 'chat.lost' && m.system === true), 'The disconnect message is not flagged as system');
check(said.filter(m => m.text === 'Hello galaxy').every(m => !m.system), 'Player chat is flagged as system');

// --- Flooding the server is cut off instead of slowing everyone down
{
  const flood = await makeClient('Flood');
  let replies = 0, closed = false;
  flood.ws.on('message', (raw) => { if (JSON.parse(raw.toString()).t === 'games') replies++; });
  flood.ws.on('close', () => { closed = true; });
  for (let i = 0; i < 1000; i++) flood.ws.send(JSON.stringify({ t: 'list' }));
  check(await until(() => closed, 4000), 'A flooding connection is not closed');
  check(replies < 100, `The server answered ${replies} of 1000 flood messages`);
  console.log(`Flood: ${replies} of 1000 messages answered, connection closed.`);
}

// Keep an eye on the view size
const size = Buffer.byteLength(JSON.stringify(vEnd));
console.log(`View package per player: ${(size / 1024).toFixed(1)} kB`);
check(size < 400 * 1024, 'View package too large');

console.log('\nAll multiplayer checks passed.');
cleanup(0);

function check(cond, msg) {
  if (!cond) { console.error('ERROR: ' + msg); failed = msg; cleanup(1); }
}
function cleanup(code) {
  for (const c of clients) { try { c.ws.close(); } catch {} }
  server.kill();
  process.exit(code);
}
