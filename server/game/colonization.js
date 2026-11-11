// Taking worlds: colony ships landing on free worlds, settlers unloading on
// own ones, and invading an enemy world whose defenses have fallen.
import { planetCapacity, ALIEN_ID, travelDistance, holeZone } from '../../shared/rules.js';
import { overrun } from '../aliens.js';
import { hostile, teamOf } from './diplomacy.js';
import { cleanupFleets, newFleet } from './fleets.js';
import { planetById, playerById } from './game.js';
import { canReach, orderMove, endChase } from './movement.js';

/** Unloading colonists on an own world - only on explicit orders. */
export function orderUnload(game, player, o) {
  const planet = planetById(game, o.planetId);
  if (planet && planet.owner === player.id) {
    if (o.value === false) delete player.orders.unload[planet.id];
    else player.orders.unload[planet.id] = true;
  }
}

/**
 * Swarming out: every colony ship of a fleet in orbit flies alone to the
 * nearest free world - one ship per world. Free by what this empire knows
 * (in sight now, or the last memory); unexplored worlds only once the known
 * free ones are used up. Worlds an own colony ship already waits at or is
 * heading for are taken. What finds no world in range stays behind in the
 * fleet, as does every ship that is no colony ship.
 * @returns {{error: string}|{swarmed: {sent: number, left: number}}}
 */
export function orderSwarm(game, player, o) {
  const fleet = game.fleets.find(f => f.id === o.fleetId);
  if (!fleet || fleet.owner !== player.id) return { error: 'err.noSuchFleet' };
  if (fleet.at == null) return { error: 'err.swarmOrbit' };
  const settlers = fleet.ships.filter(s => s.colonists > 0);
  if (!settlers.length) return { error: 'err.swarmNoColony' };
  const here = planetById(game, fleet.at);
  const zone = holeZone(game.galaxy);
  const team = teamOf(game, player.id);
  const live = (p) => team.includes(p.owner) || game.fleets.some(f => team.includes(f.owner) && f.at === p.id);
  const claimed = new Set();
  for (const f of game.fleets) {
    if (f.owner !== player.id || f === fleet || !f.ships.some(s => s.colonists > 0)) continue;
    if (f.dest != null) claimed.add(f.dest);
    else if (f.at != null && !f.hole && !f.chase) claimed.add(f.at);
  }
  const known = [], unknown = [];
  for (const p of game.galaxy.planets) {
    if (p.id === here.id || claimed.has(p.id)) continue;
    const k = live(p) ? p : player.knowledge[p.id];
    if (!k) { unknown.push(p); continue; }
    // A memory of an own world is outdated, as in buildView.
    const owner = k === p ? p.owner : (k.owner === player.id ? p.owner : k.owner);
    if (owner == null && planetCapacity(k === p ? p : { ...p, temp: k.temp, grav: k.grav }) >= 1) known.push(p);
  }
  const far = (p) => travelDistance(fleet, p, zone);
  const order = (list) => list.map(p => [p, far(p)]).sort((a, b) => a[1] - b[1]).map(([p]) => p);
  const targets = [...order(known), ...order(unknown)];
  const plan = [];
  for (const ship of settlers) {
    const part = { ...fleet, ships: [ship] };
    const i = targets.findIndex(p => canReach(game, part, p).ok);
    if (i < 0) continue;
    plan.push([ship, targets[i]]);
    targets.splice(i, 1);
  }
  if (!plan.length) return { error: 'err.swarmNoTarget' };
  // The fleet itself keeps the last ship if nothing else stays behind.
  const all = plan.length === fleet.ships.length;
  const out = all ? plan.slice(0, -1) : plan;
  for (const [ship, target] of out) {
    fleet.ships.splice(fleet.ships.indexOf(ship), 1);
    const nf = newFleet(game, player.id, here);
    nf.ships = [ship];
    orderMove(game, player, { fleetId: nf.id, planetId: target.id });
  }
  if (all) {
    const [, target] = plan[plan.length - 1];
    endChase(fleet);
    orderMove(game, player, { fleetId: fleet.id, planetId: target.id });
  } else if (fleet.dest != null || fleet.hole) {
    // What stays behind stays: no course carried over from before.
    orderMove(game, player, { fleetId: fleet.id, planetId: null });
  }
  return { swarmed: { sent: plan.length, left: fleet.ships.length - (all ? 1 : 0) } };
}

/**
 * Whoever holds the orbit takes the world - or settles it. Alone, or
 * together with allies: then the owner settles its own world, and on a free
 * one the first with settlers aboard lands.
 */
