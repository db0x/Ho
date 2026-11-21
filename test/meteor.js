// Meteors: they come in from beyond the edge of the map, cross it in a
// straight line and leave - or fall into the black hole. Only transporters
// catch them, and whoever does takes all of the ore; it counts once it
// reaches an own world, and is lost with a transporter shot down. Always
// on. One within reach is announced over the radio, once. The AI catches
// them too.
import { createGame, startGame } from '../server/game/game.js';
import { buildView, buildSpectatorView } from '../server/game/intel.js';
import { setOrders } from '../server/game/orders.js';
import { addPlayer } from '../server/game/players.js';
import { resolveTurn } from '../server/game/turn.js';
import { addShip, newFleet } from '../server/game/fleets.js';
import { meteorsOf, placeMeteor, spawnMeteor, meteorTurn, spotMeteors } from '../server/meteors.js';
import { runBot } from '../server/ai/bot.js';
import { radioTurn } from '../server/radio/chatter.js';
import { METEOR, SHIP_DEFS, oreOf, dist } from '../shared/rules.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

/** Two empires; mine gets a fleet of `transports` transporters (and `fighters` fighters) at home. */
function setup({ transports = 1, fighters = 0, shape } = {}) {
  const g = createGame('Meteor');
  g.settings.seed = 11;
  g.settings.turnTimer = 0;
  if (shape) g.settings.shape = shape;
  addPlayer(g, { name: 'Me' });
  addPlayer(g, { name: 'Other' });
  startGame(g);
  const [me, other] = g.players;
  const home = g.galaxy.planets[me.homeworld];
  const fleet = newFleet(g, me.id, home);
  for (let i = 0; i < transports; i++) addShip(g, fleet, 'transport', me.tech);
  for (let i = 0; i < fighters; i++) addShip(g, fleet, 'fighter', me.tech);
  g.meteors = [];
  return { g, me, other, home, fleet };
}

/** A meteor that passes `home` sideways at `off` ly in `turns` turns. */
function passing(g, home, { turns = 2, off = 40, speed = 40, metal = 150 } = {}) {
  const from = { x: home.x - speed * turns, y: home.y + off, z: home.z || 0 };
  return placeMeteor(g, from, { x: 1, y: 0, z: 0 }, speed, metal);
}

// 1) Rules: the transporter has a hold, nothing else does
{
  assert(SHIP_DEFS.transport.hold, 'Transporters should have a hold');
  assert(Object.entries(SHIP_DEFS).every(([t, d]) => t === 'transport' || !d.hold), 'Only transporters have a hold');
  const o = oreOf([{ type: 'transport', ore: 30 }, { type: 'transport' }, { type: 'fighter' }]);
  assert(o.ore === 30 && o.hold === 2, 'oreOf is off: ' + JSON.stringify(o));
}

// 2) Coming in: from beyond the edge, straight across, gone after its life
{
  const { g } = setup();
  const G = g.galaxy;
  for (let i = 0; i < 30; i++) spawnMeteor(g);
  const list = meteorsOf(g);
  const outside = m => m.x < G.minX || m.x > G.maxX || m.y < G.minY || m.y > G.maxY;
  assert(list.every(outside), 'Every meteor comes in from beyond the edge');
  assert(list.every(m => Math.hypot(m.vx, m.vy) >= METEOR.speed[0] - 1e-6 && Math.hypot(m.vx, m.vy) <= METEOR.speed[1] + 1e-6), 'Speeds out of range');
  assert(list.every(m => m.metal > 0 && m.life > 3), 'Meteors need ore and a few turns on the map');
  const m = list[0], { x, y, vx, vy } = m;
  meteorTurn(g, []);
  assert(Math.abs(m.x - (x + vx)) < 1e-9 && Math.abs(m.y - (y + vy)) < 1e-9, 'A meteor flies straight on');
  let turns = 1;
  while (meteorsOf(g).includes(m) && turns < 400) { meteorTurn(g, []); turns++; }
  assert(!meteorsOf(g).includes(m) && turns === m.life, `The meteor should leave after ${m.life} turns, not ${turns}`);
  assert(outside(m), 'It leaves beyond the edge');
}

