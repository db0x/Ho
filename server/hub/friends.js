// Friends between accounts, as the connections see them: who is online and
// in which game, requests, and the end-to-end encrypted messages. Stored in
// server/friends.js; this is where they meet the connections.
import * as friends from '../friends.js';
import { authEnabled } from '../auth.js';
import { accountAvatarUrl } from '../profile.js';
import { getUser, userByHandle } from '../userstore.js';
import { conns, send } from './connections.js';
import { games } from './games.js';

// Looking up handles is limited per connection: a handle is no secret, but
// nobody should be able to walk through all of them.
const LOOKUPS = { perMinute: 12 };

/** What others see of an account: never the sign-in name, only the handle. */
function publicOf(key) {
  const u = getUser(key);
  if (!u?.handle) return null;
  return { handle: u.handle, name: u.nick || u.display || key, avatar: accountAvatarUrl(key) };
}

/**
 * 'playing' with a seat in a game, 'watching' as a spectator, 'online' when
 * connected, else 'offline'. With several devices the busiest one counts.
 * Whoever hides their status is always offline to the others.
 */
const STATUS_RANK = ['offline', 'online', 'watching', 'playing'];
function statusOf(key) {
  let status = 'offline';
  if (getUser(key)?.invisible) return status;
  for (const c of conns.values()) {
    if (c.accountKey !== key) continue;
    const s = !c.gameId || !games.has(c.gameId) ? 'online' : c.playerId != null ? 'playing' : 'watching';
    if (STATUS_RANK.indexOf(s) > STATUS_RANK.indexOf(status)) status = s;
  }
  return status;
}

function friendsView(key) {
  const links = friends.linksOf(key);
  const people = (list, extra) => list.map(l => {
    const p = publicOf(l.name);
    return p && { ...p, ...extra(l) };
  }).filter(Boolean);
  // The keys to encrypt with: the friend's public one, and our own - a
  // browser whose key no longer matches it opens nothing.
  const lastAt = (name) => friends.history(key, name).at(-1)?.at || 0;
  return {
    key: friends.publicKey(key),
    friends: people(links.friends, l => ({
      status: statusOf(l.name), unread: friends.unread(key, l.name), last: lastAt(l.name),
      key: friends.publicKey(l.name)
    })).sort((a, b) => (a.status === 'offline') - (b.status === 'offline') || b.last - a.last || a.name.localeCompare(b.name)),
    incoming: people(links.incoming, l => ({ since: l.since })),
    outgoing: people(links.outgoing, l => ({ since: l.since }))
  };
}

/**
 * Sends the friends list - only if it changed since the last time, unless
 * forced. Never to a blocked connection: it sees nothing of the instance.
 */
export function sendFriends(c, force = true) {
  if (c.blocked) return;
  let view;
  try { view = friendsView(c.accountKey); } catch (e) { console.error('Friends:', e.message); return; }
  const sig = JSON.stringify(view);
  if (!force && sig === c.friendsSig) return;
  c.friendsSig = sig;
  send(c.ws, { t: 'friends', ...view });
}

/** To every connection of these accounts. */
function pushFriends(...keys) {
  for (const c of conns.values()) if (keys.includes(c.accountKey)) sendFriends(c);
}

function friendMessage(c, ws, msg) {
  const me = c.accountKey;
  const target = userByHandle(msg.handle);
  if (msg.t === 'friendLookup') {
    const now = Date.now();
    c.lookups = (c.lookups || []).filter(at => now - at < 60000);
    if (c.lookups.length >= LOOKUPS.perMinute) return send(ws, { t: 'error', key: 'friends.err.slowDown' });
    c.lookups.push(now);
    const found = target && publicOf(target.name);
    return send(ws, { t: 'friendLookup', handle: String(msg.handle ?? '').trim().replace(/^#/, '').toUpperCase(),
      user: found || null, relation: found ? friends.relation(me, target.name) : null });
  }
  if (!target) return send(ws, { t: 'error', key: 'friends.err.unknown' });
  const them = target.name;
  try {
    switch (msg.t) {
      case 'friendRequest': friends.request(me, them); break;
      case 'friendAnswer': friends.answer(me, them, !!msg.accept); break;
      case 'friendRemove': friends.remove(me, them); break;
      case 'friendMsg': {
        const m = friends.addMessage(me, them, msg.env);
        for (const x of conns.values()) {
          if ((x.accountKey === me || x.accountKey === them) && !x.blocked) {
            const withHandle = x.accountKey === me ? target.handle : getUser(me)?.handle;
            send(x.ws, { t: 'friendMsg', with: withHandle, msg: { mine: x.accountKey === me, env: m.env, at: m.at } });
          }
        }
        break;
      }
      case 'friendHistory':
      case 'friendRead': {
        if (friends.relation(me, them) !== 'friends') return send(ws, { t: 'error', key: 'friends.err.notFriends' });
        if (msg.t === 'friendHistory') {
          send(ws, { t: 'friendHistory', with: target.handle,
            messages: friends.history(me, them).map(m => ({ mine: m.from === me, env: m.env, at: m.at })) });
        }
        friends.markRead(me, them);
        pushFriends(me);
        return;
      }
    }
  } catch (e) {
    if (!String(e.message).startsWith('friends.err.')) throw e;
    return send(ws, { t: 'error', key: e.message });
  }
  pushFriends(me, them);
}

/** Friends exist only between accounts - guests have nobody to find. */
function friendAction({ c, ws }, msg) {
  // Friends exist only between accounts - guests have nobody to find.
  if (!c.accountKey || !authEnabled()) return send(ws, { t: 'error', key: 'friends.err.account' });
  friendMessage(c, ws, msg);
}

export const friendHandlers = Object.fromEntries([
  'friendLookup', 'friendRequest', 'friendAnswer', 'friendRemove', 'friendMsg', 'friendHistory', 'friendRead'
].map(t => [t, friendAction]));

let friendTick = 0;

export function tickFriends(now) {
// Friends coming online, going offline or into a game: whoever is in the
// start menu sees it within a few seconds.
if (authEnabled() && ++friendTick % 3 === 0) {
  for (const c of conns.values()) if (c.accountKey) sendFriends(c, false);
}
// Once an hour, old messages leave friends.json for good.
if (authEnabled() && friendTick % 3600 === 0) friends.expire(now);
}
