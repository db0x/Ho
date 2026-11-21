// Meteors (rules in shared/rules.js, METEOR): chunks of rock full of ore
// that come in from beyond the edge of the map, cross it in a straight line
// and leave again - or fall into the black hole. Always on.
//
// Fair shares: every empire counts the meteors that passed close by its
// worlds. A new one is aimed past a world of the empire with the fewest so
// far, coming in from the nearest edge - so nobody at the rim of the map
// goes without, and nobody in its middle gets them all.
//
// Only transporters can catch one. A fleet with transporters heads for the
// point where it meets the meteor (movement.js plays the turn through in
// small steps, as for intercepting); there it takes all of the ore aboard
// and the meteor is gone. The ore counts as metal only
// once the transporter reaches an own world - shot down on the way, it is
// lost (combat.js).
import { METEOR, SHIP_DEFS, dist, holeZone, blocked, meteorAt, meteorMeet, oreOf, shipStats, supplyDistance } from '../shared/rules.js';
import { makeRng } from './galaxy.js';
import { teamOf } from './game/diplomacy.js';
import { planetById, playerById } from './game/game.js';
import { fogOn, eyesOf, covered } from './game/sensors.js';

/** Sight without fog of war - as far as foreign fleets are seen (intel.js inSight). */
const SIGHT = { world: 300, fleet: 240 };

/** A stream of its own: meteors must not shift the combat rolls. */
function rngOf(game) {
  return game.meteorRng || (game.meteorRng = makeRng(`${game.galaxy.seed}:meteors`));
}

/** The meteors of a game. */
export const meteorsOf = game => game.meteors || (game.meteors = []);

export const meteorById = (game, id) => meteorsOf(game).find(m => m.id === id) || null;

