// HTTP (static files) + WebSocket server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  createGame, addPlayer, removePlayer, startGame, setOrders, resolveTurn,
  allReady, buildView, buildSpectatorView, lobbyView, DEFAULT_SETTINGS, armTurnTimer, setPlayerColor
} from './game.js';
import { runBot } from './bot.js';
import { handleAuth, gate, checkUpgrade, sessionAlive, authEnabled } from './auth.js';
import { listUsers, userFile, getUser, setProfile } from './userstore.js';
import {
  cleanName, nameAllowed, uniqueName, parseAvatar, putGuestAvatar, putAccountAvatar,
  accountAvatarUrl, handleAvatar
} from './profile.js';
import { MAX_PLAYERS } from '../shared/rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8080;
// The version lives only in package.json; it is inserted into the pages when
// they are served instead of being maintained in a second place.
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const VERSION_MARK = /__HO_VERSION__/g;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
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

const wss = new WebSocketServer({ noServer: true });

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
    const view = buildSpectatorView(game);     // the same for all spectators
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

// Players write text, the system sends { key, params } - translation only
// happens at the recipient.
function chat(game, from, msg) {
  const body = typeof msg === 'string' ? { text: msg } : msg;
  for (const p of game.players) {
    const c = p.connId && conns.get(p.connId);
    if (c) send(c.ws, { t: 'chat', from, ...body });
  }
}

wss.on('connection', (ws, req, session) => {
  const connId = crypto.randomUUID();
  const c = {
    ws, gameId: null, playerId: null, sid: session.token,
    account: session.display ?? session.user, accountKey: session.user ?? null,
    profile: { name: null, avatar: null }
  };
  if (c.accountKey) {
    let account = null;
    try { account = getUser(c.accountKey); } catch { /* account file unreadable */ }
    c.profile = { name: account?.nick || c.account, avatar: accountAvatarUrl(c.accountKey) };
  }
  conns.set(connId, c);
  send(ws, {
    t: 'hello', maxPlayers: MAX_PLAYERS, defaults: DEFAULT_SETTINGS, openGames: openGameList(),
    profile: { ...c.profile, account: c.accountKey ? c.account : null }
  });

  ws.on('message', (raw) => {
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
      if (p) {
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
  return uniqueName(game, name || 'Captain', selfId);
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

  switch (msg.t) {
    case 'create': {
      const g = createGame('');
      const name = playerName(c, g, msg.name);
      g.hostName = name;
      Object.assign(g.settings, sanitizeSettings(msg.settings));
      games.set(g.id, g);
      const p = addPlayer(g, { name, connId, avatar: c.profile.avatar, account: c.accountKey ? c.account : null });
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
        c.gameId = g.id; c.playerId = null;
        g.spectators.add(connId);
        g.nextTurnAt = Date.now() + g.pace.ms;
        send(ws, { t: 'watching', code: g.id });
        send(ws, { t: 'view', view: buildSpectatorView(g), started: true });
        return;
      }
      if (g.players.length >= MAX_PLAYERS) return send(ws, { t: 'error', key: 'err.gameFull' });
      const p = addPlayer(g, {
        name: playerName(c, g, msg.name), connId,
        avatar: c.profile.avatar, account: c.accountKey ? c.account : null
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
      if (!p) return send(ws, { t: 'error', key: 'err.noSeat' });
      p.connId = connId; p.connected = true;
      c.gameId = g.id; c.playerId = p.id;
      send(ws, { t: 'joined', code: g.id, playerId: p.id, token: p.token });
      if (g.state === 'lobby') broadcastLobby(g);
      else { send(ws, { t: 'view', view: buildView(g, p) }); chat(g, 'System', { key: 'chat.back', params: { player: p.name } }); }
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
      addPlayer(game, { isBot: true, name: msg.name });
      broadcastLobby(game);
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
      chat(game, me.name, String(msg.text || '').slice(0, 200));
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
        for (let i = 0; i < bots; i++) addPlayer(g, { isBot: true });
        const r = startGame(g);
        if (r.error) { games.delete(g.id); return send(ws, { t: 'error', key: r.error }); }
      }
      if (!watchable(g)) return send(ws, { t: 'error', key: 'err.watchBotsOnly' });
      c.gameId = g.id; c.playerId = null;
      g.spectators.add(connId);
      g.nextTurnAt = Date.now() + g.pace.ms;
      send(ws, { t: 'watching', code: g.id });
      send(ws, { t: 'view', view: buildSpectatorView(g), started: true });
      break;
    }
    case 'pace': {
      if (!game || !game.spectators.has(connId)) return;
      if (typeof msg.paused === 'boolean') game.pace.paused = msg.paused;
      if (Number.isFinite(msg.ms)) game.pace.ms = Math.min(10000, Math.max(120, Math.round(msg.ms)));
      game.nextTurnAt = Date.now() + (game.pace.paused ? 0 : game.pace.ms);
      broadcastView(game);
      break;
    }
    case 'step': {
      if (!game || !game.spectators.has(connId) || game.state !== 'running') return;
      maybeResolve(game);
      break;
    }
    case 'list': {
      send(ws, { t: 'games', openGames: openGameList() });
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
  if (s.seed === null || Number.isFinite(s.seed)) out.seed = s.seed;
  return out;
}

export function maybeResolve(game) {
  if (game.state !== 'running') return false;
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
    if (game.state !== 'running' || !game.spectators.size || game.pace.paused) continue;
    if (now < game.nextTurnAt) continue;
    game.nextTurnAt = now + game.pace.ms;
    maybeResolve(game);
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
    if (game.state === 'running' && game.turnDeadline && now >= game.turnDeadline) {
      for (const p of game.players) p.ready = true;
      maybeResolve(game);
    }
    // Remove orphaned games after 2 hours
    if (!game.players.some(p => p.connected) && !game.spectators.size
      && now - game.created > 2 * 3600 * 1000) {
      games.delete(game.id);
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
