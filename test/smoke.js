// Spielt eine komplette Partie mit 16 KI-Reichen durch und prüft die Invarianten.
import { createGame, addPlayer, startGame, resolveTurn, buildView } from '../server/game.js';
import { runBot } from '../server/bot.js';

const game = createGame('Test');
game.settings.seed = 20251012;
game.settings.turnTimer = 0;
for (let i = 0; i < 16; i++) addPlayer(game, { isBot: true, name: 'KI ' + (i + 1) });
const r = startGame(game);
if (r.error) throw new Error(r.error);

console.log(`Galaxie: ${game.galaxy.planets.length} Welten, ${game.galaxy.width}x${game.galaxy.height} Lj`);

let combats = 0, colonies = 0, invasions = 0;
const TURNS = 120;
const t0 = Date.now();

for (let t = 0; t < TURNS && game.state === 'running'; t++) {
  for (const b of game.players.filter(p => p.isBot && p.alive)) runBot(game, b);
  const entries = resolveTurn(game);
  for (const e of entries) {
    if (e.type === 'combat') combats++;
    if (e.type === 'colonize') colonies++;
    if (e.type === 'invade') invasions++;
  }
  // Invarianten
  for (const p of game.players) {
    assert(Number.isFinite(p.money) && p.money >= -1, `Geld kaputt bei ${p.name}: ${p.money}`);
    assert(Number.isFinite(p.metal) && p.metal >= -1, `Metall kaputt bei ${p.name}: ${p.metal}`);
    for (const f of Object.keys(p.tech)) assert(p.tech[f] >= 1, 'Techstufe < 1');
  }
  for (const pl of game.galaxy.planets) {
    assert(Number.isFinite(pl.temp) && Number.isFinite(pl.grav), 'Planetendaten kaputt');
    assert(pl.pop >= 0 && pl.pop < 200, 'Bevölkerung außerhalb der Grenzen: ' + pl.pop);
    assert(pl.metalReserve >= 0, 'Negativer Erzvorrat');
    if (pl.owner) assert(game.players.some(p => p.id === pl.owner), 'Planet hat Phantombesitzer');
  }
  for (const f of game.fleets) {
    assert(f.ships.length > 0, 'Leere Flotte übrig');
    assert(Number.isFinite(f.x) && Number.isFinite(f.y), 'Flottenposition kaputt');
  }
  if (t % 20 === 19) {
    const alive = game.players.filter(p => p.alive);
    const top = alive.slice().sort((a, b) => b.stats.pop - a.stats.pop)[0];
    console.log(`Runde ${game.turn}: ${alive.length} Reiche aktiv, ` +
      `kolonisiert: ${game.galaxy.planets.filter(p => p.owner).length}/${game.galaxy.planets.length}, ` +
      `Schiffe: ${game.fleets.reduce((a, f) => a + f.ships.length, 0)}, ` +
      `führend: ${top.name} (${top.stats.planets} W, ${top.stats.pop} Mio, Tech ${Object.values(top.tech).join('/')})`);
  }
}

const ms = Date.now() - t0;
console.log(`\n${game.turn - 1} Runden in ${ms} ms (${(ms / (game.turn - 1)).toFixed(1)} ms/Runde)`);
console.log(`Raumschlachten: ${combats}, Kolonisierungen: ${colonies}, Eroberungen: ${invasions}`);

// Sicht pro Spieler prüfen
const v = buildView(game, game.players[0]);
const json = JSON.stringify(v);
console.log(`Sicht für einen Spieler: ${(json.length / 1024).toFixed(1)} kB, ` +
  `bekannt: ${v.planets.filter(p => p.known !== 'unknown').length}/${v.planets.length} Welten, ` +
  `sichtbare Flotten: ${v.fleets.length}`);
assert(!json.includes('null,null'), 'Sicht enthaelt kaputte Felder');
assert(v.planets.every(p => p.known === 'unknown' || Number.isFinite(p.temp)), 'Sicht: Planet ohne Temperatur');

// Fremde Flotten duerfen keine Schiffsdetails verraten
for (const f of v.fleets.filter(f => !f.mine)) {
  assert(f.ships.every(s => !('hp' in s)), 'Fremde Flotte verrät Trefferpunkte');
}
assert(colonies > 5, 'KI kolonisiert nicht');
assert(combats > 0, 'Es gab keinen einzigen Kampf');

console.log('\nAlle Prüfungen bestanden.');

function assert(cond, msg) { if (!cond) { console.error('FEHLER: ' + msg); process.exit(1); } }
