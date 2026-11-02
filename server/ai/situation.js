// The situation report at the start of every move. Everything later
// decisions build on goes into one object, `s` - the other modules take from
// it what they need.
import {
  holeZone, clamp, shipStats, planetCapacity, supplyDistance, travelDistance, shipCost, batteryStats,
  dist, COMBAT_ROUNDS
} from '../../shared/rules.js';
import { allied } from '../game/diplomacy.js';
import { fleetStats } from '../game/fleets.js';
import { playerById } from '../game/game.js';
import { supplyBases } from '../game/movement.js';
import { friendly, knownAllies } from './diplomacy.js';
import { memory, perceive, review } from './memory.js';
import { chooseRival } from './war.js';

// Share of the firepower that really lands over twelve combat rounds - the
// rest is lost to own casualties and overkill on targets already destroyed.
// Calibrated against the simulation: 25 fighters crack a homeworld with 50 million.
export const HIT_RATE = 0.72;
// With how few known worlds an empire counts as battered. Against such an
// empire the coup de grâce pays off - with more worlds it keeps slipping
// away through new colonies.
export const BATTERED = 3;

/**
 * The situation at the start of the move: own and known worlds, threats,
 * how the last strikes went (hard), endgame pressure, and where colony
 * ships can go. Everything later decisions build on.
 */
export function survey(game, bot) {
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
  // Allies' worlds are no targets - unless notice was given, or this empire
  // is plotting against them (diplomacy.js).
  const enemyWorlds = known.filter(p => p.owner && p.owner !== bot.id && !friendly(game, bot, p.owner));
  const early = game.turn < 30;

  const threatened = perceive(game, bot, ai, mine, enemyWorlds);
  // First look at how the last strikes went, then plan.
  const hard = bot.level === 'hard';
  review(game, bot, ai, hard);
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
  // Free worlds: which ones can the colony ships reach, and which ones are
  // known but out of reach? For the latter, range gets researched.
  const colonyRange = shipStats('colony', bot.tech).range;
  // Supply reaches out from own inhabited worlds and those of allies.
  const home = supplyBases(game, bot.id);
  const settleable = openWorlds.filter(p => planetCapacity(p) >= 1
    && !(hard && (ai.learn.danger[p.id] || 0) > game.turn));
  const inRange = settleable.filter(p => supplyDistance(home, p, zone) <= colonyRange);
  // How good a free world is for a colony ship from `from`. Whoever wants to
  // settle accepts long trips for a good world. Hard: every turn under way is
  // a turn of growth lost - a good world next door beats a slightly better
  // one across the galaxy.
  const greed = P.settlers >= 4 ? 10 : 8;
  const colonySpeed = shipStats('colony', bot.tech).speed || 1;
  const settleScore = (p, from) => hard
    ? planetCapacity(p) * greed / (1 + travelDistance(from, p, zone) / colonySpeed)
    : planetCapacity(p) * greed - travelDistance(from, p, zone) * 0.1;
  // Hard: which colony ship was built at which shipyard for which world - it
  // takes exactly that world once it is done. Plans that never turned into a
  // ship (money ran short) or whose world is gone expire.
  if (hard) {
    ai.colonyPlans = (ai.colonyPlans || []).filter(x => game.turn - x.turn <= 3 && !planets[x.goal]?.owner);
  }
  // Ore is the hard limit: when it is scarce, the last chunks go into colonies
  // on ore-rich worlds instead of warships.
  const oreScarce = bot.metal < shipCost('colony', bot.tech).metal * 4;
  return { game, bot, ai, P, planets, zone, center, myFleets, mine, known, enemyWorlds, early, threatened, hard, hit, pressure, margin, solo, garrison, home, settleable, inRange, settleScore, oreScarce };
}

/**
 * What every known enemy world costs to take and is worth to this empire,
 * who leads, who is the rival - and how much firepower there is.
 */