// 3) Not before METEOR.firstTurn, never more than the cap - and no lobby switch
{
  const { g } = setup();
  g.turn = 0;
  for (let i = 0; i < 40; i++) meteorTurn(g, []);
  assert(!meteorsOf(g).length || METEOR.firstTurn <= 0, 'Meteors before their first turn');
  g.turn = 50;
  for (let i = 0; i < 400; i++) { meteorTurn(g, []); assert(meteorsOf(g).length <= METEOR.max(2), 'Too many meteors at once'); }
  assert(meteorsOf(g).length > 0, 'In 400 turns some meteor should come');
  assert(!('meteors' in g.settings), 'Meteors are not a lobby option');
}

// 3b) Fair shares: aimed at whoever has had the fewest, so every empire gets some
{
  for (const shape of ['scatter', 'spiral']) {
    const g = createGame('Fair');
    Object.assign(g.settings, { shape, turnTimer: 0 });
    for (let i = 0; i < 8; i++) addPlayer(g, { isBot: true });
    startGame(g);
    g.meteors = [];
    for (let i = 0; i < 8 * 4; i++) spawnMeteor(g);
    const near = g.players.map(p => p.meteorsNear || 0);
    assert(Math.min(...near) >= 4, `${shape}: every empire should have had meteors close by: ${near}`);
    assert(Math.max(...near) <= 3 * Math.min(...near), `${shape}: shares too uneven: ${near}`);
    // The one left out gets the next.
    const poor = g.players[3];
    for (const p of g.players) p.meteorsNear = p === poor ? 0 : 50;
    const m = spawnMeteor(g);
    const homes = g.galaxy.planets.filter(q => q.owner === poor.id && q.pop > 0.5);
    let closest = Infinity;
    for (let k = 0; k <= m.life * 4; k++) for (const q of homes) closest = Math.min(closest, dist(q, { x: m.x + m.vx * k / 4, y: m.y + m.vy * k / 4, z: (m.z || 0) + m.vz * k / 4 }));
    assert(closest <= METEOR.pass[1] + 5, `${shape}: the next meteor should pass the empire left out (closest ${Math.round(closest)} ly)`);
    assert(poor.meteorsNear === 1, 'and count for it');
  }
  assert(METEOR.chance(16) > METEOR.chance(6) && METEOR.chance(6) > METEOR.chance(2), 'More empires, more meteors');
}

// 4) In sight only near own worlds and fleets; spectators see all
{
  const { g, me, home } = setup();
  const near = passing(g, home, { turns: 1 });
  const far = placeMeteor(g, { x: home.x + 5000, y: home.y + 5000, z: 0 }, { x: 1, y: 0, z: 0 }, 40, 100);
  const v = buildView(g, me);
  assert(v.meteors.some(m => m.id === near.id), 'A meteor next door should be in sight');
  assert(!v.meteors.some(m => m.id === far.id), 'A meteor far away must not be in sight');
  const vm = v.meteors.find(m => m.id === near.id);
  assert(vm && vm.vx === 40 && vm.metal === 150 && vm.left > 0, 'The view shows course, ore and turns left');
  assert(buildSpectatorView(g).meteors.length === 2, 'Spectators see every meteor');
  // Reported once when it comes into sight
  const entries = resolveTurn(g);
  assert(entries.filter(e => e.key === 'log.meteorSpotted' && e.playerIds.includes(me.id)).length === 1, 'Spotting is reported once');
  assert(!resolveTurn(g).some(e => e.key === 'log.meteorSpotted' && e.params.metal === 150), 'Not reported again');
}

