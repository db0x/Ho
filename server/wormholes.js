// Wormholes: two mouths far apart that open in the course of a game and
// collapse again after a while (rules in shared/rules.js, WORMHOLE). The
// server keeps the pairs; an empire only learns where a mouth leads by
// sending a fleet through it.
import { WORMHOLE, holeZone, dist } from '../shared/rules.js';
import { makeRng } from './galaxy.js';

/** Scanner reach of own worlds and fleets - for worlds and mouths alike. */
export const SCAN = { world: 230, fleet: 185 };

// Mouths keep their distance from each other, so they never merge into one
// picture on the map.
const MOUTH_GAP = 200;

/** A stream of its own: wormholes must not shift the combat rolls. */
function rngOf(game) {
  return game.holeRng || (game.holeRng = makeRng(`${game.galaxy.seed}:holes`));
}

/** Mouth ids are random - counted ones would give away which two belong together. */
function mouthId(game, rng, taken = []) {
  let id;
  do id = 'm' + Math.floor(rng() * 36 ** 6).toString(36).padStart(6, '0');
  while (taken.includes(id) || game.wormholes.some(h => h.mouths.some(m => m.id === id)));
  return id;
}

/** The mouth with this id, its wormhole and the mouth at the other end. */
export function findMouth(game, id) {
  for (const hole of game.wormholes) {
    const i = hole.mouths.findIndex(m => m.id === id);
    if (i >= 0) return { hole, mouth: hole.mouths[i], exit: hole.mouths[1 - i] };
  }
  return null;
}

