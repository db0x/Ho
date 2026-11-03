// Fleet command: bundling and sorting out fleets, a course for every idle
// one, and the transporters' errands.
import { cargoOf, travelDistance, dist, shipStats, batteryStats, COMBAT_ROUNDS } from '../../shared/rules.js';
import { hostile } from '../game/diplomacy.js';
import { fleetStats } from '../game/fleets.js';
import { planetById } from '../game/game.js';
import { seesFleet } from '../game/intel.js';
import { canReach } from '../game/movement.js';
import { setOrders } from '../game/orders.js';
import { friendly } from './diplomacy.js';
import { HIT_RATE } from './situation.js';
import { surplus } from './shipyard.js';
import { formPacks, combatTarget } from './war.js';

/**
 * Transporters: fetch spare satellites and bring them to the most heavily
 * threatened world where they still make a difference. Loaded at a donor,
 * set down at the target. Not into an orbit the enemy already holds - the
 * transporter would go down with its cargo - and not to a world that falls
 * anyway, however many satellites arrive.
 */
export function logistics(s) {
  const { threatened, game, bot, zone } = s;
  const sat = shipStats('satellite', bot.tech);
  const held = new Set(game.fleets.filter(f => f.at != null && hostile(game, bot.id, f.owner)
    && f.ships.some(x => x.attack > 0)).map(f => f.at));
  const needy = [...threatened.entries()]
    .map(([id, a]) => ({ p: planetById(game, id), a }))
    .filter(x => x.p && x.p.owner === bot.id && !held.has(x.p.id) && x.p.pop >= 0.5)
    .filter(x => {
      const bs = batteryStats(x.p.pop, bot.tech);
      const hp = (bs ? bs.hp : 0) + (x.p.defenses || []).reduce((a, d) => a + d.maxHp, 0) + 5 * sat.maxHp;
      return x.a * COMBAT_ROUNDS * HIT_RATE < hp * 1.5;
    })
    .sort((x, y) => y.a - x.a);
  const donors = surplus(s);
  for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.ships.some(s => s.cargo))) {
    const cargo = cargoOf(f.ships);
    const here = f.at != null ? planetById(game, f.at) : null;
    const far = p => travelDistance(here || f, p, zone);
    if (cargo.used > 0) {
      // Arrived where it is needed (or the danger has passed: then wherever it stands).
      const goal = needy.length ? reachable(game, f, needy.map(x => x.p), p => -far(p) * 0.01 + (threatened.get(p.id) || 0)) : null;
      if (here && here.owner === bot.id && (!goal || goal.id === here.id)) {
        setOrders(game, bot, { drop: { fleetId: f.id } });
      } else if (goal) {
        setOrders(game, bot, { move: { fleetId: f.id, planetId: goal.id } });
      } else {
        // Nowhere needed and not at home: to the nearest own world, set down there.
        const home = reachable(game, f, s.mine.filter(p => p.pop >= 0.5 && !held.has(p.id)), p => -far(p));
        if (home) setOrders(game, bot, { move: { fleetId: f.id, planetId: home.id } });
      }
      continue;
    }
    if (!needy.length) continue;
    const donor = here && donors.find(d => d.p.id === here.id);
    if (donor) {
      setOrders(game, bot, { load: { fleetId: f.id, count: donor.spare } });
      const goal = reachable(game, f, needy.map(x => x.p), p => -far(p) * 0.01 + (threatened.get(p.id) || 0));
      if (goal && goal.id !== here.id) setOrders(game, bot, { move: { fleetId: f.id, planetId: goal.id } });
      continue;
    }
    const source = reachable(game, f, donors.map(d => d.p), p => -far(p));
    if (source && source.id !== f.at) setOrders(game, bot, { move: { fleetId: f.id, planetId: source.id } });
  }
}