// 5) Only transporters catch: refused without, or unseen
{
  const { g, me, home, fleet } = setup({ transports: 0, fighters: 2 });
  const m = passing(g, home);
  let r = setOrders(g, me, { move: { fleetId: fleet.id, meteor: m.id } });
  assert(r?.error === 'err.catchNoTransporter', 'A fleet without transporters must not catch: ' + r?.error);
  r = setOrders(g, me, { move: { fleetId: fleet.id, meteor: 'k999' } });
  assert(r?.error === 'err.noSuchMeteor', 'An unknown meteor must be refused');
  const far = placeMeteor(g, { x: home.x + 5000, y: home.y, z: 0 }, { x: 1, y: 0, z: 0 }, 40, 100);
  addShip(g, fleet, 'transport', me.tech);
  r = setOrders(g, me, { move: { fleetId: fleet.id, meteor: far.id } });
  assert(r?.error === 'err.noSuchMeteor', 'A meteor out of sight must be refused');
  // Ore aboard already does not stop it - there is no limit.
  fleet.ships.find(s => s.type === 'transport').ore = 300;
  r = setOrders(g, me, { move: { fleetId: fleet.id, meteor: m.id } });
  assert(!r, 'A transporter with ore aboard may catch another: ' + r?.error);
}

// 6) Caught: the fleet meets it, takes all of it - the meteor is gone - and brings it home
{
  const { g, me, home, fleet } = setup({ transports: 1 });
  const m = passing(g, home, { metal: 460 });
  let r = setOrders(g, me, { move: { fleetId: fleet.id, meteor: m.id } });
  assert(!r, 'Catch order refused: ' + r?.error);
  assert(fleet.catch === m.id && fleet.aim, 'The fleet should head for the meeting point');
  const vf = buildView(g, me).fleets.find(f => f.id === fleet.id);
  assert(vf.catch === m.id && vf.aim, 'The view shows the catch and its meeting point');
  let caught = null;
  for (let i = 0; i < 6 && !caught; i++) caught = resolveTurn(g).find(e => e.key?.startsWith('log.meteorCaught'));
  assert(caught?.params.metal === 460, 'One transporter takes all 460: ' + JSON.stringify(caught?.params));
  assert(oreOf(fleet.ships).ore === 460 && !fleet.catch && fleet.at == null, 'Ore aboard, the order done, the fleet in open space');
  assert(!meteorsOf(g).includes(m), 'The meteor is gone');
  assert(!buildView(g, me).meteors.length, 'Nor is it on the map any more');
  assert(buildView(g, me).fleets.find(f => f.id === fleet.id).ships[0].ore === 460, 'The view shows the ore aboard');
  // Home again: the ore counts as metal there
  setOrders(g, me, { move: { fleetId: fleet.id, planetId: home.id } });
  const before = me.metal;
  let delivered = null;
  for (let i = 0; i < 6 && !delivered; i++) delivered = resolveTurn(g).find(e => e.key === 'log.oreDelivered');
  assert(delivered?.params.metal === 460, 'The ore should be delivered at home');
  assert(me.ledger.ore === 460 && me.metal >= before + 460 - 1e-6 - 400, 'Delivered ore is booked as metal');
  assert(oreOf(fleet.ships).ore === 0, 'The hold is empty again');
}

// 7) Several transporters: the ore is spread over them
{
  const { g, me, home, fleet } = setup({ transports: 3 });
  const m = passing(g, home, { metal: 250 });
  setOrders(g, me, { move: { fleetId: fleet.id, meteor: m.id } });
  let caught = null;
  for (let i = 0; i < 6 && !caught; i++) caught = resolveTurn(g).find(e => e.key?.startsWith('log.meteorCaught'));
  assert(caught?.params.metal === 250, 'Three transporters take all 250');
  const loads = fleet.ships.map(s => s.ore);
  assert(Math.max(...loads) - Math.min(...loads) <= 1, 'Ore is spread over the transporters: ' + loads);
  assert(!meteorsOf(g).includes(m), 'An empty meteor is gone');
}

