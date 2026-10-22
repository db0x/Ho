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
