// Where the connections come in: the greeting for a new one, every message
// going to the module of its kind, the end of a connection - and the timers
// that keep games and connections in step.
import crypto from 'node:crypto';
import { MAX_PLAYERS } from '../../shared/rules.js';
import { authEnabled } from '../auth.js';
import { DEFAULT_SETTINGS } from '../game/game.js';
import { accountAvatarUrl } from '../profile.js';
import { getUser, privacyOf } from '../userstore.js';
import { accountHandlers, blockedOf, appealView, adminOf, inviterOf, checkConnections } from './account.js';
import { adminHandlers } from './admin.js';
import { conns, send, allowMessage, RATE } from './connections.js';
import { devHandlers, devOf } from './dev.js';
import { friendHandlers, sendFriends, tickFriends } from './friends.js';
import { games, discardIfIdle } from './games.js';
import { lobbyHandlers, openGameList, seatList } from './lobby.js';
import { matchHandlers, connectionLost, checkTurnTimer } from './match.js';
import { newsHandlers, VERSION, RELEASES } from './news.js';
import { rankingHandlers } from './ranking.js';
import { spectatorHandlers, paceSpectatorGames } from './spectators.js';
import { voiceHandlers, voiceOffer, releaseFloor } from './voice.js';

/**
 * Every message type the server knows, and who handles it. A Map, so a type
 * like '__proto__' or 'constructor' finds nothing.
 */
const HANDLERS = new Map(Object.entries({
  ...lobbyHandlers, ...matchHandlers, ...spectatorHandlers, ...voiceHandlers,
  ...friendHandlers, ...accountHandlers, ...newsHandlers, ...rankingHandlers, ...adminHandlers, ...devHandlers
}));
export const MESSAGE_TYPES = [...HANDLERS.keys()];

export function attach(wss) {
  wss.on('connection', (ws, req, session) => {
    const connId = crypto.randomUUID();
    const c = {
      ws, gameId: null, playerId: null, sid: session.token, since: Date.now(),
      account: session.display ?? session.user, accountKey: session.user ?? null,
      profile: { name: null, avatar: null }
    };
    let account = null;
    if (c.accountKey) {
      try { account = getUser(c.accountKey); } catch { /* account file unreadable */ }
      c.profile = { name: account?.nick || c.account, avatar: accountAvatarUrl(c.accountKey) };
      c.handle = account?.handle || null;
    }
    conns.set(connId, c);
    // Blocked: signed in, but the hello carries only the block and the thread
    // with the admins - no games, no seats, no friends.
    const blocked = blockedOf(c) ? (account?.blocked || {}) : null;
    c.blocked = !!blocked;
    send(ws, {
      t: 'hello', maxPlayers: MAX_PLAYERS, defaults: DEFAULT_SETTINGS,
      openGames: blocked ? [] : openGameList(), mySeats: blocked ? [] : seatList(c, connId),
      ...(blocked ? { blocked: { at: blocked.at }, appeal: appealView(c.accountKey) } : {}),
      voice: voiceOffer(),
      profile: { ...c.profile, account: c.accountKey ? c.account : null, handle: c.handle ?? null },
      privacy: c.accountKey ? privacyOf(account) : null,
      admin: adminOf(c),
      inviter: inviterOf(c),
      dev: devOf(c),
      // The ranking needs accounts - without sign-in there is none.
      ranking: authEnabled() && !blocked,
      // Which release's change notes this account has seen - null: none yet.
      // Without an account the browser remembers it.
      version: VERSION, releases: RELEASES, newsSeen: c.accountKey ? (account?.news ?? null) : undefined
    });
    if (c.accountKey && authEnabled() && !blocked) sendFriends(c);

    ws.on('message', (raw) => {
      const conn = conns.get(connId);
      if (conn && !allowMessage(conn)) {
        if (conn.dropped > RATE.dropsBeforeClose) {
          console.warn(`Connection of ${conn.account ?? 'a guest'} closed: message flood`);
          ws.close(1008, 'rate limit');
        }
        return;
      }
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      try { handle(connId, ws, msg); } catch (e) {
        console.error('handler error', msg?.t, e);
        send(ws, { t: 'error', key: 'err.server', params: { detail: e.message } });
      }
    });

    ws.on('close', () => {
      connectionLost(connId);
      conns.delete(connId);
    });
  });
}

function handle(connId, ws, msg) {
  const c = conns.get(connId);
  const game = c.gameId ? games.get(c.gameId) : null;
  // A blocked account may do exactly one thing: write to the admins. Checked
  // first, against the account file as it is now - before anything else
  // reads the message, not even as a sign of life for a game.
  if (msg?.t !== 'appeal' && blockedOf(c)) return send(ws, { t: 'error', key: 'err.blocked' });
  const me = game ? game.players.find(p => p.id === c.playerId) : null;
  // Every message from someone in a game counts as a sign of life for it.
  if (game) game.lastActivity = Date.now();
  HANDLERS.get(msg.t)?.({ c, connId, ws, game, me }, msg);
}

export function startTimers() {
  // Pace of spectator games: nobody drives the turns here.
  setInterval(() => paceSpectatorGames(Date.now()), 100);
  // Turn timer and cleanup
  setInterval(() => {
    const now = Date.now();
    checkConnections();
    tickFriends(now);
    for (const game of games.values()) {
      releaseFloor(game, now);
      checkTurnTimer(game, now);
      discardIfIdle(game, now);
    }
  }, 1000);
}
