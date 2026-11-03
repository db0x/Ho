// Movement through space: how far a fleet may go (range is measured from
// the own inhabited worlds - supply), setting courses, and the fleets moving
// at the end of the turn, around the black hole and into wormholes.
//
// Intercepting: an armed fleet can chase a foreign fleet in flight. Every
// turn it heads for the point where it meets the target on its course; all
// fleets move at the same time, so the turn is played through in small
// steps - where a chaser comes close enough to its target, both stop and
// fight there in open space (combat.js).
import { supplyNeed, holeZone, advance, route, dist, isAlien, travelDistance, routeLength } from '../../shared/rules.js';
import { portalsFor, findMouth, transit } from '../wormholes.js';
import { teamOf, hostile } from './diplomacy.js';
import { fleetStats } from './fleets.js';
import { planetById, playerById } from './game.js';
import { seesFleet } from './intel.js';

/** Steps a turn is played through when looking for encounters. */
const STEPS = 24;
/** How close a chaser has to come - at least, more if both are fast. */
const CATCH = 12;
/** How many turns ahead the meeting point is looked for. */
const HORIZON = 40;

/** Own inhabited worlds and those of allies - supply reaches out from there. */
export function supplyBases(game, owner) {
  const team = teamOf(game, owner);
  return game.galaxy.planets.filter(p => team.includes(p.owner) && p.pop > 0.5);
}

/**
 * Range a fleet needs for this target: the distance from the nearest own
 * supply base (inhabited own planet), measured along the path that can
 * actually be flown - supply can pass through the black hole as little as
 * the fleet itself. Known wormholes carry it to their far side. Computed in
 * shared/rules.js so the UI arrives at the same result.
 */
function supplyNeedFor(game, fleet, target) {
  return supplyNeed(supplyBases(game, fleet.owner), fleet, target, holeZone(game.galaxy),
    portalsFor(game, fleet.owner));
}

/** May this fleet head for this target (a world or a wormhole mouth)? */
export function canReach(game, fleet, target) {
  const st = fleetStats(fleet);
  if (st.speed <= 0) return { ok: false, key: 'err.fleetImmobile', params: {} };
  // Range is rounded in fleetStats, so compare against the rounded distance
  // as well - otherwise 170.3 > 170 rejects a target shown as "170 < 170".
  const need = Math.round(supplyNeedFor(game, fleet, target));
  if (need > st.range) {
    return { ok: false, key: 'err.outOfRange', params: { need, range: st.range } };
  }
  return { ok: true };
}

/** A course to a world, to a wormhole mouth, or none (planetId null). */
export function orderMove(game, player, o) {
  const fleet = game.fleets.find(f => f.id === o.fleetId);
  // Do not swallow it silently: whoever orders a course should learn why
  // nothing happens - otherwise you click a button and simply nothing
  // happens (e.g. when the fleet has been merged in the meantime).
  if (!fleet || fleet.owner !== player.id) return { error: 'err.noSuchFleet' };
  if (o.chase != null) return orderChase(game, player, fleet, o.chase);
  if (o.hole != null) {
    // Only a mouth this empire has seen - the id of an unseen one gives nothing away.
    const found = player.seenMouths.has(o.hole) ? findMouth(game, o.hole) : null;
    if (!found) return { error: 'err.noSuchHole' };
    const reach = canReach(game, fleet, found.mouth);
    if (!reach.ok) return { error: reach.key, params: reach.params };
    fleet.hole = found.mouth.id;
    fleet.dest = null;
    endChase(fleet);
    delete player.orders.moves[fleet.id];
    return;
  }
  if (o.planetId === null) { delete player.orders.moves[fleet.id]; fleet.dest = null; fleet.hole = null; endChase(fleet); return; }
  const target = planetById(game, o.planetId);
  if (!target) return { error: 'err.noSuchPlanet' };
  const reach = canReach(game, fleet, target);
  if (!reach.ok) return { error: reach.key, params: reach.params };
  fleet.dest = target.id;
  fleet.hole = null;
  endChase(fleet);
  player.orders.moves[fleet.id] = target.id;
}

export function endChase(fleet) {
  fleet.chase = null;
  fleet.aim = null;
}

/**
 * Intercept a foreign fleet: only with weapons, only a fleet in sight and
 * at war with us. One that already sits in an orbit is simply flown to -
 * the battle is at that world then.
 */
