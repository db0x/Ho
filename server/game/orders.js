// Orders of a player during a turn. Every message carries one order; it goes
// to the module it belongs to. Principle: only accept what can actually be
// paid for at the end of the turn. There must never be a "build incomplete"
// message - it would only arrive when nothing can be changed anymore.
import { orderUnload, orderSwarm } from './colonization.js';
import { loadOrDrop, splitFleet, mergeFleets } from './fleets.js';
import { orderMove, splitStrands } from './movement.js';
import { orderResearch } from './research.js';
import { orderBuild, renameShip, orderRefit, recycle } from './shipyard.js';
import { orderTerraform } from './terraforming.js';

/**
 * @returns {undefined | {error: string, params?: object} | {recycled: object} | {newFleet: string} | {swarmed: object}}
 *   an error to show, or what the order produced
 */
export function setOrders(game, player, msg) {
  if (game.state !== 'running') return;
  if (msg.research) return orderResearch(game, player, msg.research);
  if (msg.build) return orderBuild(game, player, msg.build);
  if (msg.rename) return renameShip(game, player, msg.rename);
  if (msg.unload) return orderUnload(game, player, msg.unload);
  if (msg.load || msg.drop) return loadOrDrop(game, player, msg.load || msg.drop, !!msg.load);
  if (msg.refit) return orderRefit(game, player, msg.refit);
  if (msg.recycle) return recycle(game, player, msg.recycle);
  if (msg.terraform) return orderTerraform(game, player, msg.terraform);
  if (msg.move) return orderMove(game, player, msg.move);
  if (msg.split) return splitStrands(game, player, msg.split) || splitFleet(game, player, msg.split);
  if (msg.merge) return mergeFleets(game, player, msg.merge);
  if (msg.swarm) return orderSwarm(game, player, msg.swarm);
}
