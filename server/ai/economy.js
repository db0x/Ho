// Where the money goes besides ships: research and terraforming.
import {
  TECH_FIELDS, techMaxLevel, clamp, terraformFullCost, terraformable, IDEAL, planetCapacity
} from '../../shared/rules.js';
import { setOrders } from '../game/orders.js';

/** How much goes into research, and into which fields. */
export function planResearch(s) {
  const { early, P, pressure, settleable, inRange, hit, bot, game } = s;
  // --- Research: the focus shifts with the course of the game and the situation
  let research = (early ? P.research[0] : P.research[1]) * (1 - 0.35 * pressure);
  const weights = { ...P.weights[early ? 0 : 1] };
  if (settleable.length > inRange.length && inRange.length < 2) weights.range += 3;
  if (hit && P.refits) {
    // Got hit? Then upgrade, do not rebuild.
    research += 8; weights.weapons += 2; weights.shields += 2;
  }
  // Maxed-out fields get nothing more - and if everything is maxed out, the
  // money goes entirely into ships instead of research that yields nothing.
  for (const f of TECH_FIELDS) if (bot.tech[f] >= techMaxLevel(f)) weights[f] = 0;
  const open = TECH_FIELDS.some(f => weights[f] > 0);
  research = open ? Math.round(clamp(research, 10, 60)) : 0;
  setOrders(game, bot, { research: { budgetPct: research, weights } });
  Object.assign(s, { research });
}

/** Terraforming budgets, world by world. */
export function terraform(s) {
  const { mine, bot, hard, treasury, P, early, pressure, game } = s;
  // --- Terraforming: the cheapest improvements first
  const candidates = mine
    .map(p => ({ p, cost: terraformFullCost(p, bot.tech.radical) }))
    .sort((a, b) => a.cost - b.cost);
  // Hard: not the cheapest first, but the most people per credit - the
  // capacity a world gains once it is brought to the ideal.
  if (hard) {
    const gain = c => {
      const ok = terraformable(c.p, bot.tech.radical);
      const after = { ...c.p, temp: ok.temp ? IDEAL.temp : c.p.temp, grav: ok.grav ? IDEAL.grav : c.p.grav };
      return planetCapacity(after) - planetCapacity(c.p);
    };
    candidates.sort((a, b) => (b.cost ? gain(b) / b.cost : 0) - (a.cost ? gain(a) / a.cost : 0));
  }
  let left = treasury * P.terra * (early ? 0.8 : 1) * (1 - 0.5 * pressure);
  for (const c of candidates) {
    const give = c.cost > 0 ? Math.min(left, c.cost) : 0;
    setOrders(game, bot, { terraform: { planetId: c.p.id, budget: Math.round(give) } });
    left = Math.max(0, left - give);
  }
}
