// Spielzustand und Zugauflösung. Der Server ist autoritativ - der Client
// schickt nur Befehle, niemals Ergebnisse.
import {
  TECH_FIELDS, TECH_MAX_LEVEL, TECH_START_LEVEL, techCostToNext,
  SHIP_DEFS, SHIP_TYPES, shipCost, shipStats, refitCost, refitTotal,
  habitability, planetCapacity, planetIncome, planetMining, POP_GROWTH,
  IDEAL, TERRA_COST_PER_DEGREE, TERRA_COST_PER_G, terraformable,
  COMBAT_ROUNDS, batteryStats, dist, clamp, PLAYER_COLORS, PLAYER_EMBLEMS, AI_PERSONAS,
  holeZone, route, advance, travelDistance, supplyDistance
} from '../shared/rules.js';
import { generateGalaxy, expandGalaxy, expandSpiral, makeRng } from './galaxy.js';

export const DEFAULT_SETTINGS = {
  planetsPerPlayer: 6,
  startMoney: 1600,
  startMetal: 400,
  turnTimer: 0,        // Sekunden; 0 = warten bis alle fertig sind
  expanding: true,     // Karte wächst mit der Erkundung
  mode: 'classic',     // 'classic' = flach, 'space' = räumlich (Linse)
  shape: 'scatter',    // 'scatter' = Streufeld, 'spiral' = Spirale um ein schwarzes Loch
  maxTurns: 300,       // 0 = unbegrenzt
  seed: null
};

let gameCounter = 0;