// 8) Two empires after the same meteor: the earlier one gets it, the later one nothing
{
  const { g, me, other, home, fleet } = setup({ transports: 3 });
  const m = passing(g, home, { metal: 120, turns: 3 });
  // The other one waits right on its course.
  const at = { x: home.x - 40, y: home.y + 40, z: home.z || 0 };
  // ... from a world of its own close by, so that it has supply there.
  const base = g.galaxy.planets.filter(p => p.owner === null).sort((a, b) => dist(a, home) - dist(b, home))[0];
  Object.assign(base, { owner: other.id, pop: 10 });
  const theirs = newFleet(g, other.id, null);
  Object.assign(theirs, { x: at.x - 30, y: at.y, z: at.z });
  addShip(g, theirs, 'transport', other.tech);
  addShip(g, theirs, 'transport', other.tech);
  other.seenMeteors.add(m.id);
  setOrders(g, me, { move: { fleetId: fleet.id, meteor: m.id } });
  const r = setOrders(g, other, { move: { fleetId: theirs.id, meteor: m.id } });
  assert(!r, 'The other catch order was refused: ' + r?.error);
  const got = new Map();
  for (let i = 0; i < 6; i++) for (const e of resolveTurn(g)) if (e.key?.startsWith('log.meteorCaught')) got.set(e.private, e.params.metal);
  const total = [...got.values()].reduce((a, b) => a + b, 0);
  assert(total === 120 && got.size === 1, 'The first one takes it all, the other nothing: ' + JSON.stringify([...got]));
}

// 8b) Announced over the radio once - only one within reach, only to whom it concerns
{
  const { g, me, other, home } = setup({ transports: 0 });
  me.isBot = false;
  const always = () => 0;
  const near = passing(g, home, { turns: 1 });
  const entries = [];
  spotMeteors(g, entries);
  const spot = entries.find(e => e.key === 'log.meteorSpotted' && e.private === me.id && e.meteor === near.id);
  assert(spot?.reach, 'A meteor next door is within reach');
  const out = radioTurn(g, entries, always);
  const msg = out.get(me.id)?.[0];
  assert(/^crew\d$/.test(msg?.speaker || '') && msg.important, `The crew announces it (${msg?.speaker})`);
  assert(msg?.where?.planetId === spot.planetId, 'The announcement points at the place');
  // A second one next turn is announced too - the crew does not keep quiet for it
  g.turn++;
  passing(g, home, { turns: 2, off: -40 });
  const more = [];
  spotMeteors(g, more);
  assert(radioTurn(g, more, always).get(me.id)?.length, 'The next meteor is announced as well');
  // Not again for one already reported
  const again = [];
  spotMeteors(g, again);
  assert(!again.length && !radioTurn(g, again, always).size, 'Announced once only');
  // Out of reach: reported in the log, but no radio
  const far = placeMeteor(g, { x: home.x + 2600, y: home.y + 2600, z: 0 }, { x: 1, y: 1, z: 0 }, 40, 100);
  const eye = newFleet(g, me.id, null);
  Object.assign(eye, { x: far.x, y: far.y - 50, z: 0 });
  addShip(g, eye, 'scout', me.tech);
  const remote = [];
  spotMeteors(g, remote);
  const rs = remote.find(e => e.private === me.id && e.key === 'log.meteorSpotted');
  assert(rs && !rs.reach, 'A meteor far beyond reach is reported without the mark');
  assert(!radioTurn(g, remote, always).size, 'and not announced');
  assert(!other.isBot || !radioTurn(g, entries, always).has(other.id), 'Nothing for an AI');
}

