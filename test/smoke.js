// Plays a complete game with 16 AI empires and checks the invariants.
import { createGame, addPlayer, startGame, resolveTurn, buildView, setOrders, canReach } from '../server/game.js';
import { habitability, refitTotal, refitCost, dist } from '../shared/rules.js';
import { runBot } from '../server/bot.js';
import { generateGalaxy } from '../server/galaxy.js';

const game = createGame('Test');
game.settings.seed = 20251012;
game.settings.turnTimer = 0;
for (let i = 0; i < 16; i++) addPlayer(game, { isBot: true, name: 'AI ' + (i + 1) });
const r = startGame(game);
if (r.error) throw new Error(r.error);

console.log(`Galaxy: ${game.galaxy.planets.length} worlds, ${game.galaxy.width}x${game.galaxy.height} ly`);

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
  // Invariants
  for (const p of game.players) {
    assert(Number.isFinite(p.money) && p.money >= -1, `Money broken for ${p.name}: ${p.money}`);
    assert(Number.isFinite(p.metal) && p.metal >= -1, `Metal broken for ${p.name}: ${p.metal}`);
    for (const f of Object.keys(p.tech)) assert(p.tech[f] >= 1, 'Tech level < 1');
  }
  for (const pl of game.galaxy.planets) {
    assert(Number.isFinite(pl.temp) && Number.isFinite(pl.grav), 'Planet data broken');
    assert(pl.pop >= 0 && pl.pop < 200, 'Population out of bounds: ' + pl.pop);
    assert(pl.metalReserve >= 0, 'Negative ore reserve');
    if (pl.owner) assert(game.players.some(p => p.id === pl.owner), 'Planet has a phantom owner');
  }
  // What the scanners around your own worlds pick up is up to date for this
  // turn - not as of the first discovery.
  for (const p of game.players.filter(q => q.alive)) {
    const mine = game.galaxy.planets.filter(q => q.owner === p.id);
    for (const pl of game.galaxy.planets) {
      if (pl.owner === p.id || !mine.some(q => dist(q, pl) < 230)) continue;
      const k = p.knowledge[pl.id];
      assert(k && k.owner === pl.owner,
        `${p.name} sees ${pl.name} outdated in the scanner: owner ${k?.owner} instead of ${pl.owner} (as of turn ${k?.turn})`);
    }
  }
  for (const f of game.fleets) {
    assert(f.ships.length > 0, 'Empty fleet left over');
    assert(Number.isFinite(f.x) && Number.isFinite(f.y), 'Fleet position broken');
  }
  if (t % 20 === 19) {
    const alive = game.players.filter(p => p.alive);
    const top = alive.slice().sort((a, b) => b.stats.pop - a.stats.pop)[0];
    console.log(`Turn ${game.turn}: ${alive.length} empires active, ` +
      `colonized: ${game.galaxy.planets.filter(p => p.owner).length}/${game.galaxy.planets.length}, ` +
      `ships: ${game.fleets.reduce((a, f) => a + f.ships.length, 0)}, ` +
      `leading: ${top.name} (${top.stats.planets} W, ${top.stats.pop} M, tech ${Object.values(top.tech).join('/')})`);
  }
}

/**
 * The record must carry the result the server computed: replayed, exactly
 * as many ships remain per side as the tally states - otherwise the replay
 * shows a different battle.
 */
function checkReplay(e) {
  const { sides, units, rounds, scuttled } = e.battle;
  const hp = units.map(u => u[2]);
  for (const shots of rounds) {
    for (const [from, to, dmg] of shots) {
      assert(units[from] && units[to], 'Record: unknown unit');
      assert(units[from][0] !== units[to][0], 'Record: firing on own side');
      assert(hp[from] > 0, 'Record: a dead unit shoots');
      assert(dmg > 0, 'Record: shot without damage');
    }
    for (const [, to, dmg] of shots) hp[to] = Math.round((hp[to] - dmg) * 10) / 10;
  }
  const gone = new Set(scuttled);
  sides.forEach((owner, k) => {
    const left = units.filter((u, i) => u[0] === k && u[1] !== 'battery' && hp[i] > 0 && !gone.has(i)).length;
    const name = (game.players.find(p => p.id === owner) || {}).name;
    const tally = e.params.sides.find(x => x.name === name);
    assert(tally && tally.left === left,
      `Record at ${e.params.planet}: ${name} keeps ${left}, tally says ${tally?.left}`);
  });
  const n = JSON.stringify(e.battle).length;
  replays++; replayBytes += n; biggest = Math.max(biggest, n);
}

const ms = Date.now() - t0;
console.log(`\n${game.turn - 1} turns in ${ms} ms (${(ms / (game.turn - 1)).toFixed(1)} ms/turn)`);
console.log(`Space battles: ${combats}, colonizations: ${colonies}, conquests: ${invasions}`);

