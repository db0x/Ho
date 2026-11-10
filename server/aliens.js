// Aliens: rare raids out of another galaxy (rules in shared/rules.js, ALIENS).
// A rift opens within sight of an empire's world and closes behind them
// right away: a carrier and its fighters. They never conquer and never
// build - they break a world's defenses and leave it empty, then look for
// the next one. After a few worlds, or once their carrier is gone, they
// leave again.
//
// Balanced to be beaten: they come with the technology of the empire they
// visit, a few turns away and in plain sight. Whoever brings satellites or
// a fleet to the threatened world holds it - and whoever shoots down the
// carrier breaks up the swarm. Every empire gets its turn: the next raid
// goes to the empire visited least so far.
import { alienRules, ALIEN_ID, SHIP_DEFS, holeZone, dist, travelDistance } from '../shared/rules.js';
import { makeRng } from './galaxy.js';
import { SCAN } from './wormholes.js';
import { newFleet, addShip, cleanupFleets } from './game/fleets.js';
import { teamOf } from './game/diplomacy.js';
import { fogOn, eyesOf, covered } from './game/sensors.js';

/** A stream of its own: the aliens must not shift the combat rolls. */
function rngOf(game) {
  return game.alienRng || (game.alienRng = makeRng(`${game.galaxy.seed}:aliens`));
}

/** Bookkeeping of a game: when the next raid is due, who was visited how often. */
function stateOf(game) {
  return game.aliens || (game.aliens = { next: null, visits: {} });
}

export const alienFleets = game => game.fleets.filter(f => f.owner === ALIEN_ID && f.ships.length);

