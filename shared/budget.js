// Budget of one turn: what happens to money and metal at the end of the turn.
//
// Recomputes step by step, from the player's view (server/game.js buildView),
// what resolveTurn deducts - in the same order and with the same rules:
// research, shipbuilding, refits, terraforming, and finally income and mining.
// The client uses it for the top bar, the shipyard and the ledger;
// test/budget.js checks it against what the server really books.
//
// What cannot be foreseen here: combat, conquest and new colonies between
// building and settlement - they only change the income. And salvage from a
// wreck (server/spoils.js) is counted for own fleets that stay in its orbit;
// whoever else salvages there may get a share of it.
import {
  TECH_FIELDS, techMaxLevel, techCostToNext, BUILD_TYPES, buildCost, refitCost,
  terraformable, IDEAL, TERRA_COST_PER_DEGREE, TERRA_COST_PER_G, planetIncome, planetMining,
  SHIP_DEFS, salvageRate, travelDistance, holeZone
} from './rules.js';

/**
 * Tech levels after this turn's research. A ship costs according to the
 * levels at build time, and the server researches before building.
 */
export function researchStep(me) {
  const weights = TECH_FIELDS.reduce((a, f) => a + researchWeight(me, f), 0);
  const budget = Math.min(me.money, Math.floor(me.money * me.research.budgetPct / 100));
  const tech = { ...me.tech };
  // Without weights the server releases the budget again.
  if (budget <= 0 || weights <= 0) return { tech, budget: 0, breakthrough: false };
  let breakthrough = false;
  for (const f of TECH_FIELDS) {
    const share = budget * researchWeight(me, f) / weights;
    if (share <= 0) continue;
    let points = (me.techProgress?.[f]?.points || 0) + share;
    while (tech[f] < techMaxLevel(f) && points >= techCostToNext(tech[f])) {
      points -= techCostToNext(tech[f]);
      tech[f]++;
      breakthrough = true;
    }
  }
  return { tech, budget, breakthrough };
}

/**
 * Weight a field really gets: a field at its highest level gets nothing, its
 * share goes to the others instead of disappearing.
 */
export function researchWeight(me, f) {
  return me.tech[f] >= techMaxLevel(f) ? 0 : (me.research.weights[f] || 0);
}

/** Can ships be built or refitted on this world? Same as the server. */
function shipyard(view, planetId) {
  const w = view.planets[planetId];
  return !!w && w.owner === view.you && w.pop >= 1;
}

/** The ships behind a refit order ('f:<fleet>' or 'p:<world>'). */
export function refitShips(view, key) {
  if (key.startsWith('f:')) {
    const f = view.fleets.find(x => x.mine && x.id === key.slice(2));
    return f && f.at != null && shipyard(view, f.at) ? f.ships : [];
  }
  const id = Number(key.slice(2));
  return shipyard(view, id) ? (view.planets[id].defenseShips || []) : [];
}

/**
 * The whole budget. Amounts are unrounded; `planned` is what has been
 * ordered, `booked` is the part of it that can be paid for.
 */
