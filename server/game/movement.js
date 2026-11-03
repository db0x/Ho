// Movement through space: how far a fleet may go (range is measured from
// the own inhabited worlds - supply), setting courses, and the fleets moving
// at the end of the turn, around the black hole and into wormholes.
import { supplyNeed, holeZone, advance, route, dist, isAlien } from '../../shared/rules.js';
import { portalsFor, findMouth, transit } from '../wormholes.js';
import { teamOf } from './diplomacy.js';
import { fleetStats } from './fleets.js';
import { planetById, playerById } from './game.js';

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
  if (o.hole != null) {
    // Only a mouth this empire has seen - the id of an unseen one gives nothing away.
    const found = player.seenMouths.has(o.hole) ? findMouth(game, o.hole) : null;
    if (!found) return { error: 'err.noSuchHole' };
    const reach = canReach(game, fleet, found.mouth);
    if (!reach.ok) return { error: reach.key, params: reach.params };
    fleet.hole = found.mouth.id;
    fleet.dest = null;
    delete player.orders.moves[fleet.id];
    return;
  }
  if (o.planetId === null) { delete player.orders.moves[fleet.id]; fleet.dest = null; fleet.hole = null; return; }
  const target = planetById(game, o.planetId);
  if (!target) return { error: 'err.noSuchPlanet' };
  const reach = canReach(game, fleet, target);
  if (!reach.ok) return { error: reach.key, params: reach.params };
  fleet.dest = target.id;
  fleet.hole = null;
  player.orders.moves[fleet.id] = target.id;
}

/**
 * Every fleet with a course moves on. Returns the departures - fleets that
 * left a world this turn and can still be intercepted there.
 */
export function moveFleets(game, entries) {
  const zone = holeZone(game.galaxy);
  const departures = [];            // [fleet, world it departs from this turn]
  for (const fleet of game.fleets) {
    if (fleet.dest == null && !fleet.hole) continue;
    const start = fleet.at;
    const mouth = fleet.hole ? findMouth(game, fleet.hole)?.mouth : null;
    if (fleet.hole && !mouth) { fleet.hole = null; continue; }
    const target = mouth || planetById(game, fleet.dest);
    const st = fleetStats(fleet);
    const owner = playerById(game, fleet.owner);
    if (st.speed <= 0) { fleet.dest = null; fleet.hole = null; continue; }
    // The aliens bring their own supply - they fly wherever they like.
    const reach = isAlien(fleet.owner) ? { ok: true } : canReach(game, fleet, target);
    if (!reach.ok) {
      fleet.dest = null; fleet.hole = null;
      if (owner) entries.push({ type: 'warn', playerIds: [owner.id], private: owner.id,
        key: 'log.fleetHeld', params: { near: nearestName(game, fleet) },
        because: { key: reach.key, params: reach.params } });
      continue;
    }
    // Around the black hole instead of through it - this makes the path longer.
    const step = advance(fleet, route(fleet, target, zone), st.speed);
    fleet.x = step.x; fleet.y = step.y; fleet.z = step.z;
    if (start != null && start !== fleet.dest) departures.push([fleet, start]);
    if (step.done && mouth) {
      transit(game, fleet, mouth.id, entries);
    } else if (step.done) {
      fleet.at = target.id; fleet.dest = null;
      if (owner) {
        owner.explored.add(target.id);
        entries.push({ type: 'arrive', playerIds: [owner.id], private: owner.id, planetId: target.id,
          key: 'log.arrive', params: { count: st.count, planet: target.name } });
      }
    } else {
      fleet.at = null;
    }
  }
  for (const p of game.players) p.orders.moves = {};
  return departures;
}

function nearestName(game, point) {
  let best = null, bd = Infinity;
  for (const p of game.galaxy.planets) {
    const d = dist(p, point);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? best.name : '?';
}
