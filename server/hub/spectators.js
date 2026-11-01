// Watching games: AI-only games anyone may watch at a pace they set, and
// admins watching any running game.
import crypto from 'node:crypto';
import { MAX_PLAYERS, AI_LEVELS } from '../../shared/rules.js';
import { createGame, startGame } from '../game/game.js';
import { buildSpectatorView } from '../game/intel.js';
import { addPlayer } from '../game/players.js';
import { adminOf } from './account.js';
import { send } from './connections.js';
import { games, broadcastView, maybeResolve } from './games.js';
import { sanitizeSettings } from './lobby.js';

/** A game that may be watched: AI only, no human empire. */
export function watchable(game) {
  return !!game && game.players.length > 0 && game.players.every(p => p.isBot);
}

/**
 * The spectator view, plus who controls the pace: in an AI-only game the
 * spectators drive the turns; in a game with humans (watched by an admin)
 * the players do, so there is no pace to hand out.
 */
export function spectatorView(game) {
  const view = buildSpectatorView(game);
  if (!watchable(game)) view.pace = null;
  return view;
}

/** Turns a connection into a spectator of `game`. */
export function attachSpectator(c, connId, game) {
  c.gameId = game.id; c.playerId = null;
  game.spectators.add(connId);
  if (watchable(game)) game.nextTurnAt = Date.now() + game.pace.ms;
  send(c.ws, { t: 'watching', code: game.id });
  send(c.ws, { t: 'view', view: spectatorView(game), started: true });
}

export const spectatorHandlers = {
  watch({ c, connId, ws }, msg) {
    let g = msg.code ? games.get(String(msg.code).toUpperCase()) : null;
    if (msg.code && !g) return send(ws, { t: 'error', key: 'err.gameNotFound' });
    if (!g) {
      // Set up a new AI-only game and start it right away
      const bots = Math.min(MAX_PLAYERS, Math.max(2, Math.round(msg.bots) || 6));
      g = createGame('AI game');
      Object.assign(g.settings, sanitizeSettings(msg.settings));
      games.set(g.id, g);
      // Levels rolled per empire, as in the quick game - there is something to compare.
      for (let i = 0; i < bots; i++) addPlayer(g, { isBot: true, level: AI_LEVELS[crypto.randomInt(AI_LEVELS.length)] });
      const r = startGame(g);
      if (r.error) { games.delete(g.id); return send(ws, { t: 'error', key: r.error }); }
    }
    if (!watchable(g)) return send(ws, { t: 'error', key: 'err.watchBotsOnly' });
    attachSpectator(c, connId, g);
  },

  adminWatch({ c, connId, ws, game }, msg) {
    // Admins may watch any game that has a map - including games with
    // humans, which nobody else can watch.
    if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
    const g = games.get(String(msg.code || '').toUpperCase());
    if (!g) return send(ws, { t: 'error', key: 'err.gameNotFound' });
    if (g.state === 'lobby') return send(ws, { t: 'error', key: 'err.notStarted' });
    // Watching without fog while playing in the same game would be cheating -
    // for admins too.
    if (g.state === 'running' && g.players.some(p => p.accountKey === c.accountKey && p.alive)) {
      return send(ws, { t: 'error', key: 'err.watchOwnGame' });
    }
    attachSpectator(c, connId, g);
    console.log(`Admin ${c.account} watches game ${g.id}`);
  },

  pace({ connId, game }, msg) {
    // Only AI games run at the spectators' pace - never one with humans.
    if (!game || !game.spectators.has(connId) || !watchable(game)) return;
    if (typeof msg.paused === 'boolean') game.pace.paused = msg.paused;
    if (Number.isFinite(msg.ms)) game.pace.ms = Math.min(10000, Math.max(120, Math.round(msg.ms)));
    game.nextTurnAt = Date.now() + (game.pace.paused ? 0 : game.pace.ms);
    broadcastView(game);
  },

  step({ connId, game }) {
    if (!game || !game.spectators.has(connId) || game.state !== 'running' || !watchable(game)) return;
    maybeResolve(game);
  }
};

/** Pace of spectator games: nobody drives the turns here. */
export function paceSpectatorGames(now) {
for (const game of games.values()) {
  // An admin watching a game with humans must not make it run by itself.
  if (game.state !== 'running' || !game.spectators.size || game.pace.paused || !watchable(game)) continue;
  if (now < game.nextTurnAt) continue;
  game.nextTurnAt = now + game.pace.ms;
  // A watched AI game is alive while it runs - unlike a timer game, where
  // turns keep resolving even after every human has gone.
  if (maybeResolve(game)) game.lastActivity = now;
}
}