/** Fleets merged and split: battle groups together, everything else on its own. */
export function organizeFleets(s) {
  const { myFleets, mine, game, bot, hard, P } = s;
  // --- Bundle fleets before the attack
  const waiting = new Map();
  for (const f of myFleets) {
    if (f.at === null || f.at === undefined || f.dest != null) continue;
    waiting.set(f.at, (waiting.get(f.at) || 0) + 1);
  }
  for (const p of mine) {
    if ((waiting.get(p.id) || 0) > 1) setOrders(game, bot, { merge: { planetId: p.id } });
  }
  // ... and sort them out again: settlers and scouts go their own ways,
  // otherwise the colony ship drags the whole battle fleet behind it.
  for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.at != null)) {
    const settlers = f.ships.filter(s => s.colonists > 0).map(s => s.id);
    if (settlers.length && settlers.length < f.ships.length) {
      setOrders(game, bot, { split: { fleetId: f.id, ships: settlers } });
    }
    const armed = f.ships.filter(s => s.attack > 0);
    const rest = f.ships.filter(s => s.attack <= 0).map(s => s.id);
    if (armed.length && rest.length) setOrders(game, bot, { split: { fleetId: f.id, ships: rest } });
  }
  // Transporters keep to themselves - they have their own errands.
  for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.at != null)) {
    const holds = f.ships.filter(s => s.cargo).map(s => s.id);
    if (holds.length && holds.length < f.ships.length) setOrders(game, bot, { split: { fleetId: f.id, ships: holds } });
  }
  // Hard: colony ships fly alone too - each was built for a world of its own.
  if (hard) {
    for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.at != null)) {
      const settlers = f.ships.filter(s => s.colonists > 0);
      if (settlers.length > 1 && settlers.length === f.ships.length) {
        setOrders(game, bot, { split: { fleetId: f.id, ships: settlers.map(s => s.id), each: true } });
      }
    }
  }
  // Scouts fly alone - in a bunch they only explore one world instead of several.
  for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.at != null)) {
    if (f.ships.length < 2 || !f.ships.every(s => s.type === 'scout')) continue;
    for (const s of f.ships.slice(1)) setOrders(game, bot, { split: { fleetId: f.id, ships: [s.id] } });
  }
  if (P.packs) formPacks(s);
}

/** A course for every idle fleet: settlers, scouts, warships. */
export function orderFleets(s) {
  const {
    myFleets, game, bot, zone, hard, ai, planets, settleable, settleScore, oreScarce, center,
    strikePower
  } = s;
  // --- Fleet orders
  // Worlds an own colony ship is already heading for - one is enough, otherwise
  // they all fly to the same world and the rest wander around afterwards.
  const claimed = new Set(myFleets
    .filter(f => f.dest != null && f.ships.some(s => s.colonists > 0)).map(f => f.dest));
  // The same for scouts: one per unexplored world, the next one looks elsewhere.
  const scouted = new Set(myFleets
    .filter(f => f.dest != null && isScout(f)).map(f => f.dest));
  // Free worlds held by a foreign ship - nobody settles there until it is gone.
  const { blocked, escorted } = clearOrbits(s, claimed);
  for (const fleet of game.fleets.filter(f => f.owner === bot.id && f.dest == null && !f.hole && !f.chase && f.ships.length)) {
    const st = fleetStats(fleet);
    if (st.speed <= 0 || fleet.ships.some(s => s.cargo)) continue;
    const here = fleet.at !== null ? planetById(game, fleet.at) : fleet;
    // Distance for the AI means: the path it really has to fly.
    const far = p => travelDistance(here, p, zone);
    const hasColonist = fleet.ships.some(s => s.colonists > 0);
    const armed = st.attack > 0;
    let target = null;

    if (hasColonist) {
      // Waiting for the escort that chases the intruder out of this orbit.
      if (fleet.at != null && escorted.has(fleet.at)) continue;
      // Hard: the world this ship was built for, if it is still free.
      if (hard && fleet.at != null) {
        const i = ai.colonyPlans.findIndex(x => x.yard === fleet.at && x.turn < game.turn && !claimed.has(x.goal));
        if (i >= 0) {
          const goal = planets[ai.colonyPlans[i].goal];
          ai.colonyPlans.splice(i, 1);
          if (goal && !goal.owner && (!blocked.has(goal.id) || escorted.has(goal.id))
            && canReach(game, fleet, goal).ok) target = goal;
        }
      }
      // Otherwise the best free world from here.
      if (!target) {
        target = reachable(game, fleet, settleable.filter(p => p.id !== fleet.at && !claimed.has(p.id)
          && (!blocked.has(p.id) || escorted.has(p.id))),
          p => settleScore(p, here) + (oreScarce ? Math.min(p.metalReserve, 2000) * 0.05 : 0));
      }
    } else if (!armed) {
      // Scouts: nearest unexplored world. If everything around is known, they
      // head for the edge - only there does the map grow, and the ore with it.
      // Foreign worlds come last: their defenses shoot a scout down. But it
      // still reveals the world on arrival - whoever only knows what lies on
      // their own doorstep finds no targets in the late game.
      const safe = p => !p.owner || p.owner === bot.id || friendly(game, bot, p.owner);
      const unknown = planets.filter(p => !bot.explored.has(p.id) && !scouted.has(p.id));
      target = reachable(game, fleet, unknown.filter(safe), p => -far(p));
      if (!target) target = reachable(game, fleet, unknown, p => -far(p));
      if (!target && game.settings.expanding !== false && !game.galaxy.complete) {
        target = reachable(game, fleet, planets.filter(p => safe(p) && !scouted.has(p.id)), p => dist(p, center));
      }
      if (target) scouted.add(target.id);
    } else {
      target = combatTarget(s, fleet, st, far);
    }
    if (target && target.id !== fleet.at) {
      if (hasColonist) claimed.add(target.id);
      setOrders(game, bot, { move: { fleetId: fleet.id, planetId: target.id } });
      // Into the war diary - what was sent, against whom.
      if (fleet.dest === target.id) {
        const L = ai.learn;
        if (armed && target.owner && target.owner !== bot.id) {
          L.strikes = L.strikes.filter(x => x.fleetId !== fleet.id);
          L.strikes.push({ fleetId: fleet.id, target: target.id, owner: target.owner,
            strike: strikePower(fleet), turn: game.turn });
        } else if (hasColonist && hard) {
          L.colonies.push({ fleetId: fleet.id, target: target.id });
        }
      }
    }
  }
}

