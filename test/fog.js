// Fog of war (game setting "fog", server/game/sensors.js): an empire sees
// only what its sensors cover - worlds 230, worlds with a station 360,
// fleets 185, fleets with a scout 320. A foreign course shows its target
// only if that is an own world or in sight, otherwise just the direction.
// The tallies of other empires are hidden. Off, the older, wider sight
// stays as it was. The AI goes by the same rules as a human.
import { createGame, startGame, DEFAULT_SETTINGS } from '../server/game/game.js';
import { buildView, updateVisibility } from '../server/game/intel.js';
import { addPlayer } from '../server/game/players.js';
import { newFleet, addShip } from '../server/game/fleets.js';
import { sanitizeSettings } from '../server/hub/lobby.js';
import { survey } from '../server/ai/situation.js';
import { perceivedPlanets } from '../server/ai/perception.js';
import { SENSOR, dist } from '../shared/rules.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } return ok; };

/** Two empires far apart; A only has its homeworld, no fleets anywhere. */
function setup({ fog = true, botA = false } = {}) {
  const g = createGame('Fog');
  g.settings.seed = 5;
  g.settings.aliens = false;
  g.settings.wormholes = false;
  g.settings.fog = fog;
  addPlayer(g, botA ? { name: 'A', isBot: true } : { name: 'A' });
  addPlayer(g, { name: 'B' });
  startGame(g);
  const [a, b] = g.players;
  g.fleets = [];
  const homeA = g.galaxy.planets[a.homeworld], homeB = g.galaxy.planets[b.homeworld];
  // Points at a given distance from A's home, on the side facing away from B.
  const d = dist(homeA, homeB);
  const ux = (homeA.x - homeB.x) / d, uy = (homeA.y - homeB.y) / d;
  const at = (r) => ({ x: homeA.x + ux * r, y: homeA.y + uy * r, z: 0 });
  return { g, a, b, homeA, homeB, at };
}
function fleetOf(g, owner, where, types) {
  const p = g.players.find(q => q.id === owner);
  const f = newFleet(g, owner, where.id != null ? where : null);
  if (where.id == null) { f.x = where.x; f.y = where.y; f.z = 0; }
  for (const t of types) addShip(g, f, t, p.tech);
  return f;
}
const seen = (g, player, f) => buildView(g, player).fleets.find(x => x.id === f.id);

// 0) The setting: on for new games, passed through by the lobby.
assert(DEFAULT_SETTINGS.fog === true, 'Fog of war is not on by default');
assert(sanitizeSettings({ fog: false }).fog === false && sanitizeSettings({ fog: 'x' }).fog === undefined,
  'The lobby does not take the setting as it should');
{
  const { homeA, homeB } = setup();
  assert(dist(homeA, homeB) > SENSOR.station + 100, `The homeworlds are too close for these checks (${Math.round(dist(homeA, homeB))})`);
}

// 1) Without fog: everything as before - wide sight, full course.
{
  const { g, a, b, homeB, at } = setup({ fog: false });
  const near = fleetOf(g, b.id, at(150), ['fighter']);
  near.dest = homeB.id;
  const wide = fleetOf(g, b.id, at(270), ['fighter']);
  const v = seen(g, a, near);
  assert(v && v.dest === homeB.id && v.eta > 0 && !v.heading, 'Without fog the course is not shown in full');
  assert(seen(g, a, wide), 'Without fog a fleet 270 from the homeworld is not seen');
  const view = buildView(g, a);
  assert(!view.fog && !view.sensors, 'Without fog the view carries sensors');
  assert(view.players.every(p => p.stats), 'Without fog the tallies of other empires are hidden');
}

