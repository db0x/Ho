// Intercepting in flight (game/movement.js). Every AI empire sends an idle
// armed fleet against enemies heading for its worlds and against aliens
// close by - if it is strong enough and catches them within a few turns.
//
// The normal AI takes the nearest fleet that is a bit stronger. The hard AI
// weighs it up:
// - a world that holds out on its own keeps its battery's help - no sortie,
// - a fleet sitting at the threatened world defends there instead,
// - no fleet leaves a world that is itself threatened,
// - only clearly superior fleets, and the smallest of them, so the rest
//   stays free,
// - it meets the enemy before it arrives, or not at all,
// - and it hunts colony ships and transporters that come into its space -
//   one at a time.
import { COMBAT_ROUNDS, batteryStats, isAlien, travelDistance, dist } from '../../shared/rules.js';
import { SCAN } from '../wormholes.js';
import { hostile } from '../game/diplomacy.js';
import { fleetStats } from '../game/fleets.js';
import { planetById } from '../game/game.js';
import { seesFleet } from '../game/intel.js';
import { canReach, interceptPoint } from '../game/movement.js';
import { setOrders } from '../game/orders.js';
import { HIT_RATE } from './situation.js';

/** Fighting strength: firepower times staying power - doubling a fleet quadruples it. */
function power(f) {
  let attack = 0, hp = 0;
  for (const s of f.ships) { attack += s.attack; hp += s.hp; }
  return attack * hp;
}

/** Does the world hold out alone against what comes for it - battery, satellites and station? */
function holdsAlone(world, fire, tech) {
  const bs = batteryStats(world.pop, tech);
  const hp = (bs ? bs.hp : 0) + (world.defenses || []).reduce((a, d) => a + d.hp, 0)
    + (world.station ? world.station.hp : 0);
  return fire * COMBAT_ROUNDS * HIT_RATE < hp * 0.8;
}

export function intercepts(s) {
  const { game, bot, hard, zone, threatened } = s;
  if (game.settings.interception === false) return;
  const hunters = game.fleets.filter(f => f.owner === bot.id && !f.chase && f.dest == null && !f.hole
    && f.ships.some(x => x.attack > 0) && !f.ships.some(x => x.colonists > 0 || x.cargo)
    && fleetStats(f).speed > 0);
  if (!hunters.length) return;
  const taken = new Set(game.fleets.filter(f => f.owner === bot.id && f.chase).map(f => f.chase));

  // Settlers or cargo heading into this empire's space - worth a hunt.
  const homes = s.mine.filter(p => p.pop >= 0.5);
  const near = (pt) => homes.some(p => dist(p, pt) < SCAN.world);
  const intruder = (f, goal) => f.ships.some(x => x.colonists > 0 || x.cargo) && (near(f) || (goal && near(goal)));
  const prey = [];
  // The target of a foreign fleet only as far as known (perception.js).
  const destOf = new Map(s.sight.map(x => [x.f.id, x.knownDest]));
  for (const f of game.fleets) {
    if (f.at != null || !f.ships.length || taken.has(f.id) || !hostile(game, bot.id, f.owner)) continue;
    if (!seesFleet(game, bot.id, f)) continue;
    const armed = f.ships.some(x => x.attack > 0);
    const dest = destOf.has(f.id) ? destOf.get(f.id) : f.dest;
    const goal = dest != null ? planetById(game, dest) : null;
    const threat = armed && goal?.owner === bot.id;
    const value = threat ? 3 : isAlien(f.owner) ? 2 : hard && !armed && intruder(f, goal) ? 1 : 0;
    if (!value) continue;
    if (hard && threat && holdsAlone(goal, threatened.get(goal.id) || 0, bot.tech)) continue;
    prey.push({ f, goal, armed, value, power: power(f) });
  }
  prey.sort((a, b) => b.value - a.value || b.power - a.power);

  const used = new Set();
  let hunts = 0;
  for (const p of prey) {
    if (!p.armed && hunts >= 1) continue;
    let best = null;
    for (const h of hunters) {
      if (used.has(h)) continue;
      // Waiting at the world means fighting with its battery.
      if (h.at != null && p.goal && h.at === p.goal.id) continue;
      if (hard && h.at != null && threatened.has(h.at)) continue;
      const strength = power(h);
      if (p.armed && strength < p.power * (hard ? 1.8 : 1.1)) continue;
      const aim = interceptPoint(game, h, p.f, zone);
      if (!canReach(game, h, aim).ok) continue;
      const turns = travelDistance(h, aim, zone) / fleetStats(h).speed;
      if (turns > (hard ? 4 : 3)) continue;
      if (hard && p.goal) {
        const eta = travelDistance(p.f, p.goal, zone) / (fleetStats(p.f).speed || 1);
        if (turns > eta) continue;
      }
      const score = hard ? strength : turns;
      if (!best || score < best.score) best = { h, score };
    }
    if (!best) continue;
    used.add(best.h);
    if (!p.armed) hunts++;
    setOrders(game, bot, { move: { fleetId: best.h.id, chase: p.f.id } });
  }
}
