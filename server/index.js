// HTTP (static files) + WebSocket server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  createGame, addPlayer, removePlayer, startGame, setOrders, resolveTurn,
  allReady, buildView, buildSpectatorView, lobbyView, adminGameView, DEFAULT_SETTINGS, armTurnTimer, setPlayerColor, setBotLevel,
  hostOf, pauseGame, resumeGame
} from './game.js';
import { runBot } from './bot.js';
import { handleAuth, gate, checkUpgrade, sessionAlive, authEnabled } from './auth.js';
import { listUsers, userFile, getUser, setProfile, isAdmin, setNewsSeen } from './userstore.js';
import { createInvite, listInvites, revokeInvite } from './invites.js';
import {
  cleanName, nameAllowed, reservedName, uniqueName, parseAvatar, putGuestAvatar, putAccountAvatar,
  accountAvatarUrl, handleAvatar
} from './profile.js';
import { MAX_PLAYERS, AI_LEVELS } from '../shared/rules.js';
import { releaseOf, compareRelease } from '../shared/version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8080;
// The version lives only in package.json; it is inserted into the pages when
// they are served instead of being maintained in a second place.
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const VERSION_MARK = /__HO_VERSION__/g;
// Releases with change notes (client/news/<release>.json) up to the one that
// runs - the browser cannot list the folder, so 'hello' names them.
const RELEASES = (() => {
  let names = [];
  try { names = fs.readdirSync(path.join(ROOT, 'client', 'news')); } catch { /* no notes */ }
  return names.map(n => n.match(/^(\d+\.\d+)\.json$/)?.[1]).filter(Boolean)
    .filter(r => compareRelease(r, releaseOf(VERSION)) <= 0).sort(compareRelease);
})();
// Games nobody has touched for this long are zombies and get discarded -
// even if a forgotten tab is still connected.
const IDLE_MS = (Number(process.env.HO_IDLE_HOURS) || 4) * 3600 * 1000;
// Without anybody connected, a game goes after half that time already.
const ORPHAN_MS = IDLE_MS / 2;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // Decode first, then normalize - and in this order: an encoded slash (%2f)
  // survives the URL parser and would otherwise only become a separator after
  // all checks, e.g. with /css/..%2f..%2f.
  let rel;
  try { rel = path.posix.normalize(decodeURIComponent(url.pathname)); } catch { rel = ''; }
  if (!rel.startsWith('/') || rel.includes('\0')) { res.writeHead(400).end('bad path'); return; }
  if (rel === '/') rel = '/index.html';
  // Access control before anything else: first its own endpoints, then the gate.
  // Without a session there is only the sign-in page and what it needs to display.
  if (handleAuth(req, res, rel)) return;
  if (!gate(req, res, rel)) return;
  if (handleAvatar(req, res, rel)) return;
  // /shared/* comes from the shared directory, everything else from /client
  const base = rel.startsWith('/shared/') ? ROOT : path.join(ROOT, 'client');
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(ext === '.html' ? data.toString('utf8').replace(VERSION_MARK, VERSION) : data);
  });
});

// The largest legitimate message is a profile image (AVATAR_MAX, base64
// encoded); the library default of 100 MB would let anyone tie up memory.
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

// Message throttle per connection (token bucket). Generous for people - the
// UI sends at most a few messages per second, sliders are throttled - but a
// script flooding the server would slow the game down for everyone.
const RATE = { burst: 40, perSecond: 20, dropsBeforeClose: 200 };
function allowMessage(c) {
  const now = Date.now();
  c.tokens = Math.min(RATE.burst, (c.tokens ?? RATE.burst) + (now - (c.refilled ?? now)) / 1000 * RATE.perSecond);
  c.refilled = now;
  if (c.tokens >= 1) { c.tokens--; return true; }
  c.dropped = (c.dropped || 0) + 1;
  return false;
}

server.on('upgrade', (req, socket, head) => {
  const session = checkUpgrade(req);
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, session));
});

/** @type {Map<string, any>} */
const games = new Map();
/** connId -> {ws, gameId, playerId} */
const conns = new Map();

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastLobby(game) {
  const lv = lobbyView(game);
  for (const p of game.players) {
    const c = p.connId && conns.get(p.connId);
    if (c) send(c.ws, { t: 'lobby', lobby: lv, you: p.id, host: game.players[0]?.id === p.id });
  }
}

