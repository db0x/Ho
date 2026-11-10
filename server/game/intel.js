// What each empire knows: what its worlds and fleets see now, what it
// remembers from earlier, and the view of the game built from that for its
// player - fog of war included. Spectators get the view without fog.
//
// Two levels of fog. Always: worlds out of scanner reach show what was seen
// last, foreign fleets only near own worlds and fleets. With the game
// setting "fog" (sensors.js) it gets strict: only what the sensors cover,
// scouts and stations see farther, a foreign course shows only its
// direction unless it is coming for an own world, and the tallies of other
// empires stay hidden. The AI goes by the same rules.
import { dist, travelDistance, holeZone, TECH_FIELDS, techCostToNext } from '../../shared/rules.js';
import { riftView } from '../aliens.js';
import { SCAN, findMouth, wormholeView } from '../wormholes.js';
import { round1 } from './combat.js';
import { teamOf, alliesOf, diplomacyView } from './diplomacy.js';
import { fleetStats } from './fleets.js';
import { planetById, hostOf, pauseView } from './game.js';
import { visibleEntry, logEntry } from './log.js';
import { fogOn, eyesOf, covered } from './sensors.js';

// Length of the direction arrow of a foreign fleet whose target is out of sight.
const HEADING_LEN = 110;

export function updateVisibility(game) {
  const fog = fogOn(game);
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
        p.knowledge[planet.id] = snapshotPlanet(game, planet, game.turn, fog);
      }
    }
    if (fog) {
      const eyes = eyesOf(game, p.id);
      for (const planet of game.galaxy.planets) {
        if (team.includes(planet.owner) || myFleets.some(f => f.at === planet.id) || !covered(eyes, planet)) continue;
        p.explored.add(planet.id);
        p.knowledge[planet.id] = snapshotPlanet(game, planet, game.turn, fog);
      }
      continue;
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

/**
 * What is seen of a world. With fog the AI keeps the hit points of the
 * satellites too, as an estimate for later (ai/perception.js) - stripped
 * before a view goes out.
 */
function snapshotPlanet(game, planet, turn, fog = false) {
  const d = planet.defenses || [];
  return {
    ...(fog ? { defHp: Math.round(d.reduce((a, s) => a + s.maxHp, 0)) } : {}),
    turn,
    temp: planet.temp, grav: planet.grav,
    metalRichness: planet.metalRichness, metalReserve: Math.round(planet.metalReserve),
    owner: planet.owner, pop: planet.pop,
    defenses: planet.defenses ? planet.defenses.length : 0,
    station: stationView(planet),
    sizeFactor: planet.sizeFactor
  };
}

/**
 * The orbital station as everyone who sees the world sees it: there or not,
 * how far the construction is, how much hull it has left. Null without one.
 */
function stationView(planet, own = false) {
  const st = planet.station;
  if (!st) return null;
  return { building: st.building > 0 ? st.building : 0, hp: Math.round(st.hp), maxHp: Math.round(st.maxHp),
    ...(own ? { attack: round1(st.attack), tech: st.tech } : {}) };
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
export function inSight(game, playerId, f, eyes = null) {
  if (fogOn(game)) return covered(eyes || eyesOf(game, playerId), f);
  const team = teamOf(game, playerId);
  return game.galaxy.planets.some(q => team.includes(q.owner) && dist(q, f) < 300)
    || game.fleets.some(g => team.includes(g.owner) && g.ships.length && dist(g, f) < 240);
}

/** Does this empire see the fleet - its own, in a watched orbit, or in sight? */
export function seesFleet(game, playerId, f, eyes = null) {
  if (f.owner === playerId) return true;
  const team = teamOf(game, playerId);
  if (team.includes(f.owner)) return true;
  if (f.at != null && (team.includes(planetById(game, f.at).owner)
    || game.fleets.some(g => team.includes(g.owner) && g.at === f.at && g.ships.length))) return true;
  return inSight(game, playerId, f, eyes);
}

/**
 * What an empire knows of the course of a foreign fleet it sees. Without
 * fog: everything, as before. With fog the target is known only when the
 * fleet comes for the own team - a world of it, or one of its fleets it
 * chases. Anything else shows just the direction the fleet flies in (a
 * point HEADING_LEN ahead), and a fleet still waiting in orbit not even that.
 * @returns {{dest: number|null, hole: string|null, chase?: string, aim?: object,
 *   target: object|null, heading?: object}}
 */
export function courseIntel(game, player, f, eyes = null) {
  const team = teamOf(game, player.id);
  // A course to a wormhole only shows if its mouth is in sight.
  const mouth = f.hole && player.seenMouths.has(f.hole) ? findMouth(game, f.hole)?.mouth : null;
  // A chaser shows where it is heading - whom it chases only if that one is in sight too.
  const prey = f.chase ? game.fleets.find(g => g.id === f.chase) : null;
  const chasing = prey && seesFleet(game, player.id, prey, eyes) ? chaseView(game, f) : {};
  const destP = f.dest != null ? planetById(game, f.dest) : null;
  const known = { dest: f.dest != null && !mouth ? f.dest : null, hole: mouth ? mouth.id : null, ...chasing,
    target: mouth || destP || chasing.aim || null };
  if (!fogOn(game)) return known;
  if (!known.target) return { dest: null, hole: null, target: null };
  const plain = known.target === destP && team.includes(destP.owner)
    || (prey && team.includes(prey.owner));
  if (plain) return known;
  // Not coming for us: only where it is heading - straight on, rounded.
  const real = mouth || destP || f.aim;
  if (f.at != null || !real) return { dest: null, hole: null, target: null };
  const dx = real.x - f.x, dy = real.y - f.y, dz = (real.z || 0) - (f.z || 0);
  const len = Math.hypot(dx, dy, dz) || 1;
  const k = Math.min(1, HEADING_LEN / len);
  return { dest: null, hole: null, target: null,
    heading: { x: Math.round(f.x + dx * k), y: Math.round(f.y + dy * k), z: Math.round((f.z || 0) + dz * k) } };
}

/** Whom a fleet chases and the meeting point it heads for - for course lines and panels. */
function chaseView(game, f) {
  if (!f.chase || !f.aim) return {};
  return { chase: f.chase, aim: { x: Math.round(f.aim.x), y: Math.round(f.aim.y), z: Math.round(f.aim.z || 0) } };
}

export function buildView(game, player) {
  const vis = new Set();   // planets with current sight - own and allied eyes
  const team = teamOf(game, player.id);
  const fog = fogOn(game);
  const eyes = fog ? eyesOf(game, player.id) : null;
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
        station: stationView(p, p.owner === player.id),
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
      const { defHp, ...seen } = k;
      return { ...base, known: 'memory', ...seen, owner, terraBudget: 0, terraSpent: 0, isHomeworld: !!p.isHomeworld };
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
    if ((f.at !== null && vis.has(f.at)) || team.includes(f.owner) || inSight(game, player.id, f, eyes)) {
      // Whoever has a foreign fleet in their own space scouts it well enough to
      // know its course and arrival - what it flies with stays hidden. With
      // fog only if the target is in sight too (courseIntel).
      const { target, heading, ...course } = courseIntel(game, player, f, eyes);
      const speed = target ? fleetStats(f).speed : 0;
      fleets.push({
        id: f.id, owner: f.owner, at: f.at,
        x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z || 0),
        ...course,
        ...(heading ? { heading } : {}),
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
    // Fog of war: the reach of the own and allied sensors, for the map.
    ...(fog ? { fog: true, sensors: eyes.map(e => ({ x: Math.round(e.x), y: Math.round(e.y), z: Math.round(e.z), r: e.r })) } : {}),
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
      // With fog the tallies of other empires stay hidden - allies share theirs.
      stats: fog && !team.includes(p.id) ? null : { planets: p.stats.planets, pop: p.stats.pop, ships: p.stats.ships }
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
    station: stationView(p, true),
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
