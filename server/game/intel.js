// What each empire knows: what its worlds and fleets see now, what it
// remembers from earlier, and the view of the game built from that for its
// player - fog of war included. Spectators get the view without fog.
import { dist, travelDistance, holeZone, TECH_FIELDS, techCostToNext } from '../../shared/rules.js';
import { riftView } from '../aliens.js';
import { SCAN, findMouth, wormholeView } from '../wormholes.js';
import { round1 } from './combat.js';
import { teamOf, alliesOf, diplomacyView } from './diplomacy.js';
import { fleetStats } from './fleets.js';
import { planetById, hostOf, pauseView } from './game.js';
import { visibleEntry, logEntry } from './log.js';

export function updateVisibility(game) {
  for (const p of game.players) {
    // Collect own worlds and fleets once: the map grows, otherwise every new
    // world would be checked against every other here. Allies share what
    // they see - their worlds and fleets count as eyes too.
    const team = teamOf(game, p.id);
    const mine = game.galaxy.planets.filter(q => team.includes(q.owner));
    const myFleets = game.fleets.filter(f => team.includes(f.owner));
    for (const planet of game.galaxy.planets) {
      const presence = team.includes(planet.owner) || myFleets.some(f => f.at === planet.id);
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
      if (team.includes(planet.owner) || myFleets.some(f => f.at === planet.id)) continue;
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

/**
 * Does this empire see a foreign fleet - near one of its worlds or fleets,
 * or those of its allies? Then it knows course, arrival and the number of
 * ships, not what they are. The AI goes by the same rule.
 */
export function inSight(game, playerId, f) {
  const team = teamOf(game, playerId);
  return game.galaxy.planets.some(q => team.includes(q.owner) && dist(q, f) < 300)
    || game.fleets.some(g => team.includes(g.owner) && g.ships.length && dist(g, f) < 240);
}

/** Does this empire see the fleet - its own, in a watched orbit, or in sight? */
export function seesFleet(game, playerId, f) {
  if (f.owner === playerId) return true;
  const team = teamOf(game, playerId);
  if (f.at != null && (team.includes(planetById(game, f.at).owner)
    || game.fleets.some(g => team.includes(g.owner) && g.at === f.at && g.ships.length))) return true;
  return inSight(game, playerId, f);
}

/** Whom a fleet chases and the meeting point it heads for - for course lines and panels. */
function chaseView(game, f) {
  if (!f.chase || !f.aim) return {};
  return { chase: f.chase, aim: { x: Math.round(f.aim.x), y: Math.round(f.aim.y), z: Math.round(f.aim.z || 0) } };
}

export function buildView(game, player) {
  const vis = new Set();   // planets with current sight - own and allied eyes
  const team = teamOf(game, player.id);
  for (const planet of game.galaxy.planets) {
    if (team.includes(planet.owner) || game.fleets.some(f => team.includes(f.owner) && f.at === planet.id)) vis.add(planet.id);
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
        ...chaseView(game, f),
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
      // A chaser shows where it is heading - whom it chases only if that one is in sight too.
      const prey = f.chase ? game.fleets.find(g => g.id === f.chase) : null;
      const chasing = prey && seesFleet(game, player.id, prey) ? chaseView(game, f) : {};
      const target = mouth || (f.dest != null ? planetById(game, f.dest) : chasing.aim || null);
      const speed = target ? fleetStats(f).speed : 0;
      fleets.push({
        id: f.id, owner: f.owner, at: f.at,
        x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z || 0),
        dest: f.dest != null && !mouth ? f.dest : null,
        hole: mouth ? mouth.id : null,
        ...chasing,
        eta: target && speed > 0
          ? Math.max(1, Math.ceil(travelDistance(f, target, holeZone(game.galaxy)) / speed))
          : null,
        mine: false, count: f.ships.length,
        ...(team.includes(f.owner) ? { allied: true } : {}),
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
    winners: game.winners || null,
    you: player.id,
    deadline: game.turnDeadline,
    host: hostOf(game)?.id ?? null,
    paused: pauseView(game),
    mode: game.settings.mode || 'classic',
    maxTurns: game.settings.maxTurns || 0,       // 0 = no limit: whoever is left wins
    capitalShips: game.settings.capitalShips !== false,
    alliances: game.settings.alliances !== false,
    galaxy: {
      minX: game.galaxy.minX, minY: game.galaxy.minY, minZ: game.galaxy.minZ || 0,
      maxX: game.galaxy.maxX, maxY: game.galaxy.maxY, maxZ: game.galaxy.maxZ || 0,
      width: game.galaxy.width, height: game.galaxy.height,
      shape: game.galaxy.shape || 'scatter',
      blackHole: game.galaxy.blackHole || null
    },
    wormholes: wormholeView(game, player),
    rifts: riftView(game, player),
    aliens: game.settings.aliens !== false,
    interception: game.settings.interception !== false,
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
      refit: player.orders.refit,
      allies: alliesOf(game, player.id)
    },
    diplomacy: diplomacyView(game, player.id),
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
    ...chaseView(game, f),
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
    winners: game.winners || null,
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
    alliances: game.settings.alliances !== false,
    galaxy: {
      minX: game.galaxy.minX, minY: game.galaxy.minY, minZ: game.galaxy.minZ || 0,
      maxX: game.galaxy.maxX, maxY: game.galaxy.maxY, maxZ: game.galaxy.maxZ || 0,
      width: game.galaxy.width, height: game.galaxy.height,
      shape: game.galaxy.shape || 'scatter',
      blackHole: game.galaxy.blackHole || null
    },
    wormholes: wormholeView(game, null),
    rifts: riftView(game, null),
    aliens: game.settings.aliens !== false,
    interception: game.settings.interception !== false,
    diplomacy: diplomacyView(game, null),
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
