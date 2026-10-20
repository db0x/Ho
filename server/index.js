// HTTP (statische Dateien) + WebSocket-Server.
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
// Die Version steht nur in package.json; die Seiten bekommen sie beim
// Ausliefern eingesetzt, statt sie an zweiter Stelle zu pflegen.
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
  // Erst dekodieren, dann normalisieren - und in dieser Reihenfolge: ein
  // kodierter Schraegstrich (%2f) uebersteht den URL-Parser und wuerde sonst
  // erst hinter allen Pruefungen zum Trenner, etwa bei /css/..%2f..%2f.
  let rel;
  try { rel = path.posix.normalize(decodeURIComponent(url.pathname)); } catch { rel = ''; }
  if (!rel.startsWith('/') || rel.includes('\0')) { res.writeHead(400).end('bad path'); return; }
  if (rel === '/') rel = '/index.html';
  // Vor allem anderen der Zugang: erst die eigenen Endpunkte, dann das Tor.
  // Ohne Sitzung gibt es nur die Anmeldeseite und was sie zum Anzeigen braucht.
  if (handleAuth(req, res, rel)) return;
  if (!gate(req, res, rel)) return;
  if (handleAvatar(req, res, rel)) return;
  // /shared/* kommt aus dem gemeinsamen Verzeichnis, alles andere aus /client
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
  const sitzung = checkUpgrade(req);
  if (!sitzung) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, sitzung));
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
    const view = buildSpectatorView(game);     // für alle Zuschauer dieselbe
    for (const id of game.spectators) {
      const c = conns.get(id);
      if (c) send(c.ws, { t: 'view', view, ...extra });
      else game.spectators.delete(id);
    }
  }
}

/** Eine Partie, der man zusehen darf: nur KI, kein menschliches Reich. */
function watchable(game) {
  return !!game && game.players.length > 0 && game.players.every(p => p.isBot);
}

// Spieler schreiben Text, das System schickt { key, params } - uebersetzt
// wird erst beim Empfaenger.
function chat(game, from, msg) {
  const body = typeof msg === 'string' ? { text: msg } : msg;
  for (const p of game.players) {
    const c = p.connId && conns.get(p.connId);
    if (c) send(c.ws, { t: 'chat', from, ...body });
  }
}

