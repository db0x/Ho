// Research: the share of the treasury it gets, how it is spread over the
// fields, and the breakthroughs at the end of the turn.
import { researchWeight } from '../../shared/budget.js';
import { clamp, TECH_FIELDS, techMaxLevel, techCostToNext } from '../../shared/rules.js';
import { affordable } from './economy.js';

/**
 * Share and weights. Research is deducted first. If it takes the money away
 * from the orders (or a breakthrough makes the ships more expensive), the
 * highest share at which everything works out applies - build orders take
 * precedence.
 */
export function orderResearch(game, player, r) {
  const before = { budgetPct: player.research.budgetPct, weights: { ...player.research.weights } };
  if (typeof r.budgetPct === 'number') player.research.budgetPct = clamp(Math.round(r.budgetPct), 0, 100);
  if (r.weights) {
    for (const f of TECH_FIELDS) {
      if (typeof r.weights[f] === 'number') player.research.weights[f] = clamp(Math.round(r.weights[f]), 0, 10);
    }
  }
  // Research is deducted first. If it takes the money away from the orders
  // (or a breakthrough makes the ships more expensive), the highest share
  // at which everything works out applies - build orders take precedence.
  if (!affordable(game, player)) {
    const wanted = player.research.budgetPct;
    while (player.research.budgetPct > 0 && !affordable(game, player)) player.research.budgetPct--;
    if (!affordable(game, player)) player.research = { ...player.research, ...before };   // should not happen
    else if (player._researchCapped !== game.turn && player.research.budgetPct < wanted) {
      player._researchCapped = game.turn;      // say it once per turn, not on every slider step
      return { error: 'notice.researchCapped', params: { pct: player.research.budgetPct } };
    }
  }
}

/** The research budget goes into the fields; enough points make the next level. */
export function research(game, entries) {
  for (const p of game.players) {
    if (!p.alive) continue;
    const budget = Math.min(p.money, Math.floor(p.money * p.research.budgetPct / 100));
    if (budget <= 0) continue;
    const total = TECH_FIELDS.reduce((a, f) => a + researchWeight(p, f), 0);
    if (total <= 0) continue;
    p.money -= budget;
    p.ledger.research = budget;
    const before = { ...p.tech };
    const advanced = [];
    for (const f of TECH_FIELDS) {
      const share = budget * researchWeight(p, f) / total;
      if (share <= 0) continue;
      p.researchPoints[f] += share;
      while (p.tech[f] < techMaxLevel(f) && p.researchPoints[f] >= techCostToNext(p.tech[f])) {
        p.researchPoints[f] -= techCostToNext(p.tech[f]);
        p.tech[f]++;
      }
      // Against the levels before this turn - the very first breakthrough counts too.
      if (p.tech[f] > before[f]) advanced.push({ field: f, level: p.tech[f] });
    }
    if (advanced.length) {
      entries.push({ type: 'tech', playerIds: [p.id], private: p.id,
        key: 'log.breakthrough', params: { fields: advanced } });
    }
  }
}
