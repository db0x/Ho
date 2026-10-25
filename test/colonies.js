// Colony ships of hard AI empires take short trips. An empire with its
// capital on one side and a second shipyard far away on the other: right
// next to the second one lies a very good free world. The hard AI builds the
// colony ship there and sends it to exactly that world; colony ships built
// together each fly to a world of their own. The normal AI builds everything
// at the capital, as before.
import { createGame, addPlayer, startGame, resolveTurn } from '../server/game.js';
import { runBot } from '../server/bot.js';
import { dist, travelDistance, holeZone, shipStats, IDEAL } from '../shared/rules.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

function play(level) {
  const g = createGame('Colonies');
  Object.assign(g.settings, { seed: 99, turnTimer: 0, maxTurns: 0, expanding: false });
  const bot = addPlayer(g, { isBot: true, persona: 'settler', level });
  addPlayer(g, { name: 'Far away' });
  startGame(g);
  const planets = g.galaxy.planets;
  const home = planets[bot.homeworld];
  // The second shipyard: a free world far from the capital.
  const outpost = planets.filter(p => !p.owner).sort((a, b) => dist(b, home) - dist(a, home))
    .find(p => dist(p, home) > 300 && dist(p, home) < 450);
  Object.assign(outpost, { owner: bot.id, pop: 6 });
  // Right next to it the best free world around.
  const gem = planets.filter(p => !p.owner).sort((a, b) => dist(a, outpost) - dist(b, outpost))[0];
  Object.assign(gem, { temp: IDEAL.temp, grav: IDEAL.grav });
  for (const p of planets) bot.explored.add(p.id);
  // The starting colony ship would muddle the picture.
  g.fleets = g.fleets.filter(f => !(f.owner === bot.id && f.ships.some(s => s.colonists > 0)));

  const zone = holeZone(g.galaxy);
  const speed = shipStats('colony', bot.tech).speed;
  bot.money = 5000; bot.metal = 3000;
  runBot(g, bot);
  const builds = Object.entries(bot.orders.builds)
    .filter(([, q]) => q.colony).map(([id, q]) => ({ yard: Number(id), n: q.colony }));
  resolveTurn(g);
  bot.money = 5000; bot.metal = 3000;
  runBot(g, bot);
  const trips = g.fleets.filter(f => f.owner === bot.id && f.dest != null && f.ships.some(s => s.colonists > 0))
    .map(f => ({ from: f.at, to: f.dest, ships: f.ships.length,
      turns: Math.ceil(travelDistance(f, planets[f.dest], zone) / speed) }));
  return { home, outpost, gem, builds, trips };
}

const hard = play('hard');
const normal = play('normal');
const avg = r => r.trips.reduce((a, t) => a + t.turns, 0) / Math.max(1, r.trips.length);
const show = r => r.trips.map(t => `${t.from}->${t.to} ${t.turns}T`).join(', ');
console.log(`hard:   built at ${hard.builds.map(b => `${b.yard}×${b.n}`).join(', ')}; trips ${show(hard)}`);
console.log(`normal: built at ${normal.builds.map(b => `${b.yard}×${b.n}`).join(', ')}; trips ${show(normal)}`);

assert(hard.builds.some(b => b.yard === hard.outpost.id), 'Hard AI did not build a colony ship at the shipyard next to the good world');
const toGem = hard.trips.find(t => t.to === hard.gem.id);
assert(toGem && toGem.from === hard.outpost.id, `The colony ship for the good world did not start next door (${toGem?.from})`);
assert(hard.trips.every(t => t.ships === 1), 'Hard AI sent several colony ships together to one world');
assert(new Set(hard.trips.map(t => t.to)).size === hard.trips.length, 'Two colony ships head for the same world');
assert(normal.builds.every(b => b.yard === normal.home.id), 'Normal AI changed: it should build its colony ships at the capital');
assert(hard.trips.length > 0 && avg(hard) < avg(normal),
  `Hard colony ships are not under way shorter (${avg(hard).toFixed(1)} vs. ${avg(normal).toFixed(1)} turns)`);
console.log(`Average trip: hard ${avg(hard).toFixed(1)} turns, normal ${avg(normal).toFixed(1)} turns.`);

if (errors) { console.error(`${errors} error(s)`); process.exit(1); }
console.log('All colony checks passed.');
