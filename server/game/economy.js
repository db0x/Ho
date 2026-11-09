// The treasury: what an empire can still pay for this turn, and what its
// worlds bring in at the end of it - income, mined metal - and how their
// population grows or shrinks.
import { forecast } from '../../shared/budget.js';
import { TECH_FIELDS, planetIncome, planetMining, planetCapacity, POP_GROWTH } from '../../shared/rules.js';
import { playerById } from './game.js';

/**
 * What this player can pay for at the end of the turn - with exactly the
 * calculation the client shows in the ledger (shared/budget.js). The view for
 * it is limited to what the budget needs.
 */
function budgetFor(game, player) {
  return forecast({
    you: player.id,
    me: {
      money: player.money, metal: player.metal, tech: player.tech, research: player.research,
      techProgress: Object.fromEntries(TECH_FIELDS.map(f => [f, { points: player.researchPoints[f] }])),
      builds: player.orders.builds, refit: player.orders.refit
    },
    planets: game.galaxy.planets.map(w => w.owner === player.id ? { ...w, defenseShips: w.defenses || [] } : { id: w.id, owner: w.owner }),
    fleets: game.fleets.map(f => ({ id: f.id, at: f.at, mine: f.owner === player.id, ships: f.ships }))
  });
}

/** Does everything on order work out - building and refits complete? */
export function affordable(game, player) {
  const h = budgetFor(game, player);
  return h.build.planned.n === h.build.booked.n && h.refit.planned.n === h.refit.booked.n;
}

/** Income and mining of every world, then its population grows or shrinks. */
export function runEconomy(game, entries) {
  for (const p of game.players) { p.income = 0; }
  for (const planet of game.galaxy.planets) {
    if (!planet.owner) continue;
    const p = playerById(game, planet.owner);
    if (!p || !p.alive) { planet.owner = null; planet.station = null; continue; }
    const inc = planetIncome(planet);
    p.money += inc;
    p.income += inc;
    p.ledger.income += inc;
    const mined = planetMining(planet);
    planet.metalReserve = Math.max(0, planet.metalReserve - mined);
    p.metal += mined;
    p.ledger.mined += mined;
    const cap = planetCapacity(planet);
    if (cap < 1) {
      planet.pop = Math.max(0, planet.pop - Math.max(0.4, planet.pop * 0.25));
    } else if (planet.pop > cap) {
      planet.pop = Math.max(cap, planet.pop - (planet.pop - cap) * 0.3);
    } else {
      planet.pop = Math.min(cap, planet.pop + planet.pop * POP_GROWTH * (1 - planet.pop / cap) + 0.05);
    }
    planet.pop = Math.round(planet.pop * 10) / 10;
    if (planet.pop <= 0.1) {
      entries.push({ type: 'lost', playerIds: [p.id], planetId: planet.id,
        key: 'log.colonyLost', params: { planet: planet.name } });
      planet.owner = null; planet.pop = 0; planet.terraBudget = 0; planet.terraSpent = 0; planet.defenses = []; planet.station = null;
    }
  }
  for (const p of game.players) {
    p.money = Math.round(p.money * 10) / 10;
    p.metal = Math.round(p.metal * 10) / 10;
    p.income = Math.round(p.income);
  }
}
