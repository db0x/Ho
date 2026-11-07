// A game from the lobby to its end: creating it, starting it, who leads it,
// pausing and extending it - and how it shows in the lobby and the admin
// overview. The server is authoritative - the client only sends orders,
// never results. Everything that happens within a turn lives in the modules
// next to this one; turn.js puts them in order.
import { newSeed, generateGalaxy, makeRng } from '../galaxy.js';
import { newFleet, addShip } from './fleets.js';
import { updateVisibility } from './intel.js';
import { pushLog } from './log.js';

export const DEFAULT_SETTINGS = {
  planetsPerPlayer: 6,
  startMoney: 1600,
  startMetal: 400,
  turnTimer: 0,        // seconds; 0 = wait until everyone is done
  expanding: true,     // map grows with exploration
  mode: 'classic',     // 'classic' = flat, 'space' = 3D (lens)
  shape: 'scatter',    // 'scatter' = scattered field, 'spiral' = spiral around a black hole
  maxTurns: 300,       // 0 = unlimited
  voice: false,        // CB radio open from the start (only if the server offers it)
  wormholes: true,     // wormholes open now and then in the course of the game
  capitalShips: true,  // destroyers can be built; off = classic Ho!!
  alliances: true,     // empires may ally (diplomacy.js); off = everyone against everyone
  aliens: true,        // now and then aliens raid from another galaxy (server/aliens.js)
  alienLevel: 2,       // how strong they are: 1 easy, 2 medium, 3 strong (ALIEN_LEVELS in rules.js)
  interception: true,  // armed fleets may chase foreign fleets in flight (movement.js)
  radio: true,         // AI colonies and aliens speak up over the radio now and then (server/radio/)
  seed: null
};

let gameCounter = 0;

export function createGame(hostName) {
  gameCounter++;
  return {
    id: makeGameCode(),
    created: Date.now(),
    // Last move by a human (any message from a player or spectator of the
    // game). Games without one for too long are discarded (server/index.js).
    lastActivity: Date.now(),
    state: 'lobby',
    settings: { ...DEFAULT_SETTINGS },
    hostName,
    turn: 0,
    galaxy: null,
    players: [],
    fleets: [],
    wormholes: [],            // open wormholes (server/wormholes.js)
    aliens: null,             // when the next raid is due and who had one (server/aliens.js)
    alienRifts: [],           // rifts of the last turn, for the map
    nextFleetId: 1,
    nextShipId: 1,
    log: [],
    // Diplomacy (diplomacy.js): alliances, open offers, offers turned down,
    // and what was agreed during the turn - it goes into the turn's log.
    alliances: [],
    offers: [],
    refusals: [],
    diplomacyLog: [],
    turnDeadline: null,
    // Paused by the host: { by, name, left } - left is what remained of the
    // turn timer (ms) or null without one. No turn resolves while paused.
    paused: null,
    startedAt: null,          // ms timestamps, for the admin overview
    lastTurnAt: null,
    // Spectators: connections without an empire of their own. The pace belongs
    // to the game so that several spectators see the same thing.
    spectators: new Set(),
    pace: { paused: false, ms: 1500 },
    nextTurnAt: 0,
    rng: Math.random
  };
}

function makeGameCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function planetById(game, id) { return game.galaxy.planets[id]; }
export function playerById(game, id) { return game.players.find(p => p.id === id); }

// ------------------------------------------------------------------ Game start

export function startGame(game) {
  const n = game.players.length;
  if (n < 1) return { error: 'err.tooFewPlayers' };
  // Players never choose or see the seed (see makeRng); only tests set one directly.
  const seed = game.settings.seed ?? newSeed();
  game.galaxy = generateGalaxy({
    playerCount: Math.max(2, n),
    planetsPerPlayer: game.settings.planetsPerPlayer,
    mode: game.settings.mode,
    shape: game.settings.shape,
    seed
  });
  game.settings.seed = game.galaxy.seed;
  game.startedAt = Date.now();
  game.rng = makeRng(`${game.galaxy.seed}:play`);
  game.state = 'running';
  game.turn = 1;
  game.log = [];
  game.startedAt = Date.now();

  game.players.forEach((p, i) => {
    p.money = game.settings.startMoney;
    p.metal = game.settings.startMetal;
    const home = game.galaxy.planets[game.galaxy.homeworlds[i]];
    home.owner = p.id;
    home.pop = 12;
    p.homeworld = home.id;
    // Starting fleets: a fast pair of scouts and a settler ship
    const scouts = newFleet(game, p.id, home);
    addShip(game, scouts, 'scout', p.tech);
    addShip(game, scouts, 'scout', p.tech);
    const settlers = newFleet(game, p.id, home);
    addShip(game, settlers, 'colony', p.tech);
  });
  // A solo game still gets a galaxy for two (size, spacing). The spare home
  // stays a fine world but is nobody's homeworld - otherwise the map marks it
  // as one.
  for (const id of game.galaxy.homeworlds.slice(n)) game.galaxy.planets[id].isHomeworld = false;

  updateVisibility(game);
  pushLog(game, [{ type: 'start', key: 'log.start',
    params: { empires: game.players.length, worlds: game.galaxy.planets.length } }]);
  armTurnTimer(game);
  return { ok: true };
}