function broadcastView(game, extra = {}) {
  for (const p of game.players) {
    const c = p.connId && conns.get(p.connId);
    if (c) send(c.ws, { t: 'view', view: buildView(game, p), ...extra });
  }
  if (game.spectators.size) {
    const view = spectatorView(game);          // the same for all spectators
    for (const id of game.spectators) {
      const c = conns.get(id);
      if (c) send(c.ws, { t: 'view', view, ...extra });
      else game.spectators.delete(id);
    }
  }
}

/** A game that may be watched: AI only, no human empire. */
function watchable(game) {
  return !!game && game.players.length > 0 && game.players.every(p => p.isBot);
}

/**
 * The spectator view, plus who controls the pace: in an AI-only game the
 * spectators drive the turns; in a game with humans (watched by an admin)
 * the players do, so there is no pace to hand out.
 */
function spectatorView(game) {
  const view = buildSpectatorView(game);
  if (!watchable(game)) view.pace = null;
  return view;
}

/** Turns a connection into a spectator of `game`. */
function attachSpectator(c, connId, game) {
  c.gameId = game.id; c.playerId = null;
  game.spectators.add(connId);
  if (watchable(game)) game.nextTurnAt = Date.now() + game.pace.ms;
  send(c.ws, { t: 'watching', code: game.id });
  send(c.ws, { t: 'view', view: spectatorView(game), started: true });
}

// Players write text, the system sends { key, params } - translation only
// happens at the recipient.
function chat(game, from, msg, fromId = null) {
  // System messages (keys) are flagged as such: the client must not tell
  // them apart by the sender's name - a player could be called "System".
  // fromId names the writing empire: color, and no alert for your own lines.
  const body = typeof msg === 'string' ? { text: msg, fromId } : { ...msg, system: true };
  for (const p of game.players) {
    const c = p.connId && conns.get(p.connId);
    if (c) send(c.ws, { t: 'chat', from, ...body });
  }
}

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
  }
  conns.set(connId, c);
  send(ws, {
    t: 'hello', maxPlayers: MAX_PLAYERS, defaults: DEFAULT_SETTINGS, openGames: openGameList(),
    mySeats: seatList(c, connId),
    profile: { ...c.profile, account: c.accountKey ? c.account : null },
    admin: adminOf(c),
    // Which release's change notes this account has seen - null: none yet.
    // Without an account the browser remembers it.
    version: VERSION, releases: RELEASES, newsSeen: c.accountKey ? (account?.news ?? null) : undefined
  });

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
    conns.delete(connId);
  });
});

/**
 * Is this connection an admin? Asked anew on every request, so revoking the
 * flag with users.js takes effect without signing out. Without sign-in
 * (HO_AUTH=off) there are no accounts and therefore no admins.
 */
function adminOf(c) {
  if (!c.accountKey) return false;
  try { return isAdmin(c.accountKey); } catch { return false; }   // account file unreadable
}

