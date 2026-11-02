// AI fleet sense: a lone foreign scout in the orbit of a free world blocks
// every landing there. The AI must not just give up the world - a warship
// goes there, the scout is shot down, and the colony ship lands. And scouts
// spread out: no two of them fly to the same unexplored world, and the start
// does not turn into a swarm.
import { createGame, startGame } from '../server/game/game.js';
import { addPlayer } from '../server/game/players.js';
import { resolveTurn } from '../server/game/turn.js';
import { newFleet, addShip } from '../server/game/fleets.js';
import { runBot } from '../server/ai/bot.js';
import { dist, planetCapacity } from '../shared/rules.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

// 1) Blockade: colony ship and foreign scout in the same orbit
for (const level of ['normal', 'hard']) {
  const g = createGame('Blockade');
  Object.assign(g.settings, { seed: 777, turnTimer: 0, maxTurns: 0, expanding: false });
  const bot = addPlayer(g, { isBot: true, persona: 'settler', level });
  const foe = addPlayer(g, { name: 'Intruder' });
  startGame(g);
  const planets = g.galaxy.planets;
  const home = planets[bot.homeworld];
  const gem = planets.filter(p => !p.owner && planetCapacity(p) >= 3)
    .sort((a, b) => dist(a, home) - dist(b, home))[0];
  for (const p of planets) bot.explored.add(p.id);
  // Only the colony ship at the gem, the scout of the intruder next to it,
  // and a few fighters at home.
  g.fleets = g.fleets.filter(f => f.owner !== bot.id && !(f.owner === foe.id && f.ships.every(s => s.type === 'scout')));
  const settlers = newFleet(g, bot.id, gem);
  addShip(g, settlers, 'colony', bot.tech);
  const scout = newFleet(g, foe.id, gem);
  addShip(g, scout, 'scout', foe.tech);
  const guard = newFleet(g, bot.id, home);
  for (let i = 0; i < 3; i++) addShip(g, guard, 'fighter', bot.tech);

  let sent = false;
  for (let t = 0; t < 25 && gem.owner !== bot.id; t++) {
    bot.money = 0; bot.metal = 0;
    runBot(g, bot);
    if (g.fleets.some(f => f.owner === bot.id && f.dest === gem.id && f.ships.some(s => s.attack > 0))) sent = true;
    // The intruder sits still.
    foe.ready = true;
    resolveTurn(g);
  }
  console.log(`${level}: escort sent ${sent}, gem settled ${gem.owner === bot.id} by turn ${g.turn}`);
  assert(sent, `${level}: no warship was sent against the scout`);
  assert(gem.owner === bot.id, `${level}: the colony ship never settled the blocked world`);
}

// 2) Scouts spread out
{
  const g = createGame('Scouts');
  Object.assign(g.settings, { seed: 31337, turnTimer: 0 });
  for (let i = 0; i < 6; i++) addPlayer(g, { isBot: true, name: 'AI ' + (i + 1), persona: i % 2 ? 'raider' : 'vulture' });
  startGame(g);
  let doubles = 0, most = 0;
  for (let t = 0; t < 40 && g.state === 'running'; t++) {
    for (const b of g.players.filter(p => p.isBot && p.alive)) runBot(g, b);
    for (const b of g.players) {
      const scouts = g.fleets.filter(f => f.owner === b.id && f.ships.every(s => s.type === 'scout'));
      most = Math.max(most, scouts.reduce((a, f) => a + f.ships.length, 0));
      const dests = scouts.filter(f => f.dest != null && !b.explored.has(f.dest)).map(f => f.dest);
      doubles += dests.length - new Set(dests).size;
    }
    resolveTurn(g);
  }
  console.log(`Scouts: at most ${most} per empire, ${doubles} double courses to unexplored worlds.`);
  assert(doubles === 0, `${doubles} times two scouts flew to the same unexplored world`);
  assert(most <= 8, `An empire had ${most} scouts at the same time`);
}

if (errors) { console.error(`\n${errors} blockade checks failed.`); process.exit(1); }
console.log('\nAll blockade checks passed.');
