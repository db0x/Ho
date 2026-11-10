// War: choosing the rival, campaigns against one target at a time, where
// the fleet gathers, what a fleet attacks on its own, calling strikes off -
// and for hard empires, splitting in flight.
import { travelDistance, dist, COMBAT_ROUNDS } from '../../shared/rules.js';
import { fleetStats } from '../game/fleets.js';
import { planetById } from '../game/game.js';
import { inSight } from '../game/intel.js';
import { canReach } from '../game/movement.js';
import { setOrders } from '../game/orders.js';
import { allianceOf } from '../game/diplomacy.js';
import { friendly } from './diplomacy.js';
import { reachable } from './fleets.js';
import { HIT_RATE, BATTERED } from './situation.js';

/**
 * The rival: whoever is close, whoever has hurt us, whoever grows too big. Once
 * chosen, it stays the rival for a while - otherwise the empire keeps switching
 * fronts and never gathers enough.
 */
export function chooseRival(ai, P, enemyWorlds, distance, leader, friend) {
  const points = {};
  for (const p of enemyWorlds) {
    const d = distance.get(p.id);
    if (d < 600) points[p.owner] = (points[p.owner] || 0) + (600 - d) / 600;
  }
  for (const [o, g] of Object.entries(ai.grudge)) points[o] = (points[o] || 0) + g * P.vengeance;
  if (leader) points[leader] = (points[leader] || 0) + 3 * P.vsLeader;
  if (ai.rival && points[ai.rival] != null) points[ai.rival] += 2;
  let best = null;
  // An ally is nobody's rival, however much it once hurt us.
  for (const [o, s] of Object.entries(points)) if (!friend(o) && (!best || s > best.s)) best = { o, s };
  return best ? best.o : null;
}

/** A campaign: one target, one rally point, and only go once it is enough. */
export function planCampaign(s) {
  const {
    ai, game, bot, price, margin, power, reinforcements, P, pressure, hit, bases, fighter,
    enemyWorlds, distance, value, mine, zone, planets
  } = s;
  let plan = ai.campaign;
  if (plan) {
    // As far as known - with fog of war the world as last seen.
    const z = planets[plan.targetId];
    const open = z && z.owner && z.owner !== bot.id && !friendly(game, bot, z.owner) && bot.explored.has(z.id);
    // Waited too long, or the target arms faster than we can rebuild:
    // drop it and avoid it for a while.
    const tooCostly = open && price(z) * margin > (power + reinforcements) * 1.5;
    if (!open || tooCostly || game.turn - plan.since > 35) {
      if (open) ai.avoided[z.id] = game.turn + 25;
      plan = null;
    }
  }
  const allowed = (game.turn >= P.from * (1 - pressure) && (
      P.campaign === 'always'
      || (P.campaign === 'retaliation' && (hit || pressure >= 0.5))
      || (P.campaign === 'pressure' && pressure >= 0.4)))
    // The resentful strike back earlier too
    || (hit && P.vengeance >= 1 && game.turn >= 10);
  if (!allowed || !bases.length) { ai.campaign = null; return null; }

  if (!plan) {
    const reach = fighter.range;
    const potential = power + reinforcements;
    const revengeOnly = P.campaign === 'retaliation' && pressure < 0.5;
    // How much the price counts: a poor empire takes what is cheap; a rich
    // one can afford the valuable core worlds - otherwise in the late game
    // everyone only nibbles at fringe colonies and the core stays rigid.
    const costScale = Math.max(60, potential / 25);
    let best = null, cheapest = null;
    // Plotting against an ally: its worlds are the only targets, as long as
    // one of them is within reach and affordable.
    const plotted = ai.plot && enemyWorlds.filter(p => p.owner === ai.plot.id
      && distance.get(p.id) <= reach && price(p) * margin <= potential);
    for (const p of plotted?.length ? plotted : enemyWorlds) {
      const d0 = distance.get(p.id);
      if (d0 > reach || (ai.avoided[p.id] || 0) > game.turn) continue;
      if (revengeOnly && (ai.grudge[p.owner] || 0) < 2) continue;
      const cost = price(p);
      if (!cheapest || cost < cheapest.cost) cheapest = { p, cost };
      if (cost * margin > potential) continue;
      const s = value(p) / (cost / costScale + 5) * (1 - d0 / (reach * 1.6));
      if (!best || s > best.s) best = { p, s };
    }
    // Under pressure, rather go for the cheapest than nothing at all.
    const choice = best ? best.p : (pressure > 0.6 && cheapest ? cheapest.p : null);
    if (!choice) { ai.campaign = null; return null; }
    plan = { targetId: choice.id, since: game.turn };
  }
  const target = planets[plan.targetId];
  plan.cost = price(target);
  plan.rally = mine.filter(p => p.pop >= 1)
    .sort((a, b) => travelDistance(a, target, zone) - travelDistance(b, target, zone))[0] || null;
  plan.target = target;
  ai.campaign = plan;
  return plan;
}