/** Everything the admin lobby shows: all games and all accounts. */
function adminOverview() {
  const online = new Map();          // account -> its open connections
  for (const c of conns.values()) {
    if (!c.accountKey) continue;
    if (!online.has(c.accountKey)) online.set(c.accountKey, []);
    online.get(c.accountKey).push({ since: c.since, game: c.gameId });
  }
  let accounts = [], invites = [];
  try { accounts = listUsers(); } catch { /* account file unreadable - show the games anyway */ }
  try { invites = listInvites(); } catch (e) { console.error(e.message); }
  return {
    now: Date.now(),
    games: [...games.values()].map(adminGameView)
      .sort((a, b) => (a.state === 'running' ? 0 : 1) - (b.state === 'running' ? 0 : 1) || a.created - b.created),
    accounts: accounts.map(u => {
      const sessions = online.get(u.name) || [];
      return {
        name: u.name, display: u.display, nick: u.nick, admin: u.admin, mustChange: u.mustChange,
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
/**
 * Removes a game; whoever is still connected to it gets the reason and goes
 * back to the start screen.
 */
function closeGame(game, { key, params }) {
  const notice = { t: 'ended', key, params: { code: game.id, ...params } };
  const ids = [...game.players.map(p => p.connId).filter(Boolean), ...game.spectators];
  for (const id of ids) {
    const c = conns.get(id);
    if (!c || c.gameId !== game.id) continue;
    send(c.ws, notice);
    c.gameId = null; c.playerId = null;
  }
  games.delete(game.id);
}

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
function seatList(c, connId) {
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
  const wasAway = !p.connected;
  p.connId = connId; p.connected = true;
  c.gameId = g.id; c.playerId = p.id;
  g.lastActivity = Date.now();
  send(c.ws, { t: 'joined', code: g.id, playerId: p.id, token: p.token });
  if (g.state === 'lobby') broadcastLobby(g);
  // Back is only news to the others if they were told about the loss.
  else if (wasAway) { broadcastView(g); chat(g, 'System', { key: 'chat.back', params: { player: p.name } }); }
  else send(c.ws, { t: 'view', view: buildView(g, p) });
}

function openGameList() {
  return [...games.values()]
    .filter(g => g.state === 'lobby' && g.players.length < MAX_PLAYERS)
    .map(g => ({ id: g.id, host: g.hostName, players: g.players.length }));
}

/**
 * With sign-in a player is named as in their profile - that only changes via
 * 'profile', where the server checks that nobody takes the name of another
 * account. Without sign-in the requested name applies. Within a game a
 * duplicate name gets a number.
 */
function playerName(c, game, wanted, selfId) {
  const name = c.accountKey ? c.profile.name : (cleanName(wanted) || c.profile.name);
  return uniqueName(game, name && !reservedName(name) ? name : 'Captain', selfId);
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

function handle(connId, ws, msg) {
  const c = conns.get(connId);
  const game = c.gameId ? games.get(c.gameId) : null;
  const me = game ? game.players.find(p => p.id === c.playerId) : null;
  // Every message from someone in a game counts as a sign of life for it.
  if (game) game.lastActivity = Date.now();

  switch (msg.t) {
    case 'create': {
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
      break;
    }
    case 'join': {
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
      break;
    }
    case 'resume': {
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
      break;
    }
    case 'takeover': {
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
      break;
    }
    case 'newsSeen': {
      // Always the release that runs here - not what the client claims.
      if (c.accountKey) {
        try { setNewsSeen(c.accountKey, releaseOf(VERSION)); } catch { /* account file unreadable */ }
      }
      break;
    }
    case 'profile': {
      const problem = changeProfile(c, msg);
      if (problem) send(ws, { t: 'error', key: problem });
      send(ws, { t: 'profile', profile: { ...c.profile, account: c.accountKey ? c.account : null } });
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
      break;
    }
    case 'color': {
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
      break;
    }
    case 'settings': {
      if (!game || game.players[0]?.id !== c.playerId) return;
      Object.assign(game.settings, sanitizeSettings(msg.settings));
      broadcastLobby(game);
      break;
    }
    case 'addBot': {
      if (!game || game.players[0]?.id !== c.playerId) return;
      if (game.players.length >= MAX_PLAYERS) return;
      // 'random': the quick game rolls the level for every opponent.
      const level = msg.level === 'random' ? AI_LEVELS[crypto.randomInt(AI_LEVELS.length)] : msg.level;
      addPlayer(game, { isBot: true, name: msg.name, level });
      broadcastLobby(game);
      break;
    }
    case 'level': {
      if (!game || game.players[0]?.id !== c.playerId) return;
      const bot = game.players.find(p => p.id === msg.playerId);
      if (setBotLevel(game, bot, String(msg.level || ''))) broadcastLobby(game);
      break;
    }
    case 'kick': {
      if (!game || game.players[0]?.id !== c.playerId) return;
      const victim = game.players.find(p => p.id === msg.playerId);
      if (!victim || victim.id === c.playerId) return;
      if (victim.connId) {
        const vc = conns.get(victim.connId);
        if (vc) { send(vc.ws, { t: 'kicked' }); vc.gameId = null; vc.playerId = null; }
      }
      removePlayer(game, victim.id);
      broadcastLobby(game);
      break;
    }
    case 'start': {
      if (!game || game.players[0]?.id !== c.playerId) return;
      if (game.state !== 'lobby') return;
      const r = startGame(game);
      if (r.error) return send(ws, { t: 'error', key: r.error });
      broadcastView(game, { started: true });
      break;
    }
    case 'orders': {
      if (!game || !me || game.state !== 'running') return;
      const r = setOrders(game, me, msg);
      if (r?.error) send(ws, { t: 'notice', key: r.error, params: r.params });
      send(ws, { t: 'view', view: buildView(game, me) });
      if (msg.move || msg.split || msg.merge) {
        // Moves do not change other players' views right away - only show readiness
      }
      break;
    }
    case 'ready': {
      if (!game || !me || game.state !== 'running') return;
      me.ready = msg.value !== false;
      broadcastView(game);
      maybeResolve(game);
      break;
    }
    case 'pause': {
      // The host holds the game for everyone (someone is at the door): the
      // timer freezes and no turn resolves. Orders and chat keep working.
      if (!game || !me || game.state !== 'running') return;
      if (hostOf(game) !== me) return send(ws, { t: 'error', key: 'err.notHost' });
      const changed = msg.value ? pauseGame(game, me) : resumeGame(game);
      if (!changed) return;
      chat(game, 'System', { key: msg.value ? 'chat.paused' : 'chat.resumed', params: { player: me.name } });
      broadcastView(game);
      maybeResolve(game);
      break;
    }
    case 'leave': {
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
        chat(game, 'System', { key: 'chat.left', params: { player: me.name } });
        broadcastView(game);
        maybeResolve(game);
      }
      c.gameId = null; c.playerId = null;
      // If nobody is playing anymore, the game can go
      if (!game.players.some(p => p.connected) && !game.spectators.size) games.delete(game.id);
      break;
    }
    case 'chat': {
      if (!game || !me) return;
      chat(game, me.name, String(msg.text || '').slice(0, 200), me.id);
      break;
    }
    case 'watch': {
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
      break;
    }
    case 'adminWatch': {
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
      break;
    }
    case 'pace': {
      // Only AI games run at the spectators' pace - never one with humans.
      if (!game || !game.spectators.has(connId) || !watchable(game)) return;
      if (typeof msg.paused === 'boolean') game.pace.paused = msg.paused;
      if (Number.isFinite(msg.ms)) game.pace.ms = Math.min(10000, Math.max(120, Math.round(msg.ms)));
      game.nextTurnAt = Date.now() + (game.pace.paused ? 0 : game.pace.ms);
      broadcastView(game);
      break;
    }
    case 'step': {
      if (!game || !game.spectators.has(connId) || game.state !== 'running' || !watchable(game)) return;
      maybeResolve(game);
      break;
    }
    case 'admin': {
      if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
      send(ws, { t: 'adminData', ...adminOverview() });
      break;
    }
    case 'adminEnd': {
      if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
      const g = games.get(String(msg.code || '').toUpperCase());
      if (!g) return send(ws, { t: 'error', key: 'err.gameNotFound' });
      endGame(g, c.account);
      send(ws, { t: 'adminData', ...adminOverview() });
      break;
    }
    case 'adminMsg': {
      if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
      const g = games.get(String(msg.code || '').toUpperCase());
      if (!g) return send(ws, { t: 'error', key: 'err.gameNotFound' });
      const text = String(msg.text ?? '').trim();
      if (!text || text.length > ADMIN_MSG_MAX) return send(ws, { t: 'error', key: 'err.badAdminMessage', params: { n: ADMIN_MSG_MAX } });
      const delivered = adminMessage(g, c.account, text);
      send(ws, { t: 'adminMsgSent', code: g.id, delivered });
      break;
    }
    case 'adminInvite': {
      if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
      // The token goes back to this admin only, once - the server keeps just a hash.
      const { token, invite } = createInvite(c.account, msg.note);
      console.log(`Admin ${c.account} created invite ${invite.id}${invite.note ? ` (${JSON.stringify(invite.note)})` : ''}`);
      send(ws, { t: 'adminInviteCreated', token, invite });
      send(ws, { t: 'adminData', ...adminOverview() });
      break;
    }
    case 'adminRevokeInvite': {
      if (!adminOf(c)) return send(ws, { t: 'error', key: 'err.notAdmin' });
      if (revokeInvite(String(msg.id || ''))) console.log(`Admin ${c.account} revoked invite ${msg.id}`);
      send(ws, { t: 'adminData', ...adminOverview() });
      break;
    }
    case 'list': {
      send(ws, { t: 'games', openGames: openGameList(), mySeats: seatList(c, connId) });
      break;
    }
  }
}

function sanitizeSettings(s) {
  const out = {};
  if (!s) return out;
  if (Number.isFinite(s.planetsPerPlayer)) out.planetsPerPlayer = Math.min(14, Math.max(3, Math.round(s.planetsPerPlayer)));
  if (Number.isFinite(s.startMoney)) out.startMoney = Math.min(20000, Math.max(200, Math.round(s.startMoney)));
  if (Number.isFinite(s.startMetal)) out.startMetal = Math.min(5000, Math.max(50, Math.round(s.startMetal)));
  if (Number.isFinite(s.turnTimer)) out.turnTimer = Math.min(600, Math.max(0, Math.round(s.turnTimer)));
  // 0 = unlimited: then the game only ends when a single empire is left.
  if (Number.isFinite(s.maxTurns)) out.maxTurns = s.maxTurns === 0 ? 0 : Math.min(999, Math.max(20, Math.round(s.maxTurns)));
  if (typeof s.expanding === 'boolean') out.expanding = s.expanding;
  if (s.mode === 'classic' || s.mode === 'space') out.mode = s.mode;
  if (s.shape === 'scatter' || s.shape === 'spiral') out.shape = s.shape;
  return out;
}

export function maybeResolve(game) {
  if (game.state !== 'running' || game.paused) return false;
  if (!allReady(game)) return false;
  for (const bot of game.players.filter(p => p.isBot && p.alive)) runBot(game, bot);
  const entries = resolveTurn(game);
  broadcastView(game, { resolved: true, entryCount: entries.length });
  return true;
}

// Pace of spectator games: nobody drives the turns here.
setInterval(() => {
  const now = Date.now();
  for (const game of games.values()) {
    // An admin watching a game with humans must not make it run by itself.
    if (game.state !== 'running' || !game.spectators.size || game.pace.paused || !watchable(game)) continue;
    if (now < game.nextTurnAt) continue;
    game.nextTurnAt = now + game.pace.ms;
    // A watched AI game is alive while it runs - unlike a timer game, where
    // turns keep resolving even after every human has gone.
    if (maybeResolve(game)) game.lastActivity = now;
  }
}, 100);

// Turn timer and cleanup
setInterval(() => {
  const now = Date.now();
  for (const [connId, c] of conns) {
    if (!sessionAlive(c.sid)) {
      console.log('Session ended, connection closed:', c.account ?? '?');
      c.ws.close(4001);
      conns.delete(connId);
    }
  }
  for (const game of games.values()) {
    if (game.state === 'running' && !game.paused && game.turnDeadline && now >= game.turnDeadline) {
      for (const p of game.players) p.ready = true;
      maybeResolve(game);
    }
    // Zombies: no human move for IDLE_MS - or nobody connected for half of it.
    const idle = now - game.lastActivity;
    const orphaned = !game.players.some(p => p.connected) && !game.spectators.size;
    if (idle > IDLE_MS || (orphaned && idle > ORPHAN_MS)) {
      console.log(`Game ${game.id} discarded after ${Math.round(idle / 60000)} min without activity (state ${game.state}, turn ${game.turn})`);
      closeGame(game, { key: 'notice.endedIdle', params: { hours: +(IDLE_MS / 3600000).toFixed(2) } });
    }
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`Ho!! running on http://localhost:${PORT}`);
  if (!authEnabled()) {
    console.warn('Access: DISABLED (HO_AUTH=off) - anyone with the URL can play.');
    return;
  }
  try {
    const n = listUsers().length;
    console.log(`Access: sign-in active, accounts: ${n} (${userFile()})`);
    if (!n) console.warn('No account yet. Create one with: node server/users.js add <name>');
  } catch (e) {
    console.error('Access: account file unreadable -', e.message);
  }
});