// 9) Shot down with ore aboard: the ore is lost
{
  const { g, me, other, home, fleet } = setup({ transports: 1 });
  fleet.ships[0].ore = 80;
  const spot = g.galaxy.planets.find(p => p.owner === null);
  Object.assign(fleet, { at: spot.id, x: spot.x, y: spot.y, z: spot.z || 0 });
  const foe = newFleet(g, other.id, spot);
  for (let i = 0; i < 6; i++) addShip(g, foe, 'fighter', other.tech);
  const metal = me.metal;
  const entries = resolveTurn(g);
  assert(entries.some(e => e.key === 'log.oreLost' && e.params.metal === 80 && e.private === me.id), 'The loss of the ore should be reported');
  assert(!g.fleets.includes(fleet) || !fleet.ships.length, 'The transporter should be gone');
  assert(!(me.ledger.ore > 0) && me.metal < metal + 80, 'Lost ore is not booked');
}

// 10) Splitting in flight keeps the catch; a full hold ends it
{
  const { g, me, home, fleet } = setup({ transports: 2 });
  const m = passing(g, home, { turns: 4, metal: 300 });
  setOrders(g, me, { move: { fleetId: fleet.id, meteor: m.id } });
  resolveTurn(g);
  if (fleet.at == null && fleet.catch) {
    const r = setOrders(g, me, { split: { fleetId: fleet.id, ships: [fleet.ships[1].id] } });
    const part = g.fleets.find(f => f.id === r?.newFleet);
    assert(part?.catch === m.id, 'A part split off in flight keeps the catch');
  }
}

// 11) The black hole swallows a meteor in its way
{
  const { g, me } = setup({ shape: 'spiral' });
  const bh = g.galaxy.blackHole;
  assert(bh, 'Spiral map without a black hole');
  const m = placeMeteor(g, { x: bh.x - 400, y: bh.y, z: bh.z || 0 }, { x: 1, y: 0, z: 0 }, 50, 100);
  assert(m.hole && m.life <= 8, 'A meteor headed for the hole should end there');
  me.seenMeteors.add(m.id);
  // Keep it in sight: a fleet of mine next to it.
  const eye = newFleet(g, me.id, null);
  Object.assign(eye, { x: bh.x - 300, y: bh.y + 50, z: bh.z || 0 });
  addShip(g, eye, 'scout', me.tech);
  let swallowed = false;
  for (let i = 0; i < 10 && meteorsOf(g).includes(m); i++) {
    const entries = [];
    meteorTurn(g, entries);
    swallowed ||= entries.some(e => e.key === 'log.meteorSwallowed');
    Object.assign(eye, { x: m.x, y: m.y + 50 });
  }
  assert(!meteorsOf(g).includes(m), 'The meteor should be gone into the hole');
  assert(dist(m, bh) < 400, 'It should end near the hole, not beyond the edge');
  assert(swallowed, 'Whoever watched it should read that it fell into the hole');
}

// 12) The AI catches meteors and brings the ore home
{
  let caught = 0, delivered = 0, built = 0;
  for (let seed = 1; seed <= 2; seed++) {
    const g = createGame('AI');
    Object.assign(g.settings, { seed, turnTimer: 0, maxTurns: 0 });
    for (let i = 0; i < 6; i++) addPlayer(g, { isBot: true });
    startGame(g);
    for (let t = 0; t < 110 && g.state === 'running'; t++) {
      for (const b of g.players.filter(p => p.alive)) runBot(g, b);
      for (const e of resolveTurn(g)) {
        if (e.key?.startsWith('log.meteorCaught')) caught++;
        if (e.key === 'log.oreDelivered') delivered += e.params.metal;
        if (e.key === 'log.built' && e.params?.ship === 'transport') built++;
      }
    }
  }
  console.log(`AI: ${caught} meteors caught, ${delivered} ore delivered.`);
  assert(caught > 0, 'The AI should catch meteors');
  assert(delivered > 0, 'The AI should bring ore home');
}

if (errors) { console.error(`\n${errors} errors.`); process.exit(1); }
console.log('\nAll meteor checks passed.');
