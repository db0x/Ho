// Game state and turn resolution. The server is authoritative - the client
// only sends orders, never results.
import {
  TECH_FIELDS, techMaxLevel, TECH_START_LEVEL, techCostToNext,
  SHIP_DEFS, SHIP_TYPES, shipCost, shipStats, refitCost, refitTotal,
  habitability, planetCapacity, planetIncome, planetMining, POP_GROWTH,
  IDEAL, TERRA_COST_PER_DEGREE, TERRA_COST_PER_G, terraformable,
  COMBAT_ROUNDS, INTERCEPT_ROUNDS, batteryStats, dist, clamp, PLAYER_COLORS, PLAYER_EMBLEMS, AI_PERSONAS, AI_LEVELS,
  holeZone, route, advance, travelDistance, supplyNeed, cargoOf, recycleValue, buildLock, REPAIR_SHARE, shipTypesFor
} from '../shared/rules.js';
import { pickShipName } from './shipnames.js';
import { forecast, researchWeight } from '../shared/budget.js';
import { generateGalaxy, expandGalaxy, expandSpiral, makeRng, newSeed } from './galaxy.js';
import {
  SCAN, findMouth, wormholeTurn, spotWormholes, transit, portalsFor, wormholeView
} from './wormholes.js';

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
    nextFleetId: 1,
    nextShipId: 1,
    log: [],
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

// Names for AI empires - rather silly than numbered.
const BOT_NAMES = [
  'Admiral Wobblebeard', 'Captain Cupholder', 'Baroness Breadbox', 'Admiral Grumbleguts',
  'Dr. Thrustworthy', 'Colonel Fearnaught', 'Emperor Kerfuffle', 'Consul Shortcircuit',
  'Matron Moondust', 'Overlord Nevermind', 'Warden Vacuum', 'Lady Solderpot',
  'Senator Hiccup', 'General Goosebump', 'Czarina Candyfloss', 'Doge Thunderplate',
  'Caliph Crackercrumb', 'Tribune Tomfoolery', 'Duke Hailstone', 'Admiral Anchortoss',
  'Marshal Marmot', 'Navigator Nightcrow', 'Commodore Coffeepot', 'Baron Fumblefinger',
  'Reeve Lightyear', 'Despot Deepfreeze', 'Duchess Shimmerglow', 'Primarch Somersault',
  'Chancellor Pebble', 'Warlord Fibberstone', 'Steward Stumble', 'Commandant Button',
  'Doctor Tincan', 'Vizier Charcoal', 'Hetman Heatblanket', 'Viceroy Wobbletooth',
  'Count Plasmaboost', 'Praetor Nonsuch', 'Captain Casserole', 'Prefect Pillowfort',
  'Squire Sprocket', 'Bishop Bellyflop'
];

/** A nickname still free; once all are taken, the number counts. */
function botName(game) {
  const used = new Set(game.players.map(p => p.name));
  const free = BOT_NAMES.filter(n => !used.has(n));
  return free.length
    ? free[Math.floor(Math.random() * free.length)]
    : 'AI ' + (game.players.length + 1);
}

/**
 * Personality for a new AI empire: the one that is still rarest in the
 * game - that way every round gets a colorful mix.
 */
function botPersona(game) {
  const count = Object.fromEntries(AI_PERSONAS.map(k => [k, 0]));
  for (const p of game.players) if (p.isBot && p.persona in count) count[p.persona]++;
  const fewest = Math.min(...Object.values(count));
  const free = AI_PERSONAS.filter(k => count[k] === fewest);
  return free[Math.floor(Math.random() * free.length)];
}

/** The first color of the palette that nobody wears yet. */
function freeColor(game) {
  const taken = new Set(game.players.map(p => p.color));
  return PLAYER_COLORS.find(c => !taken.has(c)) || PLAYER_COLORS[game.players.length % PLAYER_COLORS.length];
}

/**
 * Pick a color. Every color exists only once; if someone already wears it,
 * the two swap - so every color stays selectable even with 16 empires.
 */
export function setPlayerColor(game, player, color) {
  if (game.state !== 'lobby' || !PLAYER_COLORS.includes(color)) return false;
  const other = game.players.find(p => p !== player && p.color === color);
  if (other) other.color = player.color;
  player.color = color;
  return true;
}

export function addPlayer(game, { name, isBot = false, connId = null, persona = null, level = null, avatar = null, account = null, accountKey = null }) {
  if (game.players.length >= 16) return null;
  const slot = game.players.length;
  // Ids stay unique even if someone left in between.
  let num = slot + 1;
  while (game.players.some(p => p.id === 'p' + num)) num++;
  const p = {
    id: 'p' + num,
    slot,
    name: name || (isBot ? botName(game) : 'Player ' + (slot + 1)),
    color: freeColor(game),
    avatar,
    account,
    accountKey,             // normalized account name: one seat per account and game
    emblem: PLAYER_EMBLEMS[slot],
    isBot,
    persona: isBot ? (AI_PERSONAS.includes(persona) ? persona : botPersona(game)) : null,
    level: isBot ? (AI_LEVELS.includes(level) ? level : 'normal') : null,
    connId,
    joinedAt: Date.now(),
    connected: !isBot,
    alive: true,
    ready: false,
    money: 0,
    metal: 0,
    income: 0,
    tech: Object.fromEntries(TECH_FIELDS.map(f => [f, TECH_START_LEVEL])),
    researchPoints: Object.fromEntries(TECH_FIELDS.map(f => [f, 0])),
    research: {
      budgetPct: 40,
      weights: Object.fromEntries(TECH_FIELDS.map(f => [f, 1]))
    },
    explored: new Set(),
    knowledge: {},            // planetId -> last known state
    seenMouths: new Set(),    // wormhole mouths in sight once
    knownHoles: new Set(),    // wormholes jumped through: both ends known
    orders: { builds: {}, moves: {}, unload: {}, refit: {} },
    stats: { planets: 0, pop: 0, ships: 0, kills: 0, losses: 0 }
  };
  game.players.push(p);
  return p;
}

export function removePlayer(game, playerId) {
  const i = game.players.findIndex(p => p.id === playerId);
  if (i < 0) return;
  game.players.splice(i, 1);
  // The color stays as chosen; only the slots move up.
  game.players.forEach((p, idx) => {
    p.slot = idx;
    p.emblem = PLAYER_EMBLEMS[idx];
  });
}

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
  for (const player of game.players) player.ready = false;
  armTurnTimer(game);
  return true;
}

// ---------------------------------------------------------------- Ships/fleets

function newFleet(game, owner, planet) {
  const f = {
    id: 'f' + game.nextFleetId++,
    owner,
    ships: [],
    at: planet ? planet.id : null,
    x: planet ? planet.x : 0,
    y: planet ? planet.y : 0,
    z: planet ? (planet.z || 0) : 0,
    dest: null,
    hole: null           // course to a wormhole mouth instead of a world
  };
  game.fleets.push(f);
  return f;
}

function addShip(game, fleet, type, tech) {
  const st = shipStats(type, tech);
  const ship = {
    id: 's' + game.nextShipId++,
    type,
    tech: { ...tech },
    hp: st.maxHp,
    maxHp: st.maxHp,
    attack: Math.round(st.attack * 10) / 10,
    speed: Math.round(st.speed),
    range: Math.round(st.range),
    colonists: st.colonists,
    isTanker: st.isTanker
  };
  if (st.cargo) ship.cargo = [];        // satellites on board
  if (SHIP_DEFS[type].named) ship.name = pickShipName(game);
  fleet.ships.push(ship);
  return ship;
}

export function planetById(game, id) { return game.galaxy.planets[id]; }
export function playerById(game, id) { return game.players.find(p => p.id === id); }

function orbitFleet(game, owner, planet) {
  let f = game.fleets.find(f => f.owner === owner && f.at === planet.id && f.dest == null && !f.hole);
  if (!f) f = newFleet(game, owner, planet);
  return f;
}

/** Fleet stats: speed = slowest ship, range = best one + tankers. */
export function fleetStats(fleet) {
  let speed = Infinity, range = 0, attack = 0, hp = 0, tankers = 0;
  for (const s of fleet.ships) {
    if (s.speed > 0) speed = Math.min(speed, s.speed);
    range = Math.max(range, s.range);
    attack += s.attack;
    hp += s.hp;
    if (s.isTanker) tankers++;
  }
  if (!isFinite(speed)) speed = 0;
  if (tankers > 1) range += range * 0.15 * (tankers - 1);
  return { speed, range: Math.round(range), attack: Math.round(attack * 10) / 10, hp, count: fleet.ships.length };
}

