// The admin lobby: the overview of all games and accounts, and what admins
// do with them - ending games, announcements, invites, roles, blocking and
// deleting accounts, and answering blocked players.
import * as friends from '../friends.js';
import { allAppeals, cleanAppeal, APPEAL_MAX, addAppeal, forgetAppeals } from '../appeals.js';
import { forget as forgetStats } from '../stats.js';
import { revoke } from '../auth.js';
import { adminGameView } from '../game/game.js';
import { listInvites, createInvite, revokeInvite } from '../invites.js';
import { accountAvatarUrl } from '../profile.js';
import { getUser, listUsers, setInviter, setBlocked, deleteUser } from '../userstore.js';
import { adminOf, inviterOf, appealView } from './account.js';
import { send, conns, connsOf } from './connections.js';
import { games, closeGame } from './games.js';

/**
 * The checks an admin action on another account goes through: it has to
 * exist, and it must not be an admin - that includes oneself. Admins are
 * taken off the flag on the command line first. Returns the account key,
 * or null after sending the error.
 */
function targetAccount(ws, name) {
  const key = String(name || '').trim().toLowerCase();
  const user = key ? getUser(key) : null;
  if (!user) { send(ws, { t: 'error', key: 'auth.cli.unknown', params: { user: key } }); return null; }
  if (user.admin) { send(ws, { t: 'error', key: 'err.targetAdmin' }); return null; }
  return key;
}

/** Everything the admin lobby shows: all games and all accounts. */
function adminOverview() {
  const online = new Map();          // account -> its open connections
  for (const c of conns.values()) {
    if (!c.accountKey) continue;
    if (!online.has(c.accountKey)) online.set(c.accountKey, []);
    online.get(c.accountKey).push({ since: c.since, game: c.gameId });
  }
  let accounts = [], invites = [], appeals = {};
  try { accounts = listUsers(); } catch { /* account file unreadable - show the games anyway */ }
  try { invites = listInvites(); } catch (e) { console.error(e.message); }
  try { appeals = allAppeals(); } catch (e) { console.error(e.message); }
  return {
    now: Date.now(),
    games: [...games.values()].map(adminGameView)
      .sort((a, b) => (a.state === 'running' ? 0 : 1) - (b.state === 'running' ? 0 : 1) || a.created - b.created),
    accounts: accounts.map(u => {
      const sessions = online.get(u.name) || [];
      return {
        name: u.name, handle: u.handle, display: u.display, nick: u.nick, admin: u.admin, inviter: u.inviter,
        blocked: u.blocked, appeal: appeals[u.name] || [],
        mustChange: u.mustChange,
        invitedBy: u.invitedBy,
        avatar: u.avatar ? accountAvatarUrl(u.name) : null,
        created: u.created, changed: u.changed,
        online: sessions.length > 0,
        onlineSince: sessions.length ? Math.min(...sessions.map(s => s.since)) : null,
        games: [...new Set(sessions.map(s => s.game).filter(Boolean))]
      };
    }),
    invites
  };
}

/**
 * Ends a game from outside (admin): everyone in it - players and spectators -
 * is told and sent back to the start screen, then the game is gone. Their
 * seat tokens die with it, so nobody can resume into it.
 */
function endGame(game, by) {
  closeGame(game, { key: 'notice.endedByAdmin' });
  console.log(`Game ${game.id} ended by admin ${by} (state ${game.state}, turn ${game.turn})`);
}

const ADMIN_MSG_MAX = 500;

/**
 * An announcement from an admin (e.g. upcoming downtime) to everyone
 * currently connected to a game - players and spectators. The text is the
 * admin's own words, so it travels as text, not as a catalog key.
 * Returns the number of connections it reached.
 */
function adminMessage(game, from, text) {
  const note = { t: 'adminMsg', from, text, at: Date.now(), code: game.id };
  let delivered = 0;
  const ids = [...game.players.map(p => p.connId).filter(Boolean), ...game.spectators];
  for (const id of ids) {
    const c = conns.get(id);
    if (!c || c.gameId !== game.id) continue;
    send(c.ws, note);
    delivered++;
  }
  console.log(`Admin ${from} to game ${game.id} (${delivered} connections): ${JSON.stringify(text)}`);
  return delivered;
}

