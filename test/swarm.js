// Swarming out: the colony ships of a fleet in orbit each fly alone to the
// nearest free world they reach - one ship per world, worlds another own
// colony ship already heads for are skipped, and whatever finds no world
// stays behind in orbit.
import { addShip } from '../server/game/fleets.js';
import { createGame, startGame } from '../server/game/game.js';
import { setOrders } from '../server/game/orders.js';
import { addPlayer } from '../server/game/players.js';
import { travelDistance, holeZone } from '../shared/rules.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

const g = createGame('Swarm');
Object.assign(g.settings, { seed: 7, turnTimer: 0, expanding: false, fog: false });
addPlayer(g, { name: 'Me' });
addPlayer(g, { name: 'Other' });
startGame(g);
const [me] = g.players;
const planets = g.galaxy.planets;
const home = planets[me.homeworld];
const zone = holeZone(g.galaxy);
// Everything known and seen: the test is about the choice, not the fog.
for (const p of planets) { me.explored.add(p.id); me.knowledge[p.id] = { turn: g.turn, temp: p.temp, grav: p.grav, owner: p.owner, pop: p.pop }; }

// A fleet of 6 colony ships and a scout at home; the starting fleets go away.
g.fleets = g.fleets.filter(f => f.owner !== me.id);
const fleet = { id: 'fx', owner: me.id, ships: [], at: home.id, x: home.x, y: home.y, z: home.z || 0, dest: null, hole: null, chase: null, aim: null };
g.fleets.push(fleet);
for (let i = 0; i < 6; i++) addShip(g, fleet, 'colony', me.tech);
addShip(g, fleet, 'scout', me.tech);

// One free world is already claimed by another own colony ship.
const free = planets.filter(p => p.owner === null && p.id !== home.id)
  .sort((a, b) => travelDistance(home, a, zone) - travelDistance(home, b, zone));
const claimedId = free[0].id;
const other = { id: 'fy', owner: me.id, ships: [], at: home.id, x: home.x, y: home.y, z: home.z || 0, dest: null, hole: null, chase: null, aim: null };
g.fleets.push(other);
addShip(g, other, 'colony', me.tech);
setOrders(g, me, { move: { fleetId: other.id, planetId: claimedId } });

const r = setOrders(g, me, { swarm: { fleetId: fleet.id } });
const sent = g.fleets.filter(f => f.owner === me.id && f !== other && f.dest != null);
console.log(`swarmed: ${JSON.stringify(r?.swarmed)}; targets ${sent.map(f => f.dest).join(', ')}`);
assert(r?.swarmed, `No result: ${JSON.stringify(r)}`);
assert(sent.every(f => f.ships.length === 1 && f.ships[0].type === 'colony'), 'A swarming fleet is not a single colony ship');
assert(new Set(sent.map(f => f.dest)).size === sent.length, 'Two colony ships head for the same world');
assert(!sent.some(f => f.dest === claimedId), 'A colony ship heads for a world already claimed');
assert(sent.every(f => planets[f.dest].owner === null), 'A colony ship heads for an owned world');
const reachable = free.filter(p => p.id !== claimedId).slice(0, sent.length).map(p => p.id).sort();
assert(sent.length === r.swarmed.sent, 'Count in the result does not match');
// The nearest ones - provided they are in range, which near home they are.
assert(JSON.stringify(sent.map(f => f.dest).sort()) === JSON.stringify(reachable),
  `Not the nearest free worlds: ${sent.map(f => f.dest)} vs ${reachable}`);
assert(fleet.at === home.id && fleet.dest == null && fleet.ships.some(s => s.type === 'scout'),
  'The scout did not stay behind in orbit');
assert(fleet.ships.length === 7 - sent.length, 'Ships went missing');

// Few free worlds: the rest stays behind.
const g2Fleet = { id: 'fz', owner: me.id, ships: [], at: home.id, x: home.x, y: home.y, z: home.z || 0, dest: null, hole: null, chase: null, aim: null };
g.fleets.push(g2Fleet);
for (let i = 0; i < 4; i++) addShip(g, g2Fleet, 'colony', me.tech);
// The first swarm turns back; of its four targets two get taken meanwhile.
const targets = sent.map(f => f.dest);
for (const f of sent) setOrders(g, me, { move: { fleetId: f.id, planetId: null } });
for (const id of targets.slice(2)) { planets[id].owner = g.players[1].id; me.knowledge[id].owner = planets[id].owner; }
const r2 = setOrders(g, me, { swarm: { fleetId: g2Fleet.id } });
console.log(`second swarm: ${JSON.stringify(r2)}`);
assert(r2?.swarmed?.sent === 2 && r2.swarmed.left === 2, `Expected 2 sent, 2 left: ${JSON.stringify(r2)}`);
assert(g2Fleet.at === home.id && g2Fleet.ships.length === 2, 'The leftover colony ships did not stay in orbit');

// Nothing free any more: refused, nothing changes.
const r3 = setOrders(g, me, { swarm: { fleetId: g2Fleet.id } });
assert(r3?.error === 'err.swarmNoTarget', `Expected no target: ${JSON.stringify(r3)}`);
assert(g2Fleet.ships.length === 2, 'A refused swarm changed the fleet');

if (errors) { console.error(`${errors} error(s)`); process.exit(1); }
console.log('All swarm checks passed.');
