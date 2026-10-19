// Spielt eine komplette Partie mit 16 KI-Reichen durch und prüft die Invarianten.
import { createGame, addPlayer, startGame, resolveTurn, buildView, setOrders, canReach } from '../server/game.js';
import { habitability, refitTotal, refitCost } from '../shared/rules.js';
import { runBot } from '../server/bot.js';

const game = createGame('Test');
game.settings.seed = 20251012;
game.settings.turnTimer = 0;
for (let i = 0; i < 16; i++) addPlayer(game, { isBot: true, name: 'KI ' + (i + 1) });
const r = startGame(game);
if (r.error) throw new Error(r.error);

console.log(`Galaxie: ${game.galaxy.planets.length} Welten, ${game.galaxy.width}x${game.galaxy.height} Lj`);

let combats = 0, colonies = 0, invasions = 0;
let replays = 0, replayBytes = 0, biggest = 0;
const TURNS = 120;
const t0 = Date.now();

for (let t = 0; t < TURNS && game.state === 'running'; t++) {
  for (const b of game.players.filter(p => p.isBot && p.alive)) runBot(game, b);
  const entries = resolveTurn(game);
  for (const e of entries) {
    if (e.type === 'combat') combats++;
    if (e.battle) checkReplay(e);
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

/**
 * Die Mitschrift muss das Ergebnis tragen, das der Server ausgerechnet hat:
 * nachgespielt bleiben je Seite genau so viele Schiffe uebrig, wie die
 * Bilanz nennt - sonst zeigt die Wiederholung eine andere Schlacht.
 */
function checkReplay(e) {
  const { sides, units, rounds, scuttled } = e.battle;
  const hp = units.map(u => u[2]);
  for (const shots of rounds) {
    for (const [from, to, dmg] of shots) {
      assert(units[from] && units[to], 'Mitschrift: unbekannte Einheit');
      assert(units[from][0] !== units[to][0], 'Mitschrift: Beschuss der eigenen Seite');
      assert(hp[from] > 0, 'Mitschrift: Toter schiesst');
      assert(dmg > 0, 'Mitschrift: Schuss ohne Schaden');
    }
    for (const [, to, dmg] of shots) hp[to] = Math.round((hp[to] - dmg) * 10) / 10;
  }
  const weg = new Set(scuttled);
  sides.forEach((owner, k) => {
    const left = units.filter((u, i) => u[0] === k && u[1] !== 'battery' && hp[i] > 0 && !weg.has(i)).length;
    const name = (game.players.find(p => p.id === owner) || {}).name;
    const bilanz = e.params.sides.find(x => x.name === name);
    assert(bilanz && bilanz.left === left,
      `Mitschrift bei ${e.params.planet}: ${name} behaelt ${left}, Bilanz sagt ${bilanz?.left}`);
  });
  const n = JSON.stringify(e.battle).length;
  replays++; replayBytes += n; biggest = Math.max(biggest, n);
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
assert(replays > 0, 'Keine Schlacht mit Mitschrift');
console.log(`Mitschriften: ${replays}, im Schnitt ${(replayBytes / replays / 1024).toFixed(1)} kB, ` +
  `größte ${(biggest / 1024).toFixed(1)} kB`);
// Nur die juengste Runde reist mit Mitschrift - aeltere sind abgeworfen.
for (const l of game.log) {
  if (l.turn < game.turn) assert(l.entries.every(e => !e.battle), `Mitschrift aus Runde ${l.turn} nicht abgeworfen`);
}

// Jedes KI-Reich hat eine Persönlichkeit, und sechs Bots sind sechs verschiedene.
{
  const g = createGame('Mischung');
  for (let i = 0; i < 6; i++) addPlayer(g, { isBot: true });
  addPlayer(g, { name: 'Mensch' });
  const arten = g.players.filter(p => p.isBot).map(p => p.persona);
  assert(new Set(arten).size === 6, 'KI-Persönlichkeiten doppelt vergeben: ' + arten.join(', '));
  assert(g.players.find(p => !p.isBot).persona === null, 'Mensch mit KI-Persönlichkeit');
}

// Rundenlimit 0 heisst unbegrenzt: die Partie läuft über jedes Limit hinaus.
{
  const g = createGame('Endlos');
  Object.assign(g.settings, { seed: 5, turnTimer: 0, maxTurns: 0 });
  addPlayer(g, { name: 'Mensch' });
  addPlayer(g, { isBot: true });
  startGame(g);
  for (let i = 0; i < 25; i++) resolveTurn(g);
  assert(g.state === 'running', 'Unbegrenzte Partie endet nach ' + g.turn + ' Runden');
  g.settings.maxTurns = 20;
  resolveTurn(g);
  assert(g.state === 'over', 'Rundenlimit greift nicht');
}

// Spirale ohne Rundenlimit: Die KI darf nicht einschlafen. Ohne Späher wuchs
// die Karte nicht mehr, das Erz ging aus, und keine Flotte bewegte sich.
{
  const g = createGame('Spirale');
  Object.assign(g.settings, { seed: 1, turnTimer: 0, maxTurns: 0, shape: 'spiral' });
  for (let i = 0; i < 6; i++) addPlayer(g, { isBot: true });
  startGame(g);
  const anfang = g.galaxy.planets.length;
  let still = 0, amLaengsten = 0;
  while (g.turn < 220 && g.state === 'running') {
    for (const b of g.players.filter(p => p.isBot && p.alive)) runBot(g, b);
    still = g.fleets.some(f => f.dest != null) ? 0 : still + 1;
    amLaengsten = Math.max(amLaengsten, still);
    resolveTurn(g);
  }
  assert(amLaengsten < 15, `Spirale: ${amLaengsten} Runden lang bewegt sich keine Flotte`);
  assert(g.galaxy.planets.length > anfang, 'Spirale: die Karte wächst nicht');
  console.log(`Spirale: ${anfang} -> ${g.galaxy.planets.length} Welten in ${g.turn} Runden, längste Ruhe ${amLaengsten} Runden.`);
}

// Ohne Welt ist ein Reich raus - auch wenn es noch Schiffe hat.
{
  const g = createGame('Ohne Welt');
  Object.assign(g.settings, { seed: 3, turnTimer: 0 });
  addPlayer(g, { name: 'Mensch' });
  addPlayer(g, { isBot: true });
  startGame(g);
  const opfer = g.players[1];
  for (const q of g.galaxy.planets) if (q.owner === opfer.id) { q.owner = null; q.pop = 0; }
  // Kolonieschiffe weg - sonst landet das Startschiff gleich wieder auf der Heimat.
  for (const f of g.fleets) if (f.owner === opfer.id) f.ships = f.ships.filter(s => !s.colonists);
  g.fleets = g.fleets.filter(f => f.ships.length);
  assert(g.fleets.some(f => f.owner === opfer.id), 'Testaufbau: Reich ohne Schiffe');
  resolveTurn(g);
  assert(!opfer.alive, 'Reich ohne Welt lebt weiter');
  assert(!g.fleets.some(f => f.owner === opfer.id), 'Geisterflotten bleiben übrig');
  assert(g.state === 'over' && g.winner === g.players[0].id, 'Letztes Reich gewinnt nicht');
}

// Planet 0 ist ein gültiges Ziel: die ID ist falsy, der Kurs darf trotzdem nicht verpuffen.
{
  const g = createGame('Ziel0');
  g.settings.seed = 7;
  g.settings.turnTimer = 0;
  const me = addPlayer(g, { name: 'Mensch' });
  addPlayer(g, { isBot: true, name: 'KI' });
  startGame(g);
  const pl = g.players.find(p => !p.isBot);
  const fleet = g.fleets.find(f => f.owner === pl.id && f.at !== 0);
  for (const s of fleet.ships) s.range = 1e6;
  const r0 = setOrders(g, pl, { move: { fleetId: fleet.id, planetId: 0 } });
  assert(!r0?.error, 'Kurs auf Planet 0 abgelehnt: ' + r0?.error);
  const before = { x: fleet.x, y: fleet.y };
  for (let i = 0; i < 40 && fleet.at !== 0; i++) resolveTurn(g);
  assert(fleet.x !== before.x || fleet.y !== before.y, 'Flotte mit Ziel Planet 0 startet nicht');
  assert(fleet.at === 0, 'Flotte erreicht Planet 0 nicht');
}

// Jede Heimat hat Welten, die das Startschiff erreicht - in allen Formen.
{
  let geprueft = 0;
  for (const mode of ['classic', 'space']) for (const shape of ['scatter', 'spiral']) {
    for (const seed of [1, 2, 3, 42, 4711]) {
      const g = createGame('Start');
      Object.assign(g.settings, { seed, mode, shape, turnTimer: 0 });
      for (let i = 0; i < 8; i++) addPlayer(g, { isBot: true });
      startGame(g);
      for (const pl of g.players) {
        const kolonie = g.fleets.find(f => f.owner === pl.id && f.ships.some(s => s.colonists > 0));
        const ziele = g.galaxy.planets.filter(q => !q.owner && canReach(g, kolonie, q).ok);
        assert(ziele.length >= 3, `${mode}/${shape}/${seed}: ${pl.name} erreicht mit dem Startschiff nur ${ziele.length} Welten`);
        assert(ziele.some(q => habitability(q) >= 0.45), `${mode}/${shape}/${seed}: keine bewohnbare Startnachbarin`);
        geprueft++;
      }
    }
  }
  console.log(`Startnachbarn: ${geprueft} Heimatwelten geprüft.`);
}

// Umrüsten: alte Schiffe bekommen die neue Technik, gegen Aufpreis.
{
  const g = createGame('Werft');
  Object.assign(g.settings, { seed: 99, turnTimer: 0 });
  addPlayer(g, { name: 'Mensch' });
  addPlayer(g, { isBot: true });
  startGame(g);
  const pl = g.players[0];
  pl.research.budgetPct = 0;
  const flotte = g.fleets.find(f => f.owner === pl.id && f.ships.some(s => s.type === 'scout'));
  const alt = { ...flotte.ships[0] };
  pl.tech.speed = 4; pl.tech.range = 3; pl.tech.weapons = 5;
  const kosten = refitTotal(flotte.ships, pl.tech);
  assert(kosten.count === flotte.ships.length && kosten.money > 0, 'Umrüstkosten fehlen');
  const geld = pl.money;
  const r = setOrders(g, pl, { refit: { fleetId: flotte.id } });
  assert(!r?.error, 'Umrüsten abgelehnt: ' + r?.error);
  resolveTurn(g);
  const neu = flotte.ships[0];
  assert(neu.speed > alt.speed && neu.range > alt.range, 'Antrieb nicht umgerüstet');
  assert(neu.tech.weapons === alt.tech.weapons, 'Späher bekommt Waffen, die er nicht hat');
  assert(!refitCost(neu.type, neu.tech, pl.tech), 'Nach dem Umrüsten noch veraltet');
  assert(pl.money <= geld - kosten.money + pl.income + 1, 'Umrüsten war kostenlos');
  // Unterwegs gibt es keine Werft.
  const weg = g.fleets.find(f => f.owner === pl.id && f.at == null)
    || (() => { const f = g.fleets.find(x => x.owner === pl.id); f.at = null; return f; })();
  assert(setOrders(g, pl, { refit: { fleetId: weg.id } })?.error === 'err.refitNoYard', 'Umrüsten ohne Werft möglich');
  console.log(`Umrüsten: ${kosten.count} Späher für ${kosten.money} Cr / ${kosten.metal} Erz.`);
}

console.log('\nAlle Prüfungen bestanden.');

function assert(cond, msg) { if (!cond) { console.error('FEHLER: ' + msg); process.exit(1); } }
