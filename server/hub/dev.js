// Dev mode: testing aids in a running game, announced to everyone in it.
import { authEnabled } from '../auth.js';
import { devAliens } from '../aliens.js';
import { devDestroyer } from '../game/shipyard.js';
import { pushLog } from '../game/log.js';
import { devWormholes } from '../wormholes.js';
import { devRadioLine } from '../radio/chatter.js';
import { adminOf } from './account.js';
import { send } from './connections.js';
import { chat, broadcastView, deliverRadio } from './games.js';

// Dev mode (HO_DEV=on): admins get testing aids in the game, e.g. opening a
// wormhole on the spot. Without sign-in there are no admins - then everyone
// gets them, which is fine on a developer's machine and nowhere else.
export const DEV = /^(on|1|true|yes)$/i.test(process.env.HO_DEV || '');

/** May this connection use the dev mode's testing aids? */
export function devOf(c) {
  return DEV && (adminOf(c) || !authEnabled());
}

export const devHandlers = {
  dev({ c, ws, game, me }, msg) {
    // Testing aids in dev mode, for players and spectators alike. Everyone
    // in the game reads in the radio log that somebody stepped in.
    if (!devOf(c)) return send(ws, { t: 'error', key: 'err.notDev' });
    if (!game || game.state !== 'running') return;
    const at = msg.at && ['x', 'y'].every(k => Number.isFinite(msg.at[k]))
      ? { x: msg.at.x, y: msg.at.y, z: Number.isFinite(msg.at.z) ? msg.at.z : 0 } : null;
    const action = String(msg.action || '');
    if (action === 'radio') {
      // A radio line with names, only to whoever asked - nothing changes in the game.
      const line = me && devRadioLine(game, me);
      if (!line) return send(ws, { t: 'notice', key: 'dev.nothing' });
      deliverRadio(game, new Map([[me.id, [line]]]));
      return;
    }
    if (action === 'destroyer') {
      // A destroyer without research and shipyard - only for a player of the game.
      if (!devDestroyer(game, me, Number.isInteger(msg.planetId) ? msg.planetId : null)) {
        return send(ws, { t: 'notice', key: 'dev.nothing' });
      }
      console.log(`Dev: ${c.account ?? 'guest'} - destroyer in game ${game.id}`);
    } else if (action === 'aliens') {
      // Aliens right away: at the selected world, otherwise at one of the
      // player's own - or wherever the next raid would have gone.
      const entries = [];
      if (!devAliens(game, me || null, Number.isInteger(msg.planetId) ? msg.planetId : null, entries)) {
        return send(ws, { t: 'notice', key: 'dev.nothing' });
      }
      // Into the log of the current turn, as if the rift had opened with it.
      const last = game.log[game.log.length - 1];
      if (last && last.turn === game.turn) last.entries.push(...entries);
      else pushLog(game, entries);
      console.log(`Dev: ${c.account ?? 'guest'} - aliens in game ${game.id}`);
    } else {
      if (!devWormholes(game, me || null, action, at)) return send(ws, { t: 'notice', key: 'dev.nothing' });
      console.log(`Dev: ${c.account ?? 'guest'} - wormholes ${action} in game ${game.id}`);
    }
    chat(game, 'System', { key: `chat.dev.${action}`, params: { player: me?.name ?? c.account ?? '?' } });
    broadcastView(game);
  }
};