// Check the per-player view
const v = buildView(game, game.players[0]);
const json = JSON.stringify(v);
console.log(`View for one player: ${(json.length / 1024).toFixed(1)} kB, ` +
  `known: ${v.planets.filter(p => p.known !== 'unknown').length}/${v.planets.length} worlds, ` +
  `visible fleets: ${v.fleets.length}`);
assert(!json.includes('null,null'), 'View contains broken fields');
assert(v.planets.every(p => p.known === 'unknown' || Number.isFinite(p.temp)), 'View: planet without temperature');

// Foreign fleets must not reveal ship details
for (const f of v.fleets.filter(f => !f.mine)) {
  assert(f.ships.every(s => !('hp' in s)), 'Foreign fleet reveals hit points');
}
assert(colonies > 5, 'AI does not colonize');
assert(combats > 0, 'There was not a single battle');
assert(replays > 0, 'No battle with a record');
console.log(`Records: ${replays}, on average ${(replayBytes / replays / 1024).toFixed(1)} kB, ` +
  `largest ${(biggest / 1024).toFixed(1)} kB`);
// Only the latest turn travels with records - older ones are dropped.
for (const l of game.log) {
  if (l.turn < game.turn) assert(l.entries.every(e => !e.battle), `Record from turn ${l.turn} not dropped`);
}

// The map seed: without one the server rolls a secret 128-bit seed, with
// one the map is reproducible (tests rely on that).
{
  const a = generateGalaxy({ playerCount: 4 }), b = generateGalaxy({ playerCount: 4 });
  assert(/^[0-9a-f]{32}$/.test(a.seed) && a.seed !== b.seed, `Seed is not a fresh 128-bit secret (${a.seed})`);
  const same = (s) => JSON.stringify(generateGalaxy({ playerCount: 4, seed: s }).planets);
  assert(same(42) === same(42) && same(42) !== same(43), 'Seeded maps are not reproducible');
}

// Every AI empire has a personality, and six bots are six different ones.
{
  const g = createGame('Mix');
  for (let i = 0; i < 6; i++) addPlayer(g, { isBot: true });
  addPlayer(g, { name: 'Human' });
  const kinds = g.players.filter(p => p.isBot).map(p => p.persona);
  assert(new Set(kinds).size === 6, 'AI personalities assigned twice: ' + kinds.join(', '));
  assert(g.players.find(p => !p.isBot).persona === null, 'Human with an AI personality');
}

// Turn limit 0 means unlimited: the game runs past any limit.
{
  const g = createGame('Endless');
  Object.assign(g.settings, { seed: 5, turnTimer: 0, maxTurns: 0 });
  addPlayer(g, { name: 'Human' });
  addPlayer(g, { isBot: true });
  startGame(g);
  for (let i = 0; i < 25; i++) resolveTurn(g);
  assert(g.state === 'running', 'Unlimited game ends after ' + g.turn + ' turns');
  g.settings.maxTurns = 20;
  resolveTurn(g);
  assert(g.state === 'over', 'Turn limit does not apply');
}

// Spiral without a turn limit: the AI must not fall asleep. Without scouts
// the map stopped growing, the ore ran out, and no fleet moved anymore.
{
  const g = createGame('Spiral');
  Object.assign(g.settings, { seed: 1, turnTimer: 0, maxTurns: 0, shape: 'spiral' });
  for (let i = 0; i < 6; i++) addPlayer(g, { isBot: true });
  startGame(g);
  const initial = g.galaxy.planets.length;
  let idle = 0, longest = 0;
  while (g.turn < 220 && g.state === 'running') {
    for (const b of g.players.filter(p => p.isBot && p.alive)) runBot(g, b);
    idle = g.fleets.some(f => f.dest != null) ? 0 : idle + 1;
    longest = Math.max(longest, idle);
    resolveTurn(g);
  }
  assert(longest < 15, `Spiral: no fleet moves for ${longest} turns`);
  assert(g.galaxy.planets.length > initial, 'Spiral: the map does not grow');
  console.log(`Spiral: ${initial} -> ${g.galaxy.planets.length} worlds in ${g.turn} turns, longest idle ${longest} turns.`);
}