/** Own inhabited worlds - supply reaches out from there. */
export function supplyBases(game, owner) {
  return game.galaxy.planets.filter(p => p.owner === owner && p.pop > 0.5);
}

/**
 * Range a fleet needs for this target: the distance from the nearest own
 * supply base (inhabited own planet), measured along the path that can
 * actually be flown - supply can pass through the black hole as little as
 * the fleet itself. Known wormholes carry it to their far side. Computed in
 * shared/rules.js so the UI arrives at the same result.
 */
function supplyNeedFor(game, fleet, target) {
  return supplyNeed(supplyBases(game, fleet.owner), fleet, target, holeZone(game.galaxy),
    portalsFor(game, fleet.owner));
}

/** May this fleet head for this target (a world or a wormhole mouth)? */
export function canReach(game, fleet, target) {
  const st = fleetStats(fleet);
  if (st.speed <= 0) return { ok: false, key: 'err.fleetImmobile', params: {} };
  // Range is rounded in fleetStats, so compare against the rounded distance
  // as well - otherwise 170.3 > 170 rejects a target shown as "170 < 170".
  const need = Math.round(supplyNeedFor(game, fleet, target));
  if (need > st.range) {
    return { ok: false, key: 'err.outOfRange', params: { need, range: st.range } };
  }
  return { ok: true };
}

// -------------------------------------------------------------------- Orders

// ------------------------------------------------------- Affordability

/**
 * What this player can pay for at the end of the turn - with exactly the
 * calculation the client shows in the ledger (shared/budget.js). The view for
 * it is limited to what the budget needs.
 */
function budgetFor(game, player) {
  return forecast({
    you: player.id,
    me: {
      money: player.money, metal: player.metal, tech: player.tech, research: player.research,
      techProgress: Object.fromEntries(TECH_FIELDS.map(f => [f, { points: player.researchPoints[f] }])),
      builds: player.orders.builds, refit: player.orders.refit
    },
    planets: game.galaxy.planets.map(w => w.owner === player.id ? { ...w, defenseShips: w.defenses || [] } : { id: w.id, owner: w.owner }),
    fleets: game.fleets.map(f => ({ id: f.id, at: f.at, mine: f.owner === player.id, ships: f.ships }))
  });
}

/** Does everything on order work out - building and refits complete? */
function affordable(game, player) {
  const h = budgetFor(game, player);
  return h.build.planned.n === h.build.booked.n && h.refit.planned.n === h.refit.booked.n;
}

/** Change a build order; empty entries disappear. */
function buildStep(player, planetId, type, delta) {
  const q = player.orders.builds[planetId] || (player.orders.builds[planetId] = {});
  q[type] = Math.max(0, (q[type] || 0) + delta);
  if (q[type] === 0) delete q[type];
  if (!Object.keys(q).length) delete player.orders.builds[planetId];
}

export function setOrders(game, player, msg) {
  if (game.state !== 'running') return;
  // Principle: only accept what can actually be paid for at the end of the
  // turn. There must never be a "build incomplete" message - it would only
  // arrive when nothing can be changed anymore.
  if (msg.research) {
    const r = msg.research;
    const before = { budgetPct: player.research.budgetPct, weights: { ...player.research.weights } };
    if (typeof r.budgetPct === 'number') player.research.budgetPct = clamp(Math.round(r.budgetPct), 0, 100);
    if (r.weights) {
      for (const f of TECH_FIELDS) {
        if (typeof r.weights[f] === 'number') player.research.weights[f] = clamp(Math.round(r.weights[f]), 0, 10);
      }
    }
    // Research is deducted first. If it takes the money away from the orders
    // (or a breakthrough makes the ships more expensive), the highest share
    // at which everything works out applies - build orders take precedence.
    if (!affordable(game, player)) {
      const wanted = player.research.budgetPct;
      while (player.research.budgetPct > 0 && !affordable(game, player)) player.research.budgetPct--;
      if (!affordable(game, player)) player.research = { ...player.research, ...before };   // should not happen
      else if (player._researchCapped !== game.turn && player.research.budgetPct < wanted) {
        player._researchCapped = game.turn;      // say it once per turn, not on every slider step
        return { error: 'notice.researchCapped', params: { pct: player.research.budgetPct } };
      }
    }
  }
  if (msg.build) {
    const { planetId, type } = msg.build;
    const count = Math.round(Number(msg.build.count));
    const planet = planetById(game, planetId);
    if (!planet || planet.owner !== player.id || !SHIP_TYPES.includes(type) || !Number.isFinite(count) || !count) return;
    if (count > 0 && !shipTypesFor(game.settings).includes(type)) return { error: 'yard.noCapitals' };
    if (count < 0) { buildStep(player, planetId, type, count); return; }
    // Where nobody lives, the server does not build - so accept nothing either.
    if (planet.pop < 1) return { error: 'yard.needPop' };
    const lock = buildLock(type, player.tech, planet.pop);
    if (lock) return { error: 'yard.locked', params: { ...SHIP_DEFS[type].requires } };
    for (let i = 0; i < Math.min(count, 99); i++) {
      buildStep(player, planetId, type, 1);
      if (!affordable(game, player)) {
        buildStep(player, planetId, type, -1);
        return { error: 'notice.buildUnaffordable' };
      }
    }
  }
  if (msg.rename) {
    // Big ships carry a name - the owner may give them another one.
    const ship = game.fleets.filter(f => f.owner === player.id).flatMap(f => f.ships)
      .find(s => s.id === msg.rename.shipId);
    if (!ship || ship.name == null) return { error: 'err.noSuchShip' };
    const name = cleanShipName(msg.rename.name);
    if (!name) return { error: 'err.shipName' };
    ship.name = name;
  }
  if (msg.unload) {
    const planet = planetById(game, msg.unload.planetId);
    if (planet && planet.owner === player.id) {
      if (msg.unload.value === false) delete player.orders.unload[planet.id];
      else player.orders.unload[planet.id] = true;
    }
  }
  if (msg.load || msg.drop) {
    const r = loadOrDrop(game, player, msg.load || msg.drop, !!msg.load);
    if (r) return r;
  }
  if (msg.refit) {
    // Refit: a fleet in orbit of an own shipyard, or the satellites of an own
    // world. Carried out at the end of the turn after research, so right away
    // with the newest levels.
    const r = msg.refit;
    const key = r.fleetId != null ? 'f:' + r.fleetId : 'p:' + r.planetId;
    if (r.value === false) { delete player.orders.refit[key]; return; }
    if (r.fleetId != null) {
      const fleet = game.fleets.find(f => f.id === r.fleetId);
      if (!fleet || fleet.owner !== player.id) return { error: 'err.noSuchFleet' };
      const planet = fleet.at != null ? planetById(game, fleet.at) : null;
      if (!planet || planet.owner !== player.id || planet.pop < 1) return { error: 'err.refitNoYard' };
    } else {
      const planet = planetById(game, r.planetId);
      if (!planet || planet.owner !== player.id || planet.pop < 1) return { error: 'err.refitNoYard' };
    }
    player.orders.refit[key] = true;
    if (!affordable(game, player)) {
      delete player.orders.refit[key];
      return { error: 'notice.refitUnaffordable' };
    }
  }
  if (msg.recycle) {
    const r = recycle(game, player, msg.recycle);
    if (r) return r;
  }
  if (msg.terraform) {
    const planet = planetById(game, msg.terraform.planetId);
    if (planet && planet.owner === player.id) {
      planet.terraBudget = Math.max(0, Math.round(msg.terraform.budget));
    }
  }
  if (msg.move) {
    const fleet = game.fleets.find(f => f.id === msg.move.fleetId);
    // Do not swallow it silently: whoever orders a course should learn why
    // nothing happens - otherwise you click a button and simply nothing
    // happens (e.g. when the fleet has been merged in the meantime).
    if (!fleet || fleet.owner !== player.id) return { error: 'err.noSuchFleet' };
    if (msg.move.hole != null) {
      // Only a mouth this empire has seen - the id of an unseen one gives nothing away.
      const found = player.seenMouths.has(msg.move.hole) ? findMouth(game, msg.move.hole) : null;
      if (!found) return { error: 'err.noSuchHole' };
      const reach = canReach(game, fleet, found.mouth);
      if (!reach.ok) return { error: reach.key, params: reach.params };
      fleet.hole = found.mouth.id;
      fleet.dest = null;
      delete player.orders.moves[fleet.id];
      return;
    }
    if (msg.move.planetId === null) { delete player.orders.moves[fleet.id]; fleet.dest = null; fleet.hole = null; return; }
    const target = planetById(game, msg.move.planetId);
    if (!target) return { error: 'err.noSuchPlanet' };
    const reach = canReach(game, fleet, target);
    if (!reach.ok) return { error: reach.key, params: reach.params };
    fleet.dest = target.id;
    fleet.hole = null;
    player.orders.moves[fleet.id] = target.id;
  }
  if (msg.split) {
    // In orbit the split-off part stays behind without a course, the rest
    // keeps it. In flight both parts fly on to the same target until the new
    // one gets a course of its own - nobody is left adrift in deep space by
    // accident. Movement checks the range of each part again.
    const fleet = game.fleets.find(f => f.id === msg.split.fleetId);
    if (!fleet || fleet.owner !== player.id) return;
    const take = msg.split.ships || [];
    let moved = fleet.ships.filter(s => take.includes(s.id));
    // each: every ship becomes a fleet of its own (colony ships to several
    // worlds). Then all ships may be named - the first stays in the fleet.
    const each = msg.split.each === true;
    if (each && moved.length === fleet.ships.length) moved = moved.slice(1);
    if (!moved.length || moved.length === fleet.ships.length) return;
    fleet.ships = fleet.ships.filter(s => !moved.includes(s));
    const planet = fleet.at != null ? planetById(game, fleet.at) : null;
    const parts = each ? moved.map(s => [s]) : [moved];
    const ids = parts.map(ships => {
      const nf = newFleet(game, player.id, planet);
      nf.ships = ships;
      if (!planet) {
        nf.x = fleet.x; nf.y = fleet.y; nf.z = fleet.z;
        nf.dest = fleet.dest;
        nf.hole = fleet.hole;
        if (fleet.dest != null) player.orders.moves[nf.id] = fleet.dest;
      }
      return nf.id;
    });
    return { newFleet: ids[0] };
  }
  if (msg.merge) {
    const planet = planetById(game, msg.merge.planetId);
    if (!planet) return;
    const own = game.fleets.filter(f => f.owner === player.id && f.at === planet.id && f.dest == null && !f.hole);
    if (own.length < 2) return;
    const target = own[0];
    for (const f of own.slice(1)) { target.ships.push(...f.ships); f.ships = []; }
    cleanupFleets(game);
  }
}