/** Own world closest to the rival or to the nearest enemy. */
export function frontWorld(s) {
  const { enemyWorlds, ai, yards, yard } = s;
  const enemies = enemyWorlds.filter(p => !ai.rival || p.owner === ai.rival);
  if (!enemies.length || !yards.length) return yard;
  let best = null, bd = Infinity;
  for (const y of yards.slice(0, 20)) {
    for (const e of enemies) {
      const d = dist(y, e);
      if (d < bd) { bd = d; best = y; }
    }
  }
  return best || yard;
}

/**
 * Hard: strikes under way are checked again every turn. If the target has
 * grown clearly stronger than the fleet on its way (reinforcements, new
 * satellites), it turns back to the rally point instead of breaking on it.
 */
export function recall(s) {
  const { game, bot, planets, strikePower, price, margin, camp, rallyPoint, yard, ai } = s;
  for (const f of game.fleets) {
    if (f.owner !== bot.id || f.dest == null) continue;
    const target = planets[f.dest];
    if (!target || !target.owner || target.owner === bot.id) continue;
    // Allied since the fleet set out: no reason to go there anymore. A guest
    // gathering in the orbit of the ally it plots against flies on - it is
    // safe there while the alliance holds.
    const peace = friendly(game, bot, target.owner);
    const x = ai.plot?.id === target.owner ? allianceOf(game, bot.id, target.owner) : null;
    if (x && x.endsAt == null) continue;
    const strike = strikePower(f);
    if (!peace && (strike <= 0 || price(target) * margin <= strike * 1.25)) continue;
    const back = (camp && camp.rally) || rallyPoint || yard;
    if (back && back.id !== f.dest && canReach(game, f, back).ok) {
      setOrders(game, bot, { move: { fleetId: f.id, planetId: back.id } });
    }
  }
}

/**
 * Hard: splitting in flight. An armed fleet under way peels off part of
 * itself where nobody sees it coming - what it has beyond the needs of its
 * own target:
 * - sortie: the detachment cracks a second enemy world that it reaches in
 *   this very turn, so the defender gets no turn to react
 * - ambush: a small foreign fleet heading for a free world - most likely a
 *   colony ship - is met there by fighters that arrive no later than it
 * At most one detachment per fleet and turn; the main fleet flies on.
 */
export function detach(s) {
  const {
    myFleets, game, bot, planets, price, margin, strikePower, zone, ai, enemyWorlds, value, fighter, sight
  } = s;
  const ambushed = new Set(myFleets.filter(f => f.dest != null).map(f => f.dest));
  for (const f of game.fleets.filter(f => f.owner === bot.id && f.at == null && f.dest != null)) {
    const goal = planets[f.dest];
    if (!goal) continue;
    const armed = f.ships.filter(s => s.attack > 0 && s.speed > 0);
    if (armed.length < 2) continue;
    // What the own target still needs - a free or own world needs nothing,
    // but a ship stays with the fleet in any case.
    const need = goal.owner && goal.owner !== bot.id ? price(goal) * margin * 1.1 : 0;
    const spare = strikePower(f) - need;
    if (spare <= 0) continue;
    const weakFirst = armed.slice().sort((x, y) => x.attack - y.attack);
    // The fewest ships that bring this much firepower without cutting into
    // what the main fleet needs.
    const pick = (want) => {
      const out = [];
      let fire = 0;
      for (const s of weakFirst) {
        if (fire >= want) break;
        out.push(s); fire += s.attack * COMBAT_ROUNDS * HIT_RATE;
      }
      if (fire < want || fire > spare || out.length >= f.ships.length) return null;
      return out;
    };
    const turnsFor = (ships, p) => {
      const speed = Math.min(...ships.map(s => s.speed));
      return Math.ceil(travelDistance(f, p, zone) / speed);
    };
    // Splits off and sets the course; the new fleet or null.
    const send = (ships, p) => {
      if (!canReach(game, { owner: bot.id, ships }, p).ok) return null;
      const r = setOrders(game, bot, { split: { fleetId: f.id, ships: ships.map(s => s.id) } });
      const nf = r?.newFleet && game.fleets.find(x => x.id === r.newFleet);
      if (!nf) return null;
      setOrders(game, bot, { move: { fleetId: nf.id, planetId: p.id } });
      // The main fleet is weaker now - its entry in the war diary too.
      const own = ai.learn.strikes.find(x => x.fleetId === f.id);
      if (own) own.strike = strikePower(f);
      return nf;
    };

    // Sortie: the most valuable world that a detachment cracks right away.
    const sorties = enemyWorlds
      .filter(p => p.id !== goal.id && (ai.avoided[p.id] || 0) <= game.turn && price(p) * margin <= spare)
      .sort((x, y) => value(y) / (price(y) / 100 + 5) - value(x) / (price(x) / 100 + 5));
    let done = false;
    for (const p of sorties.slice(0, 8)) {
      const ships = pick(price(p) * margin);
      if (!ships || turnsFor(ships, p) > 1) continue;
      const nf = send(ships, p);
      if (!nf) continue;
      ai.learn.strikes.push({ fleetId: nf.id, target: p.id, owner: p.owner, strike: strikePower(nf), turn: game.turn });
      done = true;
      break;
    }
    if (done) continue;

    // Ambush: only what a human would see as well - course, arrival and
    // number of ships, not their kind.
    // With fog of war only fleets in sight whose target is known (perception.js).
    for (const { f: e, knownDest } of sight) {
      if (e.owner === bot.id || knownDest == null || e.ships.length > 3) continue;
      const w = planets[knownDest];
      if (!w || w.owner || ambushed.has(w.id) || !inSight(game, bot.id, e)) continue;
      const eSpeed = fleetStats(e).speed;
      if (eSpeed <= 0) continue;
      const theirs = Math.ceil(travelDistance(e, w, zone) / eSpeed);
      // Unknown ships: reckon with fighters as tough as our own.
      const ships = pick(e.ships.length * fighter.maxHp * 1.5);
      if (!ships || turnsFor(ships, w) > theirs || !send(ships, w)) continue;
      ambushed.add(w.id);
      break;
    }
  }
}

