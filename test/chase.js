// Intercepting in flight: an armed fleet chases a foreign fleet it sees.
// Both move at the same time; where the chaser comes close enough, both stop
// and fight there in open space - no battery, no satellites. A faster
// chaser catches up, a slower one only head-on. A target that reaches an
// orbit is followed there, one out of sight is given up. Every AI empire
// intercepts what comes for its worlds; the hard one weighs it up.
import { createGame, startGame } from '../server/game/game.js';
import { buildView } from '../server/game/intel.js';
import { setOrders } from '../server/game/orders.js';
import { addPlayer } from '../server/game/players.js';
import { resolveTurn } from '../server/game/turn.js';
import { newFleet, addShip } from '../server/game/fleets.js';
import { offerAlliance } from '../server/game/diplomacy.js';
import { runBot } from '../server/ai/bot.js';
import { dist } from '../shared/rules.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

/** Two empires with plenty of range; a hunter of A at its home, B's ships in space nearby. */
function setup({ levelA = null } = {}) {
  const g = createGame('Chase');
  g.settings.seed = 3;
  g.settings.aliens = false;
  g.settings.wormholes = false;
  addPlayer(g, levelA ? { name: 'A', isBot: true, level: levelA } : { name: 'A' });
  addPlayer(g, { name: 'B' });
  startGame(g);
  const [a, b] = g.players;
  for (const p of g.players) { p.tech.range = 12; p.tech.speed = 3; }
  g.fleets = [];
  return { g, a, b, homeA: g.galaxy.planets[a.homeworld], homeB: g.galaxy.planets[b.homeworld] };
}
function fleetOf(g, owner, where, types) {
  const p = g.players.find(q => q.id === owner);
  const f = newFleet(g, owner, where.id != null ? where : null);
  if (where.id == null) { f.x = where.x; f.y = where.y; f.z = 0; }
  for (const t of types) addShip(g, f, t, p.tech);
  return f;
}
const alive = (g, f) => g.fleets.includes(f) && f.ships.length > 0;

// 1) A faster hunter catches a colony ship in open space
{
  const { g, a, b, homeA, homeB } = setup();
  a.tech.speed = 8;
  const hunter = fleetOf(g, a.id, homeA, ['fighter', 'fighter', 'fighter']);
  const prey = fleetOf(g, b.id, { x: homeA.x + 120, y: homeA.y + 60 }, ['colony']);
  prey.dest = homeB.id;
  assert(setOrders(g, a, { move: { fleetId: hunter.id, chase: prey.id } }) === undefined, 'The order was refused');
  assert(hunter.chase === prey.id && hunter.aim, 'No chase and no meeting point');
  const view = buildView(g, a).fleets.find(f => f.id === hunter.id);
  assert(view.chase === prey.id && view.aim, 'The view does not show the chase');
  let battle = null;
  for (let t = 0; t < 6 && !battle; t++) battle = resolveTurn(g).find(e => e.key === 'log.battleSpace');
  assert(battle, 'No battle in space');
  if (battle) {
    assert(battle.planetId === null && battle.at && battle.battle, 'The battle has no spot or record');
    assert(!battle.battle.units.some(u => u[1] === 'battery'), 'A battery fought in open space');
    assert(dist(hunter, battle.at) < 30, 'The hunter is not where the battle was');
  }
  assert(!alive(g, prey), 'The colony ship survived three fighters');
  assert(alive(g, hunter) && hunter.at == null, 'The hunter is gone or back in an orbit');
  assert(hunter.chase == null && hunter.aim == null, 'The hunter still chases a fleet that is gone');
  console.log(`Caught: battle near ${battle?.params.near}, colony ship gone.`);
}