export function colonize(game, entries) {
  for (const planet of game.galaxy.planets) {
    const present = presentOwners(game, planet);
    const owner = holder(game, planet, present);
    if (owner == null) continue;
    // The aliens alone in the orbit: they do not take the world, they empty it.
    if (owner === ALIEN_ID) { overrun(game, planet, entries); continue; }
    const p = playerById(game, owner);
    if (!p || !p.alive) continue;
    const cap = planetCapacity(planet);

    if (planet.owner && planet.owner !== owner) {
      // An ally's world is safe, even with its battery broken.
      if (!hostile(game, owner, planet.owner)) continue;
      // Enemy world without remaining defenses: invasion
      const armed = game.fleets.some(f => f.owner === owner && f.at === planet.id && f.ships.some(s => s.attack > 0));
      if (armed) {
        const old = playerById(game, planet.owner);
        const before = planet.pop;
        planet.owner = owner;
        planet.pop = Math.max(0.5, Math.round(before * 0.65 * 10) / 10);
        planet.terraBudget = 0;
        planet.terraSpent = 0;
        // A station still there (only a construction site can be) is blown up.
        planet.station = null;
        entries.push({ type: 'invade', playerIds: [owner, old ? old.id : null].filter(Boolean), planetId: planet.id,
          key: old ? 'log.invadeFrom' : 'log.invade',
          params: { player: p.name, planet: planet.name, from: old ? old.name : null } });
      }
      continue;
    }

    // Own or free world: settlers disembark. On own worlds only on explicit
    // orders - otherwise the colony ship would dissolve right in the home
    // orbit.
    const unowned = planet.owner === null;
    if (!unowned && !p.orders.unload[planet.id]) continue;

    let landed = 0;
    for (const fleet of game.fleets.filter(f => f.owner === owner && f.at === planet.id)) {
      const keep = [];
      for (const s of fleet.ships) {
        if (s.colonists > 0 && planet.pop < cap && cap >= 1) {
          planet.pop = Math.min(cap, planet.pop + s.colonists);
          landed += s.colonists;
        } else keep.push(s);
      }
      fleet.ships = keep;
    }
    if (landed > 0) {
      planet.owner = owner;
      planet.pop = Math.round(planet.pop * 10) / 10;
      entries.push({ type: unowned ? 'colonize' : 'settle', playerIds: [owner], planetId: planet.id,
        ...(unowned ? { key: 'log.colonize', params: { player: p.name, planet: planet.name } }
                    : { key: 'log.settle', params: { planet: planet.name, amount: Math.round(landed * 10) / 10 } }) });
    } else if (unowned && cap < 1) {
      const hasColony = game.fleets.some(f => f.owner === owner && f.at === planet.id && f.ships.some(s => s.colonists > 0));
      if (hasColony) entries.push({ type: 'warn', playerIds: [owner], private: owner, planetId: planet.id,
        key: 'log.uninhabitable', params: { planet: planet.name } });
    }
  }
  for (const p of game.players) p.orders.unload = {};
  cleanupFleets(game);
}

/**
 * Who acts in this orbit: nobody while enemies face each other; otherwise
 * the owner if present, else an armed one (who may invade), else the first
 * with settlers aboard.
 */
function holder(game, planet, present) {
  if (present.length === 1) return present[0];
  if (!present.length || present.some(a => present.some(b => hostile(game, a, b)))) return null;
  if (present.includes(planet.owner)) return planet.owner;
  const here = present.map(o => game.fleets.filter(f => f.owner === o && f.at === planet.id));
  const armed = present.find((o, i) => here[i].some(f => f.ships.some(s => s.attack > 0)));
  if (planet.owner && armed != null) return armed;
  return present.find((o, i) => here[i].some(f => f.ships.some(s => s.colonists > 0))) ?? present[0];
}

/**
 * Which players have ships at this planet? The population alone does not
 * hold the orbit - that is exactly where defenseless colonies fail.
 */
function presentOwners(game, planet) {
  const set = new Set();
  for (const f of game.fleets) if (f.at === planet.id && f.ships.length) set.add(f.owner);
  if (planet.owner && planet.defenses && planet.defenses.length) set.add(planet.owner);
  // A ready station holds the orbit like the satellites - it has to be shot down first.
  if (planet.owner && planet.station && !(planet.station.building > 0)) set.add(planet.owner);
  if (planet.owner && planet.pop >= 0.5 && !planet._orbitLost) set.add(planet.owner);
  return [...set];
}
