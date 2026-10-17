// Startet den echten Server und lässt 16 WebSocket-Clients eine Partie spielen.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 8111 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), HO_AUTH: 'off' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => console.error('[server]', d.toString().trim()));
await new Promise(r => server.stdout.once('data', r));

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

// --- Lobby aufbauen
const host = await makeClient('Host');
send(host, { t: 'create', name: 'Host', settings: { planetsPerPlayer: 5, turnTimer: 0 } });
check(await until(() => host.code), 'Host bekommt keinen Partiecode');
const code = host.code;
console.log(`Partie ${code} eröffnet auf Port ${PORT}`);

for (let i = 1; i < N; i++) {
  const c = await makeClient('Spieler ' + (i + 1));
  send(c, { t: 'join', code, name: 'Spieler ' + (i + 1) });
}
check(await until(() => host.lobby?.players.length === N), `Lobby füllt sich nicht (${host.lobby?.players.length}/${N})`);
console.log(`${host.lobby.players.length} Spieler in der Lobby, Farben eindeutig: ${new Set(host.lobby.players.map(p => p.color)).size === N}`);

// 17. Spieler muss abgewiesen werden
const extra = await makeClient('Zuviel');
send(extra, { t: 'join', code, name: 'Zuviel' });
check(await until(() => extra.errors.length > 0), 'Der 17. Spieler wurde nicht abgewiesen');
check(extra.errors[0] === 'err.gameFull',
  `Abweisung kam als '${extra.errors[0]}' statt als Schlüssel err.gameFull`);
console.log('17. Spieler abgewiesen mit Schlüssel:', extra.errors[0]);

// --- Start
send(host, { t: 'start' });
check(await until(() => clients.every(c => c === extra || c.views.length > 0), 6000), 'Nicht alle Clients haben die Startsicht erhalten');
const v0 = host.views.at(-1);
console.log(`Partie gestartet: Runde ${v0.turn}, ${v0.planets.length} Welten, ${v0.players.length} Reiche`);

// Jeder sieht nur seine eigene Heimatwelt
for (const c of clients) {
  if (c === extra) continue;
  const v = c.views.at(-1);
  const own = v.planets.filter(p => p.owner === v.you);
  check(own.length === 1, `${c.name} startet nicht mit genau einer Welt (${own.length})`);
  check(v.me.id === c.id, 'Sicht gehoert zum falschen Spieler');
  const foreignDetail = v.fleets.filter(f => !f.mine && f.ships.some(s => s.hp !== undefined));
  check(foreignDetail.length === 0, 'Fremde Flottendetails sichtbar');
}
console.log('Jeder Spieler sieht genau seine eigene Startwelt; keine fremden Schiffsdetails.');

// --- Simultanzug: der Zug darf erst wechseln, wenn alle fertig sind
const turnBefore = host.views.at(-1).turn;
for (const c of clients.slice(0, N - 1)) {
  if (c === extra) continue;
  send(c, { t: 'orders', research: { budgetPct: 35 } });
  send(c, { t: 'ready', value: true });
}
await wait(500);
check(host.views.at(-1).turn === turnBefore, 'Runde wurde ausgewertet, obwohl ein Spieler noch nicht fertig war');
console.log('Runde wartet korrekt auf den letzten Spieler.');

send(clients[N - 1], { t: 'ready', value: true });
check(await until(() => host.views.at(-1).turn === turnBefore + 1, 4000), 'Runde wurde nach dem letzten Spieler nicht ausgewertet');
console.log('Nach dem letzten Spieler wurde die Runde ausgewertet.');

// --- Ein paar Runden mit Befehlen durchspielen
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
  check(await until(() => host.views.at(-1).turn >= want, 5000), `Runde ${want} kam nicht zustande`);
}
const vEnd = host.views.at(-1);
console.log(`8 weitere Runden gespielt (jetzt Runde ${vEnd.turn}).`);

// --- Verbindungsabbruch und Wiedereinstieg
const victim = clients[5];
const token = victim.token;
console.log(`Trenne ${victim.name} …`);
victim.ws.close();
await wait(400);
const vAfter = host.views.at(-1);
check(vAfter.players.find(p => p.id === victim.id).connected === false, 'Trennung wird nicht angezeigt');
console.log('Trennung wird den anderen Spielern angezeigt.');

// --- Chat erreicht alle
let chatSeen = 0;
for (const c of clients) {
  if (c === extra || c === victim) continue;
  c.ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'chat' && m.text === 'Hallo Galaxis') chatSeen++; });
}
send(host, { t: 'chat', text: 'Hallo Galaxis' });
check(await until(() => chatSeen >= N - 2), `Chat erreichte nur ${chatSeen} von ${N - 2} Spielern`);
console.log(`Chat erreichte ${chatSeen} Spieler.`);

// Sichtgröße im Blick behalten
const size = Buffer.byteLength(JSON.stringify(vEnd));
console.log(`Sichtpaket pro Spieler: ${(size / 1024).toFixed(1)} kB`);
check(size < 400 * 1024, 'Sichtpaket zu groß');

console.log('\nAlle Mehrspieler-Prüfungen bestanden.');
cleanup(0);

function check(cond, msg) {
  if (!cond) { console.error('FEHLER: ' + msg); failed = msg; cleanup(1); }
}
function cleanup(code) {
  for (const c of clients) { try { c.ws.close(); } catch {} }
  server.kill();
  process.exit(code);
}
