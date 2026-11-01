// Before the start: opening a game, joining it, taking a seat back after a
// lost connection or on another device, colors, settings and AI empires -
// and the start itself.
import crypto from 'node:crypto';
import { MAX_PLAYERS, AI_LEVELS } from '../../shared/rules.js';
import { createGame, startGame } from '../game/game.js';
import { buildView } from '../game/intel.js';
import { removePlayer, addPlayer, setPlayerColor, setBotLevel } from '../game/players.js';
import { cleanName, uniqueName, reservedName } from '../profile.js';
import { conns, send } from './connections.js';
import { games, broadcastLobby, broadcastView, chat } from './games.js';
import { watchable, attachSpectator } from './spectators.js';
import { voiceDrop, VOICE, voiceState, voiceEligible, broadcastVoice } from './voice.js';

export function openGameList() {
  return [...games.values()]
    .filter(g => g.state === 'lobby' && g.players.length < MAX_PLAYERS)
    .map(g => ({ id: g.id, host: g.hostName, players: g.players.length }));
}

/**
 * Takes a connection out of the lobby it sits in, before it opens or joins
 * another game - otherwise the old seat would linger as a ghost player.
 */
function leaveLobby(c, connId) {
  const old = c.gameId && games.get(c.gameId);
  if (!old || old.state !== 'lobby') return;
  const p = old.players.find(q => q.id === c.playerId && q.connId === connId);
  if (p) {
    removePlayer(old, p.id);
    if (!old.players.length) games.delete(old.id);
    else broadcastLobby(old);
  }
  c.gameId = null; c.playerId = null;
}

/** The seat of this connection's account in `game`, if it has one. */
function ownSeat(c, game) {
  if (!c.accountKey || game.state === 'over') return null;
  return game.players.find(p => !p.isBot && p.accountKey === c.accountKey) || null;
}

/** Games this account sits in on another connection - to continue them here. */
export function seatList(c, connId) {
  return [...games.values()]
    .map(g => ({ g, p: ownSeat(c, g) }))
    .filter(({ p }) => p && p.connId !== connId)
    .map(({ g }) => ({ id: g.id, state: g.state, turn: g.turn, players: g.players.length }));
}

/**
 * Seats a connection in `p`'s place. On mobiles the new socket often
 * overtakes the close of the old one (the server notices a dead socket
 * late): the old connection lets go of the seat, so its late close does not
 * report the player as lost.
 */
function takeSeat(c, connId, g, p) {
  const old = p.connId && p.connId !== connId && conns.get(p.connId);
  if (old) { old.gameId = null; old.playerId = null; }
  // The voice links ran to the old connection - the new one sets up its own.
  if (p.voice && p.voice.connId !== connId) voiceDrop(g, p);
  const wasAway = !p.connected;
  p.connId = connId; p.connected = true;
  c.gameId = g.id; c.playerId = p.id;
  g.lastActivity = Date.now();
  send(c.ws, { t: 'joined', code: g.id, playerId: p.id, token: p.token });
  if (g.state === 'lobby') broadcastLobby(g);
  // Back is only news to the others if they were told about the loss.
  else if (wasAway) { broadcastView(g); chat(g, 'System', { key: 'chat.back', params: { player: p.name } }); }
  else send(c.ws, { t: 'view', view: buildView(g, p) });
  if (VOICE && g.state === 'running') send(c.ws, voiceState(g));
}

/**
 * With sign-in a player is named as in their profile - that only changes via
 * 'profile', where the server checks that nobody takes the name of another
 * account. Without sign-in the requested name applies. Within a game a
 * duplicate name gets a number.
 */
export function playerName(c, game, wanted, selfId) {
  const name = c.accountKey ? c.profile.name : (cleanName(wanted) || c.profile.name);
  return uniqueName(game, name && !reservedName(name) ? name : 'Captain', selfId);
}