// 2) Both stop where they meet; a survivor keeps its course
{
  const { g, a, b, homeA, homeB } = setup();
  a.tech.speed = 8;
  const hunter = fleetOf(g, a.id, homeA, ['scout', 'fighter']);
  const prey = fleetOf(g, b.id, { x: homeA.x + 120, y: homeA.y + 60 }, ['fighter', 'fighter', 'fighter', 'fighter', 'fighter']);
  prey.dest = homeB.id;
  setOrders(g, a, { move: { fleetId: hunter.id, chase: prey.id } });
  let battle = null;
  for (let t = 0; t < 6 && !battle; t++) battle = resolveTurn(g).find(e => e.key === 'log.battleSpace');
  assert(battle && alive(g, prey), 'No battle, or the stronger target lost');
  assert(prey.dest === homeB.id && prey.at == null, 'The target lost its course');
  assert(dist(prey, battle.at) < 1, 'The target did not stop at the battle');
  console.log('Stopped: both halt where they meet, the survivor flies on.');
}

// 3) A slower chaser cannot catch a fleet running away - but head-on it can
{
  const { g, a, b, homeA, homeB } = setup();
  b.tech.speed = 9;
  const start = { x: homeA.x + 60, y: homeA.y };
  const hunter = fleetOf(g, a.id, homeA, ['fighter', 'fighter']);
  const prey = fleetOf(g, b.id, start, ['scout']);
  prey.dest = homeB.id;
  setOrders(g, a, { move: { fleetId: hunter.id, chase: prey.id } });
  let caught = false;
  for (let t = 0; t < 4; t++) caught = caught || resolveTurn(g).some(e => e.key === 'log.battleSpace');
  assert(!caught, 'A slow chaser caught a fast scout running away');

  const h2 = setup();
  h2.b.tech.speed = 9;
  const hunter2 = fleetOf(h2.g, h2.a.id, h2.homeA, ['fighter', 'fighter']);
  const mid = { x: (h2.homeA.x * 2 + h2.homeB.x) / 3, y: (h2.homeA.y * 2 + h2.homeB.y) / 3 };
  const scout2 = fleetOf(h2.g, h2.b.id, { x: h2.homeB.x * 0.6 + mid.x * 0.4, y: h2.homeB.y * 0.6 + mid.y * 0.4 }, ['scout']);
  scout2.dest = h2.a.homeworld;
  setOrders(h2.g, h2.a, { move: { fleetId: hunter2.id, chase: scout2.id } });
  let met = false;
  for (let t = 0; t < 8 && !met; t++) met = resolveTurn(h2.g).some(e => e.key === 'log.battleSpace' || e.key === 'log.battle');
  assert(met, 'Head-on, the slow chaser did not meet the fast scout');
  console.log('Speed: a fast fleet runs away, head-on it is met.');
}

// 4) Orders: only armed, only enemies, only in sight; a target in orbit is flown to
{
  const { g, a, b, homeA, homeB } = setup();
  const scouts = fleetOf(g, a.id, homeA, ['scout']);
  const fighters = fleetOf(g, a.id, homeA, ['fighter']);
  const near = fleetOf(g, b.id, { x: homeA.x + 100, y: homeA.y }, ['colony']);
  near.dest = homeB.id;
  const far = fleetOf(g, b.id, { x: homeB.x + 30, y: homeB.y + 30 }, ['colony']);
  far.dest = homeB.id;
  const orbit = fleetOf(g, b.id, homeB, ['fighter']);
  assert(setOrders(g, a, { move: { fleetId: scouts.id, chase: near.id } })?.error === 'err.chaseUnarmed', 'Scouts may intercept');
  assert(setOrders(g, a, { move: { fleetId: fighters.id, chase: far.id } })?.error === 'err.noSuchTarget', 'A fleet out of sight may be chased');
  assert(setOrders(g, a, { move: { fleetId: fighters.id, chase: fighters.id } })?.error === 'err.noSuchTarget', 'An own fleet may be chased');
  offerAlliance(g, a, b.id, false); offerAlliance(g, b, a.id, false);
  assert(setOrders(g, a, { move: { fleetId: fighters.id, chase: near.id } })?.error === 'err.chaseFriend', 'An ally may be chased');
  g.alliances = [];
  // A scout of A in that orbit gives sight of the enemy fighter there.
  fleetOf(g, a.id, homeB, ['scout']);
  const r = setOrders(g, a, { move: { fleetId: fighters.id, chase: orbit.id } });
  assert(r === undefined && fighters.dest === homeB.id && !fighters.chase, `A target in orbit did not turn into a course to that world (${JSON.stringify(r)})`);
  // Cancelling a course ends the chase
  setOrders(g, a, { move: { fleetId: fighters.id, chase: near.id } });
  setOrders(g, a, { move: { fleetId: fighters.id, planetId: null } });
  assert(!fighters.chase && !fighters.aim, 'Cancelling the course does not end the chase');
  console.log('Orders: armed only, enemies only, in sight only; orbit means a course.');
}

