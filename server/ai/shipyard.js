// What the shipyards build, what gets refitted, and what goes into the
// scrap press.
import {
  shipStats, travelDistance, dist, buildLock, shipCost, recycleValue, refitTotal
} from '../../shared/rules.js';
import { planetById } from '../game/game.js';
import { setOrders } from '../game/orders.js';

export function build(s) {
  const {
    treasury, P, myFleets, inRange, game, mine, pressure, camp, power, margin, fighterStrike,
    enemyWorlds, threatened, rallyPoint, yard, bot, known, planets, hard, ai, yards, zone,
    settleScore, hit, fighterCost, oreScarce
  } = s;
  const budget = treasury * P.build;
  const myColonyShips = myFleets
    .reduce((a, f) => a + f.ships.filter(s => s.colonists > 0).length, 0);
  // Only as many colony ships as there are reachable targets - otherwise
  // they stand around with the scarce ore tied up in them.
  const wantColony = Math.max(0, Math.min(P.settlers, inRange.length - myColonyShips));
  const myShips = myFleets.reduce((a, f) => a + f.ships.length, 0);
  let cap = (10 + game.turn * 0.6 * P.fleet + mine.length * 1.5) * (1 + pressure);
  // A campaign lacking firepower may break the cap.
  if (camp && power < camp.cost * margin) {
    cap = Math.max(cap, myShips + Math.ceil((camp.cost * margin - power) / fighterStrike));
  }
  const war = enemyWorlds.length > 0 || threatened.size > 0;
  const shipyard = rallyPoint || yard;

  const order = [];
  const scouts = () => {
    // A few scouts are always under way, as long as there is something to
    // discover or the map can grow.
    // Only scouts that keep up with today's levels are counted.
    const farEnough = shipStats('scout', bot.tech).range * 0.75;
    const underway = myFleets.reduce((a, f) => a + f.ships.filter(s => s.type === 'scout' && s.range >= farEnough).length, 0);
    const wanted = known.length < planets.length || (game.settings.expanding !== false && !game.galaxy.complete)
      ? (P.scouts ? 3 : 2) : 0;
    if (game.turn < 6) order.push([yard, 'scout', 2]);
    else if (underway < wanted && game.turn % 3 === 0) order.push([yard, 'scout', 1]);
  };
  const colonies = () => {
    if (wantColony <= 0) return;
    if (!hard) { order.push([yard, 'colony', wantColony]); return; }
    // Hard: every colony ship comes from the shipyard right next to the
    // world it is meant for - short trips instead of all of them crossing
    // the empire from the capital. That alone decides most games. Worlds a
    // colony ship already heads for, or one is being built for, are taken.
    const taken = new Set(ai.colonyPlans.map(x => x.goal));
    for (const f of myFleets) if (f.dest != null && f.ships.some(s => s.colonists > 0)) taken.add(f.dest);
    const options = inRange.filter(p => !taken.has(p.id)).map(p => {
      let best = yard, bd = Infinity;
      for (const y of yards.slice(0, 30)) { const d = travelDistance(y, p, zone); if (d < bd) { bd = d; best = y; } }
      return { p, yard: best, s: settleScore(p, best) };
    }).sort((a, b) => b.s - a.s).slice(0, wantColony);
    for (const o of options) {
      order.push([o.yard, 'colony', 1]);
      ai.colonyPlans.push({ yard: o.yard.id, goal: o.p.id, turn: game.turn });
    }
  };
  const satellites = () => {
    if (!P.satellites) return;
    // Threatened worlds first, the most heavily threatened in front.
    const targets = [...threatened.entries()]
      .map(([id, a]) => ({ p: planetById(game, id), a }))
      .filter(x => x.p.pop >= 1)
      .sort((x, y) => y.a - x.a);
    // The bulwark builds its wall even without acute danger.
    if (P.satellites >= 3) {
      for (const p of yards) {
        if (targets.length >= 4) break;
        if (threatened.has(p.id)) continue;
        if (enemyWorlds.some(e => dist(e, p) < 380)) targets.push({ p, a: 0 });
      }
    }
    for (const { p } of targets.slice(0, 4)) {
      const present = p.defenses ? p.defenses.length : 0;
      const room = Math.ceil(2 + p.pop / 6 * P.satellites) - present;
      const n = Math.min(room, P.satellites + (hit ? 1 : 0));
      if (n > 0) order.push([p, 'satellite', n]);
    }
  };
  const transports = () => {
    // Whoever relies on satellites moves them where the danger is now,
    // instead of leaving them at worlds that have gone quiet.
    if (P.satellites < 1 || game.turn < 25 || mine.length < 3) return;
    const have = myFleets.reduce((a, f) => a + f.ships.filter(s => s.cargo).length, 0);
    if (have < (P.satellites >= 3 ? 2 : 1) && surplus(s).length) order.push([yard, 'transport', 1]);
  };
  // The anchor for the fleet: one per so many fighters, built at the
  // largest world that may - repairs then happen at home anyway. It costs
  // more than a turn's budget, so the empire saves up for it: fighters
  // only when threatened, until it is paid for.
  const big = P.capital && war && game.settings.capitalShips !== false ? yards.find(p => !buildLock('destroyer', bot.tech, p.pop)) : null;
  let saving = false;
  if (big) {
    const ships = myFleets.flatMap(f => f.ships);
    const fighters = ships.filter(s => s.type === 'fighter').length;
    const have = ships.filter(s => s.type === 'destroyer').length;
    if (have < Math.floor(fighters / P.capital)) {
      const c = shipCost('destroyer', bot.tech);
      if (c.money <= budget && c.metal <= bot.metal) order.push([big, 'destroyer', 1]);
      else saving = true;
    }
  }
  const warships = () => {
    if (saving && !threatened.size) return;
    // If a lot of money is lying around, it goes into ships instead of being hoarded.
    const hoard = Math.floor(Math.max(0, budget - 10 * fighterCost.money) / fighterCost.money * 0.4);
    const n = Math.min(P.fighters + (camp ? 2 : 0) + hoard, Math.ceil(cap - myShips));
    if (war && n > 0) order.push([shipyard, 'fighter', n]);
    else if (threatened.size) order.push([shipyard, 'fighter', 2]);
  };

  scouts();
  if (hit) satellites();
  // Warlike empires arm first after the start, then they settle.
  if (P.solo === 'prey' && game.turn >= 35 && !oreScarce) { warships(); colonies(); }
  else { colonies(); warships(); }
  if (!hit) satellites();
  transports();

  // Ore is scarcer than money: as long as settling is still planned,
  // something is kept for the colony ships of the next turns.
  const oreReserve = wantColony > 0 ? shipCost('colony', bot.tech).metal * 2 : 0;
  let spentMoney = 0, spentMetal = 0;
  for (const [pl, type, n] of order) {
    const c = shipCost(type, bot.tech);
    const ore = type === 'colony' || type === 'scout' ? bot.metal : bot.metal - oreReserve;
    let k = 0;
    while (k < n
      && spentMoney + c.money <= budget
      && spentMetal + c.metal <= ore) {
      k++; spentMoney += c.money; spentMetal += c.metal;
    }
    if (k > 0) setOrders(game, bot, { build: { planetId: pl.id, type, count: k } });
  }
}