export function createGame(hostName) {
  gameCounter++;
  return {
    id: makeGameCode(),
    created: Date.now(),
    state: 'lobby',
    settings: { ...DEFAULT_SETTINGS },
    hostName,
    turn: 0,
    galaxy: null,
    players: [],
    fleets: [],
    nextFleetId: 1,
    nextShipId: 1,
    log: [],
    turnDeadline: null,
    // Zuschauer: Verbindungen ohne eigenes Reich. Der Takt gehört zur Partie,
    // damit mehrere Zuschauer dasselbe sehen.
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

// Namen für KI-Reiche - lieber albern als durchnummeriert.
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

/** Ein noch freier Spitzname; sind alle vergeben, zählt die Nummer. */
function botName(game) {
  const used = new Set(game.players.map(p => p.name));
  const free = BOT_NAMES.filter(n => !used.has(n));
  return free.length
    ? free[Math.floor(Math.random() * free.length)]
    : 'KI ' + (game.players.length + 1);
}

/**
 * Persönlichkeit für ein neues KI-Reich: eine, die in der Partie noch am
 * seltensten vorkommt - so bekommt jede Runde eine bunte Mischung.
 */
function botPersona(game) {
  const zahl = Object.fromEntries(AI_PERSONAS.map(k => [k, 0]));
  for (const p of game.players) if (p.isBot && p.persona in zahl) zahl[p.persona]++;
  const wenigste = Math.min(...Object.values(zahl));
  const frei = AI_PERSONAS.filter(k => zahl[k] === wenigste);
  return frei[Math.floor(Math.random() * frei.length)];
}

export function addPlayer(game, { name, isBot = false, connId = null, persona = null }) {
  if (game.players.length >= 16) return null;
  const slot = game.players.length;
  const p = {
    id: 'p' + (slot + 1),
    slot,
    name: name || (isBot ? botName(game) : 'Spieler ' + (slot + 1)),
    color: PLAYER_COLORS[slot],
    emblem: PLAYER_EMBLEMS[slot],
    isBot,
    persona: isBot ? (AI_PERSONAS.includes(persona) ? persona : botPersona(game)) : null,
    connId,
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
    knowledge: {},            // planetId -> letzter bekannter Zustand
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
  game.players.forEach((p, idx) => {
    p.slot = idx;
    p.color = PLAYER_COLORS[idx];
    p.emblem = PLAYER_EMBLEMS[idx];
  });
}

// ------------------------------------------------------------------ Spielstart

export function startGame(game) {
  const n = game.players.length;
  if (n < 1) return { error: 'err.tooFewPlayers' };
  const seed = game.settings.seed ?? ((Math.random() * 1e9) | 0);
  game.galaxy = generateGalaxy({
    playerCount: Math.max(2, n),
    planetsPerPlayer: game.settings.planetsPerPlayer,
    mode: game.settings.mode,
    shape: game.settings.shape,
    seed
  });
  game.settings.seed = game.galaxy.seed;
  game.rng = makeRng(game.galaxy.seed ^ 0x9e3779b9);
  game.state = 'running';
  game.turn = 1;
  game.log = [];

  game.players.forEach((p, i) => {
    p.money = game.settings.startMoney;
    p.metal = game.settings.startMetal;
    const home = game.galaxy.planets[game.galaxy.homeworlds[i]];
    home.owner = p.id;
    home.pop = 12;
    p.homeworld = home.id;
    p._lastTech = { ...p.tech };
    // Startflotten: ein schnelles Späherpaar und ein Siedlerschiff
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

// --------------------------------------------------------------- Schiffe/Flotten

function newFleet(game, owner, planet) {
  const f = {
    id: 'f' + game.nextFleetId++,
    owner,
    ships: [],
    at: planet ? planet.id : null,
    x: planet ? planet.x : 0,
    y: planet ? planet.y : 0,
    z: planet ? (planet.z || 0) : 0,
    dest: null
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
  fleet.ships.push(ship);
  return ship;
}

export function planetById(game, id) { return game.galaxy.planets[id]; }
export function playerById(game, id) { return game.players.find(p => p.id === id); }

function orbitFleet(game, owner, planet) {
  let f = game.fleets.find(f => f.owner === owner && f.at === planet.id && f.dest == null);
  if (!f) f = newFleet(game, owner, planet);
  return f;
}

/** Flottenwerte: Geschwindigkeit = langsamstes Schiff, Reichweite = bestes + Tanker. */
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

/** Bewohnte eigene Welten - von dort reicht der Nachschub. */
export function supplyBases(game, owner) {
  return game.galaxy.planets.filter(p => p.owner === owner && p.pop > 0.5);
}

/**
 * Nächste eigene Versorgungsbasis (bewohnter eigener Planet). Gemessen wird
 * der tatsächlich fliegbare Weg: Nachschub kann so wenig durch das schwarze
 * Loch wie die Flotte selbst. Gerechnet wird in shared/rules.js, damit die
 * Oberfläche zum selben Ergebnis kommt.
 */
function supplyDistanceFor(game, owner, point) {
  return supplyDistance(supplyBases(game, owner), point, holeZone(game.galaxy));
}

/** Darf diese Flotte dieses Ziel anfliegen? */
export function canReach(game, fleet, target) {
  const st = fleetStats(fleet);
  if (st.speed <= 0) return { ok: false, key: 'err.fleetImmobile', params: {} };
  const need = supplyDistanceFor(game, fleet.owner, target);
  if (need > st.range) {
    return { ok: false, key: 'err.outOfRange', params: { need: Math.round(need), range: st.range } };
  }
  return { ok: true };
}

// ------------------------------------------------------------------- Befehle

export function setOrders(game, player, msg) {
  if (game.state !== 'running') return;
  if (msg.research) {
    const r = msg.research;
    if (typeof r.budgetPct === 'number') player.research.budgetPct = clamp(Math.round(r.budgetPct), 0, 100);
    if (r.weights) {
      for (const f of TECH_FIELDS) {
        if (typeof r.weights[f] === 'number') player.research.weights[f] = clamp(Math.round(r.weights[f]), 0, 10);
      }
    }
  }
  if (msg.build) {
    const { planetId, type, count } = msg.build;
    const planet = planetById(game, planetId);
    if (!planet || planet.owner !== player.id || !SHIP_TYPES.includes(type)) return;
    const q = player.orders.builds[planetId] || (player.orders.builds[planetId] = {});
    q[type] = Math.max(0, (q[type] || 0) + count);
    if (q[type] === 0) delete q[type];
    if (!Object.keys(q).length) delete player.orders.builds[planetId];
  }
  if (msg.unload) {
    const planet = planetById(game, msg.unload.planetId);
    if (planet && planet.owner === player.id) {
      if (msg.unload.value === false) delete player.orders.unload[planet.id];
      else player.orders.unload[planet.id] = true;
    }
  }
  if (msg.refit) {
    // Umrüsten: eine Flotte im Orbit einer eigenen Werft, oder die Satelliten
    // einer eigenen Welt. Ausgeführt wird am Rundenende nach der Forschung,
    // also gleich mit dem neuesten Stand.
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
  }
  if (msg.terraform) {
    const planet = planetById(game, msg.terraform.planetId);
    if (planet && planet.owner === player.id) {
      planet.terraBudget = Math.max(0, Math.round(msg.terraform.budget));
    }
  }
  if (msg.move) {
    const fleet = game.fleets.find(f => f.id === msg.move.fleetId);
    // Nicht stumm verschlucken: wer einen Kurs befiehlt, soll erfahren, warum
    // nichts passiert - sonst klickt man auf einen Knopf und es geschieht
    // einfach nichts (etwa wenn die Flotte inzwischen verschmolzen ist).
    if (!fleet || fleet.owner !== player.id) return { error: 'err.noSuchFleet' };
    if (msg.move.planetId === null) { delete player.orders.moves[fleet.id]; fleet.dest = null; return; }
    const target = planetById(game, msg.move.planetId);
    if (!target) return { error: 'err.noSuchPlanet' };
    const reach = canReach(game, fleet, target);
    if (!reach.ok) return { error: reach.key, params: reach.params };
    fleet.dest = target.id;
    player.orders.moves[fleet.id] = target.id;
  }
  if (msg.split) {
    const fleet = game.fleets.find(f => f.id === msg.split.fleetId);
    if (!fleet || fleet.owner !== player.id || fleet.dest != null) return;
    const take = msg.split.ships || [];
    const moved = fleet.ships.filter(s => take.includes(s.id));
    if (!moved.length || moved.length === fleet.ships.length) return;
    fleet.ships = fleet.ships.filter(s => !take.includes(s.id));
    const nf = newFleet(game, player.id, planetById(game, fleet.at));
    nf.ships = moved;
    return { newFleet: nf.id };
  }
  if (msg.merge) {
    const planet = planetById(game, msg.merge.planetId);
    if (!planet) return;
    const own = game.fleets.filter(f => f.owner === player.id && f.at === planet.id && f.dest == null);
    if (own.length < 2) return;
    const target = own[0];
    for (const f of own.slice(1)) { target.ships.push(...f.ships); f.ships = []; }
    cleanupFleets(game);
  }
}

/**
 * Führt die Umrüstaufträge eines Spielers aus. Reicht das Geld nicht für
 * alle, werden so viele Schiffe umgerüstet, wie bezahlbar sind.
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
      const st = shipStats(s.type, c.tech);
      // Der Schaden bleibt - neu ist nur, was die bessere Panzerung dazugibt.
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

function cleanupFleets(game) {
  game.fleets = game.fleets.filter(f => f.ships.length > 0);
}

// -------------------------------------------------------------- Zugauflösung

export function allReady(game) {
  return game.players.filter(p => p.alive).every(p => p.ready || p.isBot || !p.connected);
}

export function resolveTurn(game) {
  const entries = [];
  const rng = game.rng;
  for (const p of game.galaxy.planets) p._orbitLost = false;

  // 1) Forschung
  for (const p of game.players) {
    if (!p.alive) continue;
    const budget = Math.min(p.money, Math.floor(p.money * p.research.budgetPct / 100));
    if (budget <= 0) continue;
    p.money -= budget;
    const total = TECH_FIELDS.reduce((a, f) => a + p.research.weights[f], 0);
    if (total <= 0) { p.money += budget; continue; }
    const advanced = [];
    for (const f of TECH_FIELDS) {
      const share = budget * p.research.weights[f] / total;
      if (share <= 0) continue;
      p.researchPoints[f] += share;
      while (p.tech[f] < TECH_MAX_LEVEL && p.researchPoints[f] >= techCostToNext(p.tech[f])) {
        p.researchPoints[f] -= techCostToNext(p.tech[f]);
        p.tech[f]++;
      }
      if (p.tech[f] > (p._lastTech?.[f] ?? p.tech[f])) advanced.push({ field: f, level: p.tech[f] });
    }
    p._lastTech = { ...p.tech };
    if (advanced.length) {
      entries.push({ type: 'tech', playerIds: [p.id], private: p.id,
        key: 'log.breakthrough', params: { fields: advanced } });
    }
  }

  // 2) Schiffsbau
  for (const p of game.players) {
    if (!p.alive) continue;
    for (const [pid, queue] of Object.entries(p.orders.builds)) {
      const planet = planetById(game, Number(pid));
      if (!planet || planet.owner !== p.id || planet.pop < 1) continue;
      for (const type of SHIP_TYPES) {
        let n = queue[type] || 0;
        let built = 0;
        while (n-- > 0) {
          const cost = shipCost(type, p.tech);
          if (p.money < cost.money || p.metal < cost.metal) break;
          p.money -= cost.money;
          p.metal -= cost.metal;
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
    if (Math.abs(planet.temp - IDEAL.temp) < 0.05 && Math.abs(planet.grav - IDEAL.grav) < 0.002) {
      planet.temp = IDEAL.temp; planet.grav = IDEAL.grav;
      planet.terraBudget = 0;
      entries.push({ type: 'terra', playerIds: [p.id], private: p.id, planetId: planet.id,
        key: 'log.terraDone', params: { planet: planet.name } });
    }
  }

  // 4) Bewegung
  const zone = holeZone(game.galaxy);
  for (const fleet of game.fleets) {
    if (fleet.dest == null) continue;
    const target = planetById(game, fleet.dest);
    const st = fleetStats(fleet);
    const owner = playerById(game, fleet.owner);
    if (st.speed <= 0) { fleet.dest = null; continue; }
    const reach = canReach(game, fleet, target);
    if (!reach.ok) {
      fleet.dest = null;
      if (owner) entries.push({ type: 'warn', playerIds: [owner.id], private: owner.id,
        key: 'log.fleetHeld', params: { near: nearestName(game, fleet) },
        because: { key: reach.key, params: reach.params } });
      continue;
    }
    // Um das schwarze Loch herum statt hindurch - der Weg wird dadurch länger.
    const step = advance(fleet, route(fleet, target, zone), st.speed);
    fleet.x = step.x; fleet.y = step.y; fleet.z = step.z;
    if (step.done) {
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

  // 5) Kampf
  for (const planet of game.galaxy.planets) {
    resolveCombatAt(game, planet, entries, rng);
  }
  cleanupFleets(game);

  // 6) Kolonisierung und Invasion
  for (const planet of game.galaxy.planets) {
    const present = presentOwners(game, planet);
    if (present.length !== 1) continue;
    const owner = present[0];
    const p = playerById(game, owner);
    if (!p || !p.alive) continue;
    const cap = planetCapacity(planet);

    if (planet.owner && planet.owner !== owner) {
      // Feindwelt ohne verbliebene Abwehr: Invasion
      const armed = game.fleets.some(f => f.owner === owner && f.at === planet.id && f.ships.some(s => s.attack > 0));
      if (armed) {
        const old = playerById(game, planet.owner);
        const before = planet.pop;
        planet.owner = owner;
        planet.pop = Math.max(0.5, Math.round(before * 0.65 * 10) / 10);
        planet.terraBudget = 0;
        entries.push({ type: 'invade', playerIds: [owner, old ? old.id : null].filter(Boolean), planetId: planet.id,
          key: old ? 'log.invadeFrom' : 'log.invade',
          params: { player: p.name, planet: planet.name, from: old ? old.name : null } });
      }
      continue;
    }

    // Eigene oder freie Welt: Siedler gehen von Bord. Auf eigenen Welten nur
    // auf ausdrücklichen Befehl - sonst löst sich das Kolonieschiff
    // gleich im Heimatorbit auf.
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
        text: unowned ? `${p.name} kolonisiert ${planet.name}.`
                      : `${planet.name}: ${landed} Mio. Siedler angekommen.` });
    } else if (unowned && cap < 1) {
      const hasColony = game.fleets.some(f => f.owner === owner && f.at === planet.id && f.ships.some(s => s.colonists > 0));
      if (hasColony) entries.push({ type: 'warn', playerIds: [owner], private: owner, planetId: planet.id,
        key: 'log.uninhabitable', params: { planet: planet.name } });
    }
  }
  for (const p of game.players) p.orders.unload = {};
  cleanupFleets(game);

  // 7) Wirtschaft
  for (const p of game.players) { p.income = 0; }
  for (const planet of game.galaxy.planets) {
    if (!planet.owner) continue;
    const p = playerById(game, planet.owner);
    if (!p || !p.alive) { planet.owner = null; continue; }
    const inc = planetIncome(planet);
    p.money += inc;
    p.income += inc;
    const mined = planetMining(planet);
    planet.metalReserve = Math.max(0, planet.metalReserve - mined);
    p.metal += mined;
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
      planet.owner = null; planet.pop = 0; planet.terraBudget = 0; planet.defenses = [];
    }
  }
  for (const p of game.players) {
    p.money = Math.round(p.money * 10) / 10;
    p.metal = Math.round(p.metal * 10) / 10;
    p.income = Math.round(p.income);
  }

  // 8) Sichtbarkeit, Ausdehnung, Statistik, Ausscheiden
  updateVisibility(game);
  maybeExpand(game, entries);
  for (const p of game.players) {
    const planets = game.galaxy.planets.filter(q => q.owner === p.id);
    p.stats.planets = planets.length;
    p.stats.pop = Math.round(planets.reduce((a, q) => a + q.pop, 0) * 10) / 10;
    p.stats.ships = game.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + f.ships.length, 0)
      + game.galaxy.planets.reduce((a, q) => a + ((q.owner === p.id && q.defenses) ? q.defenses.length : 0), 0);
    // Ohne Welt ist Schluss: Reichweite misst sich an eigenen bewohnten Welten,
    // übrig gebliebene Schiffe kämen also nirgends mehr hin. Sie verschwinden
    // mit dem Reich, statt als Geisterflotten auf der Karte zu stehen. (Ein
    // Kolonieschiff über einer freien Welt hat oben schon landen dürfen.)
    if (p.alive && p.stats.planets === 0) {
      p.alive = false;
      game.fleets = game.fleets.filter(f => f.owner !== p.id);
      p.stats.ships = 0;
      entries.push({ type: 'eliminated', playerIds: [p.id],
        key: 'log.eliminated', params: { player: p.name } });
    }
  }

  game.turn++;
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

const EDGE_TRIGGER = 200;    // Abstand zur äußersten Welt, ab dem die Karte nachgibt
// Die Himmelsrichtung kommt als Schluesselwort heraus; benannt wird sie im
// Katalog (dir.left ... dir.bottom).

/**
 * Erkundung dehnt die Karte: wer den äußersten Welten nahe kommt, schiebt die
 * Grenze weiter hinaus. Höchstens ein Streifen pro Runde - die dringendste
 * Richtung zuerst -, damit die Galaxie wächst und nicht springt.
 */
function maybeExpand(game, entries) {
  if (game.settings.expanding === false) return;
  const g = game.galaxy;
  // Neues Land erst, wenn das alte weitgehend vergeben ist: Solange es mehr
  // als zwei freie bewohnbare Welten je lebendem Reich gibt, bleibt die Karte,
  // wie sie ist - sonst wüchse sie ins Uferlose. Unbewohnbare Welten zählen
  // nicht mit, die nimmt ohnehin niemand.
  const lebende = game.players.filter(p => p.alive).length;
  let frei = 0;
  for (const q of g.planets) if (!q.owner && planetCapacity(q) >= 1) frei++;
  if (frei > Math.max(3, lebende * 2)) return;
  const eyes = [];
  for (const q of g.planets) if (q.owner) eyes.push(q);
  for (const f of game.fleets) eyes.push(f);
  if (!eyes.length) return;

  // Spirale: gemessen wird vom Kern nach außen, und sie wächst als Ring.
  if (g.field) {
    let maxR = 0;
    for (const e of eyes) maxR = Math.max(maxR, Math.hypot(e.x - g.field.cx, e.y - g.field.cy));
    if (maxR < g.field.rOut - EDGE_TRIGGER) return;
    const added = expandSpiral(g);
    if (added.length) {
      entries.push({ type: 'galaxy', key: 'log.armsGrow', params: { count: added.length } });
    }
    return;
  }

  // Gemessen wird zur Grenze, nicht zur äußersten Welt: neue Welten halten
  // Abstand zum Rand, also muss man für den nächsten Streifen weiter hinaus.
  let best = null, bestD = EDGE_TRIGGER;
  for (const e of eyes) {
    if (e.x - g.minX < bestD) { bestD = e.x - g.minX; best = 'left'; }
    if (g.maxX - e.x < bestD) { bestD = g.maxX - e.x; best = 'right'; }
    if (e.y - g.minY < bestD) { bestD = e.y - g.minY; best = 'top'; }
    if (g.maxY - e.y < bestD) { bestD = g.maxY - e.y; best = 'bottom'; }
  }
  if (!best) return;

  const added = expandGalaxy(g, best);
  if (!added.length) return;
  entries.push({ type: 'galaxy', key: 'log.mapGrows',
    params: { count: added.length, direction: best } });
}

// Zahlen gehen ungeformt raus - wie sie geschrieben werden (Komma oder
// Punkt), entscheidet die Sprache des Clients.
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
 * Welche Spieler haben Schiffe bei diesem Planeten? Die Bevölkerung allein
 * hält den Orbit nicht - genau daran scheitern wehrlose Kolonien.
 */
function presentOwners(game, planet) {
  const set = new Set();
  for (const f of game.fleets) if (f.at === planet.id && f.ships.length) set.add(f.owner);
  if (planet.owner && planet.defenses && planet.defenses.length) set.add(planet.owner);
  if (planet.owner && planet.pop >= 0.5 && !planet._orbitLost) set.add(planet.owner);
  return [...set];
}

function resolveCombatAt(game, planet, entries, rng) {
  const sides = new Map();
  let battery = null;
  for (const f of game.fleets) {
    if (f.at !== planet.id || !f.ships.length) continue;
    if (!sides.has(f.owner)) sides.set(f.owner, []);
    sides.get(f.owner).push(...f.ships);
  }
  if (planet.owner && planet.defenses && planet.defenses.length) {
    if (!sides.has(planet.owner)) sides.set(planet.owner, []);
    sides.get(planet.owner).push(...planet.defenses);
  }
  // Nur kämpfen, wenn überhaupt ein Fremder im Orbit steht
  const intruder = [...sides.keys()].some(o => o !== planet.owner);
  if (!intruder) return;
  if (planet.owner) {
    const ownerP = playerById(game, planet.owner);
    const bs = ownerP ? batteryStats(planet.pop, ownerP.tech) : null;
    if (bs) {
      battery = { id: 'battery', type: 'battery', attack: bs.attack, hp: bs.hp, maxHp: bs.hp, isBattery: true };
      if (!sides.has(planet.owner)) sides.set(planet.owner, []);
      sides.get(planet.owner).push(battery);
    }
  }
  if (sides.size < 2) return;
  const anyArmed = [...sides.values()].some(ships => ships.some(s => s.attack > 0));
  if (!anyArmed) return;

  const before = new Map([...sides].map(([k, v]) => [k, v.length]));
  for (let round = 0; round < COMBAT_ROUNDS; round++) {
    const alive = [...sides].filter(([, ships]) => ships.some(s => s.hp > 0));
    if (alive.length < 2) break;
    const damage = [];
    for (const [owner, ships] of alive) {
      const enemies = alive.filter(([o]) => o !== owner).flatMap(([, s]) => s.filter(x => x.hp > 0));
      if (!enemies.length) continue;
      for (const s of ships) {
        if (s.hp <= 0 || s.attack <= 0) continue;
        const t = enemies[Math.floor(rng() * enemies.length)];
        damage.push([t, s.attack * (0.75 + rng() * 0.5)]);
      }
    }
    for (const [t, dmg] of damage) t.hp -= dmg;
    for (const [, ships] of sides) for (const s of ships) if (s.hp < 0) s.hp = 0;
  }

  // Verluste eintragen
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
  // Toten entfernen
  for (const f of game.fleets) {
    if (f.at === planet.id) f.ships = f.ships.filter(s => s.hp > 0);
  }
  if (planet.defenses) planet.defenses = planet.defenses.filter(s => s.hp > 0);

  // Wer noch Waffen hat, beherrscht den Orbit; wehrlose Schiffe gehen verloren.
  const armedOwners = new Set();
  for (const f of game.fleets) if (f.at === planet.id && f.ships.some(s => s.attack > 0)) armedOwners.add(f.owner);
  if (planet.defenses && planet.defenses.some(s => s.attack > 0)) armedOwners.add(planet.owner);
  if (battery && battery.hp > 0) armedOwners.add(planet.owner);
  if (armedOwners.size === 1) {
    const victor = [...armedOwners][0];
    for (const f of game.fleets) {
      if (f.at === planet.id && f.owner !== victor && f.ships.length) {
        const p = playerById(game, f.owner);
        if (p) p.stats.losses += f.ships.length;
        f.ships = [];
      }
    }
  }

  // Jede Seite als eigener Posten - der Satz drumherum gehoert in den Katalog.
  const bilanz = [];
  for (const [owner, n] of before) {
    const p = playerById(game, owner);
    const left = (game.fleets.filter(f => f.at === planet.id && f.owner === owner).reduce((a, f) => a + f.ships.length, 0))
      + (planet.owner === owner && planet.defenses ? planet.defenses.length : 0);
    bilanz.push({ name: p ? p.name : String(owner), left, before: n });
  }
  entries.push({
    type: 'combat', planetId: planet.id, playerIds: [...before.keys()],
    key: 'log.battle', params: { planet: planet.name, sides: bilanz }
  });
  cleanupFleets(game);
}

// --------------------------------------------------------------- Sichtbarkeit

export function updateVisibility(game) {
  for (const p of game.players) {
    // Eigene Welten und Flotten einmal sammeln: die Karte wächst, sonst würde
    // hier mit jeder neuen Welt jede gegen jede geprüft.
    const mine = game.galaxy.planets.filter(q => q.owner === p.id);
    const myFleets = game.fleets.filter(f => f.owner === p.id);
    for (const planet of game.galaxy.planets) {
      const presence = planet.owner === p.id || myFleets.some(f => f.at === planet.id);
      if (presence) {
        p.explored.add(planet.id);
        p.knowledge[planet.id] = snapshotPlanet(game, planet, game.turn);
      }
    }
    // Scanner: eigene Welten und Flotten sehen die Nachbarschaft grob
    for (const planet of game.galaxy.planets) {
      if (p.explored.has(planet.id)) continue;
      const seen = mine.some(q => dist(q, planet) < 230)
        || myFleets.some(f => dist(f, planet) < 185);
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

function pushLog(game, entries) {
  if (!entries.length) return;
  game.log.push({ turn: game.turn, entries });
  if (game.log.length > 120) game.log.shift();
}

// ------------------------------------------------------------- Sicht pro Spieler

export function buildView(game, player) {
  const vis = new Set();   // Planeten mit aktueller Sicht
  for (const planet of game.galaxy.planets) {
    if (planet.owner === player.id || game.fleets.some(f => f.owner === player.id && f.at === planet.id)) vis.add(planet.id);
  }

  const planets = game.galaxy.planets.map(p => {
    const base = { id: p.id, name: p.name, x: p.x, y: p.y, z: p.z || 0 };
    if (vis.has(p.id)) {
      return {
        ...base, known: 'live',
        temp: p.temp, grav: p.grav, sizeFactor: p.sizeFactor,
        metalRichness: p.metalRichness, metalReserve: Math.round(p.metalReserve),
        owner: p.owner, pop: p.pop,
        defenses: p.defenses ? p.defenses.length : 0,
        defenseRefit: p.owner === player.id && p.defenses ? refitTotal(p.defenses, player.tech) : null,
        terraBudget: p.owner === player.id ? p.terraBudget : 0,
        isHomeworld: !!p.isHomeworld
      };
    }
    const k = player.knowledge[p.id];
    if (k) return { ...base, known: 'memory', ...k, terraBudget: 0, isHomeworld: !!p.isHomeworld };
    return { ...base, known: 'unknown' };
  });

  // Flotten: eigene immer, fremde bei Sichtkontakt
  const fleets = [];
  for (const f of game.fleets) {
    if (!f.ships.length) continue;
    const mine = f.owner === player.id;
    if (mine) {
      fleets.push({
        id: f.id, owner: f.owner, at: f.at,
        x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z || 0), dest: f.dest,
        mine: true,
        ships: f.ships.map(s => ({ id: s.id, type: s.type, hp: Math.round(s.hp), maxHp: s.maxHp, attack: s.attack, speed: s.speed, range: s.range, colonists: s.colonists, tech: s.tech })),
        stats: fleetStats(f)
      });
      continue;
    }
    const detected = (f.at !== null && vis.has(f.at))
      || game.galaxy.planets.some(q => q.owner === player.id && dist(q, f) < 300)
      || game.fleets.some(g => g.owner === player.id && g.ships.length && dist(g, f) < 240);
    if (detected) {
      // Wer eine fremde Flotte im eigenen Raum hat, klärt sie so weit auf, dass
      // er ihren Kurs und die Ankunft kennt - womit sie fliegt, bleibt verdeckt.
      const ziel = f.dest != null ? planetById(game, f.dest) : null;
      const tempo = ziel ? fleetStats(f).speed : 0;
      fleets.push({
        id: f.id, owner: f.owner, at: f.at,
        x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z || 0),
        dest: ziel ? ziel.id : null,
        eta: ziel && tempo > 0
          ? Math.max(1, Math.ceil(travelDistance(f, ziel, holeZone(game.galaxy)) / tempo))
          : null,
        mine: false, count: f.ships.length,
        ships: f.ships.map(s => ({ id: s.id, type: s.type })),
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
    mode: game.settings.mode || 'classic',
    galaxy: {
      minX: game.galaxy.minX, minY: game.galaxy.minY, minZ: game.galaxy.minZ || 0,
      maxX: game.galaxy.maxX, maxY: game.galaxy.maxY, maxZ: game.galaxy.maxZ || 0,
      width: game.galaxy.width, height: game.galaxy.height,
      shape: game.galaxy.shape || 'scatter',
      blackHole: game.galaxy.blackHole || null
    },
    me: {
      id: player.id, name: player.name, color: player.color, emblem: player.emblem,
      money: Math.round(player.money), metal: Math.round(player.metal), income: player.income,
      tech: { ...player.tech },
      techProgress: Object.fromEntries(TECH_FIELDS.map(f => [f, {
        points: Math.round(player.researchPoints[f]), next: techCostToNext(player.tech[f])
      }])),
      research: { budgetPct: player.research.budgetPct, weights: { ...player.research.weights } },
      ready: player.ready,
      homeworld: player.homeworld,
      builds: player.orders.builds,
      refit: player.orders.refit
    },
    players: game.players.map(p => ({
      id: p.id, name: p.name, color: p.color, emblem: p.emblem, isBot: p.isBot, persona: p.persona,
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
 * Sicht für Zuschauer: keine Nebel, kein eigenes Reich. Alles liegt offen -
 * Technikstände, Kassen und das vollständige Protokoll.
 */
export function buildSpectatorView(game) {
  const planets = game.galaxy.planets.map(p => ({
    id: p.id, name: p.name, x: p.x, y: p.y, z: p.z || 0, known: 'live',
    temp: p.temp, grav: p.grav, sizeFactor: p.sizeFactor,
    metalRichness: p.metalRichness, metalReserve: Math.round(p.metalReserve),
    owner: p.owner, pop: p.pop,
    defenses: p.defenses ? p.defenses.length : 0,
    terraBudget: p.terraBudget || 0,
    isHomeworld: !!p.isHomeworld
  }));

  const fleets = game.fleets.filter(f => f.ships.length).map(f => ({
    id: f.id, owner: f.owner, at: f.at,
    x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z || 0), dest: f.dest, mine: false,
    ships: f.ships.map(s => ({
      id: s.id, type: s.type, hp: Math.round(s.hp), maxHp: s.maxHp,
      attack: s.attack, speed: s.speed, range: s.range, colonists: s.colonists, tech: s.tech
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
    pace: { ...game.pace },
    mode: game.settings.mode || 'classic',
    galaxy: {
      minX: game.galaxy.minX, minY: game.galaxy.minY, minZ: game.galaxy.minZ || 0,
      maxX: game.galaxy.maxX, maxY: game.galaxy.maxY, maxZ: game.galaxy.maxZ || 0,
      width: game.galaxy.width, height: game.galaxy.height,
      shape: game.galaxy.shape || 'scatter',
      blackHole: game.galaxy.blackHole || null
    },
    players: game.players.map(p => ({
      id: p.id, name: p.name, color: p.color, emblem: p.emblem, isBot: p.isBot, persona: p.persona,
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
 * Ein Protokolleintrag fuer den Client: Schluessel und Werte statt fertigem
 * Satz - der Satz entsteht erst dort, in der Sprache des Spielers.
 */
function logEntry(e) {
  return {
    type: e.type, planetId: e.planetId ?? null,
    key: e.key, params: e.params, because: e.because
  };
}

/** Alle sehen Siege und Ausscheiden; alles andere nur die Beteiligten. */
const PUBLIC_ENTRIES = new Set(['start', 'victory', 'eliminated']);
function visibleEntry(e, playerId) {
  if (e.private && e.private !== playerId) return false;
  if (PUBLIC_ENTRIES.has(e.type)) return true;
  if (e.playerIds && e.playerIds.length) return e.playerIds.includes(playerId);
  return true;
}

export function lobbyView(game) {
  return {
    id: game.id,
    state: game.state,
    settings: game.settings,
    players: game.players.map(p => ({
      id: p.id, name: p.name, color: p.color, emblem: p.emblem,
      isBot: p.isBot, persona: p.persona, connected: p.connected
    }))
  };
}