wss.on('connection', (ws, req, sitzung) => {
  const connId = crypto.randomUUID();
  const c = {
    ws, gameId: null, playerId: null, sid: sitzung.token,
    account: sitzung.display ?? sitzung.user, accountKey: sitzung.user ?? null,
    profile: { name: null, avatar: null }
  };
  if (c.accountKey) {
    let konto = null;
    try { konto = getUser(c.accountKey); } catch { /* Kontendatei unlesbar */ }
    c.profile = { name: konto?.nick || c.account, avatar: accountAvatarUrl(c.accountKey) };
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
        games.delete(game.id);           // niemand sieht mehr zu
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
 * Mit Anmeldung heisst ein Spieler wie in seinem Profil - geaendert wird das
 * nur ueber 'profile', wo der Server prueft, dass niemand den Namen eines
 * anderen Kontos annimmt. Ohne Anmeldung gilt der Wunschname. In der Partie
 * bekommt ein doppelter Name eine Nummer.
 */
function spielerName(c, game, wunsch, selfId) {
  const name = c.accountKey ? c.profile.name : (cleanName(wunsch) || c.profile.name);
  return uniqueName(game, name || 'Captain', selfId);
}

/** Neue Seite eines Profils annehmen. Gibt einen Fehlerschluessel zurueck oder null. */
function profilAendern(c, msg) {
  if (msg.name !== undefined) {
    const name = cleanName(msg.name);
    if (c.accountKey) {
      const rüge = nameAllowed(name, c.accountKey);
      if (rüge) return rüge;
      // Wer wieder wie sein Konto heisst, braucht keinen eigenen Eintrag.
      setProfile(c.accountKey, { nick: name === c.account ? null : name });
    } else if (name.length < 2) return 'profile.err.short';
    c.profile.name = name;
  }
  if (msg.avatar !== undefined) {
    let bild = null;
    if (msg.avatar !== null) {
      bild = parseAvatar(msg.avatar);
      if (bild.error) return bild.error;
    }
    if (c.accountKey) c.profile.avatar = putAccountAvatar(c.accountKey, bild);
    else c.profile.avatar = bild ? putGuestAvatar(bild, c.profile.avatar?.match(/avatar\/(g-[^?]+)/)?.[1]) : null;
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
      const name = spielerName(c, g, msg.name);
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
        // Eine laufende KI-Partie kann man nicht spielen, aber ansehen
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
        name: spielerName(c, g, msg.name), connId,
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
      const rüge = profilAendern(c, msg);
      if (rüge) send(ws, { t: 'error', key: rüge });
      send(ws, { t: 'profile', profile: { ...c.profile, account: c.accountKey ? c.account : null } });
      if (rüge || !me) return;
      // Das Bild geht immer mit; umbenannt wird nur vor dem Start - danach
      // stuende der alte Name schon in Protokoll und Chat.
      me.avatar = c.profile.avatar;
      if (game.state === 'lobby') {
        if (msg.name !== undefined) {
          me.name = spielerName(c, game, c.profile.name, me.id);
          if (game.players[0] === me) game.hostName = me.name;
        }
        broadcastLobby(game);
      } else broadcastView(game);
      break;
    }
    case 'color': {
      if (!game || !me) return;
      // Die eigene Farbe darf jeder waehlen, die der KI-Reiche der Gastgeber.
      const wer = msg.playerId ? game.players.find(p => p.id === msg.playerId) : me;
      const host = game.players[0] === me;
      if (!wer || (wer !== me && !(wer.isBot && host))) return;
      // Traegt ein Mitspieler die Farbe schon, wird nur getauscht, wenn der
      // Gastgeber es will - sonst verliert jemand ungefragt seine Farbe.
      const traeger = game.players.find(p => p !== wer && p.color === msg.color);
      if (traeger && !traeger.isBot && !host) return send(ws, { t: 'error', key: 'lobby.colorTaken' });
      if (setPlayerColor(game, wer, String(msg.color || ''))) broadcastLobby(game);
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
        // Bewegungen aendern die Sicht anderer nicht sofort - nur Bereitschaft anzeigen
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
      // Zuschauer melden sich einfach ab
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
        // Das Reich bleibt stehen und wird übersprungen - sonst bräche die
        // Partie für alle anderen auseinander.
        me.connected = false;
        me.connId = null;
        me.token = null;
        chat(game, 'System', { key: 'chat.left', params: { player: me.name } });
        broadcastView(game);
        maybeResolve(game);
      }
      c.gameId = null; c.playerId = null;
      // Läuft niemand mehr mit, kann die Partie weg
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
        // Neue reine KI-Partie aufsetzen und sofort starten
        const bots = Math.min(MAX_PLAYERS, Math.max(2, Math.round(msg.bots) || 6));
        g = createGame('KI-Partie');
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
  // 0 = unbegrenzt: dann endet die Partie erst, wenn nur ein Reich übrig ist.
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

// Takt der Zuschauerpartien: hier treibt niemand die Runden an.
setInterval(() => {
  const now = Date.now();
  for (const game of games.values()) {
    if (game.state !== 'running' || !game.spectators.size || game.pace.paused) continue;
    if (now < game.nextTurnAt) continue;
    game.nextTurnAt = now + game.pace.ms;
    maybeResolve(game);
  }
}, 100);

// Rundentimer und Aufräumen
setInterval(() => {
  const now = Date.now();
  for (const [connId, c] of conns) {
    if (!sessionAlive(c.sid)) {
      console.log('Sitzung beendet, Verbindung getrennt:', c.account ?? '?');
      c.ws.close(4001);
      conns.delete(connId);
    }
  }
  for (const game of games.values()) {
    if (game.state === 'running' && game.turnDeadline && now >= game.turnDeadline) {
      for (const p of game.players) p.ready = true;
      maybeResolve(game);
    }
    // Verwaiste Partien nach 2 Stunden entfernen
    if (!game.players.some(p => p.connected) && !game.spectators.size
      && now - game.created > 2 * 3600 * 1000) {
      games.delete(game.id);
    }
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`Ho!! läuft auf http://localhost:${PORT}`);
  if (!authEnabled()) {
    console.warn('Zugang: ABGESCHALTET (HO_AUTH=off) - jeder mit der URL kann mitspielen.');
    return;
  }
  try {
    const n = listUsers().length;
    console.log(`Zugang: Anmeldung aktiv, Konten: ${n} (${userFile()})`);
    if (!n) console.warn('Noch kein Konto. Anlegen mit: node server/users.js add <name>');
  } catch (e) {
    console.error('Zugang: Kontendatei unlesbar -', e.message);
  }
});