export const adminHandlers = {
  admin({ c, ws }) {
    if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
    send(ws, { t: 'adminData', ...adminOverview() });
  },

  adminEnd({ c, ws }, msg) {
    if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
    const g = games.get(String(msg.code || '').toUpperCase());
    if (!g) return send(ws, { t: 'error', key: 'err.gameNotFound' });
    endGame(g, c.account);
    send(ws, { t: 'adminData', ...adminOverview() });
  },

  adminMsg({ c, ws }, msg) {
    if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
    const g = games.get(String(msg.code || '').toUpperCase());
    if (!g) return send(ws, { t: 'error', key: 'err.gameNotFound' });
    const text = String(msg.text ?? '').trim();
    if (!text || text.length > ADMIN_MSG_MAX) return send(ws, { t: 'error', key: 'err.badAdminMessage', params: { n: ADMIN_MSG_MAX } });
    const delivered = adminMessage(g, c.account, text);
    send(ws, { t: 'adminMsgSent', code: g.id, delivered });
  },

  adminInvite({ c, ws }, msg) {
    if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
    // The token goes back to this admin only, once - the server keeps just a hash.
    const { token, invite } = createInvite(c.account, msg.note, c.accountKey);
    console.log(`Admin ${c.account} created invite ${invite.id}${invite.note ? ` (${JSON.stringify(invite.note)})` : ''}`);
    send(ws, { t: 'adminInviteCreated', token, invite });
    send(ws, { t: 'adminData', ...adminOverview() });
  },

  adminRevokeInvite({ c, ws }, msg) {
    if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
    if (revokeInvite(String(msg.id || ''))) console.log(`Admin ${c.account} revoked invite ${msg.id}`);
    send(ws, { t: 'adminData', ...adminOverview() });
  },

  adminInviter({ c, ws }, msg) {
    if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
    // Taking the flag away also ends that account's open invites (invites.js).
    const name = String(msg.name || '');
    let r;
    try { r = setInviter(name, !!msg.on); } catch (e) {
      if (e.message !== 'auth.cli.unknown') throw e;
      return send(ws, { t: 'error', key: e.message, params: { user: name } });
    }
    console.log(`Admin ${c.account} ${r.inviter ? 'granted' : 'revoked'} the inviter role of ${r.name}`);
    // The account's open connections learn it right away - no new sign-in needed.
    for (const other of conns.values()) {
      if (other.accountKey === r.name && !other.blocked) send(other.ws, { t: 'roles', admin: adminOf(other), inviter: inviterOf(other) });
    }
    send(ws, { t: 'adminData', ...adminOverview() });
  },

  adminBlock({ c, ws }, msg) {
    if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
    const key = targetAccount(ws, msg.name);
    if (!key) return;
    const r = setBlocked(key, !!msg.on, c.account);
    console.log(`Admin ${c.account} ${r.blocked ? 'blocked' : 'unblocked'} ${key}`);
    // Their open connections start over: the next hello says what applies
    // now. Closing also gives up a seat in a game, as any lost connection does.
    for (const other of connsOf(key)) other.ws.close(4003, r.blocked ? 'blocked' : 'unblocked');
    send(ws, { t: 'adminData', ...adminOverview() });
  },

  adminAppeal({ c, ws }, msg) {
    if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
    const key = targetAccount(ws, msg.name);
    if (!key) return;
    const text = cleanAppeal(msg.text);
    if (!text) return send(ws, { t: 'error', key: 'err.badAppeal', params: { n: APPEAL_MAX } });
    addAppeal(key, 'admin', c.account, text);
    for (const other of connsOf(key)) send(other.ws, { t: 'appealData', msgs: appealView(key) });
    send(ws, { t: 'adminData', ...adminOverview() });
  },

  adminDelete({ c, ws }, msg) {
    if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
    const key = targetAccount(ws, msg.name);
    if (!key) return;
    // As when players delete themselves: profile image, friendships and
    // messages go along; their sessions end, the cleanup loop closes the sockets.
    deleteUser(key);
    try { friends.forget(key); } catch (e) { console.error('Friends cleanup failed:', e.message); }
    try { forgetAppeals(key); } catch (e) { console.error(e.message); }
    try { forgetStats(key); } catch (e) { console.error('Stats cleanup failed:', e.message); }
    revoke(key);
    console.log(`Admin ${c.account} deleted account ${key}`);
    send(ws, { t: 'adminData', ...adminOverview() });
  }
};