export function assessEnemies(s) {
  const { game, planets, hard, bot, enemyWorlds, ai, mine, P, myFleets, treasury } = s;
  // --- Situation report: what does each enemy world cost, and who is down?
  // The defense battery is rebuilt from the population every turn -
  // sieging is pointless, it has to be broken in one move.
  const homeFleet = new Map();
  for (const f of game.fleets) {
    // Own guests in an ally's orbit are no defense against us.
    if (f.at === null || f.at === undefined || f.owner === bot.id) continue;
    const pl = planets[f.at];
    // An ally's fleet in the orbit defends the world as well.
    if (!pl || !pl.owner || (pl.owner !== f.owner && !allied(game, pl.owner, f.owner))) continue;
    homeFleet.set(f.at, (homeFleet.get(f.at) || 0) + f.ships.reduce((a, s) => a + s.maxHp, 0));
  }
  // Hard: armed fleets of the owner that can be there within two turns count
  // too - a world is not only defended by what sits in its orbit. Only free
  // fleets or ones already on their way there: a fleet with another target
  // will not turn back.
  const rescuers = new Map();      // empire -> its armed fleets in space or orbit
  if (hard) {
    for (const f of game.fleets) {
      if (f.owner === bot.id || !f.ships.some(s => s.attack > 0)) continue;
      if (!rescuers.has(f.owner)) rescuers.set(f.owner, []);
      rescuers.get(f.owner).push({ f, reach: 2 * fleetStats(f).speed, hp: f.ships.reduce((a, s) => a + s.maxHp, 0) });
    }
  }
  const defense = new Map();       // world -> hit points that have to go
  const worldsLeft = new Map();    // empire -> how many of its worlds the AI knows
  for (const p of enemyWorlds) {
    const holder = playerById(game, p.owner);
    const bs = holder ? batteryStats(p.pop, holder.tech) : null;
    let hp = bs ? bs.hp : 0;
    if (p.defenses) for (const s of p.defenses) hp += s.maxHp;
    // Known allies of the owner come to the rescue too - a public alliance deters.
    const helpers = game.alliances.length ? [p.owner, ...knownAllies(game, bot, p.owner)] : [p.owner];
    for (const r of helpers.flatMap(o => o === bot.id ? [] : rescuers.get(o) || [])) {
      if (r.f.at !== p.id && (r.f.dest == null || r.f.dest === p.id) && dist(r.f, p) <= r.reach) hp += r.hp;
    }
    defense.set(p.id, hp + (homeFleet.get(p.id) || 0));
    worldsLeft.set(p.owner, (worldsLeft.get(p.owner) || 0) + 1);
  }

  // What a world really costs, as far as this empire knows: the estimate,
  // corrected by what earlier strikes against it taught - and for a hard
  // empire by what it learned about the owner anywhere.
  const price = p => {
    const base = (defense.get(p.id) || 0) * (hard ? ai.learn.foe[p.owner] || 1 : 1);
    return Math.max(base, ai.learn.world[p.id]?.need || 0);
  };

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

  ai.rival = chooseRival(ai, P, enemyWorlds, distance, leader, o => friendly(game, bot, o));

  // What is an enemy world worth - from the point of view of exactly this empire?
  const value = p => {
    const o = p.owner;
    let w = p.pop * 1.5 + planetCapacity(p) * 0.5 + 5;
    w *= 1 + Math.min(3, (ai.grudge[o] || 0) * 0.08 * P.vengeance);
    if (o === ai.rival) w *= 1.6;
    if (o === leader) w *= 1 + P.vsLeader;
    if ((worldsLeft.get(o) || 99) <= BATTERED) w *= 1.8;
    if (P.carrion && ai.fresh.has(p.id)) w *= 2.5;
    // The ally it plots against: that is what the fleets gather for.
    if (ai.plot?.id === o) w *= 3;
    return w;
  };

  // --- Firepower: what is there, what is coming?
  const fighter = shipStats('fighter', bot.tech);
  const fighterCost = shipCost('fighter', bot.tech);
  const fighterStrike = fighter.attack * COMBAT_ROUNDS * HIT_RATE;
  const strikePower = f => f.ships.reduce((a, s) => a + s.attack, 0) * COMBAT_ROUNDS * HIT_RATE;
  const power = myFleets.reduce((a, f) => a + (fleetStats(f).speed > 0 ? strikePower(f) : 0), 0);
  const reinforcements = Math.max(0, treasury * P.build / fighterCost.money) * fighterStrike * 3;
  Object.assign(s, {
    worldsLeft, price, bases, distance, value, fighter, fighterCost, fighterStrike, strikePower,
    power, reinforcements
  });
}
