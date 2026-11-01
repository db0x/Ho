// Terraforming: a budget per world that moves temperature and gravity
// towards the ideal, as far as the empire's research allows.
import { terraformable, IDEAL, TERRA_COST_PER_DEGREE, TERRA_COST_PER_G } from '../../shared/rules.js';
import { planetById, playerById } from './game.js';

/** The budget a world gets per turn. */
export function orderTerraform(game, player, o) {
  const planet = planetById(game, o.planetId);
  if (planet && planet.owner === player.id) {
    planet.terraBudget = Math.max(0, Math.round(o.budget));
  }
}

export function terraform(game, entries) {
  for (const planet of game.galaxy.planets) {
    if (!planet.owner || !planet.terraBudget) continue;
    const p = playerById(game, planet.owner);
    if (!p || !p.alive) continue;
    const allow = terraformable(planet, p.tech.radical);
    let budget = Math.min(planet.terraBudget, p.money);
    if (budget <= 0) continue;
    const dT = planet.temp - IDEAL.temp, dG = planet.grav - IDEAL.grav;
    const needT = allow.temp ? Math.abs(dT) * TERRA_COST_PER_DEGREE : 0;
    const needG = allow.grav ? Math.abs(dG) * TERRA_COST_PER_G : 0;
    if (needT + needG <= 0) {
      if (!allow.temp || !allow.grav) {
        entries.push({ type: 'warn', playerIds: [p.id], private: p.id, planetId: planet.id,
          key: 'log.terraBlocked', params: { planet: planet.name } });
      }
      continue;
    }
    const spend = Math.min(budget, needT + needG);
    const shareT = needT / (needT + needG);
    const spentT = spend * shareT, spentG = spend - spentT;
    if (spentT > 0) {
      const deg = spentT / TERRA_COST_PER_DEGREE;
      planet.temp += dT > 0 ? -Math.min(deg, Math.abs(dT)) : Math.min(deg, Math.abs(dT));
      planet.temp = Math.round(planet.temp * 10) / 10;
    }
    if (spentG > 0) {
      const g = spentG / TERRA_COST_PER_G;
      planet.grav += dG > 0 ? -Math.min(g, Math.abs(dG)) : Math.min(g, Math.abs(dG));
      planet.grav = Math.round(planet.grav * 1000) / 1000;
    }
    p.money -= spend;
    p.ledger.terra += spend;
    // Running total for the owner's overview; starts over with a new owner.
    planet.terraSpent = (planet.terraSpent || 0) + spend;
    if (Math.abs(planet.temp - IDEAL.temp) < 0.05 && Math.abs(planet.grav - IDEAL.grav) < 0.002) {
      planet.temp = IDEAL.temp; planet.grav = IDEAL.grav;
      planet.terraBudget = 0;
      entries.push({ type: 'terra', playerIds: [p.id], private: p.id, planetId: planet.id,
        key: 'log.terraDone', params: { planet: planet.name } });
    }
  }
}