export function sanitizeSettings(s) {
  const out = {};
  if (!s) return out;
  if (Number.isFinite(s.planetsPerPlayer)) out.planetsPerPlayer = Math.min(14, Math.max(3, Math.round(s.planetsPerPlayer)));
  if (Number.isFinite(s.startMoney)) out.startMoney = Math.min(20000, Math.max(200, Math.round(s.startMoney)));
  if (Number.isFinite(s.startMetal)) out.startMetal = Math.min(5000, Math.max(50, Math.round(s.startMetal)));
  if (Number.isFinite(s.turnTimer)) out.turnTimer = Math.min(600, Math.max(0, Math.round(s.turnTimer)));
  // 0 = unlimited: then the game only ends when a single empire is left.
  if (Number.isFinite(s.maxTurns)) out.maxTurns = s.maxTurns === 0 ? 0 : Math.min(999, Math.max(20, Math.round(s.maxTurns)));
  if (typeof s.expanding === 'boolean') out.expanding = s.expanding;
  if (typeof s.voice === 'boolean') out.voice = s.voice;
  if (typeof s.wormholes === 'boolean') out.wormholes = s.wormholes;
  if (typeof s.capitalShips === 'boolean') out.capitalShips = s.capitalShips;
  if (typeof s.alliances === 'boolean') out.alliances = s.alliances;
  if (s.mode === 'classic' || s.mode === 'space') out.mode = s.mode;
  if (s.shape === 'scatter' || s.shape === 'spiral') out.shape = s.shape;
  return out;
}

