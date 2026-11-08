// The games hosted on this server: telling everyone in a game what changed,
// the game chat, resolving a turn once everyone is done - and closing games,
// by an admin or because nobody has touched them for too long.
import { runBot } from '../ai/bot.js';
import { lobbyView, allReady } from '../game/game.js';
import { buildView } from '../game/intel.js';
import { resolveTurn } from '../game/turn.js';
import { radioTurn } from '../radio/chatter.js';
import { speak } from '../radio/tts.js';
import { countLine } from '../radio/stats.js';
import { recordGame } from '../stats.js';
import { conns, send } from './connections.js';
import { spectatorView } from './spectators.js';

// Games nobody has touched for this long are zombies and get discarded -
// even if a forgotten tab is still connected.
const IDLE_MS = (Number(process.env.HO_IDLE_HOURS) || 4) * 3600 * 1000;
// Without anybody connected, a game goes after half that time already.
const ORPHAN_MS = IDLE_MS / 2;

/** @type {Map<string, any>} */
export const games = new Map();

export function broadcastLobby(game) {
  const lv = lobbyView(game);
  for (const p of game.players) {
    const c = p.connId && conns.get(p.connId);
    if (c) send(c.ws, { t: 'lobby', lobby: lv, you: p.id, host: game.players[0]?.id === p.id });
  }
}

export function broadcastView(game, extra = {}) {
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

// Players write text, the system sends { key, params } - translation only
// happens at the recipient.
export function chat(game, from, msg, fromId = null) {
  // System messages (keys) are flagged as such: the client must not tell
  // them apart by the sender's name - a player could be called "System".
  // fromId names the writing empire: color, and no alert for your own lines.
  const body = typeof msg === 'string' ? { text: msg, fromId } : { ...msg, system: true };
  for (const p of game.players) {
    const c = p.connId && conns.get(p.connId);
    if (c) send(c.ws, { t: 'chat', from, ...body });
  }
}

export function maybeResolve(game) {
  if (game.state !== 'running' || game.paused) return false;
  if (!allReady(game)) return false;
  for (const bot of game.players.filter(p => p.isBot && p.alive)) runBot(game, bot);
  const entries = resolveTurn(game);
  // Decided: into the statistics - a continuation afterwards no longer counts.
  if (game.state === 'over') record(game);
  broadcastView(game, { resolved: true, entryCount: entries.length });
  deliverRadio(game, radioTurn(game, entries));
  return true;
}

/**
 * After the view: the radio chatter of the turn - a line and a short call per
 * player at most. A line with names waits for the speech service and falls
 * back to its fixed line; a fixed line is usually prepared already. What
 * cannot be spoken goes out as text (textOnly) - with its names, if it has
 * them; a short call without its sound is left out. The game never waits
 * for the radio, and nothing here may throw.
 */
export async function deliverRadio(game, out) {
  try {
    for (const [id, msgs] of out) {
      const ready = await Promise.all(msgs.map(async ({ named, line, stat, ...msg }) => {
        if (named) {
          try {
            const spoken = { ...msg, ...(await speak(named.say, named.voice, named.speed)), text: named.text };
            countLine(named.stat);
            return spoken;
          } catch {}
        }
        try {
          const spoken = { ...msg, ...(await speak(line.say, line.voice, line.speed)) };
          countLine(stat);
          return spoken;
        } catch {}
        // No voice: the line is still said - as text.
        if (msg.short) return null;
        const { file, v, ...rest } = msg;
        countLine(named ? named.stat : stat);
        return { ...rest, text: named?.text ?? msg.text, textOnly: true };
      }));
      const c = conns.get(game.players.find(p => p.id === id)?.connId);
      if (c && c.gameId === game.id) for (const msg of ready) if (msg) send(c.ws, msg);
    }
  } catch (e) {
    console.warn('Radio chatter not delivered:', e.message);
  }
}

/** Into the statistics; a full disk must not take the game down with it. */
export function record(game, opts) {
  try { recordGame(game, opts); } catch (e) { console.error(`Game ${game.id} not recorded:`, e.message); }
}

/**
 * Removes a game; whoever is still connected to it gets the reason and goes
 * back to the start screen.
 */
export function closeGame(game, { key, params }) {
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

/** Zombies: no human move for IDLE_MS - or nobody connected for half of it. */
export function discardIfIdle(game, now) {
  const idle = now - game.lastActivity;
  const orphaned = !game.players.some(p => p.connected) && !game.spectators.size;
  if (idle > IDLE_MS || (orphaned && idle > ORPHAN_MS)) {
    // Nobody played it to the end: given up, as far as the ranking is concerned.
    if (game.state === 'running') record(game, { abandoned: true });
    console.log(`Game ${game.id} discarded after ${Math.round(idle / 60000)} min without activity (state ${game.state}, turn ${game.turn})`);
    closeGame(game, { key: 'notice.endedIdle', params: { hours: +(IDLE_MS / 3600000).toFixed(2) } });
  }
}