/** The raider splits big clusters into packs that go hunting on their own. */
export function formPacks(s) {
  const { game, enemyWorlds, price, fighterStrike, bot } = s;
  const size = Math.max(3, Math.round(3 + game.turn / 25));
  const prey = enemyWorlds.filter(p => price(p) <= size * fighterStrike).length;
  if (prey < 2) return;
  for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.at != null)) {
    const fighterIds = f.ships.filter(s => s.attack > 0).map(s => s.id);
    let packs = Math.min(Math.floor(fighterIds.length / size) - 1, prey - 1, 4);
    while (packs-- > 0) {
      setOrders(game, bot, { split: { fleetId: f.id, ships: fighterIds.splice(0, size) } });
    }
  }
}

export function combatTarget(s, fleet, st, far) {
  const {
    garrison, threatened, yard, camp, margin, game, price, solo, enemyWorlds, distance, ai,
    worldsLeft, value, guard, rallyPoint, bot
  } = s;
  const strike = st.attack * COMBAT_ROUNDS * HIT_RATE;
  // Garrison: whoever is threatened at home stays where they are needed.
  if (garrison >= 0.3 && fleet.at != null && threatened.has(fleet.at)) return null;
  // Nobody gives up the capital - half the economy would collapse with it.
  if (yard && fleet.at === yard.id && threatened.has(yard.id)) return null;

  if (camp && strike >= camp.cost * margin && canReach(game, fleet, camp.target).ok) return camp.target;

  // Plotting against an ally: gather in its orbit as a guest, before any
  // hunt of its own - safe while the alliance holds, and once notice runs
  // out the battle starts right there.
  const plot = camp && ai.plot && camp.target.owner === ai.plot.id ? allianceOf(game, bot.id, ai.plot.id) : null;
  if (plot && plot.endsAt == null) {
    if (fleet.at === camp.target.id) return null;
    if (canReach(game, fleet, camp.target).ok) return camp.target;
  }

  // On its own: only targets this fleet cracks in one move - the defense
  // battery is back at full strength next turn.
  const crackable = p => price(p) * margin <= strike;
  let prey = [];
  if (solo === 'prey') prey = enemyWorlds.filter(crackable);
  else if (solo === 'near') prey = enemyWorlds.filter(p => crackable(p) && distance.get(p.id) < 260);
  else if (solo === 'carrion') {
    prey = enemyWorlds.filter(p => crackable(p)
      && (ai.fresh.has(p.id) || (worldsLeft.get(p.owner) || 99) <= BATTERED));
  }
  if (prey.length) {
    const t = reachable(game, fleet, prey,
      p => value(p) / (price(p) / 100 + 5) - far(p) * 0.03);
    if (t) return t;
  }

  // Nothing to gain: gather - at the campaign, at the border or at home.
  let rally = camp ? camp.rally : null;
  if (!rally && garrison >= 0.3) rally = guard;
  if (!rally) rally = rallyPoint;
  if (rally && rally.id !== fleet.at && canReach(game, fleet, rally).ok) return rally;
  return null;
}

/** Where ships are built and gathered, and which world the defenders hold. */
export function takePositions(s) {
  const { mine, camp, P, ai, game, bot, threatened } = s;
  // --- Building
  const yards = mine.filter(p => p.pop >= 1).sort((a, b) => b.pop - a.pop);
  const yard = yards[0];
  // The front is measured from the shipyards - they have to be known first.
  Object.assign(s, { yards, yard });
  const front = frontWorld(s);
  // One rally point for everything: build where the fleet gathers - otherwise
  // every turn a new stream of fresh fighters moves from the yard to the front.
  const rallyPoint = (camp && camp.rally) || (P.solo === 'prey' || P.carrion ? front : yard);
  // Guard: defenders hold out at a threatened world for a few turns instead
  // of chasing every passing enemy and back.
  let guard = ai.guard && planetById(game, ai.guard.id);
  if (!guard || guard.owner !== bot.id || game.turn > ai.guard.until) {
    guard = null; ai.guard = null;
    const worst = [...threatened.entries()].sort((a, b) => b[1] - a[1])[0];
    if (worst) { ai.guard = { id: worst[0], until: game.turn + 6 }; guard = planetById(game, worst[0]); }
  }
  Object.assign(s, { rallyPoint, guard });
}