function orderChase(game, player, fleet, targetId) {
  if (game.settings.interception === false) return { error: 'err.chaseOff' };
  const target = game.fleets.find(f => f.id === targetId && f.ships.length);
  if (!target || target.owner === player.id || !seesFleet(game, player.id, target)) return { error: 'err.noSuchTarget' };
  if (!hostile(game, player.id, target.owner)) return { error: 'err.chaseFriend' };
  if (!fleet.ships.some(s => s.attack > 0)) return { error: 'err.chaseUnarmed' };
  if (target.at != null) return orderMove(game, player, { fleetId: fleet.id, planetId: target.at });
  if (fleetStats(fleet).speed <= 0) return { error: 'err.fleetImmobile' };
  const aim = interceptPoint(game, fleet, target);
  const reach = canReach(game, fleet, aim);
  if (!reach.ok) return { error: reach.key, params: reach.params };
  fleet.chase = target.id;
  fleet.aim = aim;
  fleet.dest = null;
  fleet.hole = null;
  delete player.orders.moves[fleet.id];
}

/** Where a fleet is heading this turn: a mouth, a world - or nothing. */
function goalOf(game, f) {
  if (f.hole) return findMouth(game, f.hole)?.mouth || null;
  if (f.dest != null) return planetById(game, f.dest);
  if (f.aim) return f.aim;
  return null;
}

/**
 * Where a fleet will be in `turns` turns if it keeps its course: along its
 * path, standing still once it has arrived.
 */
export function futurePosition(game, f, turns, zone = holeZone(game.galaxy)) {
  const goal = goalOf(game, f);
  const speed = fleetStats(f).speed;
  if (!goal || speed <= 0) return { x: f.x, y: f.y, z: f.z || 0 };
  const p = advance(f, route(f, goal, zone), speed * turns);
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * The point where the chaser meets the target soonest - looked for along
 * the target's course. Without a solution (the target is faster and runs
 * away), the point where the target will be in the end.
 */
export function interceptPoint(game, chaser, target, zone = holeZone(game.galaxy)) {
  const speed = fleetStats(chaser).speed;
  const goal = goalOf(game, target);
  const tspeed = fleetStats(target).speed;
  const path = goal && tspeed > 0 ? route(target, goal, zone) : null;
  const at = (turns) => path ? advance(target, path, tspeed * turns) : { x: target.x, y: target.y, z: target.z || 0 };
  const total = path ? routeLength(target, path) / tspeed : 0;
  const last = Math.min(HORIZON, Math.max(1, Math.ceil(total) + 1));
  for (let k = 1; k <= last * 8; k++) {
    const turns = k / 8;
    const p = at(turns);
    if (travelDistance(chaser, p, zone) <= speed * turns) return { x: p.x, y: p.y, z: p.z || 0 };
  }
  const p = at(last);
  return { x: p.x, y: p.y, z: p.z || 0 };
}

/**
 * Before the fleets move: every chaser checks its target - still there,
 * still in sight, still at war - and aims anew. A target that went into
 * orbit is followed there.
 */
function steerChase(game, fleet, entries, zone) {
  const target = game.fleets.find(f => f.id === fleet.chase && f.ships.length);
  const owner = playerById(game, fleet.owner);
  const lost = (key) => {
    endChase(fleet);
    if (owner && key) entries.push({ type: 'warn', playerIds: [owner.id], private: owner.id,
      key, params: { near: nearestName(game, fleet) } });
  };
  // Destroyed or gone through a rift: the battle report already told.
  if (!target) return lost(null);
  if (!hostile(game, fleet.owner, target.owner)) return lost('log.chasePeace');
  if (owner && !seesFleet(game, owner.id, target)) return lost('log.chaseLost');
  if (target.at != null) {
    fleet.dest = target.at;
    endChase(fleet);
    return;
  }
  fleet.aim = interceptPoint(game, fleet, target, zone);
}

/**
 * Every fleet with a course moves on. First every fleet plans its way for
 * the turn, then chasers that meet their target stop with it, then the
 * moves are made. Returns the departures - fleets that left a world this
 * turn and can still be intercepted there - and the encounters in open
 * space, each a group of fleets that fight there.
 */