export function forecast(view) {
  const me = view.me;
  const { tech, budget: research, breakthrough } = researchStep(me);
  let money = me.money - research, metal = me.metal;
  const available = { money, metal };

  // We also track what it fails on - "not enough metal" should only show
  // up when it really is the metal that runs short.
  const pot = () => ({ planned: { money: 0, metal: 0, n: 0 }, booked: { money: 0, metal: 0, n: 0 },
    lacksMoney: false, lacksMetal: false });
  const build = pot(), refit = pot();
  const book = (t, c) => {
    t.planned.money += c.money; t.planned.metal += c.metal; t.planned.n++;
    if (money < c.money || metal < c.metal) {
      if (money < c.money) t.lacksMoney = true;
      if (metal < c.metal) t.lacksMetal = true;
      return false;
    }
    money -= c.money; metal -= c.metal;
    t.booked.money += c.money; t.booked.metal += c.metal; t.booked.n++;
    return true;
  };

  // Building: world by world, per type as many as affordable - after the
  // first one that fails, the rest of that type is left over.
  // New ships that fly join the orbit of their world - for the salvage there.
  const launched = new Map();       // world id -> a transporter among them
  for (const [pid, q] of Object.entries(me.builds || {})) {
    if (!shipyard(view, pid)) continue;
    for (const type of BUILD_TYPES) {
      // Fighters cost less at a ready station - as the server builds them.
      const c = buildCost(type, tech, view.planets[pid]);
      let broke = false;
      for (let i = 0; i < (q[type] || 0); i++) {
        if (broke) { build.planned.money += c.money; build.planned.metal += c.metal; build.planned.n++; continue; }
        broke = !book(build, c);
        if (!broke && SHIP_DEFS[type]?.speedMul > 0) {
          launched.set(Number(pid), launched.get(Number(pid)) || !!SHIP_DEFS[type].cargo);
        }
      }
    }
  }
  // Refits: ship by ship; whatever cannot be paid for is skipped.
  for (const key of Object.keys(me.refit || {})) {
    for (const s of refitShips(view, key)) {
      const c = refitCost(s.type, s.tech || {}, tech);
      if (c) book(refit, c);
    }
  }
  // Terraforming: per world up to the set budget, as long as there is money.
  // The new values already count for this turn's income.
  const terra = { planned: 0, booked: 0, worlds: 0 };
  const afterTerra = new Map();
  for (const w of view.planets) {
    if (w.owner !== view.you || !w.terraBudget) continue;
    const ok = terraformable(w, tech.radical);
    const dT = w.temp - IDEAL.temp, dG = w.grav - IDEAL.grav;
    const neededT = ok.temp ? Math.abs(dT) * TERRA_COST_PER_DEGREE : 0;
    const neededG = ok.grav ? Math.abs(dG) * TERRA_COST_PER_G : 0;
    const needed = neededT + neededG;
    if (needed <= 0) continue;
    const target = Math.min(w.terraBudget, needed);
    terra.planned += target; terra.worlds++;
    const budget = Math.min(w.terraBudget, money);
    if (budget <= 0) continue;
    const spent = Math.min(budget, needed);
    money -= spent; terra.booked += spent;
    // Effect as on the server, including rounding
    const shareT = neededT / needed;
    let temp = w.temp, grav = w.grav;
    const sT = spent * shareT, sG = spent - sT;
    if (sT > 0) {
      const deg = sT / TERRA_COST_PER_DEGREE;
      temp += dT > 0 ? -Math.min(deg, Math.abs(dT)) : Math.min(deg, Math.abs(dT));
      temp = Math.round(temp * 10) / 10;
    }
    if (sG > 0) {
      const g = sG / TERRA_COST_PER_G;
      grav += dG > 0 ? -Math.min(g, Math.abs(dG)) : Math.min(g, Math.abs(dG));
      grav = Math.round(grav * 1000) / 1000;
    }
    // At the target the server snaps exactly onto the ideal.
    if (Math.abs(temp - IDEAL.temp) < 0.05 && Math.abs(grav - IDEAL.grav) < 0.002) { temp = IDEAL.temp; grav = IDEAL.grav; }
    afterTerra.set(w.id, { ...w, temp, grav });
  }

  const mine = view.planets.filter(p => p.owner === view.you).map(p => afterTerra.get(p.id) || p);
  const income = mine.reduce((a, p) => a + planetIncome(p), 0);
  const mining = mine.reduce((a, p) => a + planetMining(p), 0);
  const salvage = salvageForecast(view, launched);

  return {
    tech, breakthrough, research, available,
    build, refit, terra, income, mining, salvage: salvage.metal, salvageShared: salvage.shared,
    afterTerra,
    after: { money: money + income, metal: metal + mining + salvage.metal }
  };
}

const allied = (view, id) => id === view.you || (view.me?.allies || []).includes(id);
const armed = f => (f.ships || []).some(s => (SHIP_DEFS[s.type]?.attackMul || 0) > 0);

/**
 * Metal the own fleets salvage this turn: from every wreck in sight with an
 * own fleet in its orbit that stays there, arrives there this turn or is
 * built there (`launched`: world id -> a transporter among the new ships).
 * `shared`: someone else is in such an orbit too, or on the way there, and
 * may take a share.
 */
export function salvageForecast(view, launched = new Map()) {
  let metal = 0, shared = false;
  for (const w of view.planets) {
    const x = salvageAt(view, w, launched);
    metal += x.metal;
    shared ||= x.metal > 0 && x.shared;
  }
  return { metal, shared };
}

/**
 * The salvage at one world this turn, as the server will do it: `metal` for
 * the own fleets, `blocked` under the guns of a hostile world or of an armed
 * foreign fleet in that orbit, `shared` when someone else is there or on the
 * way and may take a share.
 */
export function salvageAt(view, w, launched = new Map()) {
  const none = { metal: 0, blocked: false, shared: false };
  if (!w?.wreck || w.known !== 'live' || !(w.wreck.metal > 0) || !view.you) return none;
  const zone = holeZone(view.galaxy);
  const arrives = f => f.dest === w.id && f.stats?.speed > 0 && travelDistance(f, w, zone) <= f.stats.speed;
  // A chaser whose prey sits in the same orbit stays and fights there.
  const stays = f => !f.chase || view.fleets.find(g => g.id === f.chase)?.at === w.id;
  const orbit = view.fleets.filter(f => f.at === w.id);
  const own = view.fleets.filter(f => f.mine && !f.hole
    && (f.at === w.id ? (f.dest == null || f.dest === w.id) && stays(f) : !f.chase && arrives(f)));
  const blocked = (w.owner && w.pop >= 0.5 && !allied(view, w.owner))
    || orbit.some(f => !allied(view, f.owner) && armed(f));
  if (blocked) return { ...none, blocked: true };
  if (!own.length && !launched.has(w.id)) return none;
  const transport = launched.get(w.id) || own.some(f => f.ships.some(s => SHIP_DEFS[s.type]?.cargo));
  return {
    metal: Math.min(w.wreck.metal, salvageRate(w.wreck.total, transport)), blocked: false,
    shared: view.fleets.some(f => f.owner !== view.you && (f.at === w.id || f.dest === w.id))
  };
}