/** The world closest to a point - to name where something is. */
export function nearestWorld(game, point) {
  let best = null, bd = Infinity;
  for (const p of game.galaxy.planets) {
    const d = dist(p, point);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** Does this empire (with its allies) see the meteor? */
export function seesMeteor(game, playerId, m, eyes = null) {
  if (fogOn(game)) return covered(eyes || eyesOf(game, playerId), m);
  const team = teamOf(game, playerId);
  return game.galaxy.planets.some(q => team.includes(q.owner) && dist(q, m) < SIGHT.world)
    || game.fleets.some(g => team.includes(g.owner) && g.ships.length && dist(g, m) < SIGHT.fleet);
}

/** The meteors an empire sees right now - for the AI, by the same rules as the map. */
export function meteorsSeen(game, playerId) {
  const eyes = fogOn(game) ? eyesOf(game, playerId) : null;
  return meteorsOf(game).filter(m => seesMeteor(game, playerId, m, eyes));
}

/** Turns a meteor still flies before it leaves the map or falls into the hole. */
export const turnsLeft = m => Math.max(0, m.life - m.age);

/** The box a meteor leaves through: the map and a margin around it. */
function box(g) {
  const M = METEOR.margin;
  return {
    x0: g.minX - M, x1: g.maxX + M, y0: g.minY - M, y1: g.maxY + M,
    z0: (g.minZ || 0) - M, z1: (g.maxZ || 0) + M
  };
}

/**
 * How long a meteor flies from here: until it leaves the box - or until it
 * reaches the black hole's zone, then it is swallowed there.
 */
function lifeOf(game, m) {
  const b = box(game.galaxy);
  let t = Infinity;
  for (const [p, v, lo, hi] of [[m.x, m.vx, b.x0, b.x1], [m.y, m.vy, b.y0, b.y1], [m.z || 0, m.vz || 0, b.z0, b.z1]]) {
    if (Math.abs(v) < 1e-9) continue;
    t = Math.min(t, ((v > 0 ? hi : lo) - p) / v);
  }
  if (!isFinite(t) || t <= 0) t = 1;
  const zone = holeZone(game.galaxy);
  let hole = false;
  if (zone && blocked(m, meteorAt(m, t), zone)) {
    // In steps along the way: the first moment inside the zone.
    for (let k = 1; k <= Math.ceil(t * 8); k++) {
      if (dist(meteorAt(m, k / 8), zone) < zone.r) { t = k / 8; hole = true; break; }
    }
  }
  return { life: Math.max(1, Math.ceil(t)), hole };
}

/** Ore for a meteor that comes in this turn. */
function oreFor(game, rng) {
  const base = METEOR.metal(game.turn);
  return Math.max(20, Math.round(base * (1 - METEOR.spread + 2 * METEOR.spread * rng())));
}

/**
 * A meteor at this spot, flying in this direction at this speed (ly per
 * turn) with this much ore. Exported for the tests and the dev mode.
 */
export function placeMeteor(game, from, dir, speed, metal) {
  return make(game, rngOf(game), from, dir, speed, metal);
}

function make(game, rng, from, dir, speed, metal) {
  const len = Math.hypot(dir.x, dir.y, dir.z || 0) || 1;
  const m = {
    id: 'k' + (game.nextMeteorId = (game.nextMeteorId || 0) + 1),
    x: from.x, y: from.y, z: from.z || 0,
    vx: dir.x / len * speed, vy: dir.y / len * speed, vz: (dir.z || 0) / len * speed,
    metal, total: metal,
    born: game.turn, age: 0,
    seed: Math.floor(rng() * 1e6)
  };
  Object.assign(m, lifeOf(game, m));
  meteorsOf(game).push(m);
  tallyNear(game, m);
  return m;
}

/** Inhabited worlds of an empire - what a meteor has to pass to count for it. */
const homesOf = (game, p) => game.galaxy.planets.filter(q => q.owner === p.id && q.pop > 0.5);

/** Every empire whose worlds the meteor's course passes close by counts it (p.meteorsNear). */
function tallyNear(game, m) {
  for (const p of game.players) {
    if (!p.alive) continue;
    const homes = homesOf(game, p);
    let near = false;
    for (let k = 0; k <= m.life * 2 && !near; k++) {
      const at = meteorAt(m, k / 2);
      near = homes.some(q => dist(q, at) <= METEOR.near);
    }
    if (near) p.meteorsNear = (p.meteorsNear || 0) + 1;
  }
}

/**
 * Whose turn it is: the empire with the fewest meteors close by so far -
 * among equals chance decides. Null without any empire with a world.
 */
function nextTarget(game, rng) {
  const living = game.players.filter(p => p.alive && homesOf(game, p).length);
  if (!living.length) return null;
  const least = Math.min(...living.map(p => p.meteorsNear || 0));
  const due = living.filter(p => (p.meteorsNear || 0) === least);
  return due[Math.floor(rng() * due.length)];
}

/**
 * A course past one of the target's worlds - a little beside it - in from
 * beyond the edge. Of a few directions the one with the shortest way in
 * wins, more or less: the target should see it first. Not through the
 * black hole before it gets there. Null if nothing fits.
 */
function courseFor(game, rng, target) {
  const homes = homesOf(game, target);
  const world = homes[Math.floor(rng() * homes.length)];
  const b = box(game.galaxy);
  const zone = holeZone(game.galaxy);
  const space = (game.galaxy.maxZ || 0) > (game.galaxy.minZ || 0);
  let best = null;
  for (let i = 0; i < 12; i++) {
    const a = rng() * Math.PI * 2;
    const dz = space ? (rng() - 0.5) * 0.3 : 0;
    const dir = { x: Math.cos(a), y: Math.sin(a), z: dz };
    const off = (METEOR.pass[0] + rng() * (METEOR.pass[1] - METEOR.pass[0])) * (rng() < 0.5 ? -1 : 1);
    const aim = { x: world.x - dir.y * off, y: world.y + dir.x * off, z: world.z || 0 };
    // Back along the course to the edge of the box: that is where it comes in.
    let back = Infinity;
    for (const [p, d, lo, hi] of [[aim.x, dir.x, b.x0, b.x1], [aim.y, dir.y, b.y0, b.y1], [aim.z, dir.z, b.z0, b.z1]]) {
      if (Math.abs(d) < 1e-9) continue;
      back = Math.min(back, (p - (d > 0 ? lo : hi)) / d);
    }
    if (!isFinite(back) || back <= 0) continue;
    const from = { x: aim.x - dir.x * back, y: aim.y - dir.y * back, z: aim.z - dir.z * back };
    if (zone && blocked(from, aim, zone)) continue;
    const score = back * (0.75 + 0.5 * rng());
    if (!best || score < best.score) best = { from, dir, score };
  }
  return best;
}

/**
 * A new meteor: aimed past a world of the empire whose turn it is
 * (nextTarget), in from beyond the nearest edge and out on the far side.
 * Without a course that fits, a random one: in from one side, towards a
 * point somewhere in the middle - a course right into the black hole rarer
 * than chance would make it.
 */
export function spawnMeteor(game) {
  const rng = rngOf(game);
  const target = nextTarget(game, rng);
  const course = target && courseFor(game, rng, target);
  if (course) {
    const speed = METEOR.speed[0] + rng() * (METEOR.speed[1] - METEOR.speed[0]);
    return make(game, rng, course.from, course.dir, speed, oreFor(game, rng));
  }
  return randomMeteor(game, rng);
}

function randomMeteor(game, rng) {
  const g = game.galaxy;
  const b = box(g);
  const zone = holeZone(g);
  const depth = (g.maxZ || 0) - (g.minZ || 0);
  const zAt = (k) => depth > 0 ? Math.round((g.minZ || 0) + depth * (0.5 + (rng() - 0.5) * k)) : 0;
  let from = null, to = null;
  for (let i = 0; i < 8; i++) {
    const side = Math.floor(rng() * 4), u = rng();
    from = side === 0 ? { x: b.x0, y: b.y0 + u * (b.y1 - b.y0) }
      : side === 1 ? { x: b.x1, y: b.y0 + u * (b.y1 - b.y0) }
      : side === 2 ? { x: b.x0 + u * (b.x1 - b.x0), y: b.y0 }
      : { x: b.x0 + u * (b.x1 - b.x0), y: b.y1 };
    from.z = zAt(0.8);
    to = { x: g.minX + (0.2 + 0.6 * rng()) * (g.maxX - g.minX),
      y: g.minY + (0.2 + 0.6 * rng()) * (g.maxY - g.minY), z: zAt(0.5) };
    if (!zone || !blocked(from, to, zone) || rng() < 0.3) break;
  }
  const speed = METEOR.speed[0] + rng() * (METEOR.speed[1] - METEOR.speed[0]);
  return make(game, rng, from, { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, speed, oreFor(game, rng));
}

/**
 * Once per turn, after movement and the catches: every meteor flies on.
 * Those whose time is up leave the map - or fall into the black hole, in
 * front of everyone who sees it. From METEOR.firstTurn on, a new one may
 * come in.
 */
export function meteorTurn(game, entries) {
  const keep = [];
  for (const m of meteorsOf(game)) {
    if (m.metal <= 0) { forget(game, m); continue; }
    const next = meteorAt(m, 1);
    m.x = next.x; m.y = next.y; m.z = next.z;
    m.age++;
    if (m.age < m.life) { keep.push(m); continue; }
    if (m.hole) {
      const eyes = game.players.filter(p => p.alive && p.seenMeteors?.has(m.id) && seesMeteor(game, p.id, m)).map(p => p.id);
      const bh = game.galaxy.blackHole;
      if (eyes.length) entries.push({ type: 'meteor', playerIds: eyes, planetId: null,
        key: 'log.meteorSwallowed', params: { hole: bh?.name ?? '?', metal: Math.round(m.metal) } });
    }
    forget(game, m);
  }
  game.meteors = keep;
  if (game.turn < METEOR.firstTurn) return;
  const n = game.players.filter(p => p.alive).length;
  if (keep.length >= METEOR.max(n)) return;
  if (rngOf(game)() < METEOR.chance(n)) spawnMeteor(game);
}

/** A meteor gone: nobody needs to remember having seen it. */
function forget(game, m) {
  for (const p of game.players) p.seenMeteors?.delete(m.id);
}

/**
 * Could this empire catch the meteor at all - does its course pass within
 * reach of a transporter, measured from the empire's supply bases (its own
 * and its allies' inhabited worlds), before it leaves the map?
 */
export function meteorInReach(game, player, m) {
  const team = teamOf(game, player.id);
  const bases = game.galaxy.planets.filter(q => team.includes(q.owner) && q.pop > 0.5);
  if (!bases.length) return false;
  const range = shipStats('transport', player.tech).range;
  const zone = holeZone(game.galaxy);
  const last = Math.min(METEOR.horizon, turnsLeft(m));
  for (let k = 0; k <= last * 2; k++) {
    if (supplyDistance(bases, meteorAt(m, k / 2), zone) <= range) return true;
  }
  return false;
}

/**
 * After visibility: meteors that come into sight for the first time are
 * reported - how much ore they carry and where they pass. One within reach
 * is marked so: the crew announces it over the radio (radio/chatter.js).
 */
export function spotMeteors(game, entries) {
  for (const p of game.players) {
    if (!p.alive) continue;
    const seen = p.seenMeteors || (p.seenMeteors = new Set());
    const eyes = fogOn(game) ? eyesOf(game, p.id) : null;
    for (const m of meteorsOf(game)) {
      if (seen.has(m.id) || !seesMeteor(game, p.id, m, eyes)) continue;
      seen.add(m.id);
      const near = nearestWorld(game, m);
      entries?.push({ type: 'meteor', playerIds: [p.id], private: p.id, planetId: near?.id ?? null,
        key: 'log.meteorSpotted', params: { near: near?.name ?? '?', metal: Math.round(m.metal) },
        ...(meteorInReach(game, p, m) ? { reach: true, meteor: m.id } : {}) });
    }
  }
}

/**
 * The point where a fleet meets the meteor soonest - looked for along the
 * meteor's straight course, as long as it is still on the map. Null if the
 * fleet cannot get there in time.
 */
export function meteorIntercept(game, fleet, m, speed, zone = holeZone(game.galaxy)) {
  const from = fleet.at != null ? planetById(game, fleet.at) : fleet;
  return meteorMeet(from, speed, { ...m, left: turnsLeft(m) }, zone)?.at || null;
}

/**
 * The catches of a turn, earliest first: the first fleet that came close
 * enough takes the whole meteor - its ore spread over the transporters, so
 * that one shot down does not lose everything - and the meteor is gone.
 * The catch order is done then; the fleet stays where it met the meteor.
 * Whoever comes after it goes away with nothing.
 * @param {{fleet: object, meteor: object, t: number}[]} catches
 */
export function resolveCatches(game, catches, entries) {
  catches.sort((a, b) => a.t - b.t);
  for (const { fleet, meteor: m } of catches) {
    const owner = playerById(game, fleet.owner);
    const near = nearestWorld(game, fleet);
    fleet.catch = null; fleet.aim = null;
    if (!owner) continue;
    const at = near?.id ?? null;
    if (!(m.metal > 0)) {
      entries.push({ type: 'meteor', playerIds: [owner.id], private: owner.id, planetId: at,
        key: 'log.meteorGone', params: { near: near?.name ?? '?' } });
      continue;
    }
    const holds = fleet.ships.filter(s => SHIP_DEFS[s.type]?.hold);
    if (!holds.length) continue;
    const got = Math.round(m.metal);
    holds.forEach((s, i) => {
      s.ore = (s.ore || 0) + Math.floor(got / holds.length) + (i < got % holds.length ? 1 : 0);
    });
    m.metal = 0;
    entries.push({ type: 'meteor', playerIds: [owner.id], private: owner.id, planetId: at,
      key: 'log.meteorCaught', params: { near: near?.name ?? '?', metal: got } });
  }
}

/**
 * In the orbit of an own world the transporters unload: the ore counts as
 * metal from now on. After the battles and landings - a world lost in this
 * turn takes nothing.
 */
export function unloadOre(game, entries) {
  for (const f of game.fleets) {
    if (f.at == null || !f.ships.length) continue;
    const planet = planetById(game, f.at);
    if (planet.owner !== f.owner) continue;
    const ore = oreOf(f.ships).ore;
    if (ore <= 0) continue;
    for (const s of f.ships) if (s.ore) s.ore = 0;
    const p = playerById(game, f.owner);
    if (!p) continue;
    p.metal += ore;
    if (p.ledger) p.ledger.ore = (p.ledger.ore || 0) + ore;
    entries.push({ type: 'meteor', playerIds: [p.id], private: p.id, planetId: planet.id,
      key: 'log.oreDelivered', params: { planet: planet.name, metal: ore } });
  }
}

/**
 * What an empire sees of the meteors: where, whither and how fast, how much
 * ore is left and how long it still flies. Without a player (spectators)
 * all of them.
 */
export function meteorView(game, player, eyes = null) {
  const r1 = v => Math.round(v * 10) / 10;
  return meteorsOf(game)
    .filter(m => m.metal > 0 && (!player || seesMeteor(game, player.id, m, eyes)))
    .map(m => ({
      id: m.id, x: Math.round(m.x), y: Math.round(m.y), z: Math.round(m.z || 0),
      vx: r1(m.vx), vy: r1(m.vy), vz: r1(m.vz || 0),
      metal: Math.round(m.metal), total: m.total, left: turnsLeft(m), seed: m.seed
    }));
}

/**
 * Dev mode: a meteor that passes close by the selected world (otherwise the
 * homeworld) in three turns - from wherever that puts its start.
 * @returns {boolean} whether one came
 */
export function devMeteor(game, player, planetId) {
  let planet = planetId != null ? planetById(game, planetId) : null;
  if (!planet && player) planet = planetById(game, player.homeworld);
  if (!planet) planet = game.galaxy.planets[0];
  if (!planet) return false;
  const rng = rngOf(game);
  const a = rng() * Math.PI * 2;
  const dir = { x: Math.cos(a), y: Math.sin(a), z: 0 };
  const speed = (METEOR.speed[0] + METEOR.speed[1]) / 2;
  const off = 60;                    // passes beside the world, not through it
  const from = {
    x: planet.x - dir.x * speed * 3 - dir.y * off,
    y: planet.y - dir.y * speed * 3 + dir.x * off,
    z: planet.z || 0
  };
  const m = make(game, rng, from, dir, speed, oreFor(game, rng));
  spotMeteors(game, null);
  return !!m;
}
