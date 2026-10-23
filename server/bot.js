// AI empires with character. They play by the same rules as humans and only
// use worlds they have explored themselves. What sets them apart is their
// personality: it decides where the money goes, whom the empire attacks and
// how it answers when it gets hit itself. On top of that comes a pinch of
// variance per empire, so two conquerors do not play like twins.
import {
  shipCost, shipStats, planetCapacity, terraformFullCost, dist, batteryStats, COMBAT_ROUNDS,
  holeZone, travelDistance, refitTotal, clamp, TECH_FIELDS, TECH_MAX_LEVEL, supplyDistance, cargoOf
} from '../shared/rules.js';
import { setOrders, fleetStats, canReach, planetById, playerById } from './game.js';

// Share of the firepower that really lands over twelve combat rounds - the
// rest is lost to own casualties and overkill on targets already destroyed.
// Calibrated against the simulation: 25 fighters crack a homeworld with 50 million.
const HIT_RATE = 0.72;
// With how few known worlds an empire counts as battered. Against such an
// empire the coup de grâce pays off - with more worlds it keeps slipping
// away through new colonies.
const BATTERED = 3;

/*
 * The personalities. The numbers are inclinations, not laws - endgame
 * pressure pushes all of them towards attack over the course of the game.
 *
 *   research    share of the treasury for research, early / late (percent)
 *   weights     research priorities, early / late
 *   build       share of the rest that goes into ships
 *   terra       share of the rest for terraforming
 *   settlers    colony ships allowed to be under way at the same time
 *   fleet       how fast the fleet may grow with the turns
 *   fighters    fighters per turn
 *   satellites  appetite for satellites at threatened worlds
 *   campaign    'always' | 'retaliation' (only whoever strikes gets it back)
 *               | 'pressure' (only once it has got stuck)
 *   from        campaigns no earlier than this turn
 *   margin      how much superiority must be assembled before striking
 *   solo        what a fleet attacks on its own: 'prey' (anything it can
 *               crack), 'near' (only at its own border),
 *               'carrion' (only the weakened), 'never'
 *   vengeance   how resentful
 *   vsLeader    how much it wants to keep the front-runner small
 *   garrison    stays home when threatened (from 0.3)
 */
const PERSONAS = {
  // Picks a neighbor as rival and rolls it up world by world.
  conqueror: {
    research: [32, 25],
    weights: [{ range: 3, speed: 2, weapons: 3, shields: 2, mini: 2, radical: 1 },
              { range: 2, speed: 2, weapons: 4, shields: 3, mini: 2, radical: 1 }],
    build: 0.72, terra: 0.25, settlers: 3, fleet: 1.5, fighters: 6, satellites: 2,
    campaign: 'always', from: 15, margin: 1.15, solo: 'prey',
    vengeance: 1.5, vsLeader: 0.4, garrison: 0
  },
  // Spreads out, terraforms and defends itself - war only as an answer.
  settler: {
    research: [36, 32],
    weights: [{ range: 4, speed: 2, weapons: 1, shields: 1, mini: 2, radical: 4 },
              { range: 3, speed: 2, weapons: 2, shields: 3, mini: 2, radical: 3 }],
    build: 0.6, terra: 0.45, settlers: 5, fleet: 0.8, fighters: 3, satellites: 2,
    campaign: 'retaliation', from: 45, margin: 1.4, solo: 'near',
    vengeance: 0.8, vsLeader: 0.3, garrison: 0.4
  },
  // Researches a lot, builds little, refits - and then strikes with quality.
  technocrat: {
    research: [50, 40],
    weights: [{ range: 2, speed: 2, weapons: 3, shields: 3, mini: 3, radical: 2 },
              { range: 2, speed: 2, weapons: 4, shields: 4, mini: 3, radical: 1 }],
    build: 0.65, terra: 0.3, settlers: 3, fleet: 0.8, fighters: 4, satellites: 1,
    campaign: 'always', from: 70, margin: 1.3, solo: 'never',
    vengeance: 1.0, vsLeader: 1.0, garrison: 0.2, refits: true
  },
  // Fast packs that raid weakly defended colonies all over the map. It avoids
  // big worlds until there is nothing else left.
  raider: {
    research: [30, 26],
    weights: [{ range: 3, speed: 4, weapons: 2, shields: 1, mini: 2, radical: 1 },
              { range: 3, speed: 4, weapons: 3, shields: 2, mini: 2, radical: 1 }],
    build: 0.75, terra: 0.2, settlers: 2, fleet: 1.4, fighters: 5, satellites: 0,
    campaign: 'pressure', from: 8, margin: 1.0, solo: 'prey',
    vengeance: 1.2, vsLeader: 1.0, garrison: 0, packs: true, scouts: 5
  },
  // Satellites at every border. But not an eternal hedgehog: once the wall
  // is tight, it breaks out with a big fleet.
  bulwark: {
    research: [38, 32],
    weights: [{ range: 2, speed: 1, weapons: 2, shields: 4, mini: 2, radical: 3 },
              { range: 2, speed: 2, weapons: 3, shields: 4, mini: 2, radical: 2 }],
    build: 0.6, terra: 0.45, settlers: 3, fleet: 0.9, fighters: 3, satellites: 3,
    campaign: 'always', from: 100, margin: 1.25, solo: 'near',
    vengeance: 1.0, vsLeader: 0.5, garrison: 0.5, refits: true
  },
  // Waits until others tear each other apart and takes what is left:
  // freshly conquered worlds, broken batteries, empires on the ground.
  vulture: {
    research: [32, 28],
    weights: [{ range: 3, speed: 3, weapons: 2, shields: 2, mini: 2, radical: 2 },
              { range: 3, speed: 3, weapons: 3, shields: 2, mini: 2, radical: 1 }],
    build: 0.7, terra: 0.3, settlers: 2, fleet: 1.2, fighters: 4, satellites: 1,
    campaign: 'always', from: 25, margin: 1.0, solo: 'carrion',
    vengeance: 0.5, vsLeader: 0.8, garrison: 0.1, carrion: true, scouts: 5
  }
};

