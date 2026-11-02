// The end of a turn: every phase in its order, then the tally of every
// empire, eliminations and the end of the game.
import { cargoOf } from '../../shared/rules.js';
import { wormholeTurn, spotWormholes } from '../wormholes.js';
import { colonize } from './colonization.js';
import { fightBattles } from './combat.js';
import { exposeAlliances, settleDiplomacy, united } from './diplomacy.js';
import { runEconomy } from './economy.js';
import { maybeExpand } from './expansion.js';
import { armTurnTimer } from './game.js';
import { updateVisibility, seesFleet } from './intel.js';
import { pushLog } from './log.js';
import { moveFleets } from './movement.js';
import { research } from './research.js';
import { buildShips } from './shipyard.js';
import { terraform } from './terraforming.js';

export function resolveTurn(game) {
  const entries = [];
  for (const p of game.galaxy.planets) p._orbitLost = false;

  // What is really booked this turn, per item - to verify the client's
  // forecast (shared/budget.js, test/budget.js).
  for (const p of game.players) {
    p.ledger = { research: 0, build: { money: 0, metal: 0 }, refit: { money: 0, metal: 0 }, terra: 0, income: 0, mined: 0 };
  }

  // 1) Research
  research(game, entries);

  // 2) Shipbuilding, then refits
  buildShips(game, entries);

  // 3) Terraforming
  terraform(game, entries);

  // 4) Movement
  const departures = moveFleets(game, entries);

  // 5) Combat, intercepting and repairs
  fightBattles(game, departures, entries);

  // 6) Colonization and invasion
  colonize(game, entries);

  // 7) Economy
  runEconomy(game, entries);

  // 8) Expansion, visibility, statistics, elimination - grow first, then
  // look: otherwise new worlds within scanner range stay blind for a turn.
  maybeExpand(game, entries);
  wormholeTurn(game, entries);
  updateVisibility(game);
  spotWormholes(game, entries);
  // Allied fleets sharing an orbit in peace give a secret alliance away.
  if (game.alliances.length) exposeAlliances(game, entries, seesFleet);
  for (const p of game.players) {
    const planets = game.galaxy.planets.filter(q => q.owner === p.id);
    p.stats.planets = planets.length;
    p.stats.pop = Math.round(planets.reduce((a, q) => a + q.pop, 0) * 10) / 10;
    p.stats.ships = game.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + f.ships.length + cargoOf(f.ships).used, 0)
      + game.galaxy.planets.reduce((a, q) => a + ((q.owner === p.id && q.defenses) ? q.defenses.length : 0), 0);
    // The heights an empire reached - for the statistics (server/stats.js).
    p.stats.peakPlanets = Math.max(p.stats.peakPlanets || 0, p.stats.planets);
    p.stats.peakPop = Math.max(p.stats.peakPop || 0, p.stats.pop);
    // Without a world it is over: range is measured from own inhabited worlds,
    // so leftover ships could not go anywhere anymore. They vanish with the
    // empire instead of standing on the map as ghost fleets. (A colony ship
    // above a free world has already been allowed to land above.)
    if (p.alive && p.stats.planets === 0) {
      p.alive = false;
      p.outAt = game.turn;
      game.fleets = game.fleets.filter(f => f.owner !== p.id);
      p.stats.ships = 0;
      entries.push({ type: 'eliminated', playerIds: [p.id],
        key: 'log.eliminated', params: { player: p.name } });
    }
  }

  // What was agreed during the turn, and alliances whose notice runs out.
  settleDiplomacy(game, entries);

  game.turn++;
  game.lastTurnAt = Date.now();
  for (const p of game.players) p.ready = false;
  pushLog(game, entries);

  const alive = game.players.filter(p => p.alive);
  if (alive.length === 1 && game.players.length > 1) {
    game.state = 'over';
    game.endReason = 'conquest';
    game.winner = alive[0].id;
    pushLog(game, [{ type: 'victory', key: 'log.victory', params: { player: alive[0].name } }]);
  } else if (united(game, alive.map(p => p.id))) {
    // Only allies are left: they rule the galaxy together.
    game.state = 'over';
    game.endReason = 'alliance';
    const ranked = alive.slice().sort((a, b) => b.stats.pop - a.stats.pop);
    game.winner = ranked[0].id;
    game.winners = ranked.map(p => p.id);
    pushLog(game, [{ type: 'victory', key: 'log.jointVictory', params: { players: ranked.map(p => p.name).join(' & ') } }]);
  } else if (game.settings.maxTurns && game.turn > game.settings.maxTurns) {
    game.state = 'over';
    game.endReason = 'turnLimit';
    const best = alive.sort((a, b) => b.stats.pop - a.stats.pop)[0];
    game.winner = best ? best.id : null;
    pushLog(game, [{ type: 'victory',
      key: best ? 'log.turnLimit' : 'log.turnLimitNobody',
      params: { player: best ? best.name : null } }]);
  }
  armTurnTimer(game);
  return entries;
}