export const lobbyHandlers = {
  create({ c, connId, ws }, msg) {
    leaveLobby(c, connId);
    const g = createGame('');
    const name = playerName(c, g, msg.name);
    g.hostName = name;
    Object.assign(g.settings, sanitizeSettings(msg.settings));
    games.set(g.id, g);
    const p = addPlayer(g, { name, connId, avatar: c.profile.avatar, account: c.accountKey ? c.account : null, accountKey: c.accountKey });
    p.token = crypto.randomUUID();
    c.gameId = g.id; c.playerId = p.id;
    send(ws, { t: 'joined', code: g.id, playerId: p.id, token: p.token });
    broadcastLobby(g);
  },

  join({ c, connId, ws }, msg) {
    const g = games.get((msg.code || '').toUpperCase());
    if (!g) return send(ws, { t: 'error', key: 'err.gameNotFound' });
    if (g.state !== 'lobby') {
      // A running AI game cannot be played, but it can be watched
      if (!watchable(g)) return send(ws, { t: 'error', key: 'err.gameRunning' });
      attachSpectator(c, connId, g);
      return;
    }
    if (g.players.length >= MAX_PLAYERS) return send(ws, { t: 'error', key: 'err.gameFull' });
    // One seat per account: a second tab must not bring a second empire
    // that plays into the hands of the first.
    if (c.accountKey && g.players.some(p => p.accountKey === c.accountKey)) {
      return send(ws, { t: 'error', key: 'err.alreadySeated' });
    }
    leaveLobby(c, connId);
    g.lastActivity = Date.now();
    const p = addPlayer(g, {
      name: playerName(c, g, msg.name), connId,
      avatar: c.profile.avatar, account: c.accountKey ? c.account : null, accountKey: c.accountKey
    });
    p.token = crypto.randomUUID();
    c.gameId = g.id; c.playerId = p.id;
    send(ws, { t: 'joined', code: g.id, playerId: p.id, token: p.token });
    broadcastLobby(g);
  },

  resume({ c, connId, ws }, msg) {
    const g = games.get((msg.code || '').toUpperCase());
    if (!g) return send(ws, { t: 'error', key: 'err.gameNotFound' });
    const p = g.players.find(p => p.token === msg.token);
    if (!p) {
      // The account still sits in the game, but under a new key: another
      // device took the seat over. Say so instead of a cryptic error.
      if (ownSeat(c, g)) return send(ws, { t: 'takenOver', code: g.id });
      return send(ws, { t: 'error', key: 'err.noSeat' });
    }
    takeSeat(c, connId, g, p);
  },

  takeover({ c, connId, ws }, msg) {
    // Moving to another device: the account picks up its seat without the
    // key the first device holds. Only with sign-in - without accounts
    // nothing proves whose seat it is.
    const g = games.get(String(msg.code || '').toUpperCase());
    if (!g) return send(ws, { t: 'error', key: 'err.gameNotFound' });
    const p = ownSeat(c, g);
    if (!p) return send(ws, { t: 'error', key: 'err.noSeat' });
    if (p.connId !== connId) {
      if (c.gameId !== g.id) leaveLobby(c, connId);
      // A new key, so the old device cannot quietly take it back on its
      // next reconnect - it is told and returns to the start screen.
      p.token = crypto.randomUUID();
      const old = p.connId && conns.get(p.connId);
      if (old) send(old.ws, { t: 'takenOver', code: g.id });
    }
    takeSeat(c, connId, g, p);
  },

  color({ ws, game, me }, msg) {
    if (!game || !me) return;
    // Everyone may pick their own color, the host also those of the AI empires.
    const who = msg.playerId ? game.players.find(p => p.id === msg.playerId) : me;
    const host = game.players[0] === me;
    if (!who || (who !== me && !(who.isBot && host))) return;
    // If another player already wears the color, it is only swapped if the
    // host wants it - otherwise someone loses their color without being asked.
    const wearer = game.players.find(p => p !== who && p.color === msg.color);
    if (wearer && !wearer.isBot && !host) return send(ws, { t: 'error', key: 'lobby.colorTaken' });
    if (setPlayerColor(game, who, String(msg.color || ''))) broadcastLobby(game);
  },

  settings({ c, game }, msg) {
    if (!game || game.players[0]?.id !== c.playerId) return;
    Object.assign(game.settings, sanitizeSettings(msg.settings));
    broadcastLobby(game);
  },

  addBot({ c, game }, msg) {
    if (!game || game.players[0]?.id !== c.playerId) return;
    if (game.players.length >= MAX_PLAYERS) return;
    // 'random': the quick game rolls the level for every opponent.
    const level = msg.level === 'random' ? AI_LEVELS[crypto.randomInt(AI_LEVELS.length)] : msg.level;
    addPlayer(game, { isBot: true, name: msg.name, level });
    broadcastLobby(game);
  },

  level({ c, game }, msg) {
    if (!game || game.players[0]?.id !== c.playerId) return;
    const bot = game.players.find(p => p.id === msg.playerId);
    if (setBotLevel(game, bot, String(msg.level || ''))) broadcastLobby(game);
  },

  kick({ c, game }, msg) {
    if (!game || game.players[0]?.id !== c.playerId) return;
    const victim = game.players.find(p => p.id === msg.playerId);
    if (!victim || victim.id === c.playerId) return;
    if (victim.connId) {
      const vc = conns.get(victim.connId);
      if (vc) { send(vc.ws, { t: 'kicked' }); vc.gameId = null; vc.playerId = null; }
    }
    removePlayer(game, victim.id);
    broadcastLobby(game);
  },

  start({ c, ws, game }) {
    if (!game || game.players[0]?.id !== c.playerId) return;
    if (game.state !== 'lobby') return;
    const r = startGame(game);
    if (r.error) return send(ws, { t: 'error', key: r.error });
    broadcastView(game, { started: true });
    // Chosen in the lobby: the CB radio is open from the first turn.
    if (game.settings.voice && voiceEligible(game)) {
      game.voiceAllowed = true;
      broadcastVoice(game);
    }
  },

  list({ c, connId, ws }) {
    send(ws, { t: 'games', openGames: openGameList(), mySeats: seatList(c, connId) });
  }
};
