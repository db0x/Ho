// A running game: orders, diplomacy, being done with the turn, pausing,
// extending a finished game, the chat - and leaving it, on purpose or
// because the connection was lost.
import { answerOffers } from '../ai/diplomacy.js';
import {
  offerAlliance, answerOffer, withdrawOffer, endAlliance, announceAlliance
} from '../game/diplomacy.js';
import { hostOf, pauseGame, resumeGame, continueGame, playerById } from '../game/game.js';
import { buildView } from '../game/intel.js';
import { setOrders } from '../game/orders.js';
import { removePlayer } from '../game/players.js';
import { send, conns } from './connections.js';
import { broadcastView, maybeResolve, chat, games, broadcastLobby, record } from './games.js';
import { watchable } from './spectators.js';
import { voiceDrop } from './voice.js';

export const matchHandlers = {
  orders({ ws, game, me }, msg) {
    if (!game || !me || game.state !== 'running') return;
    const r = setOrders(game, me, msg);
    if (r?.error) send(ws, { t: 'notice', key: r.error, params: r.params });
    if (r?.recycled) send(ws, { t: 'recycled', ...r.recycled });
    // Orders change only this player's view - the others see them at the end of the turn.
    send(ws, { t: 'view', view: buildView(game, me) });
  },

  diplomacy({ ws, game, me }, msg) {
    if (!game || !me || game.state !== 'running' || !me.alive) return;
    const other = String(msg.with ?? '');
    const actions = {
      offer: () => offerAlliance(game, me, other, msg.secret === true),
      accept: () => answerOffer(game, me, other, true),
      decline: () => answerOffer(game, me, other, false),
      withdraw: () => withdrawOffer(game, me, other),
      end: () => endAlliance(game, me, other),
      announce: () => announceAlliance(game, me, other)
    };
    if (!Object.hasOwn(actions, msg.action)) return;
    const r = actions[msg.action]();
    if (r?.error) send(ws, { t: 'notice', key: r.error });
    // An AI does not keep anyone waiting - it answers right away.
    const bot = playerById(game, other);
    if (bot?.isBot && bot.alive) answerOffers(game, bot);
    // Alliances change what everyone sees: shared sight, a public announcement.
    broadcastView(game);
  },

  ready({ game, me }, msg) {
    if (!game || !me || game.state !== 'running') return;
    me.ready = msg.value !== false;
    broadcastView(game);
    maybeResolve(game);
  },

  pause({ ws, game, me }, msg) {
    // The host holds the game for everyone (someone is at the door): the
    // timer freezes and no turn resolves. Orders and chat keep working.
    if (!game || !me || game.state !== 'running') return;
    if (hostOf(game) !== me) return send(ws, { t: 'error', key: 'err.notHost' });
    const changed = msg.value ? pauseGame(game, me) : resumeGame(game);
    if (!changed) return;
    chat(game, 'System', { key: msg.value ? 'chat.paused' : 'chat.resumed', params: { player: me.name } });
    broadcastView(game);
    maybeResolve(game);
  },

  continue({ ws, game, me }, msg) {
    // Extends a finished game by more turns instead of ending it - the
    // host's call, right after the game ended.
    if (!game || !me || game.state !== 'over') return;
    if (hostOf(game) !== me) return send(ws, { t: 'error', key: 'err.notHostContinue' });
    if (!continueGame(game, msg.turns)) return;
    chat(game, 'System', { key: 'chat.continued', params: { player: me.name } });
    broadcastView(game);
  },

  leave({ c, connId, game, me }) {
    if (!game) return;
    // Spectators simply sign off
    if (game.spectators.delete(connId)) {
      c.gameId = null;
      if (!game.spectators.size && watchable(game)) games.delete(game.id);
      return;
    }
    if (!me) return;
    if (game.state === 'lobby') {
      removePlayer(game, me.id);
      if (!game.players.length) games.delete(game.id);
      else broadcastLobby(game);
    } else {
      // The empire stays and is skipped - otherwise the game would fall
      // apart for everyone else.
      me.connected = false;
      me.connId = null;
      me.token = null;
      // Leaving an empire that is still in the game is giving up (server/stats.js).
      if (game.state === 'running' && me.alive) me.leftAt = game.turn;
      voiceDrop(game, me);
      chat(game, 'System', { key: 'chat.left', params: { player: me.name } });
      broadcastView(game);
      maybeResolve(game);
    }
    c.gameId = null; c.playerId = null;
    // If nobody is playing anymore, the game can go - as given up.
    if (!game.players.some(p => p.connected) && !game.spectators.size) {
      if (game.state === 'running') record(game, { abandoned: true });
      games.delete(game.id);
    }
  },

  chat({ game, me }, msg) {
    if (!game || !me) return;
    chat(game, me.name, String(msg.text || '').slice(0, 200), me.id);
  }
};

/** A connection closed: only the connection holding a seat gives it up. */
export function connectionLost(connId) {
  const c = conns.get(connId);
  if (c?.gameId) {
    const game = games.get(c.gameId);
    if (game?.spectators.delete(connId) && !game.spectators.size && watchable(game)) {
      games.delete(game.id);           // nobody is watching anymore
    }
    const p = game?.players.find(p => p.id === c.playerId);
    // Only the connection holding the seat may give it up.
    if (p && p.connId === connId) {
      p.connected = false;
      voiceDrop(game, p);
      if (game.state === 'lobby') {
        removePlayer(game, p.id);
        if (!game.players.length) games.delete(game.id);
        else broadcastLobby(game);
      } else {
        chat(game, 'System', { key: 'chat.lost', params: { player: p.name } });
        broadcastView(game);
        maybeResolve(game);
      }
    }
  }
}

/** The turn timer ran out: whoever is not done yet is done now. */
export function checkTurnTimer(game, now) {
  if (game.state === 'running' && !game.paused && game.turnDeadline && now >= game.turnDeadline) {
    for (const p of game.players) p.ready = true;
    maybeResolve(game);
  }
}