function nearest(game, point) {
  let best = null, bd = Infinity;
  for (const p of game.galaxy.planets) {
    const d = dist(p, point);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/**
 * Where a mouth may lie: off the worlds, outside the black hole's zone and
 * away from other mouths - but with worlds nearby, otherwise there is no
 * reason to go there. `relaxed` makes do with one neighbour (testing aid).
 */
function fits(game, p, relaxed) {
  const zone = holeZone(game.galaxy);
  if (zone && dist(p, zone) < zone.r * 1.25 + WORMHOLE.radius) return false;
  let near = 0;
  for (const q of game.galaxy.planets) {
    const d = dist(p, q);
    if (d < WORMHOLE.clearance) return false;
    if (d < WORMHOLE.neighbours) near++;
  }
  if (near < (relaxed ? 1 : 2)) return false;
  for (const h of game.wormholes) for (const m of h.mouths) if (dist(p, m) < MOUTH_GAP) return false;
  return true;
}

function randomPoint(game, rng) {
  const g = game.galaxy;
  return {
    x: Math.round(g.minX + rng() * (g.maxX - g.minX)),
    y: Math.round(g.minY + rng() * (g.maxY - g.minY)),
    z: g.mode === 'space' ? Math.round((rng() * 2 - 1) * (g.halfDepth || 0) * 0.5) : 0
  };
}

/**
 * Opens a wormhole: one mouth anywhere (or, for testing, close to `near`),
 * the other as far away as the map allows - at least WORMHOLE.span of its
 * longer side. Returns the wormhole, or null if the map has no room for one.
 */
export function openWormhole(game, { near = null } = {}) {
  const rng = rngOf(game);
  const g = game.galaxy;
  const span = WORMHOLE.span * Math.max(g.maxX - g.minX, g.maxY - g.minY);
  const spots = [];
  for (let i = 0; i < 1500 && spots.length < 60; i++) {
    const p = randomPoint(game, rng);
    if (fits(game, p, false)) spots.push(p);
  }
  let a = null;
  if (near) {
    // Rings around the spot, slowly widening: the first place that fits.
    for (let i = 0; i < 400 && !a; i++) {
      const ang = rng() * Math.PI * 2, d = 90 + i * 0.6;
      const p = { x: Math.round(near.x + Math.cos(ang) * d), y: Math.round(near.y + Math.sin(ang) * d), z: Math.round(near.z || 0) };
      if (fits(game, p, true)) a = p;
    }
  } else if (spots.length) a = spots[Math.floor(rng() * spots.length)];
  if (!a) return null;
  const far = spots.filter(p => dist(p, a) >= span);
  const b = far.length ? far[Math.floor(rng() * far.length)]
    : spots.reduce((best, p) => (!best || dist(p, a) > dist(best, a) ? p : best), null);
  // A small map gets what it can - but a wormhole next door is pointless.
  if (!b || dist(a, b) < span * 0.6) return null;
  const life = WORMHOLE.life[0] + Math.floor(rng() * (WORMHOLE.life[1] - WORMHOLE.life[0] + 1));
  const first = mouthId(game, rng);
  const hole = {
    id: 'w' + (game.nextHoleId = (game.nextHoleId || 0) + 1),
    mouths: [{ id: first, ...a }, { id: mouthId(game, rng, [first]), ...b }],
    opened: game.turn,
    closes: game.turn + life        // collapses when this turn is resolved
  };
  game.wormholes.push(hole);
  return hole;
}

/**
 * Once per turn, after movement: wormholes whose time is up collapse, and
 * from WORMHOLE.firstTurn on a new one may open.
 */
export function wormholeTurn(game, entries) {
  for (const hole of [...game.wormholes]) if (game.turn >= hole.closes) collapse(game, hole, entries);
  if (game.settings.wormholes === false || game.turn < WORMHOLE.firstTurn) return;
  if (game.wormholes.length >= WORMHOLE.max) return;
  if (rngOf(game)() < WORMHOLE.chance) openWormhole(game);
}

/**
 * The wormhole is gone. Fleets on their way to a mouth stop where they are;
 * whoever is on the far side now has to manage without the way home.
 */
export function collapse(game, hole, entries) {
  game.wormholes = game.wormholes.filter(h => h !== hole);
  const ids = hole.mouths.map(m => m.id);
  for (const f of game.fleets) {
    if (!ids.includes(f.hole)) continue;
    f.hole = null;
    const at = nearest(game, f);
    entries?.push({ type: 'warn', playerIds: [f.owner], private: f.owner, planetId: at?.id ?? null,
      key: 'log.holeLost', params: { near: at?.name ?? '?' } });
  }
  for (const p of game.players) {
    const seen = hole.mouths.find(m => p.seenMouths.has(m.id));
    for (const id of ids) p.seenMouths.delete(id);
    p.knownHoles.delete(hole.id);
    if (!seen || !p.alive) continue;
    const at = nearest(game, seen);
    entries?.push({ type: 'wormhole', playerIds: [p.id], private: p.id, planetId: at?.id ?? null,
      key: 'log.holeCollapsed', params: { near: at?.name ?? '?' } });
  }
}

/** Mouths come into sight like worlds: within scanner reach of own worlds and fleets. */
export function spotWormholes(game, entries) {
  for (const p of game.players) {
    if (!p.alive) continue;
    const mine = game.galaxy.planets.filter(q => q.owner === p.id);
    const fleets = game.fleets.filter(f => f.owner === p.id && f.ships.length);
    for (const hole of game.wormholes) {
      for (const m of hole.mouths) {
        if (p.seenMouths.has(m.id)) continue;
        if (!mine.some(q => dist(q, m) < SCAN.world) && !fleets.some(f => dist(f, m) < SCAN.fleet)) continue;
        p.seenMouths.add(m.id);
        const at = nearest(game, m);
        entries?.push({ type: 'wormhole', playerIds: [p.id], private: p.id, planetId: at?.id ?? null,
          key: hole.opened === game.turn ? 'log.holeOpened' : 'log.holeSpotted', params: { near: at?.name ?? '?' } });
      }
    }
  }
}

/**
 * A fleet reached a mouth: it comes out of the other one and stops there.
 * From now on its empire knows both ends.
 */
export function transit(game, fleet, id, entries) {
  const found = findMouth(game, id);
  if (!found) return false;
  const { hole, exit } = found;
  fleet.x = exit.x; fleet.y = exit.y; fleet.z = exit.z || 0;
  fleet.at = null; fleet.dest = null; fleet.hole = null;
  const p = game.players.find(q => q.id === fleet.owner);
  if (p) {
    p.knownHoles.add(hole.id);
    for (const m of hole.mouths) p.seenMouths.add(m.id);
    const at = nearest(game, exit);
    entries.push({ type: 'wormhole', playerIds: [p.id], private: p.id, planetId: at?.id ?? null,
      key: 'log.holeJump', params: { count: fleet.ships.length, near: at?.name ?? '?' } });
  }
  return true;
}

/** Known wormholes of an empire as supply links - in both directions. */
export function portalsFor(game, owner) {
  const p = game.players.find(q => q.id === owner);
  if (!p || !p.knownHoles?.size) return [];
  const out = [];
  for (const h of game.wormholes) {
    if (!p.knownHoles.has(h.id)) continue;
    const [a, b] = h.mouths;
    out.push({ a, b }, { a: b, b: a });
  }
  return out;
}

/**
 * The mouths an empire has seen; where they lead only once it has jumped.
 * Without a player (spectators) everything, links included.
 */
export function wormholeView(game, player) {
  const out = [];
  for (const h of game.wormholes) {
    const known = !player || player.knownHoles.has(h.id);
    h.mouths.forEach((m, i) => {
      if (player && !player.seenMouths.has(m.id)) return;
      out.push({
        id: m.id, x: m.x, y: m.y, z: m.z || 0,
        link: known ? h.mouths[1 - i].id : null,
        unstable: h.closes - game.turn < WORMHOLE.unstable,
        age: game.turn - h.opened
      });
    });
  }
  return out;
}

/**
 * Testing aids for the dev mode (HO_DEV): open a wormhole (near a spot),
 * reveal all of them, make them unstable, or close them right away.
 * @returns {boolean} whether something changed
 */
export function devWormholes(game, player, action, at) {
  if (action === 'open') {
    const hole = openWormhole(game, { near: at });
    if (!hole) return false;
    // Whoever opened it sees the near end - where it leads stays to be found out.
    player?.seenMouths.add(hole.mouths[0].id);
    spotWormholes(game, null);
    return true;
  }
  if (!game.wormholes.length) return false;
  if (action === 'reveal') {
    if (!player) return false;
    for (const h of game.wormholes) {
      player.knownHoles.add(h.id);
      for (const m of h.mouths) player.seenMouths.add(m.id);
    }
  } else if (action === 'shake') {
    for (const h of game.wormholes) h.closes = Math.min(h.closes, game.turn + WORMHOLE.unstable - 1);
  } else if (action === 'close') {
    for (const h of [...game.wormholes]) collapse(game, h, null);
  } else return false;
  return true;
}
