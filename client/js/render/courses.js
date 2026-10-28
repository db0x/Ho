// Course lines and orbit slots, shared by the flat map and the space view.
// Everything here works in screen coordinates: both views project first and
// hand over points.
//
// A fleet with a course waits on the side of the orbit that faces its first
// waypoint, nose pointed that way - its line then starts at the ship itself,
// and several fleets leaving the same world fan out instead of all lines
// springing from the middle of the planet.

const TAU = Math.PI * 2;
const GAP = 0.62;                       // minimum angle between two fleets in orbit

const norm = a => ((a % TAU) + TAU) % TAU;
const apart = (a, b) => { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, TAU - d); };

/**
 * Orbit position of every fleet at one world.
 * @param {object[]} fleets       the fleets in orbit there
 * @param {(f) => number|null} headingOf  screen angle of the first waypoint, null without a course
 * @param {(f) => boolean} isMine
 * @returns {Map<string, {a: number, heading: number}>}  a = angle on the orbit, heading = nose
 */
export function orbitSlots(fleets, headingOf, isMine) {
  const out = new Map();
  const gap = Math.min(GAP, TAU / Math.max(1, fleets.length));
  const taken = [];
  // With a course: as close to the course as the neighbours allow.
  const moving = fleets.map(f => ({ f, h: headingOf(f) })).filter(m => m.h != null)
    .sort((x, y) => norm(x.h) - norm(y.h));
  let prev = -Infinity;
  for (const m of moving) {
    let a = norm(m.h);
    if (a - prev < gap) a = prev + gap;
    prev = a;
    taken.push(a);
    out.set(m.f.id, { a, heading: m.h });
  }
  // Without a course: the old places (own at the top, foreign at the bottom),
  // stepping on until one is free.
  for (const f of fleets) {
    if (out.has(f.id)) continue;
    const start = isMine(f) ? -Math.PI / 2 : Math.PI / 2;
    let a = start;
    for (let k = 0; k < Math.ceil(TAU / gap); k++) {
      const cand = start + k * gap;
      if (taken.every(t => apart(t, cand) >= gap * 0.99)) { a = cand; break; }
    }
    taken.push(a);
    out.set(f.id, { a, heading: a + Math.PI / 2 });
  }
  return out;
}

/**
 * Fleets in space that stand on the same spot - split in flight, or launched
 * together - fan out side by side across their heading, so each one can be
 * picked on its own. Changes the spots in place.
 * @param {{x: number, y: number, heading: number}[]} spots  in-space spots only
 * @param {number} gap  distance between two neighbours in screen pixels
 */
export function fanOut(spots, gap) {
  const groups = [];
  for (const s of spots) {
    const g = groups.find(g => Math.abs(g[0].x - s.x) < 3 && Math.abs(g[0].y - s.y) < 3);
    if (g) g.push(s); else groups.push([s]);
  }
  for (const g of groups) {
    if (g.length < 2) continue;
    const nx = -Math.sin(g[0].heading), ny = Math.cos(g[0].heading);
    g.forEach((s, i) => {
      const k = (i - (g.length - 1) / 2) * gap;
      s.x += nx * k; s.y += ny * k;
    });
  }
}

/** Line style: the fleet in focus stands out, the others step back. */
export function courseStyle(f, focusId) {
  const hot = f.id === focusId;
  const dim = focusId != null && !hot;
  const rgb = f.mine ? '255,216,119' : '255,120,120';
  const alpha = hot ? 0.95 : dim ? 0.25 : f.mine ? 0.7 : 0.5;
  return { color: `rgba(${rgb},${alpha})`, width: hot ? 2.6 : 1.4, hot };
}

/**
 * Arrowhead at the edge of the target world, pointing along the last piece
 * of the line.
 * @param {number} fx,fy  where the last piece comes from
 * @param {number} tx,ty  target centre
 * @param {number} r      distance from the centre (ring around the world)
 */
export function arrowHead(ctx, fx, fy, tx, ty, r, size, color) {
  const dx = tx - fx, dy = ty - fy;
  const len = Math.hypot(dx, dy);
  if (len < r + 2) return;
  const ux = dx / len, uy = dy / len;
  const px = tx - ux * r, py = ty - uy * r;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px - ux * size - uy * size * 0.55, py - uy * size + ux * size * 0.55);
  ctx.lineTo(px - ux * size + uy * size * 0.55, py - uy * size - ux * size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Middle of a screen polyline, measured along it. */
export function midpoint(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d >= left && d > 0) {
      const k = left / d;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    }
    left -= d;
  }
  return pts[pts.length - 1];
}

/** A wormhole mouth rather than a world? Mouth ids are strings, world ids numbers. */
export const isMouth = (target) => typeof target?.id === 'string';

/**
 * Where a fleet is heading: a world or a wormhole mouth - null without a
 * course, or if the target is not in the view.
 */
export function courseTarget(view, f) {
  if (f.hole) return view.wormholes?.find(m => m.id === f.hole) || null;
  return f.dest != null ? view.planets[f.dest] || null : null;
}

/** The wormholes this empire knows both ends of, as supply links (shared/rules.js supplyNeed). */
export function portalsOf(view) {
  const list = view.wormholes || [];
  const out = [];
  for (const m of list) {
    const b = m.link && list.find(x => x.id === m.link);
    if (b) out.push({ a: m, b });
  }
  return out;
}

/** The world closest to a point - to name where a mouth lies. */
export function nearestPlanet(view, point) {
  let best = null, bd = Infinity;
  for (const p of view.planets) {
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2 + ((p.z || 0) - (point.z || 0)) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