function nearest(game, point) {
  let best = null, bd = Infinity;
  for (const p of game.galaxy.planets) {
    const d = dist(p, point);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

const inhabited = p => p.owner && p.pop >= 0.5;
const worldsOf = (game, id) => game.galaxy.planets.filter(p => p.owner === id && p.pop >= 0.5);
const hasCarrier = f => f.ships.some(s => s.type === 'alienCarrier');
/**
 * A world the aliens may hit: inhabited, and not the last one of its empire.
 * Summoned in dev mode they spare nothing - otherwise there would be nothing
 * to test in the first turns, when everyone has just the homeworld.
 */
const fairGame = (game, p, a) => inhabited(p) && (a?.dev || worldsOf(game, p.owner).length >= 2);

/** Players who see this spot - for the log entries about rifts and swarms. */
function watchers(game, point) {
  return game.players.filter(p => p.alive && seesPoint(game, p.id, point)).map(p => p.id);
}

function seesPoint(game, playerId, point) {
  if (fogOn(game)) return covered(eyesOf(game, playerId), point);
  const team = teamOf(game, playerId);
  return game.galaxy.planets.some(q => team.includes(q.owner) && dist(q, point) < SCAN.world)
    || game.fleets.some(f => team.includes(f.owner) && f.ships.length && dist(f, point) < SCAN.fleet);
}

/** A rift on the map for one turn - opening (aliens arrive) or closing (they leave). */
function rift(game, point, kind) {
  (game.alienRifts || (game.alienRifts = [])).push({
    x: Math.round(point.x), y: Math.round(point.y), z: Math.round(point.z || 0), kind
  });
}

// ------------------------------------------------------------------- Arrival

/**
 * The empire for the next raid: of those with enough worlds, the one visited
 * least so far - and not one the aliens are already busy with.
 */
function pickVictim(game, rng) {
  const st = stateOf(game);
  const A = alienRules(game);
  const busy = new Set(alienFleets(game).map(f => f.alien?.target));
  const able = game.players.filter(p => p.alive && !busy.has(p.id)
    && worldsOf(game, p.id).length >= A.minWorlds);
  if (!able.length) return null;
  const fewest = Math.min(...able.map(p => st.visits[p.id] || 0));
  const pool = able.filter(p => (st.visits[p.id] || 0) === fewest);
  return pool[Math.floor(rng() * pool.length)];
}

/** The world they head for first: a colony rather than the homeworld. */
function pickWorld(game, player, rng) {
  const worlds = worldsOf(game, player.id);
  const colonies = worlds.filter(p => !p.isHomeworld && p.id !== player.homeworld);
  const pool = colonies.length ? colonies : worlds;
  return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
}

/**
 * Where the rift opens: a few turns of flight from the world, in empty
 * space, away from the black hole - and always within sight of the world,
 * so the empire sees them coming.
 */
function riftSpot(game, world, speed, rng) {
  const zone = holeZone(game.galaxy);
  const A = alienRules(game);
  const [lo, hi] = A.distance;
  const want = Math.max(lo, Math.min(hi, speed * A.approach));
  for (let i = 0; i < 60; i++) {
    const ang = rng() * Math.PI * 2;
    const d = want * (0.9 + rng() * 0.2) * (i < 40 ? 1 : 0.8);
    const p = {
      x: world.x + Math.cos(ang) * d, y: world.y + Math.sin(ang) * d,
      z: (world.z || 0) + (game.galaxy.mode === 'space' ? (rng() * 2 - 1) * d * 0.3 : 0)
    };
    if (zone && dist(p, zone) < zone.r * 1.2) continue;
    if (game.galaxy.planets.some(q => dist(q, p) < 40)) continue;
    return p;
  }
  return null;
}

/**
 * Opens a rift and lets a swarm out. Without a victim or world the next
 * raid is picked as usual. Returns the fleet, or null if there was nobody
 * to visit or no room on the map.
 * @param {{player?: object, world?: object, dev?: boolean}} [o]
 */
export function spawnAliens(game, entries, o = {}) {
  const rng = rngOf(game);
  const player = o.player || (o.world ? game.players.find(p => p.id === o.world.owner) : null) || pickVictim(game, rng);
  if (!player) return null;
  const world = o.world && o.world.owner === player.id ? o.world : pickWorld(game, player, rng);
  if (!world) return null;
  // The technology of the empire they visit - on the higher levels a step
  // or two ahead of it.
  const A = alienRules(game);
  const t = player.tech;
  const tech = {
    range: 1, mini: 1, radical: 1, recycling: 1,
    speed: t.speed || 1,
    weapons: (t.weapons || 1) + A.techBonus,
    shields: (t.shields || 1) + A.techBonus
  };
  const fighters = A.fighters(Math.max(A.firstTurn, game.turn));
  const speed = SHIP_DEFS.alienCarrier.speedMul * (42 + 13 * (tech.speed - 1));
  const at = riftSpot(game, world, speed, rng);
  if (!at) return null;

  const f = newFleet(game, ALIEN_ID, null);
  f.x = at.x; f.y = at.y; f.z = at.z;
  for (let i = 0; i < A.carriers(fighters); i++) addShip(game, f, 'alienCarrier', tech);
  for (let i = 0; i < fighters; i++) addShip(game, f, 'alienFighter', tech);
  f.dest = world.id;
  f.alien = {
    target: player.id, tech, full: fighters, raids: 0, born: game.turn,
    hp0: f.ships.reduce((a, s) => a + s.maxHp, 0), ...(o.dev ? { dev: true } : {})
  };
  const st = stateOf(game);
  st.visits[player.id] = (st.visits[player.id] || 0) + 1;
  rift(game, at, 'open');
  const near = nearest(game, at);
  const eyes = watchers(game, at);
  if (!eyes.includes(player.id)) eyes.push(player.id);
  entries?.push({ type: 'alien', playerIds: eyes, planetId: world.id,
    key: 'log.alienRift', params: { near: near?.name ?? '?', planet: world.name, count: f.ships.length } });
  return f;
}

// ------------------------------------------------------------------ Steering

/**
 * At the start of the turn, before the fleets move: every swarm keeps up
 * the siege of an inhabited world, or picks the next one nearby.
 */
export function steerAliens(game) {
  game.alienRifts = [];
  const A = alienRules(game);
  for (const f of alienFleets(game)) {
    const a = f.alien || (f.alien = { target: null, full: 0, raids: 0, born: game.turn, hp0: 1 });
    if (a.leaving) continue;
    if (f.dest != null) {
      const p = game.galaxy.planets[f.dest];
      if (p && fairGame(game, p, a)) continue;
      f.dest = null;
    }
    if (f.at != null) {
      const here = game.galaxy.planets[f.at];
      if (here && here.owner && (here.pop >= 0.5 || here.defenses?.length)
        && (a.dev || worldsOf(game, here.owner).length >= 2)) continue;
    }
    if (a.raids >= A.raids) { a.leaving = true; continue; }
    const prey = pickPrey(game, f);
    if (prey) f.dest = prey.id;
    else a.leaving = true;
  }
}

/**
 * The next world: close by, the visited empire's first, homeworlds last -
 * and never the last world of an empire: the aliens hurt, they do not
 * knock anybody out of the game.
 */
function pickPrey(game, f) {
  const { hunt } = alienRules(game);
  const zone = holeZone(game.galaxy);
  let best = null, bs = Infinity;
  for (const p of game.galaxy.planets) {
    if (p.id === f.at || !fairGame(game, p, f.alien)) continue;
    const d = travelDistance(f, p, zone);
    if (d > hunt) continue;
    const score = d * (p.owner === f.alien.target ? 0.7 : 1) * (p.isHomeworld ? 3 : 1);
    if (score < bs) { bs = score; best = p; }
  }
  return best;
}

// --------------------------------------------------------------- Overrunning

/**
 * The aliens hold the orbit of a world on their own: nobody survives. The
 * world is free and empty again - whoever wants it settles it anew.
 */
export function overrun(game, planet, entries) {
  if (!planet.owner && !(planet.pop > 0)) return;
  // The last world of an empire is spared - they move on next turn.
  const here = alienFleets(game).filter(f => f.at === planet.id);
  if (planet.owner && planet.pop >= 0.5 && worldsOf(game, planet.owner).length < 2
    && !here.some(f => f.alien?.dev)) return;
  const old = game.players.find(p => p.id === planet.owner);
  planet.owner = null;
  planet.pop = 0;
  planet.terraBudget = 0;
  planet.terraSpent = 0;
  planet.defenses = [];
  planet.station = null;
  for (const f of here) if (f.alien) f.alien.raids++;
  const eyes = watchers(game, planet);
  if (old && !eyes.includes(old.id)) eyes.push(old.id);
  entries.push({ type: 'alien', playerIds: eyes, planetId: planet.id,
    key: old ? 'log.alienOverrun' : 'log.alienOverrunFree', params: { planet: planet.name, player: old?.name ?? null } });
}

// ------------------------------------------------------------ End of the turn

/**
 * After the battles and the landings: carriers send out new fighters, swarms
 * without a carrier or with their work done leave - and now and then a new
 * rift opens.
 * @param {Set<number>} fought worlds with a battle this turn
 */
export function alienTurn(game, entries, fought = new Set()) {
  const A = alienRules(game);
  for (const f of alienFleets(game)) {
    const a = f.alien;
    if (!a) continue;
    const here = f.at != null ? game.galaxy.planets[f.at] : f;
    if (!hasCarrier(f)) {
      // Without their carrier the fighters break off and flee home.
      entries.push({ type: 'alien', playerIds: watchers(game, here), planetId: f.at ?? nearest(game, f)?.id ?? null,
        key: 'log.alienBrokeOff', params: { near: (f.at != null ? here : nearest(game, f))?.name ?? '?', count: f.ships.length } });
      rift(game, f, 'close');
      f.ships = [];
      continue;
    }
    const hp = f.ships.reduce((s, x) => s + x.hp, 0);
    if (a.leaving || a.raids >= A.raids || game.turn - a.born >= A.life || hp < a.hp0 * A.retreat) {
      entries.push({ type: 'alien', playerIds: watchers(game, here), planetId: f.at ?? nearest(game, f)?.id ?? null,
        key: 'log.alienLeft', params: { near: (f.at != null ? here : nearest(game, f))?.name ?? '?' } });
      rift(game, f, 'close');
      f.ships = [];
      continue;
    }
    // The carrier sends out new fighters - but not in the middle of a battle.
    if (f.at != null && fought.has(f.at)) continue;
    const have = f.ships.filter(s => s.type === 'alienFighter').length;
    for (let i = 0; i < A.relaunch && have + i < a.full; i++) addShip(game, f, 'alienFighter', a.tech);
  }
  cleanupFleets(game);

  if (game.settings.aliens === false || game.turn < A.firstTurn) return;
  const st = stateOf(game);
  const rng = rngOf(game);
  const alive = game.players.filter(p => p.alive).length;
  const interval = A.interval(alive);
  if (st.next == null) st.next = A.firstTurn + Math.floor(rng() * interval);
  if (game.turn < st.next) return;
  if (alienFleets(game).length >= A.maxActive(alive)) return;
  const f = spawnAliens(game, entries);
  // Nobody to visit right now: try again soon.
  st.next = game.turn + (f ? Math.round(interval * (0.7 + rng() * 0.6)) : 3);
}

/** The rifts of this turn an empire sees - spectators see all of them. */
export function riftView(game, player) {
  const all = game.alienRifts || [];
  return player ? all.filter(r => seesPoint(game, player.id, r)) : all.slice();
}

/**
 * Testing aid for the dev mode: aliens right away - at the selected world,
 * otherwise at a world of whoever asks, otherwise wherever the next raid
 * would go. Ignores the rules of when and whom.
 */
export function devAliens(game, player, planetId, entries) {
  const world = planetId != null ? game.galaxy.planets[planetId] : null;
  if (world && inhabited(world)) return !!spawnAliens(game, entries, { world, dev: true });
  if (player && player.alive && worldsOf(game, player.id).length) return !!spawnAliens(game, entries, { player, dev: true });
  return !!spawnAliens(game, entries, { dev: true });
}