// Without a world an empire is out - even if it still has ships.
{
  const g = createGame('No world');
  Object.assign(g.settings, { seed: 3, turnTimer: 0 });
  addPlayer(g, { name: 'Human' });
  addPlayer(g, { isBot: true });
  startGame(g);
  const victim = g.players[1];
  for (const q of g.galaxy.planets) if (q.owner === victim.id) { q.owner = null; q.pop = 0; }
  // Remove colony ships - otherwise the starting ship lands right back on the homeworld.
  for (const f of g.fleets) if (f.owner === victim.id) f.ships = f.ships.filter(s => !s.colonists);
  g.fleets = g.fleets.filter(f => f.ships.length);
  assert(g.fleets.some(f => f.owner === victim.id), 'Test setup: empire without ships');
  resolveTurn(g);
  assert(!victim.alive, 'Empire without a world lives on');
  assert(!g.fleets.some(f => f.owner === victim.id), 'Ghost fleets are left over');
  assert(g.state === 'over' && g.winner === g.players[0].id, 'Last empire does not win');
}

// Planet 0 is a valid target: the ID is falsy, the course must still not fizzle.
{
  const g = createGame('Target0');
  g.settings.seed = 7;
  g.settings.turnTimer = 0;
  const me = addPlayer(g, { name: 'Human' });
  addPlayer(g, { isBot: true, name: 'AI' });
  startGame(g);
  const pl = g.players.find(p => !p.isBot);
  const fleet = g.fleets.find(f => f.owner === pl.id && f.at !== 0);
  for (const s of fleet.ships) s.range = 1e6;
  const r0 = setOrders(g, pl, { move: { fleetId: fleet.id, planetId: 0 } });
  assert(!r0?.error, 'Course to planet 0 rejected: ' + r0?.error);
  const before = { x: fleet.x, y: fleet.y };
  for (let i = 0; i < 40 && fleet.at !== 0; i++) resolveTurn(g);
  assert(fleet.x !== before.x || fleet.y !== before.y, 'Fleet heading for planet 0 does not start');
  assert(fleet.at === 0, 'Fleet does not reach planet 0');
}

// Every homeworld has worlds the starting ship can reach - in all shapes.
{
  let checked = 0;
  for (const mode of ['classic', 'space']) for (const shape of ['scatter', 'spiral']) {
    for (const seed of [1, 2, 3, 42, 4711]) {
      const g = createGame('Start');
      Object.assign(g.settings, { seed, mode, shape, turnTimer: 0 });
      for (let i = 0; i < 8; i++) addPlayer(g, { isBot: true });
      startGame(g);
      for (const pl of g.players) {
        const colony = g.fleets.find(f => f.owner === pl.id && f.ships.some(s => s.colonists > 0));
        const targets = g.galaxy.planets.filter(q => !q.owner && canReach(g, colony, q).ok);
        assert(targets.length >= 3, `${mode}/${shape}/${seed}: ${pl.name} reaches only ${targets.length} worlds with the starting ship`);
        assert(targets.some(q => habitability(q) >= 0.45), `${mode}/${shape}/${seed}: no habitable starting neighbor`);
        checked++;
      }
    }
  }
  console.log(`Starting neighbors: ${checked} homeworlds checked.`);
}

// Refit: old ships get the new tech, at a surcharge.
{
  const g = createGame('Shipyard');
  Object.assign(g.settings, { seed: 99, turnTimer: 0 });
  addPlayer(g, { name: 'Human' });
  addPlayer(g, { isBot: true });
  startGame(g);
  const pl = g.players[0];
  pl.research.budgetPct = 0;
  const fleet = g.fleets.find(f => f.owner === pl.id && f.ships.some(s => s.type === 'scout'));
  const old = { ...fleet.ships[0] };
  pl.tech.speed = 4; pl.tech.range = 3; pl.tech.weapons = 5;
  const cost = refitTotal(fleet.ships, pl.tech);
  assert(cost.count === fleet.ships.length && cost.money > 0, 'Refit costs missing');
  const money = pl.money;
  const r = setOrders(g, pl, { refit: { fleetId: fleet.id } });
  assert(!r?.error, 'Refit rejected: ' + r?.error);
  resolveTurn(g);
  const refitted = fleet.ships[0];
  assert(refitted.speed > old.speed && refitted.range > old.range, 'Drive not refitted');
  assert(refitted.tech.weapons === old.tech.weapons, 'Scout gets weapons it does not have');
  assert(!refitCost(refitted.type, refitted.tech, pl.tech), 'Still outdated after the refit');
  assert(pl.money <= money - cost.money + pl.income + 1, 'Refit was free');
  // There is no shipyard while under way.
  const underway = g.fleets.find(f => f.owner === pl.id && f.at == null)
    || (() => { const f = g.fleets.find(x => x.owner === pl.id); f.at = null; return f; })();
  assert(setOrders(g, pl, { refit: { fleetId: underway.id } })?.error === 'err.refitNoYard', 'Refit possible without a shipyard');
  console.log(`Refit: ${cost.count} scouts for ${cost.money} Cr / ${cost.metal} ore.`);
}

console.log('\nAll checks passed.');

function assert(cond, msg) { if (!cond) { console.error('ERROR: ' + msg); process.exit(1); } }