export function runBot(game, bot) {
  const ai = memory(game, bot);
  const P = ai.p;
  const planets = game.galaxy.planets;
  const zone = holeZone(game.galaxy);
  // Center of the map - the edge where it grows is measured from here.
  const g = game.galaxy;
  const center = g.field ? { x: g.field.cx, y: g.field.cy, z: 0 }
    : { x: (g.minX + g.maxX) / 2, y: (g.minY + g.maxY) / 2, z: 0 };
  // Without a turn limit, endgame pressure grows as if there were 300 turns -
  // otherwise there would be nothing to break up turtling there.
  const maxTurns = game.settings.maxTurns || 300;
  // Count once instead of five times - with a thousand worlds and hundreds
  // of fleets per turn that makes the difference.
  const myFleets = game.fleets.filter(f => f.owner === bot.id);
  const mine = planets.filter(p => p.owner === bot.id);
  const known = planets.filter(p => bot.explored.has(p.id));
  const openWorlds = known.filter(p => !p.owner);
  const enemyWorlds = known.filter(p => p.owner && p.owner !== bot.id);
  const early = game.turn < 30;

  const threatened = perceive(game, bot, ai, mine, enemyWorlds);
  const hit = game.turn - ai.lastHit < 8;

  // --- Endgame pressure: the later, the less patience. Whoever has not moved
  // for a long time loses it faster - this breaks up turtling.
  let pressure = clamp((game.turn / maxTurns - 0.35) / 0.35, 0, 1);
  const quietFrom = Math.max(ai.quietSince, maxTurns * 0.3);
  if (game.turn > quietFrom + 20) pressure = Math.min(1, pressure + clamp((game.turn - quietFrom - 20) / 40, 0, 0.6));
  const margin = P.margin * (1 - 0.3 * pressure);
  // Late in the game even the most cautious one turns aggressive: whoever only
  // struck at the border now takes any prey, and the garrison moves out.
  const solo = pressure > 0.5 && P.solo !== 'carrion' ? 'prey' : P.solo;
  const garrison = P.garrison * (1 - pressure);

  // --- Research: the focus shifts with the course of the game and the situation
  let research = (early ? P.research[0] : P.research[1]) * (1 - 0.35 * pressure);
  const weights = { ...P.weights[early ? 0 : 1] };

  // Free worlds: which ones can the colony ships reach, and which ones are
  // known but out of reach? For the latter, range gets researched.
  const colonyRange = shipStats('colony', bot.tech).range;
  const home = mine.filter(p => p.pop > 0.5);
  const settleable = openWorlds.filter(p => planetCapacity(p) >= 1);
  const inRange = settleable.filter(p => supplyDistance(home, p, zone) <= colonyRange);
  if (settleable.length > inRange.length && inRange.length < 2) weights.range += 3;
  // Ore is the hard limit: when it is scarce, the last chunks go into colonies
  // on ore-rich worlds instead of warships.
  const oreScarce = bot.metal < shipCost('colony', bot.tech).metal * 4;
  if (hit && P.refits) {
    // Got hit? Then upgrade, do not rebuild.
    research += 8; weights.weapons += 2; weights.shields += 2;
  }
  // Maxed-out fields get nothing more - and if everything is maxed out, the
  // money goes entirely into ships instead of research that yields nothing.
  for (const f of TECH_FIELDS) if (bot.tech[f] >= TECH_MAX_LEVEL) weights[f] = 0;
  const open = TECH_FIELDS.some(f => weights[f] > 0);
  research = open ? Math.round(clamp(research, 10, 60)) : 0;
  setOrders(game, bot, { research: { budgetPct: research, weights } });
  const treasury = bot.money * (1 - research / 100);

  // --- Situation report: what does each enemy world cost, and who is down?
  // The defense battery is rebuilt from the population every turn -
  // sieging is pointless, it has to be broken in one move.
  const homeFleet = new Map();
  for (const f of game.fleets) {
    if (f.at === null || f.at === undefined) continue;
    const pl = planets[f.at];
    if (!pl || pl.owner !== f.owner) continue;
    homeFleet.set(f.at, (homeFleet.get(f.at) || 0) + f.ships.reduce((a, s) => a + s.maxHp, 0));
  }
  const defense = new Map();       // world -> hit points that have to go
  const worldsLeft = new Map();    // empire -> how many of its worlds the AI knows
  for (const p of enemyWorlds) {
    const holder = playerById(game, p.owner);
    const bs = holder ? batteryStats(p.pop, holder.tech) : null;
    let hp = bs ? bs.hp : 0;
    if (p.defenses) for (const s of p.defenses) hp += s.maxHp;
    defense.set(p.id, hp + (homeFleet.get(p.id) || 0));
    worldsLeft.set(p.owner, (worldsLeft.get(p.owner) || 0) + 1);
  }

  // How far is each enemy world from the nearest own base?
  const bases = mine.filter(p => p.pop >= 0.5);
  const distance = new Map();
  for (const p of enemyWorlds) {
    let d = Infinity;
    for (const b of bases) { const e = dist(b, p); if (e < d) d = e; }
    distance.set(p.id, d);
  }

  // Who leads? Every empire's tally is visible to everyone in the list.
  const living = game.players.filter(p => p.alive);
  const totalPop = living.reduce((a, p) => a + p.stats.pop, 0) || 1;
  const top = living.slice().sort((a, b) => b.stats.pop - a.stats.pop)[0];
  const leader = top && top.id !== bot.id && top.stats.pop / totalPop > 0.25 && living.length > 2
    ? top.id : null;

  ai.rival = chooseRival(ai, P, enemyWorlds, distance, leader);

  // What is an enemy world worth - from the point of view of exactly this empire?
  const value = p => {
    const o = p.owner;
    let w = p.pop * 1.5 + planetCapacity(p) * 0.5 + 5;
    w *= 1 + Math.min(3, (ai.grudge[o] || 0) * 0.08 * P.vengeance);
    if (o === ai.rival) w *= 1.6;
    if (o === leader) w *= 1 + P.vsLeader;
    if ((worldsLeft.get(o) || 99) <= BATTERED) w *= 1.8;
    if (P.carrion && ai.fresh.has(p.id)) w *= 2.5;
    return w;
  };

  // --- Firepower: what is there, what is coming?
  const fighter = shipStats('fighter', bot.tech);
  const fighterCost = shipCost('fighter', bot.tech);
  const fighterStrike = fighter.attack * COMBAT_ROUNDS * HIT_RATE;
  const strikePower = f => f.ships.reduce((a, s) => a + s.attack, 0) * COMBAT_ROUNDS * HIT_RATE;
  const power = myFleets.reduce((a, f) => a + (fleetStats(f).speed > 0 ? strikePower(f) : 0), 0);
  const reinforcements = Math.max(0, treasury * P.build / fighterCost.money) * fighterStrike * 3;

  const camp = planCampaign();

  // --- Terraforming: the cheapest improvements first
  const candidates = mine
    .map(p => ({ p, cost: terraformFullCost(p, bot.tech.radical) }))
    .sort((a, b) => a.cost - b.cost);
  let left = treasury * P.terra * (early ? 0.8 : 1) * (1 - 0.5 * pressure);
  for (const c of candidates) {
    const give = c.cost > 0 ? Math.min(left, c.cost) : 0;
    setOrders(game, bot, { terraform: { planetId: c.p.id, budget: Math.round(give) } });
    left = Math.max(0, left - give);
  }

  // --- Building
  const yards = mine.filter(p => p.pop >= 1).sort((a, b) => b.pop - a.pop);
  const yard = yards[0];
  const front = frontWorld();
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
  if (yard) build();

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
  // Scouts fly alone - in a bunch they only explore one world instead of several.
  for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.at != null)) {
    if (f.ships.length < 2 || !f.ships.every(s => s.type === 'scout')) continue;
    for (const s of f.ships.slice(1)) setOrders(game, bot, { split: { fleetId: f.id, ships: [s.id] } });
  }
  if (P.packs) formPacks();

  // --- Fleet orders
  // Worlds an own colony ship is already heading for - one is enough, otherwise
  // they all fly to the same world and the rest wander around afterwards.
  const claimed = new Set(myFleets
    .filter(f => f.dest != null && f.ships.some(s => s.colonists > 0)).map(f => f.dest));
  for (const fleet of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.ships.length)) {
    const st = fleetStats(fleet);
    if (st.speed <= 0 || fleet.ships.some(s => s.cargo)) continue;
    const here = fleet.at !== null ? planetById(game, fleet.at) : fleet;
    // Distance for the AI means: the path it really has to fly.
    const far = p => travelDistance(here, p, zone);
    const hasColonist = fleet.ships.some(s => s.colonists > 0);
    const armed = st.attack > 0;
    let target = null;

    if (hasColonist) {
      // Settlers: the best possible free world. Whoever wants to settle also
      // accepts long trips for a good world.
      const greed = P.settlers >= 4 ? 10 : 8;
      target = reachable(game, fleet, settleable.filter(p => p.id !== fleet.at && !claimed.has(p.id)),
        p => planetCapacity(p) * greed - far(p) * 0.1
          + (oreScarce ? Math.min(p.metalReserve, 2000) * 0.05 : 0));
    } else if (!armed) {
      // Scouts: nearest unexplored world. If everything around is known, they
      // head for the edge - only there does the map grow, and the ore with it.
      // Foreign worlds come last: their defenses shoot a scout down. But it
      // still reveals the world on arrival - whoever only knows what lies on
      // their own doorstep finds no targets in the late game.
      const safe = p => !p.owner || p.owner === bot.id;
      const unknown = planets.filter(p => !bot.explored.has(p.id));
      target = reachable(game, fleet, unknown.filter(safe), p => -far(p));
      if (!target) target = reachable(game, fleet, unknown, p => -far(p));
      if (!target && game.settings.expanding !== false) {
        target = reachable(game, fleet, planets.filter(safe), p => dist(p, center));
      }
    } else {
      target = combatTarget(fleet, st, far);
    }
    if (target && target.id !== fleet.at) {
      if (hasColonist) claimed.add(target.id);
      setOrders(game, bot, { move: { fleetId: fleet.id, planetId: target.id } });
    }
  }

  logistics();
  refit();

  bot.ready = true;

  // ------------------------------------------------------------ Helpers

  /** A campaign: one target, one rally point, and only go once it is enough. */
  function planCampaign() {
    let plan = ai.campaign;
    if (plan) {
      const z = planetById(game, plan.targetId);
      const open = z && z.owner && z.owner !== bot.id && bot.explored.has(z.id);
      // Waited too long, or the target arms faster than we can rebuild:
      // drop it and avoid it for a while.
      const tooCostly = open && (defense.get(z.id) || 0) * margin > (power + reinforcements) * 1.5;
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
      for (const p of enemyWorlds) {
        const d0 = distance.get(p.id);
        if (d0 > reach || (ai.avoided[p.id] || 0) > game.turn) continue;
        if (revengeOnly && (ai.grudge[p.owner] || 0) < 2) continue;
        const cost = defense.get(p.id) || 0;
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
    const target = planetById(game, plan.targetId);
    plan.cost = defense.get(target.id) || 0;
    plan.rally = mine.filter(p => p.pop >= 1)
      .sort((a, b) => travelDistance(a, target, zone) - travelDistance(b, target, zone))[0] || null;
    plan.target = target;
    ai.campaign = plan;
    return plan;
  }

  /** Own world closest to the rival or to the nearest enemy. */
  function frontWorld() {
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

  function build() {
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
      const wanted = known.length < planets.length || game.settings.expanding !== false
        ? (P.scouts ? 3 : 2) : 0;
      if (game.turn < 6) order.push([yard, 'scout', 2]);
      else if (underway < wanted && game.turn % 3 === 0) order.push([yard, 'scout', 1]);
    };
    const colonies = () => { if (wantColony > 0) order.push([yard, 'colony', wantColony]); };
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
      if (have < (P.satellites >= 3 ? 2 : 1) && surplus().length) order.push([yard, 'transport', 1]);
    };
    const warships = () => {
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
  function surplus() {
    const keep = 2;
    return mine.filter(p => !threatened.has(p.id) && (p.defenses?.length || 0) > keep
      && !enemyWorlds.some(e => dist(e, p) < 300))
      .map(p => ({ p, spare: p.defenses.length - keep }));
  }

  /**
   * Transporters: fetch spare satellites and bring them to the most heavily
   * threatened world. Loaded at a donor, set down at the target.
   */
  function logistics() {
    const needy = [...threatened.entries()]
      .map(([id, a]) => ({ p: planetById(game, id), a }))
      .filter(x => x.p && x.p.owner === bot.id)
      .sort((x, y) => y.a - x.a);
    const donors = surplus();
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

  /** The raider splits big clusters into packs that go hunting on their own. */
  function formPacks() {
    const size = Math.max(3, Math.round(3 + game.turn / 25));
    const prey = enemyWorlds.filter(p => (defense.get(p.id) || 0) <= size * fighterStrike).length;
    if (prey < 2) return;
    for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.at != null)) {
      const fighterIds = f.ships.filter(s => s.attack > 0).map(s => s.id);
      let packs = Math.min(Math.floor(fighterIds.length / size) - 1, prey - 1, 4);
      while (packs-- > 0) {
        setOrders(game, bot, { split: { fleetId: f.id, ships: fighterIds.splice(0, size) } });
      }
    }
  }

  function combatTarget(fleet, st, far) {
    const strike = st.attack * COMBAT_ROUNDS * HIT_RATE;
    // Garrison: whoever is threatened at home stays where they are needed.
    if (garrison >= 0.3 && fleet.at != null && threatened.has(fleet.at)) return null;
    // Nobody gives up the capital - half the economy would collapse with it.
    if (yard && fleet.at === yard.id && threatened.has(yard.id)) return null;

    if (camp && strike >= camp.cost * margin && canReach(game, fleet, camp.target).ok) return camp.target;

    // On its own: only targets this fleet cracks in one move - the defense
    // battery is back at full strength next turn.
    const crackable = p => (defense.get(p.id) || 0) * margin <= strike;
    let prey = [];
    if (solo === 'prey') prey = enemyWorlds.filter(crackable);
    else if (solo === 'near') prey = enemyWorlds.filter(p => crackable(p) && distance.get(p.id) < 260);
    else if (solo === 'carrion') {
      prey = enemyWorlds.filter(p => crackable(p)
        && (ai.fresh.has(p.id) || (worldsLeft.get(p.owner) || 99) <= BATTERED));
    }
    if (prey.length) {
      const t = reachable(game, fleet, prey,
        p => value(p) / ((defense.get(p.id) || 0) / 100 + 5) - far(p) * 0.03);
      if (t) return t;
    }

    // Nothing to gain: gather - at the campaign, at the border or at home.
    let rally = camp ? camp.rally : null;
    if (!rally && garrison >= 0.3) rally = guard;
    if (!rally) rally = rallyPoint;
    if (rally && rally.id !== fleet.at && canReach(game, fleet, rally).ok) return rally;
    return null;
  }

  /** Refit outdated ships and satellites if the money suffices. */
  function refit() {
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
}

/**
 * The memory of an AI empire - it is created on the first move. The variance
 * depends on the seed and the empire, so a game with the same seed plays out
 * the same way.
 */
function memory(game, bot) {
  if (bot.ai) return bot.ai;
  const template = PERSONAS[bot.persona] || PERSONAS.conqueror;
  let s = 1;
  for (const ch of `${game.settings.seed}:${bot.id}:${bot.name}`) s = (s * 31 + ch.charCodeAt(0)) % 2147483647;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const vary = (v, f) => v * (1 + (rnd() * 2 - 1) * f);
  bot.ai = {
    p: {
      ...template,
      build: vary(template.build, 0.1), terra: vary(template.terra, 0.2),
      fleet: vary(template.fleet, 0.15), margin: vary(template.margin, 0.1),
      from: Math.round(vary(template.from, 0.3)), vengeance: vary(template.vengeance, 0.3)
    },
    grudge: {},             // empire -> how badly it has hurt us
    rival: null,
    campaign: null,
    avoided: {},            // world -> until which turn it is no campaign target
    owned: new Set(),
    holdings: new Map(),    // known enemy world -> owner and population of the previous turn
    fresh: new Map(),       // world -> turn in which it changed owner or collapsed
    lastHit: -99,
    quietSince: game.turn,  // last turn in which a world changed owner
    guard: null             // threatened world the defenders are currently holding
  };
  return bot.ai;
}

/**
 * What has happened since the last move? Lost worlds stir up a grudge
 * against the new owner, approaching battle fleets a little too.
 * Returns the threatened own worlds with the firepower heading for them.
 */
function perceive(game, bot, ai, mine, enemyWorlds) {
  const now = new Set(mine.map(p => p.id));
  for (const id of ai.owned) {
    if (now.has(id)) continue;
    const pl = planetById(game, id);
    if (!pl.owner || pl.owner === bot.id) continue;
    ai.grudge[pl.owner] = (ai.grudge[pl.owner] || 0) + 4 + pl.pop / 4;
    ai.lastHit = game.turn;
    ai.quietSince = game.turn;
  }
  for (const id of now) {
    const before = ai.holdings.get(id);
    if (!ai.owned.has(id) && before && before.owner !== bot.id) ai.quietSince = game.turn;
  }
  ai.owned = now;

  const threatened = new Map();
  for (const f of game.fleets) {
    if (f.owner === bot.id) continue;
    const target = f.dest != null ? f.dest : f.at;
    if (target == null || !now.has(target)) continue;
    const fire = f.ships.reduce((a, s) => a + s.attack, 0);
    if (fire <= 0) continue;
    threatened.set(target, (threatened.get(target) || 0) + fire);
    ai.grudge[f.owner] = (ai.grudge[f.owner] || 0) + 0.3;
  }
  for (const k of Object.keys(ai.grudge)) {
    ai.grudge[k] *= 0.97;
    if (ai.grudge[k] < 0.2) delete ai.grudge[k];
  }

  // At the neighbors: changes of ownership and collapsed population - both
  // mean that there has just been fighting there.
  for (const p of enemyWorlds) {
    const old = ai.holdings.get(p.id);
    if (old && (old.owner !== p.owner || p.pop < old.pop * 0.8)) {
      ai.fresh.set(p.id, game.turn);
      if (old.owner !== p.owner) ai.quietSince = Math.max(ai.quietSince, game.turn - 10);
    }
    ai.holdings.set(p.id, { owner: p.owner, pop: p.pop });
  }
  for (const [id, t] of ai.fresh) if (game.turn - t > 6) ai.fresh.delete(id);
  return threatened;
}

/**
 * The rival: whoever is close, whoever has hurt us, whoever grows too big. Once
 * chosen, it stays the rival for a while - otherwise the empire keeps switching
 * fronts and never gathers enough.
 */
function chooseRival(ai, P, enemyWorlds, distance, leader) {
  const points = {};
  for (const p of enemyWorlds) {
    const d = distance.get(p.id);
    if (d < 600) points[p.owner] = (points[p.owner] || 0) + (600 - d) / 600;
  }
  for (const [o, g] of Object.entries(ai.grudge)) points[o] = (points[o] || 0) + g * P.vengeance;
  if (leader) points[leader] = (points[leader] || 0) + 3 * P.vsLeader;
  if (ai.rival && points[ai.rival] != null) points[ai.rival] += 2;
  let best = null;
  for (const [o, s] of Object.entries(points)) if (!best || s > best.s) best = { o, s };
  return best ? best.o : null;
}

/** Best target that the fleet can actually reach. */
function reachable(game, fleet, arr, score) {
  const sorted = arr.slice().sort((a, b) => score(b) - score(a));
  for (const p of sorted.slice(0, 12)) {
    if (canReach(game, fleet, p).ok) return p;
  }
  return null;
}