// 5) A target that reaches an orbit is followed there; one out of sight is given up
{
  const { g, a, b, homeA } = setup();
  const target = g.galaxy.planets.filter(p => !p.owner).sort((x, y) => dist(x, homeA) - dist(y, homeA))[0];
  const hunter = fleetOf(g, a.id, homeA, ['fighter']);
  const prey = fleetOf(g, b.id, { x: target.x + 10, y: target.y + 10 }, ['scout']);
  prey.dest = target.id;
  b.tech.speed = 9;
  setOrders(g, a, { move: { fleetId: hunter.id, chase: prey.id } });
  resolveTurn(g);
  assert(prey.at === target.id && alive(g, hunter), 'Setup: the scout should reach the orbit first');
  resolveTurn(g);
  assert(hunter.dest === target.id || hunter.at === target.id, 'The hunter did not follow into the orbit');
  assert(!hunter.chase, 'The hunter still chases a fleet in orbit');
  const h = setup();
  const hunter2 = fleetOf(h.g, h.a.id, h.homeA, ['fighter']);
  const ghost = fleetOf(h.g, h.b.id, { x: h.homeA.x + 150, y: h.homeA.y }, ['scout']);
  ghost.dest = h.b.homeworld;
  setOrders(h.g, h.a, { move: { fleetId: hunter2.id, chase: ghost.id } });
  // Out of sight all of a sudden
  ghost.x = h.homeB.x; ghost.y = h.homeB.y;
  const e = resolveTurn(h.g);
  assert(!hunter2.chase && e.some(x => x.key === 'log.chaseLost'), 'A fleet out of sight is still chased');
  console.log('Orbit: followed there; out of sight: given up.');
}

// 6) The AI intercepts what comes for its worlds - the hard one only when clearly stronger
{
  const run = (level, mine, theirs) => {
    const { g, a, b, homeA } = setup({ levelA: level });
    const colony = g.galaxy.planets.filter(p => !p.owner).sort((x, y) => dist(x, homeA) - dist(y, homeA))[0];
    colony.owner = a.id; colony.pop = 3;
    a.tech.speed = 6;
    fleetOf(g, a.id, homeA, Array(mine).fill('fighter'));
    const raid = fleetOf(g, b.id, { x: colony.x + (colony.x - homeA.x) * 0.9 + 60, y: colony.y + (colony.y - homeA.y) * 0.9 + 60 }, Array(theirs).fill('fighter'));
    raid.dest = colony.id;
    runBot(g, a);
    return g.fleets.some(f => f.owner === a.id && f.chase === raid.id);
  };
  assert(run('normal', 6, 3), 'The normal AI does not intercept a weaker raid on its colony');
  assert(run('hard', 8, 3), 'The hard AI does not intercept a much weaker raid on its colony');
  assert(!run('hard', 4, 3), 'The hard AI intercepts without a clear advantage');
  assert(!run('normal', 2, 5), 'The normal AI intercepts a much stronger raid');
  console.log('AI: intercepts raids on its worlds; the hard one only with a clear edge.');
}

if (errors) { console.error(`\n${errors} chase checks failed.`); process.exit(1); }
console.log('\nAll chase checks passed.');