export const SHIP_NAME_MAX = 28;

/**
 * Ship names end up in the client via innerHTML, like player names (see
 * cleanName in server/profile.js): nothing that reads as markup, no control
 * characters, the apostrophe as the letter apostrophe.
 */
function cleanShipName(name) {
  return String(name ?? '')
    .replace(/['`]/g, 'ʼ')
    .replace(/[\u0000-\u001f\u007f<>&"\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SHIP_NAME_MAX)
    .trim();
}

/**
 * Carries out a player's refit orders. If the money is not enough for all
 * of them, as many ships are refitted as can be paid for.
 */
function refitOrders(game, p, entries) {
  for (const key of Object.keys(p.orders.refit)) {
    const [kind, id] = [key.slice(0, 1), key.slice(2)];
    let ships, planet;
    if (kind === 'f') {
      const fleet = game.fleets.find(f => f.id === id && f.owner === p.id);
      planet = fleet && fleet.at != null ? planetById(game, fleet.at) : null;
      ships = fleet ? fleet.ships : [];
    } else {
      planet = planetById(game, Number(id));
      ships = planet?.defenses || [];
    }
    if (!planet || planet.owner !== p.id || planet.pop < 1) continue;
    let done = 0, short = false;
    for (const s of ships) {
      const c = refitCost(s.type, s.tech, p.tech);
      if (!c) continue;
      if (p.money < c.money || p.metal < c.metal) { short = true; continue; }
      p.money -= c.money;
      p.metal -= c.metal;
      p.ledger.refit.money += c.money; p.ledger.refit.metal += c.metal;
      const st = shipStats(s.type, c.tech);
      // The damage stays - only what the better armor adds is new.
      s.hp = Math.max(1, s.hp + st.maxHp - s.maxHp);
      s.maxHp = st.maxHp;
      s.attack = Math.round(st.attack * 10) / 10;
      if (s.speed > 0 || st.speed > 0) s.speed = Math.round(st.speed);
      if (s.range > 0 || st.range > 0) s.range = Math.round(st.range);
      s.tech = c.tech;
      done++;
    }
    if (done) entries.push({ type: 'build', playerIds: [p.id], private: p.id, planetId: planet.id,
      key: 'log.refitted', params: { planet: planet.name, count: done } });
    if (short) entries.push({ type: 'warn', playerIds: [p.id], private: p.id, planetId: planet.id,
      key: 'log.refitShort', params: { planet: planet.name } });
  }
  p.orders.refit = {};
}

/**
 * Recycling: a fleet in orbit of an own shipyard, or satellites of an own
 * world, are taken apart right away - like loading and splitting, so the
 * metal can go into ships in the same turn. Satellites aboard a recycled
 * transporter are set down first, they are not part of the deal. Only
 * accepted if the orders placed so far can still be paid for afterwards.
 */
function recycle(game, player, o) {
  let planet, fleet = null, ships;
  if (o.fleetId != null) {
    fleet = game.fleets.find(f => f.id === o.fleetId);
    if (!fleet || fleet.owner !== player.id) return { error: 'err.noSuchFleet' };
    planet = fleet.at != null ? planetById(game, fleet.at) : null;
    ships = fleet.ships;
  } else {
    planet = planetById(game, o.planetId);
    const sats = planet?.defenses || [];
    const want = o.count == null ? sats.length : Math.max(0, Math.round(Number(o.count)) || 0);
    // The oldest first - those are the ones worth the least in battle.
    ships = [...sats].sort((a, b) => techSum(a) - techSum(b)).slice(0, want);
  }
  if (!planet || planet.owner !== player.id || planet.pop < 1) return { error: 'err.recycleNoYard' };
  if (!ships.length) return { error: 'err.recycleNothing' };
  const v = recycleValue(ships, player.tech.recycling);
  if (!v) return { error: 'err.recycleLocked' };
  if (player.money < v.money) return { error: 'notice.recycleUnaffordable' };
  const money = player.money, metal = player.metal;
  player.money -= v.money;
  player.metal += v.metal;
  if (!affordable(game, player)) {
    player.money = money; player.metal = metal;
    return { error: 'notice.recycleUnaffordable' };
  }
  if (fleet) {
    const defenses = planet.defenses || (planet.defenses = []);
    for (const s of ships) if (s.cargo?.length) defenses.push(...s.cargo);
    fleet.ships = [];
    delete player.orders.moves[fleet.id];
    delete player.orders.refit['f:' + fleet.id];
    cleanupFleets(game);
  } else {
    planet.defenses = planet.defenses.filter(s => !ships.includes(s));
  }
  return { recycled: { count: v.count, money: v.money, metal: v.metal, planetId: planet.id } };
}

function techSum(s) {
  return Object.values(s.tech || {}).reduce((a, x) => a + x, 0);
}

/**
 * Transporters take satellites aboard from the orbit of an own world or set
 * them down there. Right away, like splitting and merging: whoever loads can
 * set off in the same turn. Satellites keep their damage and tech level.
 */
function loadOrDrop(game, player, o, load) {
  const fleet = game.fleets.find(f => f.id === o.fleetId);
  if (!fleet || fleet.owner !== player.id) return { error: 'err.noSuchFleet' };
  const planet = fleet.at != null ? planetById(game, fleet.at) : null;
  if (!planet || planet.owner !== player.id) return { error: 'err.cargoOwnWorld' };
  const holds = fleet.ships.filter(s => s.cargo);
  if (!holds.length) return { error: 'err.noTransporter' };
  const want = o.count == null ? Infinity : Math.max(0, Math.round(Number(o.count)) || 0);
  const defenses = planet.defenses || (planet.defenses = []);
  if (load) {
    const n = Math.min(want, cargoOf(fleet.ships).room, defenses.length);
    if (!defenses.length) return { error: 'err.noSatellites' };
    if (n <= 0) return { error: 'err.cargoFull' };
    // Spread over the transporters: if one is shot down, not everything is lost.
    for (let i = 0; i < n; i++) {
      const hold = holds.filter(s => s.cargo.length < SHIP_DEFS[s.type].cargo)
        .sort((a, b) => a.cargo.length - b.cargo.length)[0];
      hold.cargo.push(defenses.pop());
    }
    return;
  }
  const aboard = holds.reduce((a, s) => a + s.cargo.length, 0);
  if (!aboard) return { error: 'err.cargoEmpty' };
  const n = Math.min(want, aboard);
  const dropped = [];
  for (let i = 0; i < n; i++) {
    const hold = holds.filter(s => s.cargo.length).sort((a, b) => b.cargo.length - a.cargo.length)[0];
    const sat = hold.cargo.pop();
    defenses.push(sat);
    dropped.push([hold, sat]);
  }
  // A refit order for this world now covers more satellites - only accept
  // that if it can still be paid for.
  if (player.orders.refit['p:' + planet.id] && !affordable(game, player)) {
    for (const [hold, sat] of dropped.reverse()) { defenses.splice(defenses.indexOf(sat), 1); hold.cargo.push(sat); }
    return { error: 'notice.dropRefit' };
  }
}

/**
 * Dev mode: a destroyer right away and for free, in the orbit of an own
 * world - the given one, otherwise the homeworld - built with the current
 * levels. Testing it should not take forty turns of research.
 * @returns {boolean} whether one was placed
 */
export function devDestroyer(game, player, planetId) {
  if (!player?.alive || game.settings.capitalShips === false) return false;
  let planet = planetId != null ? planetById(game, planetId) : null;
  if (!planet || planet.owner !== player.id) planet = planetById(game, player.homeworld);
  if (!planet || planet.owner !== player.id) planet = game.galaxy.planets.find(p => p.owner === player.id);
  if (!planet) return false;
  addShip(game, orbitFleet(game, player.id, planet), 'destroyer', player.tech);
  return true;
}

function cleanupFleets(game) {
  game.fleets = game.fleets.filter(f => f.ships.length > 0);
}

// ----------------------------------------------------------- Turn resolution

export function allReady(game) {
  return game.players.filter(p => p.alive).every(p => p.ready || p.isBot || !p.connected);
}

export function resolveTurn(game) {
  const entries = [];
  const rng = game.rng;
  for (const p of game.galaxy.planets) p._orbitLost = false;

  // What is really booked this turn, per item - to verify the client's
  // forecast (shared/budget.js, test/budget.js).
  for (const p of game.players) {
    p.ledger = { research: 0, build: { money: 0, metal: 0 }, refit: { money: 0, metal: 0 }, terra: 0, income: 0, mined: 0 };
  }

  // 1) Research
  for (const p of game.players) {
    if (!p.alive) continue;
    const budget = Math.min(p.money, Math.floor(p.money * p.research.budgetPct / 100));
    if (budget <= 0) continue;
    const total = TECH_FIELDS.reduce((a, f) => a + researchWeight(p, f), 0);
    if (total <= 0) continue;
    p.money -= budget;
    p.ledger.research = budget;
    const before = { ...p.tech };
    const advanced = [];
    for (const f of TECH_FIELDS) {
      const share = budget * researchWeight(p, f) / total;
      if (share <= 0) continue;
      p.researchPoints[f] += share;
      while (p.tech[f] < techMaxLevel(f) && p.researchPoints[f] >= techCostToNext(p.tech[f])) {
        p.researchPoints[f] -= techCostToNext(p.tech[f]);
        p.tech[f]++;
      }
      // Against the levels before this turn - the very first breakthrough counts too.
      if (p.tech[f] > before[f]) advanced.push({ field: f, level: p.tech[f] });
    }
    if (advanced.length) {
      entries.push({ type: 'tech', playerIds: [p.id], private: p.id,
        key: 'log.breakthrough', params: { fields: advanced } });
    }
  }

  // 2) Shipbuilding
  for (const p of game.players) {
    if (!p.alive) continue;
    for (const [pid, queue] of Object.entries(p.orders.builds)) {
      const planet = planetById(game, Number(pid));
      if (!planet || planet.owner !== p.id || planet.pop < 1) continue;
      for (const type of SHIP_TYPES) {
        let n = queue[type] || 0;
        let built = 0;
        // Accepted only when unlocked - but the world may have lost people
        // since (and research never goes back).
        if (n > 0 && buildLock(type, p.tech, planet.pop)) {
          entries.push({ type: 'warn', playerIds: [p.id], private: p.id, planetId: planet.id,
            key: 'log.buildLocked', params: { planet: planet.name, ship: type } });
          continue;
        }
        while (n-- > 0) {
          const cost = shipCost(type, p.tech);
          if (p.money < cost.money || p.metal < cost.metal) break;
          p.money -= cost.money;
          p.metal -= cost.metal;
          p.ledger.build.money += cost.money; p.ledger.build.metal += cost.metal;
          if (type === 'satellite') {
            (planet.defenses || (planet.defenses = [])).push(makeDefense(game, type, p.tech));
          } else {
            addShip(game, orbitFleet(game, p.id, planet), type, p.tech);
          }
          built++;
        }
        if (built > 0) {
          entries.push({ type: 'build', playerIds: [p.id], private: p.id, planetId: planet.id,
            key: 'log.built', params: { planet: planet.name, count: built, ship: type } });
        }
        if (n + 1 > 0 && built < (queue[type] || 0)) {
          entries.push({ type: 'warn', playerIds: [p.id], private: p.id, planetId: planet.id,
            key: 'log.buildShort', params: { planet: planet.name } });
        }
      }
    }
    p.orders.builds = {};
    refitOrders(game, p, entries);
  }

  // 3) Terraforming
  for (const planet of game.galaxy.planets) {
    if (!planet.owner || !planet.terraBudget) continue;
    const p = playerById(game, planet.owner);
    if (!p || !p.alive) continue;
    const allow = terraformable(planet, p.tech.radical);
    let budget = Math.min(planet.terraBudget, p.money);
    if (budget <= 0) continue;
    const dT = planet.temp - IDEAL.temp, dG = planet.grav - IDEAL.grav;
    const needT = allow.temp ? Math.abs(dT) * TERRA_COST_PER_DEGREE : 0;
    const needG = allow.grav ? Math.abs(dG) * TERRA_COST_PER_G : 0;
    if (needT + needG <= 0) {
      if (!allow.temp || !allow.grav) {
        entries.push({ type: 'warn', playerIds: [p.id], private: p.id, planetId: planet.id,
          key: 'log.terraBlocked', params: { planet: planet.name } });
      }
      continue;
    }
    const spend = Math.min(budget, needT + needG);
    const shareT = needT / (needT + needG);
    const spentT = spend * shareT, spentG = spend - spentT;
    if (spentT > 0) {
      const deg = spentT / TERRA_COST_PER_DEGREE;
      planet.temp += dT > 0 ? -Math.min(deg, Math.abs(dT)) : Math.min(deg, Math.abs(dT));
      planet.temp = Math.round(planet.temp * 10) / 10;
    }
    if (spentG > 0) {
      const g = spentG / TERRA_COST_PER_G;
      planet.grav += dG > 0 ? -Math.min(g, Math.abs(dG)) : Math.min(g, Math.abs(dG));
      planet.grav = Math.round(planet.grav * 1000) / 1000;
    }
    p.money -= spend;
    p.ledger.terra += spend;
    // Running total for the owner's overview; starts over with a new owner.
    planet.terraSpent = (planet.terraSpent || 0) + spend;
    if (Math.abs(planet.temp - IDEAL.temp) < 0.05 && Math.abs(planet.grav - IDEAL.grav) < 0.002) {
      planet.temp = IDEAL.temp; planet.grav = IDEAL.grav;
      planet.terraBudget = 0;
      entries.push({ type: 'terra', playerIds: [p.id], private: p.id, planetId: planet.id,
        key: 'log.terraDone', params: { planet: planet.name } });
    }
  }

  // 4) Movement
  const zone = holeZone(game.galaxy);
  const departures = [];            // [fleet, world it departs from this turn]
  for (const fleet of game.fleets) {
    if (fleet.dest == null && !fleet.hole) continue;
    const start = fleet.at;
    const mouth = fleet.hole ? findMouth(game, fleet.hole)?.mouth : null;
    if (fleet.hole && !mouth) { fleet.hole = null; continue; }
    const target = mouth || planetById(game, fleet.dest);
    const st = fleetStats(fleet);
    const owner = playerById(game, fleet.owner);
    if (st.speed <= 0) { fleet.dest = null; fleet.hole = null; continue; }
    const reach = canReach(game, fleet, target);
    if (!reach.ok) {
      fleet.dest = null; fleet.hole = null;
      if (owner) entries.push({ type: 'warn', playerIds: [owner.id], private: owner.id,
        key: 'log.fleetHeld', params: { near: nearestName(game, fleet) },
        because: { key: reach.key, params: reach.params } });
      continue;
    }
    // Around the black hole instead of through it - this makes the path longer.
    const step = advance(fleet, route(fleet, target, zone), st.speed);
    fleet.x = step.x; fleet.y = step.y; fleet.z = step.z;
    if (start != null && start !== fleet.dest) departures.push([fleet, start]);
    if (step.done && mouth) {
      transit(game, fleet, mouth.id, entries);
    } else if (step.done) {
      fleet.at = target.id; fleet.dest = null;
      if (owner) {
        owner.explored.add(target.id);
        entries.push({ type: 'arrive', playerIds: [owner.id], private: owner.id, planetId: target.id,
          key: 'log.arrive', params: { count: st.count, planet: target.name } });
      }
    } else {
      fleet.at = null;
    }
  }
  for (const p of game.players) p.orders.moves = {};

  const fought = new Set();          // worlds with a battle this turn - no repairs there
  // 5) Combat. Whoever departs while an armed enemy is in orbit gets
  // intercepted: they still have to survive INTERCEPT_ROUNDS combat rounds,
  // then they are gone. Otherwise every scout would escape, since all moves happen simultaneously.
  for (const planet of game.galaxy.planets) {
    const fleeing = departures
      .filter(([f, from]) => from === planet.id && f.ships.length && game.fleets.some(g =>
        g.at === planet.id && g.owner !== f.owner && g.ships.some(s => s.attack > 0)))
      .map(([f]) => f);
    if (resolveCombatAt(game, planet, entries, rng, fleeing)) fought.add(planet.id);
  }
  cleanupFleets(game);
  repairFleets(game, fought, entries);

  // 6) Colonization and invasion
  for (const planet of game.galaxy.planets) {
    const present = presentOwners(game, planet);
    if (present.length !== 1) continue;
    const owner = present[0];
    const p = playerById(game, owner);
    if (!p || !p.alive) continue;
    const cap = planetCapacity(planet);

    if (planet.owner && planet.owner !== owner) {
      // Enemy world without remaining defenses: invasion
      const armed = game.fleets.some(f => f.owner === owner && f.at === planet.id && f.ships.some(s => s.attack > 0));
      if (armed) {
        const old = playerById(game, planet.owner);
        const before = planet.pop;
        planet.owner = owner;
        planet.pop = Math.max(0.5, Math.round(before * 0.65 * 10) / 10);
        planet.terraBudget = 0;
        planet.terraSpent = 0;
        entries.push({ type: 'invade', playerIds: [owner, old ? old.id : null].filter(Boolean), planetId: planet.id,
          key: old ? 'log.invadeFrom' : 'log.invade',
          params: { player: p.name, planet: planet.name, from: old ? old.name : null } });
      }
      continue;
    }

    // Own or free world: settlers disembark. On own worlds only on explicit
    // orders - otherwise the colony ship would dissolve right in the home
    // orbit.
    const unowned = planet.owner === null;
    if (!unowned && !p.orders.unload[planet.id]) continue;

    let landed = 0;
    for (const fleet of game.fleets.filter(f => f.owner === owner && f.at === planet.id)) {
      const keep = [];
      for (const s of fleet.ships) {
        if (s.colonists > 0 && planet.pop < cap && cap >= 1) {
          planet.pop = Math.min(cap, planet.pop + s.colonists);
          landed += s.colonists;
        } else keep.push(s);
      }
      fleet.ships = keep;
    }
    if (landed > 0) {
      planet.owner = owner;
      planet.pop = Math.round(planet.pop * 10) / 10;
      entries.push({ type: unowned ? 'colonize' : 'settle', playerIds: [owner], planetId: planet.id,
        ...(unowned ? { key: 'log.colonize', params: { player: p.name, planet: planet.name } }
                    : { key: 'log.settle', params: { planet: planet.name, amount: Math.round(landed * 10) / 10 } }) });
    } else if (unowned && cap < 1) {
      const hasColony = game.fleets.some(f => f.owner === owner && f.at === planet.id && f.ships.some(s => s.colonists > 0));
      if (hasColony) entries.push({ type: 'warn', playerIds: [owner], private: owner, planetId: planet.id,
        key: 'log.uninhabitable', params: { planet: planet.name } });
    }
  }
  for (const p of game.players) p.orders.unload = {};
  cleanupFleets(game);

  // 7) Economy
  for (const p of game.players) { p.income = 0; }
  for (const planet of game.galaxy.planets) {
    if (!planet.owner) continue;
    const p = playerById(game, planet.owner);
    if (!p || !p.alive) { planet.owner = null; continue; }
    const inc = planetIncome(planet);
    p.money += inc;
    p.income += inc;
    p.ledger.income += inc;
    const mined = planetMining(planet);
    planet.metalReserve = Math.max(0, planet.metalReserve - mined);
    p.metal += mined;
    p.ledger.mined += mined;
    const cap = planetCapacity(planet);
    if (cap < 1) {
      planet.pop = Math.max(0, planet.pop - Math.max(0.4, planet.pop * 0.25));
    } else if (planet.pop > cap) {
      planet.pop = Math.max(cap, planet.pop - (planet.pop - cap) * 0.3);
    } else {
      planet.pop = Math.min(cap, planet.pop + planet.pop * POP_GROWTH * (1 - planet.pop / cap) + 0.05);
    }
    planet.pop = Math.round(planet.pop * 10) / 10;
    if (planet.pop <= 0.1) {
      entries.push({ type: 'lost', playerIds: [p.id], planetId: planet.id,
        key: 'log.colonyLost', params: { planet: planet.name } });
      planet.owner = null; planet.pop = 0; planet.terraBudget = 0; planet.terraSpent = 0; planet.defenses = [];
    }
  }
  for (const p of game.players) {
    p.money = Math.round(p.money * 10) / 10;
    p.metal = Math.round(p.metal * 10) / 10;
    p.income = Math.round(p.income);
  }

  // 8) Expansion, visibility, statistics, elimination - grow first, then
  // look: otherwise new worlds within scanner range stay blind for a turn.
  maybeExpand(game, entries);
  wormholeTurn(game, entries);
  updateVisibility(game);
  spotWormholes(game, entries);
  for (const p of game.players) {
    const planets = game.galaxy.planets.filter(q => q.owner === p.id);
    p.stats.planets = planets.length;
    p.stats.pop = Math.round(planets.reduce((a, q) => a + q.pop, 0) * 10) / 10;
    p.stats.ships = game.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + f.ships.length + cargoOf(f.ships).used, 0)
      + game.galaxy.planets.reduce((a, q) => a + ((q.owner === p.id && q.defenses) ? q.defenses.length : 0), 0);
    // Without a world it is over: range is measured from own inhabited worlds,
    // so leftover ships could not go anywhere anymore. They vanish with the
    // empire instead of standing on the map as ghost fleets. (A colony ship
    // above a free world has already been allowed to land above.)
    if (p.alive && p.stats.planets === 0) {
      p.alive = false;
      game.fleets = game.fleets.filter(f => f.owner !== p.id);
      p.stats.ships = 0;
      entries.push({ type: 'eliminated', playerIds: [p.id],
        key: 'log.eliminated', params: { player: p.name } });
    }
  }

  game.turn++;
  game.lastTurnAt = Date.now();
  for (const p of game.players) p.ready = false;
  pushLog(game, entries);

  const alive = game.players.filter(p => p.alive);
  if (alive.length === 1 && game.players.length > 1) {
    game.state = 'over';
    game.winner = alive[0].id;
    pushLog(game, [{ type: 'victory', key: 'log.victory', params: { player: alive[0].name } }]);
  } else if (game.settings.maxTurns && game.turn > game.settings.maxTurns) {
    game.state = 'over';
    const best = alive.sort((a, b) => b.stats.pop - a.stats.pop)[0];
    game.winner = best ? best.id : null;
    pushLog(game, [{ type: 'victory',
      key: best ? 'log.turnLimit' : 'log.turnLimitNobody',
      params: { player: best ? best.name : null } }]);
  }
  armTurnTimer(game);
  return entries;
}

const EDGE_TRIGGER = 200;    // distance to the outermost world at which the map gives way
// The galaxy does not grow without end: at most this many worlds per empire
// that took part (AI included), then it is complete.
export const MAX_WORLDS_PER_PLAYER = 100;
// The direction comes out as a keyword; it is named in the catalog
// (dir.left ... dir.bottom).

/**
 * Exploration stretches the map: whoever comes close to the outermost worlds
 * pushes the border further out. At most one strip per turn - the most urgent
 * direction first - so the galaxy grows instead of jumping.
 */
function maybeExpand(game, entries) {
  if (game.settings.expanding === false) return;
  const g = game.galaxy;
  if (g.complete) return;
  const room = game.players.length * MAX_WORLDS_PER_PLAYER - g.planets.length;
  if (room <= 0) { complete(); return; }
  // New land only once the old one is largely taken: as long as there are
  // more than two free habitable worlds per living empire, the map stays as
  // it is - otherwise it would grow without bounds. Uninhabitable worlds do
  // not count, nobody takes them anyway.
  const living = game.players.filter(p => p.alive).length;
  let free = 0;
  for (const q of g.planets) if (!q.owner && planetCapacity(q) >= 1) free++;
  if (free > Math.max(3, living * 2)) return;
  const eyes = [];
  for (const q of g.planets) if (q.owner) eyes.push(q);
  for (const f of game.fleets) eyes.push(f);
  if (!eyes.length) return;

  // Spiral: measured from the core outwards, and it grows as a ring.
  if (g.field) {
    let maxR = 0;
    for (const e of eyes) maxR = Math.max(maxR, Math.hypot(e.x - g.field.cx, e.y - g.field.cy));
    if (maxR < g.field.rOut - EDGE_TRIGGER) return;
    const added = expandSpiral(g, room);
    if (added.length) {
      entries.push({ type: 'galaxy', key: 'log.armsGrow', params: { count: added.length } });
    }
    if (added.length >= room) complete();
    return;
  }

  // Measured to the border, not to the outermost world: new worlds keep
  // their distance from the edge, so you have to go further out for the next strip.
  let best = null, bestD = EDGE_TRIGGER;
  for (const e of eyes) {
    if (e.x - g.minX < bestD) { bestD = e.x - g.minX; best = 'left'; }
    if (g.maxX - e.x < bestD) { bestD = g.maxX - e.x; best = 'right'; }
    if (e.y - g.minY < bestD) { bestD = e.y - g.minY; best = 'top'; }
    if (g.maxY - e.y < bestD) { bestD = g.maxY - e.y; best = 'bottom'; }
  }
  if (!best) return;

  const added = expandGalaxy(g, best, room);
  if (!added.length) return;
  entries.push({ type: 'galaxy', key: 'log.mapGrows',
    params: { count: added.length, direction: best } });
  if (added.length >= room) complete();

  /** The limit is reached: said once, then the map stays as it is. */
  function complete() {
    g.complete = true;
    entries.push({ type: 'galaxy', key: 'log.galaxyComplete', params: { count: g.planets.length } });
  }
}

// Numbers go out unformatted - how they are written (comma or period) is
// up to the client's language.
function round1(n) { return Math.round(n * 10) / 10; }

function makeDefense(game, type, tech) {
  const st = shipStats(type, tech);
  return {
    id: 's' + game.nextShipId++, type, tech: { ...tech },
    hp: st.maxHp, maxHp: st.maxHp,
    attack: Math.round(st.attack * 10) / 10, speed: 0, range: 0, colonists: 0, isTanker: false
  };
}

function nearestName(game, point) {
  let best = null, bd = Infinity;
  for (const p of game.galaxy.planets) {
    const d = dist(p, point);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? best.name : '?';
}

/**
 * Which players have ships at this planet? The population alone does not
 * hold the orbit - that is exactly where defenseless colonies fail.
 */
function presentOwners(game, planet) {
  const set = new Set();
  for (const f of game.fleets) if (f.at === planet.id && f.ships.length) set.add(f.owner);
  if (planet.owner && planet.defenses && planet.defenses.length) set.add(planet.owner);
  if (planet.owner && planet.pop >= 0.5 && !planet._orbitLost) set.add(planet.owner);
  return [...set];
}

const gunsOf = s => SHIP_DEFS[s.type]?.guns || 1;
/** Big ships draw the fire: picked as often as `weight` small ones. */
const targetWeight = s => SHIP_DEFS[s.type]?.weight || 1;

/**
 * A target by weight. With equal weights exactly the same pick as
 * enemies[Math.floor(r * n)] - existing battles roll the same as before.
 */
function pickTarget(enemies, weights, total, r) {
  let x = r * total;
  for (let i = 0; i < enemies.length; i++) {
    x -= weights[i];
    if (x < 0) return enemies[i];
  }
  return enemies[enemies.length - 1];
}

/**
 * Repairs in the orbit of own worlds: a fleet with a destroyer gets back a
 * share of every ship's hull - but not in a turn with a battle there.
 */
function repairFleets(game, fought, entries) {
  for (const f of game.fleets) {
    if (f.at == null || fought.has(f.at) || !f.ships.some(s => SHIP_DEFS[s.type]?.repair)) continue;
    const planet = planetById(game, f.at);
    if (!planet || planet.owner !== f.owner) continue;
    let mended = 0;
    for (const s of f.ships) {
      if (s.hp >= s.maxHp) continue;
      s.hp = Math.min(s.maxHp, round1(s.hp + s.maxHp * REPAIR_SHARE));
      mended++;
    }
    if (mended) entries.push({ type: 'build', playerIds: [f.owner], private: f.owner, planetId: planet.id,
      key: 'log.repaired', params: { planet: planet.name, count: mended } });
  }
}

/** @returns {boolean} whether there was a battle */
function resolveCombatAt(game, planet, entries, rng, fleeing = []) {
  const sides = new Map();
  let battery = null;
  for (const f of game.fleets) {
    if (f.at !== planet.id || !f.ships.length) continue;
    if (!sides.has(f.owner)) sides.set(f.owner, []);
    sides.get(f.owner).push(...f.ships);
  }
  // Intercepted ships only fight during the first INTERCEPT_ROUNDS rounds
  const escaping = new Set();
  for (const f of fleeing) {
    if (!sides.has(f.owner)) sides.set(f.owner, []);
    sides.get(f.owner).push(...f.ships);
    for (const s of f.ships) escaping.add(s);
  }
  if (planet.owner && planet.defenses && planet.defenses.length) {
    if (!sides.has(planet.owner)) sides.set(planet.owner, []);
    sides.get(planet.owner).push(...planet.defenses);
  }
  // Only fight if there is any stranger in orbit at all
  const intruder = [...sides.keys()].some(o => o !== planet.owner);
  if (!intruder) return false;
  if (planet.owner) {
    const ownerP = playerById(game, planet.owner);
    const bs = ownerP ? batteryStats(planet.pop, ownerP.tech) : null;
    if (bs) {
      battery = { id: 'battery', type: 'battery', attack: bs.attack, hp: bs.hp, maxHp: bs.hp, isBattery: true };
      if (!sides.has(planet.owner)) sides.set(planet.owner, []);
      sides.get(planet.owner).push(battery);
    }
  }
  if (sides.size < 2) return false;
  const anyArmed = [...sides.values()].some(ships => ships.some(s => s.attack > 0));
  if (!anyArmed) return false;

  const before = new Map([...sides].map(([k, v]) => [k, v.length]));

  // Record for the replay in the client: every unit once, every shot as
  // [shooter, target, damage]. Compact, because it travels with the view.
  const owners = [...sides.keys()];
  const units = [];
  const idx = new Map();
  owners.forEach((owner, k) => {
    for (const s of sides.get(owner)) {
      idx.set(s, units.length);
      units.push([k, s.isBattery ? 'battery' : s.type, s.hp, round1(s.maxHp)]);
    }
  });
  const rounds = [];

  for (let round = 0; round < COMBAT_ROUNDS; round++) {
    const engaged = s => s.hp > 0 && (round < INTERCEPT_ROUNDS || !escaping.has(s));
    const alive = [...sides].filter(([, ships]) => ships.some(engaged));
    if (alive.length < 2) break;
    const damage = [];
    for (const [owner, ships] of alive) {
      const enemies = alive.filter(([o]) => o !== owner).flatMap(([, s]) => s.filter(engaged));
      if (!enemies.length) continue;
      const weights = enemies.map(targetWeight);
      const total = weights.reduce((a, w) => a + w, 0);
      for (const s of ships) {
        if (!engaged(s) || s.attack <= 0) continue;
        // Big ships fire several guns, each at a target of its own.
        const guns = gunsOf(s);
        for (let g = 0; g < guns; g++) {
          const t = pickTarget(enemies, weights, total, rng());
          // Rounded to tenths - exactly as it appears in the record.
          damage.push([t, round1(s.attack / guns * (0.75 + rng() * 0.5)), s]);
        }
      }
    }
    rounds.push(damage.map(([t, dmg, s]) => [idx.get(s), idx.get(t), dmg]));
    // To tenths, like the damage: otherwise a remainder like 2e-15 would be
    // left after subtracting, and a ship without a hull would fly on.
    for (const [t, dmg] of damage) t.hp = round1(t.hp - dmg);
    for (const [, ships] of sides) for (const s of ships) if (s.hp < 0) s.hp = 0;
  }

  // Record losses
  for (const [owner, ships] of sides) {
    const lost = ships.filter(s => s.hp <= 0 && !s.isBattery).length;
    const p = playerById(game, owner);
    if (p) { p.stats.losses += lost; }
  }
  if (battery && battery.hp <= 0) {
    planet._orbitLost = true;
    const before = planet.pop;
    planet.pop = Math.round(Math.max(0, planet.pop * 0.7) * 10) / 10;
    entries.push({ type: 'combat', planetId: planet.id, playerIds: [planet.owner],
      key: 'log.batteryBroken',
      params: { planet: planet.name, before: round1(before), after: round1(planet.pop) } });
  }
  // Remove the dead - satellites aboard go down with their transporter
  for (const f of game.fleets) {
    if (f.at !== planet.id && !fleeing.includes(f)) continue;
    cargoLost(f, f.ships.filter(s => s.hp <= 0), planet, entries);
    f.ships = f.ships.filter(s => s.hp > 0);
  }
  if (planet.defenses) planet.defenses = planet.defenses.filter(s => s.hp > 0);

  // Whoever still has weapons controls the orbit; defenseless ships are lost.
  const armedOwners = new Set();
  for (const f of game.fleets) if (f.at === planet.id && f.ships.some(s => s.attack > 0)) armedOwners.add(f.owner);
  if (planet.defenses && planet.defenses.some(s => s.attack > 0)) armedOwners.add(planet.owner);
  if (battery && battery.hp > 0) armedOwners.add(planet.owner);
  const scuttled = [];
  if (armedOwners.size === 1) {
    const victor = [...armedOwners][0];
    for (const f of game.fleets) {
      if (f.at === planet.id && f.owner !== victor && f.ships.length) {
        const p = playerById(game, f.owner);
        if (p) p.stats.losses += f.ships.length;
        for (const s of f.ships) if (idx.has(s)) scuttled.push(idx.get(s));
        cargoLost(f, f.ships, planet, entries);
        f.ships = [];
      }
    }
  }

  // Every side as its own item - the sentence around it belongs in the catalog.
  const tally = [];
  for (const [owner, n] of before) {
    const p = playerById(game, owner);
    const left = (game.fleets.filter(f => (f.at === planet.id || fleeing.includes(f)) && f.owner === owner)
      .reduce((a, f) => a + f.ships.length, 0))
      + (planet.owner === owner && planet.defenses ? planet.defenses.length : 0);
    tally.push({ name: p ? p.name : String(owner), left, before: n });
  }
  entries.push({
    type: 'combat', planetId: planet.id, playerIds: [...before.keys()],
    key: 'log.battle', params: { planet: planet.name, sides: tally },
    battle: { sides: owners, units, rounds, scuttled, fled: [...escaping].map(s => idx.get(s)) }
  });
  cleanupFleets(game);
  return true;
}

/** Satellites that went down with lost transporters - told to the owner only. */
function cargoLost(fleet, ships, planet, entries) {
  const n = ships.reduce((a, s) => a + (s.cargo ? s.cargo.length : 0), 0);
  if (n) entries.push({ type: 'warn', playerIds: [fleet.owner], private: fleet.owner, planetId: planet.id,
    key: 'log.cargoLost', params: { planet: planet.name, count: n } });
}

// ---------------------------------------------------------------- Visibility

export function updateVisibility(game) {
  for (const p of game.players) {
    // Collect own worlds and fleets once: the map grows, otherwise every new
    // world would be checked against every other here.
    const mine = game.galaxy.planets.filter(q => q.owner === p.id);
    const myFleets = game.fleets.filter(f => f.owner === p.id);
    for (const planet of game.galaxy.planets) {
      const presence = planet.owner === p.id || myFleets.some(f => f.at === planet.id);
      if (presence) {
        p.explored.add(planet.id);
        p.knowledge[planet.id] = snapshotPlanet(game, planet, game.turn);
      }
    }
    // Scanners: own worlds and fleets roughly see their neighborhood - anew
    // every turn. Recording only on first discovery would mean: a world that
    // was free would stay free on the map, even if someone settled there
    // long ago.
    for (const planet of game.galaxy.planets) {
      if (planet.owner === p.id || myFleets.some(f => f.at === planet.id)) continue;
      const seen = mine.some(q => dist(q, planet) < SCAN.world)
        || myFleets.some(f => dist(f, planet) < SCAN.fleet);
      if (seen) {
        p.explored.add(planet.id);
        p.knowledge[planet.id] = snapshotPlanet(game, planet, game.turn);
      }
    }
  }
}

function snapshotPlanet(game, planet, turn) {
  return {
    turn,
    temp: planet.temp, grav: planet.grav,
    metalRichness: planet.metalRichness, metalReserve: Math.round(planet.metalReserve),
    owner: planet.owner, pop: planet.pop,
    defenses: planet.defenses ? planet.defenses.length : 0,
    sizeFactor: planet.sizeFactor
  };
}

/**
 * Combat stats of the satellites of an own world: combined, and the weakest
 * tech level - that tells whether a refit is worth it.
 */
function defenseStats(planet) {
  const d = planet.defenses || [];
  if (!d.length) return null;
  return {
    attack: round1(d.reduce((a, s) => a + s.attack, 0)),
    hp: Math.round(d.reduce((a, s) => a + s.hp, 0)),
    maxHp: Math.round(d.reduce((a, s) => a + s.maxHp, 0)),
    weapons: Math.min(...d.map(s => s.tech?.weapons || 1)),
    shields: Math.min(...d.map(s => s.tech?.shields || 1))
  };
}

function pushLog(game, entries) {
  if (!entries.length) return;
  // Only the latest turn keeps its battle records - nobody needs older
  // ones, and they would travel along with every view.
  for (const l of game.log.slice(-3)) {
    if (l.turn < game.turn) for (const e of l.entries) delete e.battle;
  }
  game.log.push({ turn: game.turn, entries });
  if (game.log.length > 120) game.log.shift();
}

// ------------------------------------------------------------- View per player

/**
 * Does this empire see a foreign fleet - near one of its worlds or fleets?
 * Then it knows course, arrival and the number of ships, not what they are.
 * The AI goes by the same rule.
 */
export function inSight(game, playerId, f) {
  return game.galaxy.planets.some(q => q.owner === playerId && dist(q, f) < 300)
    || game.fleets.some(g => g.owner === playerId && g.ships.length && dist(g, f) < 240);
}

export function buildView(game, player) {
  const vis = new Set();   // planets with current sight
  for (const planet of game.galaxy.planets) {
    if (planet.owner === player.id || game.fleets.some(f => f.owner === player.id && f.at === planet.id)) vis.add(planet.id);
  }

  const planets = game.galaxy.planets.map(p => {
    const base = { id: p.id, name: p.name, x: p.x, y: p.y, z: p.z || 0 };
    if (vis.has(p.id)) {
      return {
        ...base, known: 'live',
        temp: p.temp, grav: p.grav, sizeFactor: p.sizeFactor,
        metalRichness: p.metalRichness,
        // Exact, not rounded: the client's ledger recomputes the mining with
        // it (rounding only happens on display).
        metalReserve: p.owner === player.id ? p.metalReserve : Math.round(p.metalReserve),
        owner: p.owner, pop: p.pop,
        defenses: p.defenses ? p.defenses.length : 0,
        // Type and tech level of every satellite: refits use the levels after
        // research, and only the client's ledger knows those.
        defenseShips: p.owner === player.id && p.defenses ? p.defenses.map(d => ({ type: d.type, tech: d.tech })) : null,
        defenseStats: p.owner === player.id ? defenseStats(p) : null,
        terraBudget: p.owner === player.id ? p.terraBudget : 0,
        terraSpent: p.owner === player.id ? Math.round(p.terraSpent || 0) : 0,
        isHomeworld: !!p.isHomeworld
      };
    }
    const k = player.knowledge[p.id];
    // A memory in which you were the owner yourself is outdated: if the world
    // still belonged to you, it would be in sight above. The log has reported
    // the loss - so do not show it as your own here either, otherwise the list,
    // income and shipyard would count a world that is not yours.
    if (k) {
      const owner = k.owner === player.id ? p.owner : k.owner;
      return { ...base, known: 'memory', ...k, owner, terraBudget: 0, terraSpent: 0, isHomeworld: !!p.isHomeworld };
    }
    return { ...base, known: 'unknown' };
  });

  // Fleets: own ones always, foreign ones on sight contact
  const fleets = [];
  for (const f of game.fleets) {
    if (!f.ships.length) continue;
    const mine = f.owner === player.id;
    if (mine) {
      fleets.push({
        id: f.id, owner: f.owner, at: f.at,
        x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z || 0), dest: f.dest, hole: f.hole,
        mine: true,
        ships: f.ships.map(s => ({ id: s.id, type: s.type, hp: Math.round(s.hp), maxHp: s.maxHp, attack: s.attack, speed: s.speed, range: s.range, colonists: s.colonists, tech: s.tech,
          ...(s.cargo ? { cargo: s.cargo.length } : {}), ...(s.name ? { name: s.name } : {}) })),
        stats: fleetStats(f)
      });
      continue;
    }
    if ((f.at !== null && vis.has(f.at)) || inSight(game, player.id, f)) {
      // Whoever has a foreign fleet in their own space scouts it well enough to
      // know its course and arrival - what it flies with stays hidden.
      // A course to a wormhole only shows if its mouth is in sight.
      const mouth = f.hole && player.seenMouths.has(f.hole) ? findMouth(game, f.hole)?.mouth : null;
      const target = mouth || (f.dest != null ? planetById(game, f.dest) : null);
      const speed = target ? fleetStats(f).speed : 0;
      fleets.push({
        id: f.id, owner: f.owner, at: f.at,
        x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z || 0),
        dest: f.dest != null && !mouth ? f.dest : null,
        hole: mouth ? mouth.id : null,
        eta: target && speed > 0
          ? Math.max(1, Math.ceil(travelDistance(f, target, holeZone(game.galaxy)) / speed))
          : null,
        mine: false, count: f.ships.length,
        // A big ship is known by its name, like at sea.
        ships: f.ships.map(s => ({ id: s.id, type: s.type, ...(s.name ? { name: s.name } : {}) })),
        stats: { count: f.ships.length }
      });
    }
  }

  return {
    turn: game.turn,
    state: game.state,
    winner: game.winner || null,
    you: player.id,
    deadline: game.turnDeadline,
    host: hostOf(game)?.id ?? null,
    paused: pauseView(game),
    mode: game.settings.mode || 'classic',
    maxTurns: game.settings.maxTurns || 0,       // 0 = no limit: whoever is left wins
    capitalShips: game.settings.capitalShips !== false,
    galaxy: {
      minX: game.galaxy.minX, minY: game.galaxy.minY, minZ: game.galaxy.minZ || 0,
      maxX: game.galaxy.maxX, maxY: game.galaxy.maxY, maxZ: game.galaxy.maxZ || 0,
      width: game.galaxy.width, height: game.galaxy.height,
      shape: game.galaxy.shape || 'scatter',
      blackHole: game.galaxy.blackHole || null
    },
    wormholes: wormholeView(game, player),
    me: {
      id: player.id, name: player.name, color: player.color, emblem: player.emblem, avatar: player.avatar,
      // Accurate to one decimal, as the server computes - with the rounded
      // amount the research forecast would occasionally be off by 1.
      money: Math.round(player.money * 10) / 10, metal: Math.round(player.metal * 10) / 10, income: player.income,
      tech: { ...player.tech },
      techProgress: Object.fromEntries(TECH_FIELDS.map(f => [f, {
        points: player.researchPoints[f], next: techCostToNext(player.tech[f])
      }])),
      research: { budgetPct: player.research.budgetPct, weights: { ...player.research.weights } },
      ready: player.ready,
      homeworld: player.homeworld,
      builds: player.orders.builds,
      refit: player.orders.refit
    },
    players: game.players.map(p => ({
      id: p.id, name: p.name, color: p.color, emblem: p.emblem, avatar: p.avatar, isBot: p.isBot, persona: p.persona,
      connected: p.connected, alive: p.alive, ready: p.ready,
      stats: { planets: p.stats.planets, pop: p.stats.pop, ships: p.stats.ships }
    })),
    planets, fleets,
    log: game.log.slice(-25).map(l => ({
      turn: l.turn,
      entries: l.entries.filter(e => visibleEntry(e, player.id)).map(logEntry)
    })).filter(l => l.entries.length)
  };
}

/**
 * View for spectators: no fog, no empire of their own. Everything is out in
 * the open - tech levels, treasuries and the complete log.
 */
export function buildSpectatorView(game) {
  const planets = game.galaxy.planets.map(p => ({
    id: p.id, name: p.name, x: p.x, y: p.y, z: p.z || 0, known: 'live',
    temp: p.temp, grav: p.grav, sizeFactor: p.sizeFactor,
    metalRichness: p.metalRichness, metalReserve: Math.round(p.metalReserve),
    owner: p.owner, pop: p.pop,
    defenses: p.defenses ? p.defenses.length : 0,
    terraBudget: p.terraBudget || 0,
    terraSpent: Math.round(p.terraSpent || 0),
    isHomeworld: !!p.isHomeworld
  }));

  const fleets = game.fleets.filter(f => f.ships.length).map(f => ({
    id: f.id, owner: f.owner, at: f.at,
    x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z || 0), dest: f.dest, hole: f.hole, mine: false,
    ships: f.ships.map(s => ({
      id: s.id, type: s.type, hp: Math.round(s.hp), maxHp: s.maxHp,
      attack: s.attack, speed: s.speed, range: s.range, colonists: s.colonists, tech: s.tech,
      ...(s.cargo ? { cargo: s.cargo.length } : {}), ...(s.name ? { name: s.name } : {})
    })),
    stats: fleetStats(f)
  }));

  return {
    turn: game.turn,
    state: game.state,
    winner: game.winner || null,
    spectator: true,
    code: game.id,
    you: null,
    me: null,
    deadline: null,
    paused: pauseView(game),
    pace: { ...game.pace },
    mode: game.settings.mode || 'classic',
    maxTurns: game.settings.maxTurns || 0,       // 0 = no limit: whoever is left wins
    capitalShips: game.settings.capitalShips !== false,
    galaxy: {
      minX: game.galaxy.minX, minY: game.galaxy.minY, minZ: game.galaxy.minZ || 0,
      maxX: game.galaxy.maxX, maxY: game.galaxy.maxY, maxZ: game.galaxy.maxZ || 0,
      width: game.galaxy.width, height: game.galaxy.height,
      shape: game.galaxy.shape || 'scatter',
      blackHole: game.galaxy.blackHole || null
    },
    wormholes: wormholeView(game, null),
    players: game.players.map(p => ({
      id: p.id, name: p.name, color: p.color, emblem: p.emblem, avatar: p.avatar, isBot: p.isBot, persona: p.persona,
      level: p.level,                      // spectators see how well each AI plays
      connected: p.connected, alive: p.alive, ready: p.ready,
      tech: { ...p.tech },
      money: Math.round(p.money), metal: Math.round(p.metal), income: Math.round(p.income || 0),
      stats: { planets: p.stats.planets, pop: p.stats.pop, ships: p.stats.ships }
    })),
    planets, fleets,
    log: game.log.slice(-25).map(l => ({
      turn: l.turn,
      entries: l.entries.map(logEntry)
    }))
  };
}

/**
 * A log entry for the client: key and values instead of a finished sentence -
 * the sentence is only assembled there, in the player's language.
 */
function logEntry(e) {
  const out = {
    type: e.type, planetId: e.planetId ?? null,
    key: e.key, params: e.params, because: e.because
  };
  if (e.battle) out.battle = e.battle;
  return out;
}

/** Everyone sees victories and eliminations; everything else only those involved. */
const PUBLIC_ENTRIES = new Set(['start', 'victory', 'eliminated']);
function visibleEntry(e, playerId) {
  if (e.private && e.private !== playerId) return false;
  if (PUBLIC_ENTRIES.has(e.type)) return true;
  if (e.playerIds && e.playerIds.length) return e.playerIds.includes(playerId);
  return true;
}

function pauseView(game) {
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

/** The host sets how well an AI empire plays - only in the lobby. */
export function setBotLevel(game, player, level) {
  if (game.state !== 'lobby' || !player?.isBot || !AI_LEVELS.includes(level)) return false;
  player.level = level;
  return true;
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
