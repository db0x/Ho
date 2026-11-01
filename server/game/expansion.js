// The growing map: exploring close to the edge pushes the border further
// out, until the galaxy is complete.
import { planetCapacity } from '../../shared/rules.js';
import { expandSpiral, expandGalaxy } from '../galaxy.js';

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
export function maybeExpand(game, entries) {
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