export function armTurnTimer(game) {
  game.turnDeadline = game.settings.turnTimer > 0
    ? Date.now() + game.settings.turnTimer * 1000
    : null;
}

// ------------------------------------------------------------------- Host/pause

/**
 * Who leads the game: whoever created it, as long as they are connected -
 * otherwise the next connected human. That way a pause never gets stuck
 * because the host's tab closed. AI-only games have no host.
 */
export function hostOf(game) {
  const first = game.players[0];
  if (first && !first.isBot && first.connected) return first;
  return game.players.find(p => !p.isBot && p.connected) || null;
}

/**
 * Turns stop resolving and the turn timer freezes where it stands. Only with
 * a timer: without one no turn ends while someone is away anyway.
 */
export function pauseGame(game, player) {
  if (game.state !== 'running' || game.paused || !game.turnDeadline) return false;
  const left = game.turnDeadline ? Math.max(0, game.turnDeadline - Date.now()) : null;
  game.paused = { by: player.id, name: player.name, left };
  game.turnDeadline = null;
  return true;
}

// After a pause there should be a moment to get back into the game, even if
// the timer was about to run out.
const RESUME_GRACE_MS = 15000;

export function resumeGame(game) {
  if (!game.paused) return false;
  const { left } = game.paused;
  game.paused = null;
  game.turnDeadline = left != null ? Date.now() + Math.max(left, RESUME_GRACE_MS) : null;
  return true;
}

export const MINIMUM_CONTINUE_TURNS = 1, MAXIMUM_CONTINUE_TURNS = 500;

/**
 * Extends a game that just ended by more turns instead of ending it there -
 * the host's call, right after "over" (turn limit reached or one empire
 * left). The new limit replaces the old one even if that game was endless.
 */
export function continueGame(game, extraTurns) {
  if (game.state !== 'over') return false;
  const roundedTurns = Math.round(Number(extraTurns));
  if (!Number.isFinite(roundedTurns) || roundedTurns < MINIMUM_CONTINUE_TURNS || roundedTurns > MAXIMUM_CONTINUE_TURNS) return false;
  game.settings.maxTurns = Math.min(999, game.turn + roundedTurns - 1);
  game.state = 'running';
  game.winner = null;
  game.winners = null;
  for (const player of game.players) player.ready = false;
  armTurnTimer(game);
  return true;
}

export function allReady(game) {
  return game.players.filter(p => p.alive).every(p => p.ready || p.isBot || !p.connected);
}

export function pauseView(game) {
  return game.paused ? { by: game.paused.by, name: game.paused.name, left: game.paused.left } : null;
}

export function lobbyView(game) {
  return {
    id: game.id,
    state: game.state,
    // Everything but the seed: knowing it would reveal the whole map.
    settings: { ...game.settings, seed: undefined },
    players: game.players.map(p => ({
      id: p.id, name: p.name, color: p.color, emblem: p.emblem, avatar: p.avatar,
      // The account behind it if the display name differs - who plays with
      // whom should remain recognizable.
      account: p.account && p.account.toLowerCase() !== p.name.toLowerCase() ? p.account : null,
      isBot: p.isBot, persona: p.persona, level: p.level, connected: p.connected
    }))
  };
}

/**
 * A game as the admin overview shows it: who plays, since when, and how far
 * along it is. No fog-of-war data - just the bookkeeping.
 */
export function adminGameView(game) {
  return {
    id: game.id,
    state: game.state,
    host: game.hostName,
    mode: game.settings.mode,
    shape: game.settings.shape,
    turn: game.turn,
    maxTurns: game.settings.maxTurns || 0,
    created: game.created,
    startedAt: game.startedAt,
    lastTurnAt: game.lastTurnAt,
    lastActivity: game.lastActivity,
    spectators: game.spectators.size,
    paused: !!game.paused,
    winner: game.winner || null,
    players: game.players.map(p => ({
      id: p.id, name: p.name, color: p.color, avatar: p.avatar, account: p.account,
      isBot: p.isBot, persona: p.persona, connected: p.connected,
      alive: p.alive, ready: p.ready, joinedAt: p.joinedAt,
      stats: { planets: p.stats.planets, pop: p.stats.pop, ships: p.stats.ships }
    }))
  };
}