export function moveFleets(game, entries) {
  const zone = holeZone(game.galaxy);
  for (const fleet of game.fleets) if (fleet.chase) steerChase(game, fleet, entries, zone);
  const plans = [];
  for (const fleet of game.fleets) {
    if (fleet.dest == null && !fleet.hole && !fleet.aim) continue;
    const mouth = fleet.hole ? findMouth(game, fleet.hole)?.mouth : null;
    if (fleet.hole && !mouth) { fleet.hole = null; continue; }
    const target = mouth || (fleet.dest != null ? planetById(game, fleet.dest) : fleet.aim);
    const st = fleetStats(fleet);
    const owner = playerById(game, fleet.owner);
    if (st.speed <= 0) { fleet.dest = null; fleet.hole = null; endChase(fleet); continue; }
    // The aliens bring their own supply - they fly wherever they like.
    const reach = isAlien(fleet.owner) ? { ok: true } : canReach(game, fleet, target);
    if (!reach.ok) {
      fleet.dest = null; fleet.hole = null; endChase(fleet);
      if (owner) entries.push({ type: 'warn', playerIds: [owner.id], private: owner.id,
        key: 'log.fleetHeld', params: { near: nearestName(game, fleet) },
        because: { key: reach.key, params: reach.params } });
      continue;
    }
    // Around the black hole instead of through it - this makes the path longer.
    const path = route(fleet, target, zone);
    plans.push({ fleet, path, speed: st.speed, mouth, target, start: { x: fleet.x, y: fleet.y, z: fleet.z || 0 },
      stop: null, from: fleet.at });
  }
  const encounters = findEncounters(game, plans);

  const departures = [];            // [fleet, world it departs from this turn]
  for (const p of plans) {
    const { fleet, mouth, target } = p;
    const owner = playerById(game, fleet.owner);
    const step = p.stop != null ? { ...p.meet, done: false } : advance(p.start, p.path, p.speed);
    fleet.x = step.x; fleet.y = step.y; fleet.z = step.z;
    if (p.from != null && p.from !== fleet.dest) departures.push([fleet, p.from]);
    if (step.done && mouth) {
      transit(game, fleet, mouth.id, entries);
    } else if (step.done && fleet.dest != null) {
      fleet.at = target.id; fleet.dest = null;
      if (owner) {
        owner.explored.add(target.id);
        entries.push({ type: 'arrive', playerIds: [owner.id], private: owner.id, planetId: target.id,
          key: 'log.arrive', params: { count: fleet.ships.length, planet: target.name } });
      }
    } else {
      // On the way - or stopped where a chaser caught up.
      fleet.at = null;
    }
  }
  for (const p of game.players) p.orders.moves = {};
  return { departures, encounters };
}

/** Position of a planned fleet after the share t (0..1) of the turn - standing where it stopped. */
function posAt(p, t) {
  const tt = p.stop != null ? Math.min(t, p.stop) : t;
  return advance(p.start, p.path, p.speed * tt);
}

/**
 * Chasers that come close enough to their target during the turn: both stop
 * where they meet. The earliest meeting first - a target that stopped there
 * stands still for everyone chasing it later in the turn. Fleets meeting
 * the same target fight together.
 */
function findEncounters(game, plans) {
  const byId = new Map(plans.map(p => [p.fleet.id, p]));
  // A target without a course of its own stands still.
  const still = (f) => ({ fleet: f, path: [], speed: 0, start: { x: f.x, y: f.y, z: f.z || 0 }, stop: null });
  const groupOf = new Map();        // fleet -> the group it fights in
  const done = new Set();
  for (let round = 0; round < plans.length; round++) {
    let best = null;
    for (const p of plans) {
      if (!p.fleet.chase || done.has(p)) continue;
      const tf = game.fleets.find(f => f.id === p.fleet.chase && f.ships.length);
      if (!tf || tf.at != null && !byId.has(tf.id)) continue;
      const tp = byId.get(tf.id) || still(tf);
      const reach = Math.max(CATCH, (p.speed + tp.speed) / STEPS + 4);
      for (let k = 0; k <= STEPS; k++) {
        const t = k / STEPS;
        if (best && t >= best.t) break;
        if (dist(posAt(p, t), posAt(tp, t)) <= reach) { best = { p, tp, t }; break; }
      }
    }
    if (!best) break;
    const { p, tp, t } = best;
    done.add(p);
    if (tp.stop == null || tp.stop > t) { tp.stop = t; tp.meet = posAt(tp, t); }
    const meet = tp.meet || posAt(tp, t);
    tp.meet = meet;
    p.stop = t; p.meet = meet;
    // One battle per meeting: chasing each other, or two chasing the same
    // target, puts everyone into the same group.
    const g = groupOf.get(tp.fleet) || { at: meet, fleets: new Set([tp.fleet]) };
    const other = groupOf.get(p.fleet);
    if (other && other !== g) for (const f of other.fleets) g.fleets.add(f);
    g.fleets.add(p.fleet);
    for (const f of g.fleets) groupOf.set(f, g);
  }
  return [...new Set(groupOf.values())].map(g => ({
    at: { x: g.at.x, y: g.at.y, z: g.at.z || 0 }, fleets: [...g.fleets]
  }));
}

export function nearestName(game, point) {
  let best = null, bd = Infinity;
  for (const p of game.galaxy.planets) {
    const d = dist(p, point);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? best.name : '?';
}