/** Unarmed fleet without settlers or cargo - a scout. */
function isScout(f) {
  return f.ships.every(s => s.attack <= 0 && !(s.colonists > 0) && !s.cargo);
}

/**
 * A foreign ship in the orbit of a free world blocks every landing there -
 * even a lone scout. Where an own colony ship waits or is heading, the
 * nearest idle warship that can deal with the intruder goes there.
 * Returns the blocked worlds and those an escort is on its way to.
 */
function clearOrbits(s, claimed) {
  const { game, bot, planets, myFleets, threatened, zone } = s;
  const blocked = new Map();       // free world -> firepower needed to clear it
  for (const f of game.fleets) {
    if (f.at == null || !f.ships.length || !hostile(game, bot.id, f.owner)) continue;
    const p = planets[f.at];
    if (!p || p.owner || !bot.explored.has(p.id) || !seesFleet(game, bot.id, f)) continue;
    // Only the kind of ship is visible: reckon with it as tough as our own.
    let need = 0;
    for (const x of f.ships) {
      const st = shipStats(x.type, bot.tech);
      need += st.maxHp * (st.attack > 0 ? 2 : 1.3);
    }
    blocked.set(p.id, (blocked.get(p.id) || 0) + need);
  }
  const escorted = new Set();
  if (!blocked.size) return { blocked, escorted };
  const strike = f => f.ships.reduce((a, x) => a + x.attack, 0) * COMBAT_ROUNDS * HIT_RATE;
  for (const f of myFleets) {
    if (f.dest != null && blocked.has(f.dest) && strike(f) >= blocked.get(f.dest)) escorted.add(f.dest);
  }
  // Worlds an own colony ship waits at or is heading for.
  const wanted = new Set(claimed);
  for (const f of myFleets) if (f.at != null && f.ships.some(x => x.colonists > 0)) wanted.add(f.at);
  for (const [id, need] of blocked) {
    if (!wanted.has(id) || escorted.has(id)) continue;
    const p = planets[id];
    const guards = myFleets.filter(f => f.dest == null && !f.hole && !f.chase && f.ships.length && strike(f) >= need
      && fleetStats(f).speed > 0 && !f.ships.some(x => x.colonists > 0 || x.cargo)
      && !(f.at != null && threatened.has(f.at)));
    const g = guards.map(f => ({ f, d: travelDistance(f.at != null ? planets[f.at] : f, p, zone) }))
      .sort((a, b) => a.d - b.d).slice(0, 12).find(x => canReach(game, x.f, p).ok);
    if (!g) continue;
    // Only as many ships as needed - the rest stays where it is.
    let ships = [], fire = 0;
    for (const x of g.f.ships.filter(x => x.attack > 0 && x.speed > 0).sort((a, b) => b.attack - a.attack)) {
      if (fire >= need) break;
      ships.push(x); fire += x.attack * COMBAT_ROUNDS * HIT_RATE;
    }
    let fleet = g.f;
    if (ships.length < g.f.ships.length && g.f.at != null) {
      const r = setOrders(game, bot, { split: { fleetId: g.f.id, ships: ships.map(x => x.id) } });
      fleet = (r?.newFleet && game.fleets.find(x => x.id === r.newFleet)) || g.f;
    }
    setOrders(game, bot, { move: { fleetId: fleet.id, planetId: id } });
    if (fleet.dest === id) escorted.add(id);
  }
  return { blocked, escorted };
}

/** Best target that the fleet can actually reach. */
export function reachable(game, fleet, arr, score) {
  const sorted = arr.slice().sort((a, b) => score(b) - score(a));
  for (const p of sorted.slice(0, 12)) {
    if (canReach(game, fleet, p).ok) return p;
  }
  return null;
}