/**
 * Worlds with more satellites than they need: not threatened, and none of
 * the rival's worlds close by. What stands beyond the reserve may go.
 */
export function surplus(s) {
  const { mine, threatened, enemyWorlds } = s;
  const keep = 2;
  return mine.filter(p => !threatened.has(p.id) && (p.defenses?.length || 0) > keep
    && !enemyWorlds.some(e => dist(e, p) < 300))
    .map(p => ({ p, spare: p.defenses.length - keep }));
}

/**
 * Recycle idle fleets at quiet shipyards that consist of hopelessly
 * outdated ships only - they would not get anywhere or win anything.
 */
export function scrap(s) {
  const { bot, myFleets, threatened, game } = s;
  let free = bot.money * 0.2;
  const junk = s => {
    const now = shipStats(s.type, bot.tech);
    return now.range > s.range * 1.6 || now.attack > s.attack * 1.6;
  };
  for (const f of [...myFleets]) {
    if (f.dest != null || f.hole || f.at == null || threatened.has(f.at)) continue;
    const pl = planetById(game, f.at);
    if (!pl || pl.owner !== bot.id || pl.pop < 1) continue;
    if (f.ships.some(s => s.colonists > 0 || s.cargo?.length || !junk(s))) continue;
    const v = recycleValue(f.ships, bot.tech.recycling);
    if (!v || v.money > free) continue;
    if (setOrders(game, bot, { recycle: { fleetId: f.id } })?.error) continue;
    free -= v.money;
    myFleets.splice(myFleets.indexOf(f), 1);
  }
}

/** Refit outdated ships and satellites if the money suffices. */
export function refit(s) {
  const { bot, P, game, mine } = s;
  // Whoever relies on refits does it with every improvement. Everyone else
  // only once range or firepower lag behind by a quarter - otherwise old
  // scouts and fighters stand around that cannot get anywhere anymore.
  let free = bot.money * (P.refits ? 0.25 : 0.15);
  const outdated = s => {
    const now = shipStats(s.type, bot.tech);
    return P.refits || now.range > s.range * 1.25 || now.attack > s.attack * 1.25;
  };
  for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.at != null)) {
    const pl = planetById(game, f.at);
    if (!pl || pl.owner !== bot.id || pl.pop < 1 || f.ships.some(s => s.colonists > 0)) continue;
    if (!f.ships.some(outdated)) continue;
    const k = refitTotal(f.ships, bot.tech);
    if (!k.count || k.count < f.ships.length / 2 || k.money > free) continue;
    setOrders(game, bot, { refit: { fleetId: f.id } });
    free -= k.money;
  }
  for (const pl of mine) {
    if (!P.refits || !pl.defenses || pl.defenses.length < 2 || pl.pop < 1) continue;
    const k = refitTotal(pl.defenses, bot.tech);
    if (k.count < pl.defenses.length / 2 || k.money > free) continue;
    setOrders(game, bot, { refit: { planetId: pl.id } });
    free -= k.money;
  }
}
