// The own account: its roles (admin, inviter, blocked) asked anew on every
// request, the profile, the own invite links - and for a blocked account the
// one thing left, writing to the admins.
import { appealsOf, cleanAppeal, APPEAL_MAX, unanswered, APPEAL_UNANSWERED, addAppeal } from '../appeals.js';
import { sessionAlive } from '../auth.js';
import { listInvites, createInvite, revokeInvite } from '../invites.js';
import {
  cleanName, nameAllowed, reservedName, parseAvatar, putAccountAvatar, putGuestAvatar
} from '../profile.js';
import { isAdmin, isInviter, isBlocked, setProfile } from '../userstore.js';
import { send, connsOf, conns } from './connections.js';
import { broadcastLobby, broadcastView } from './games.js';
import { playerName } from './lobby.js';

/**
 * Is this connection an admin? Asked anew on every request, so revoking the
 * flag with users.js takes effect without signing out. Without sign-in
 * (HO_AUTH=off) there are no accounts and therefore no admins.
 */
export function adminOf(c) {
  if (!c.accountKey) return false;
  try { return isAdmin(c.accountKey); } catch { return false; }   // account file unreadable
}

/** May this connection create invite links? Admins may; so may accounts with the inviter flag. */
export function inviterOf(c) {
  if (!c.accountKey) return false;
  try { return isInviter(c.accountKey); } catch { return false; }   // account file unreadable
}

/**
 * Is this connection's account blocked? Asked anew on every request, like
 * the admin flag. An unreadable account file counts as blocked: better to
 * refuse than to let someone through who should not be.
 */
export function blockedOf(c) {
  if (!c.accountKey) return false;
  try { return isBlocked(c.accountKey); } catch { return true; }
}

/** The thread with the admins as the blocked player sees it. */
export function appealView(key) {
  let msgs = [];
  try { msgs = appealsOf(key); } catch (e) { console.error(e.message); }
  return msgs.map(m => ({ mine: m.from === 'user', by: m.from === 'admin' ? m.by : null, text: m.text, at: m.at }));
}

/** An inviter's own open invites - nobody else's. */
function ownInvites(c) {
  let invites = [];
  try { invites = listInvites({ account: c.accountKey }); } catch (e) { console.error(e.message); }
  return { t: 'inviteData', now: Date.now(), invites };
}

/** Accept a new side of a profile. Returns an error key or null. */
function changeProfile(c, msg) {
  if (msg.name !== undefined) {
    const name = cleanName(msg.name);
    if (c.accountKey) {
      const problem = nameAllowed(name, c.accountKey);
      if (problem) return problem;
      // Whoever is named like their account again needs no entry of their own.
      setProfile(c.accountKey, { nick: name === c.account ? null : name });
    } else if (name.length < 2) return 'profile.err.short';
    else if (reservedName(name)) return 'profile.err.reserved';
    c.profile.name = name;
  }
  if (msg.avatar !== undefined) {
    let image = null;
    if (msg.avatar !== null) {
      image = parseAvatar(msg.avatar);
      if (image.error) return image.error;
    }
    if (c.accountKey) c.profile.avatar = putAccountAvatar(c.accountKey, image);
    else c.profile.avatar = image ? putGuestAvatar(image, c.profile.avatar?.match(/avatar\/(g-[^?]+)/)?.[1]) : null;
  }
  return null;
}

export const accountHandlers = {
  profile({ c, ws, game, me }, msg) {
    const problem = changeProfile(c, msg);
    if (problem) send(ws, { t: 'error', key: problem });
    send(ws, { t: 'profile', profile: { ...c.profile, account: c.accountKey ? c.account : null, handle: c.handle ?? null } });
    if (problem || !me) return;
    // The image always goes along; renaming only happens before the start -
    // afterwards the old name would already be in the log and chat.
    me.avatar = c.profile.avatar;
    if (game.state === 'lobby') {
      if (msg.name !== undefined) {
        me.name = playerName(c, game, c.profile.name, me.id);
        if (game.players[0] === me) game.hostName = me.name;
      }
      broadcastLobby(game);
    } else broadcastView(game);
  },

  appeal({ c, ws }, msg) {
    if (!blockedOf(c)) return send(ws, { t: 'error', key: 'err.notBlocked' });
    const text = cleanAppeal(msg.text);
    if (!text) return send(ws, { t: 'error', key: 'err.badAppeal', params: { n: APPEAL_MAX } });
    // No flooding the admins: a few messages in a row, then wait for an answer.
    if (unanswered(c.accountKey) >= APPEAL_UNANSWERED) {
      return send(ws, { t: 'error', key: 'err.appealWait', params: { n: APPEAL_UNANSWERED } });
    }
    addAppeal(c.accountKey, 'user', c.account, text);
    console.log(`Blocked account ${c.account} wrote to the admins`);
    // Every tab of the account shows it; the admins see it on their next poll.
    for (const other of connsOf(c.accountKey)) send(other.ws, { t: 'appealData', msgs: appealView(c.accountKey) });
  },

  invites({ c, ws }) {
    if (!inviterOf(c)) return send(ws, { t: 'error', key: 'err.notInviter' });
    send(ws, ownInvites(c));
  },

  inviteCreate({ c, ws }, msg) {
    if (!inviterOf(c)) return send(ws, { t: 'error', key: 'err.notInviter' });
    // As for admins: the token goes back once, the server keeps just a hash.
    const { token, invite } = createInvite(c.account, msg.note, c.accountKey);
    console.log(`${c.account} created invite ${invite.id}${invite.note ? ` (${JSON.stringify(invite.note)})` : ''}`);
    send(ws, { t: 'inviteCreated', token, invite });
    send(ws, ownInvites(c));
  },

  inviteRevoke({ c, ws }, msg) {
    if (!inviterOf(c)) return send(ws, { t: 'error', key: 'err.notInviter' });
    // Only their own - someone else's id simply finds nothing.
    if (revokeInvite(String(msg.id || ''), { account: c.accountKey })) console.log(`${c.account} revoked invite ${msg.id}`);
    send(ws, ownInvites(c));
  }
};

/**
 * Connections whose session ended are closed - and those whose block changed
 * outside the panel start over.
 */
export function checkConnections() {
  for (const [connId, c] of conns) {
    if (!sessionAlive(c.sid)) {
      console.log('Session ended, connection closed:', c.account ?? '?');
      c.ws.close(4001);
      conns.delete(connId);
    }
    // Blocked or unblocked without the panel (users.js, the file by hand):
    // the connection starts over like after the panel - and gives up its seat.
    else if (c.accountKey && blockedOf(c) !== c.blocked) {
      console.log(`Block of ${c.account} changed, connection closed`);
      c.ws.close(4003, 'block changed');
    }
  }
}