// 2) With fog: sensor reach, direction only for a target out of sight.
{
  const { g, a, b, homeA, homeB, at } = setup();
  const near = fleetOf(g, b.id, at(150), ['fighter']);
  near.dest = homeB.id;
  const wide = fleetOf(g, b.id, at(SENSOR.world + 40), ['fighter']);
  const v = seen(g, a, near);
  if (assert(v, 'A fleet within sensor reach is not seen')) {
    assert(v.dest == null && v.eta == null, 'The target out of sight is given away');
    assert(v.heading, 'No direction for a fleet with a target out of sight');
    if (v.heading) {
      const toward = (v.heading.x - near.x) * (homeB.x - near.x) + (v.heading.y - near.y) * (homeB.y - near.y);
      assert(toward > 0 && dist(v.heading, near) < 120, 'The direction does not point to the target, or reaches too far');
    }
  }
  assert(!seen(g, a, wide), 'A fleet beyond the sensors is seen');
  // Coming for an own world: target and arrival are known.
  near.dest = homeA.id;
  const w = seen(g, a, near);
  assert(w && w.dest === homeA.id && w.eta > 0 && !w.heading, 'A fleet heading for an own world does not show it');
  // Waiting in orbit out of sight of its target: no direction given away.
  const parked = fleetOf(g, b.id, homeB, ['fighter']);
  parked.dest = homeA.id;
  assert(!seen(g, a, parked), 'A fleet at the far homeworld is seen');

  const view = buildView(g, a);
  assert(view.fog === true && view.sensors?.length === 1 && view.sensors[0].r === SENSOR.world, 'The view does not carry the sensors');
  const pb = view.players.find(p => p.id === b.id), pa = view.players.find(p => p.id === a.id);
  assert(pb.stats === null && pa.stats, 'With fog the tallies are not hidden (or the own one is)');
}

// 3) Scouts and stations see farther.
{
  const { g, a, b, homeA, at } = setup();
  const target = fleetOf(g, b.id, at(270), ['fighter']);
  const plain = fleetOf(g, a.id, homeA, ['fighter']);
  assert(!seen(g, a, target), 'A fighter fleet sees as far as a scout');
  addShip(g, plain, 'scout', a.tech);
  assert(seen(g, a, target), 'A fleet with a scout does not see farther');
  plain.ships = plain.ships.filter(s => s.type !== 'scout');
  homeA.station = { building: 0, hp: 100, maxHp: 100, attack: 1, tech: { ...a.tech } };
  assert(seen(g, a, target), 'A world with a station does not see farther');
  homeA.station.building = 2;
  assert(!seen(g, a, target), 'A station still being built already sees farther');
}

// 4) Memory: worlds out of sight as last seen, the AI estimate stays on the server.
{
  const { g, a, b, homeB } = setup();
  const scout = fleetOf(g, a.id, homeB, ['scout']);
  updateVisibility(g);
  const popThen = homeB.pop;
  g.fleets = g.fleets.filter(f => f !== scout);
  homeB.pop = popThen + 10;
  updateVisibility(g);
  const vp = buildView(g, a).planets.find(p => p.id === homeB.id);
  assert(vp.known === 'memory' && vp.pop === popThen, 'The world out of sight does not show what was seen');
  assert(!('defHp' in vp), 'The AI estimate goes out with the view');
}

// 5) The AI: only what its sensors give.
{
  const { g, a, b, homeA, homeB, at } = setup({ botA: true });
  // An armed fleet of B on its way to A's homeworld, still out of sensor reach.
  const strike = fleetOf(g, b.id, at(SENSOR.world + 80), ['fighter', 'fighter']);
  strike.dest = homeA.id;
  assert(!survey(g, a).threatened.has(homeA.id), 'The AI sees an attack coming that is out of sensor reach');
  strike.x = at(150).x; strike.y = at(150).y;
  assert(survey(g, a).threatened.has(homeA.id), 'The AI does not see an attack within sensor reach');
  g.settings.fog = false;
  strike.x = at(SENSOR.world + 80).x; strike.y = at(SENSOR.world + 80).y;
  assert(survey(g, a).threatened.has(homeA.id), 'Without fog the AI no longer sees what it saw before');
  g.settings.fog = true;

  // Worlds: never seen - empty; seen once - as they were then.
  let pb = perceivedPlanets(g, a)[homeB.id];
  assert(pb.owner == null && pb.pop === 0, 'The AI knows a world it never saw');
  const look = fleetOf(g, a.id, homeB, ['scout']);
  updateVisibility(g);
  g.fleets = g.fleets.filter(f => f !== look);
  const popThen = homeB.pop;
  homeB.pop = popThen + 10;
  pb = perceivedPlanets(g, a)[homeB.id];
  assert(pb.owner === b.id && pb.pop === popThen, 'The AI does not remember the world as seen');
  assert(perceivedPlanets(g, a)[homeA.id] === homeA, 'The AI does not see its own world live');
}

if (errors) { console.log(`\n${errors} fog of war checks failed.`); process.exit(1); }
console.log('All fog of war checks passed.');
