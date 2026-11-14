// The orbital station and its construction site (see ../shipshd.js): a ring
// built around its world, at the height of the satellite shield.
//
// Seen at a slant, like the rings some worlds have by nature - but made: a
// slim dark band whose outer wall is lit from within in the owner's colour,
// a stretch of it under glass, another of open lattice. Four anchors sit on
// it, each holding the ring to its world with a tether of light - and
// carrying the shield, once the satellites have raised it. What the station
// is for hangs from the near side: the pods of the yard, where the ships are
// built, and the command module with its masts. The far half runs behind
// the world, the near half in front of it.
//
// One drawing for every view:
//   ringStation   the ring itself, around the origin, in the caller's units
//                 (the map draws it around the real world, ../ships.js)
//   ringAnim      what moves on it: light along the band, pulses down the tethers, the yard
//   ringArc       the same ring seen straight on, as an arc along the rim of
//                 a huge world (the battle window, ../../ui/battle.js)
//   stationBody   ring and a small nameless world on the grid of 100 units -
//                 the icon and the ship profile
// The site: part of the band is plated, the rest is scaffold, the pods of
// the yard only frames, a crane above them.
import { RED, GREEN, WHITE, fillShadowed, TAU, tone } from './kit.js';

const AMBER = '#ffb347';
const GLOW = '#8fdcff';

/** How flat the ring looks: its short axis as a share of the long one. */
export const RING_K = 0.3;
/** It leans a little, so it does not look like a ruler laid across the world. */
export const RING_TILT = -0.12;
/** Where the yard hangs on the ring: in the middle of the near half, towards the viewer. */
export const RING_YARD = 1.55;
/** Inner edge of the band as a share of the outer one. */
const INNER = 0.9;
/** The four anchors: hubs on the band from which a tether of light reaches down to the world. */
const NODES = [0.62, 2.55, 3.72, 5.7];
/** A stretch of the band under glass (a habitat), and one of open lattice. */
const GLASS = [2.8, 3.52], LATTICE = [5.02, 5.56];
/** The command module, standing out from the band on the near right. */
const COMMAND = 0.26;
/** On a site the band is plated from here to there; the yard lies within. */
const BUILT = [Math.PI * 0.3, Math.PI * 1.25];
/** The pods of the yard: offset from RING_YARD along the ring, and size. */
const PODS = [[-0.4, 1.5], [-0.27, 2.1], [-0.13, 1.6], [0.02, 2.4], [0.17, 1.7], [0.3, 2.2], [0.43, 1.4]];

const DARK = '#3b4354', LENS = '#7fe9ff';

/** A fixed "random" number in [0, 1) - the same every frame. */
const rnd = (i, k) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };

/** A point on the ring: angle a, at radius rad, before the tilt. */
export const ringPoint = (a, rad) => [Math.cos(a) * rad, Math.sin(a) * rad * RING_K];
/** The same after the tilt - where something on the ring is on screen, relative to the world. */
export function ringSpot(a, rad) {
  const [x, y] = ringPoint(a, rad), c = Math.cos(RING_TILT), s = Math.sin(RING_TILT);
  return [x * c - y * s, x * s + y * c];
}

/** Dark metal across the band: a little light from the upper left, deep shade on the right. */
function across(ctx, R, base = DARK) {
  const g = ctx.createLinearGradient(-R, 0, R, 0);
  g.addColorStop(0, tone(base, -0.25));
  g.addColorStop(0.2, tone(base, 0.5));
  g.addColorStop(0.5, base);
  g.addColorStop(0.85, tone(base, -0.5));
  g.addColorStop(1, tone(base, -0.7));
  return g;
}

/** Where a tether ends: on the line from its anchor to the middle of the world, at the world's surface. */
function tetherEnd(x, y, world) {
  const d = Math.hypot(x, y) || 1, k = Math.min(0.9, world * 0.93 / d);
  return [x * k, y * k];
}

/**
 * The ring around the origin - the caller has moved there and turned by
 * RING_TILT. R is its outer radius in the caller's units.
 * @param {object} o
 *   color  the owner's - the light bands along the ring carry it
 *   site   under construction
 *   part   'back' (the half behind the world), 'front' or 'both'
 *   lite   small on the map: fewer details
 *   world  radius of the world in the middle - the tethers end on it
 */
export function ringStation(ctx, R, o = {}) {
  const { color = '#9fb0c8', site = false, part = 'both', lite = R < 44, world = R * 0.5 } = o;
  const u = R / 56, K = RING_K, Ri = R * INNER, h = R * 0.05;
  const fine = Math.max(0.45, 0.3 * u);
  const P = (a, rad) => [Math.cos(a) * rad, Math.sin(a) * rad * K];
  const within = (a, [a0, a1]) => a >= a0 && a <= a1;
  const sector = (a0, a1, r0 = Ri, r1 = R) => {
    ctx.beginPath();
    ctx.ellipse(0, 0, r1, r1 * K, 0, a0, a1);
    ctx.ellipse(0, 0, r0, r0 * K, 0, a1, a0, true);
    ctx.closePath();
  };

  const half = (A0, A1, far) => {
    const span = site ? [Math.max(A0, BUILT[0]), Math.min(A1, BUILT[1])] : [A0, A1];
    const [a0, a1] = span;
    if (site) {
      // The part not plated yet: the band's edges as scaffold, rungs across
      ctx.save();
      ctx.strokeStyle = 'rgba(190,205,230,.7)'; ctx.lineWidth = Math.max(0.5, 0.45 * u);
      ctx.setLineDash([2.4 * u, 1.8 * u]);
      for (const [g0, g1] of [[A0, Math.min(A1, BUILT[0])], [Math.max(A0, BUILT[1]), A1]]) {
        if (g1 <= g0) continue;
        for (const rad of [R, Ri]) { ctx.beginPath(); ctx.ellipse(0, 0, rad, rad * K, 0, g0, g1); ctx.stroke(); }
        if (!lite) {
          ctx.setLineDash([]);
          ctx.beginPath();
          for (let a = g0 + 0.08; a < g1 - 0.04; a += 0.2) { ctx.moveTo(...P(a, Ri)); ctx.lineTo(...P(a + 0.1, R)); }
          ctx.stroke();
          ctx.setLineDash([2.4 * u, 1.8 * u]);
        }
      }
      ctx.restore();
    }
    if (a1 <= a0) return;

    // Tethers: light from the anchors down to the world - under the band they start from
    if (!site) {
      for (const a of NODES) {
        if (!within(a, [A0, A1])) continue;
        const [x, y] = P(a, Ri), [ex, ey] = tetherEnd(x, y, world);
        ctx.save();
        ctx.lineCap = 'round';
        const g = ctx.createLinearGradient(x, y, ex, ey);
        g.addColorStop(0, 'rgba(140,225,255,.85)'); g.addColorStop(1, 'rgba(90,170,255,.25)');
        ctx.strokeStyle = 'rgba(90,180,255,.22)'; ctx.lineWidth = Math.max(1.6, 2.6 * u);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = g; ctx.lineWidth = Math.max(0.7, 0.8 * u);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.restore();
      }
    }

    if (far) {
      // The inner wall, seen through the ring's opening
      ctx.beginPath();
      ctx.ellipse(0, 0, Ri, Ri * K, 0, a0, a1);
      ctx.ellipse(0, h * 0.8, Ri, Ri * K, 0, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = '#1b212d'; ctx.fill();
      if (!lite) {
        const n = Math.round(40 * (a1 - a0) / Math.PI);
        for (let i = 0; i < n; i++) {
          if (rnd(i, 9) > 0.45) continue;
          const [x, y] = P(a0 + (a1 - a0) * (i + 0.5) / n, Ri);
          ctx.fillStyle = 'rgba(127,233,255,.8)';
          ctx.fillRect(x - 0.35 * u, y + h * 0.3, 0.7 * u, 0.5 * u);
        }
      }
    } else {
      // The outer wall: dark plates, and the band of light in the owner's colour
      const wall = () => {
        ctx.beginPath();
        ctx.ellipse(0, 0, R, R * K, 0, a0, a1);
        ctx.ellipse(0, h, R, R * K, 0, a1, a0, true);
        ctx.closePath();
      };
      wall(); fillShadowed(ctx, across(ctx, R, '#2f3644'), u);
      ctx.save(); wall(); ctx.clip();
      ctx.strokeStyle = 'rgba(4,7,14,.55)'; ctx.lineWidth = fine;
      const ribs = Math.round((lite ? 14 : 36) * (a1 - a0) / Math.PI);
      ctx.beginPath();
      for (let i = 1; i < ribs; i++) { const [x, y] = P(a0 + (a1 - a0) * i / ribs, R); ctx.moveTo(x, y); ctx.lineTo(x, y + h); }
      ctx.stroke();
      ctx.restore();
      // Lit from within: short strokes of light, a glow around them
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.setLineDash(lite ? [3.2 * u, 2.6 * u] : [2.2 * u, 1.5 * u, 0.7 * u, 1.5 * u]);
      ctx.strokeStyle = hexA(color, 0.3); ctx.lineWidth = Math.max(1.6, 2.4 * u);
      ctx.beginPath(); ctx.ellipse(0, h * 0.55, R, R * K, 0, a0, a1); ctx.stroke();
      ctx.strokeStyle = tone(color, 0.45); ctx.lineWidth = Math.max(0.8, (lite ? 1.3 : 0.95) * u);
      ctx.beginPath(); ctx.ellipse(0, h * 0.55, R, R * K, 0, a0, a1); ctx.stroke();
      ctx.restore();
    }

    // The band's back: dark plates with a bright edge
    sector(a0, a1);
    if (far) {
      const tg = ctx.createLinearGradient(0, -R * K, 0, 0);
      tg.addColorStop(0, '#5b6679'); tg.addColorStop(1, '#343c4b');
      ctx.fillStyle = tg;
    } else {
      const tg = ctx.createLinearGradient(-R, 0, R, 0);
      tg.addColorStop(0, '#4d5769'); tg.addColorStop(0.3, '#6b768b'); tg.addColorStop(1, '#2c3340');
      ctx.fillStyle = tg;
    }
    ctx.fill();
    // Stretches of another kind: a habitat under glass, an open lattice
    for (const [kind, range] of [['glass', GLASS], ['lattice', LATTICE]]) {
      const g0 = Math.max(a0, range[0]), g1 = Math.min(a1, range[1]);
      if (g1 <= g0) continue;
      sector(g0, g1);
      if (kind === 'glass') {
        const gg = ctx.createLinearGradient(0, -R * K, 0, R * K);
        gg.addColorStop(0, 'rgba(120,220,235,.75)'); gg.addColorStop(1, 'rgba(50,130,160,.75)');
        ctx.fillStyle = gg; ctx.fill();
        ctx.strokeStyle = 'rgba(210,250,255,.55)'; ctx.lineWidth = fine;
        ctx.beginPath();
        for (let a = g0 + 0.07; a < g1; a += lite ? 0.14 : 0.07) { ctx.moveTo(...P(a, Ri)); ctx.lineTo(...P(a, R)); }
        ctx.stroke();
        ctx.beginPath(); ctx.ellipse(0, 0, (R + Ri) / 2, (R + Ri) / 2 * K, 0, g0, g1); ctx.stroke();
      } else {
        ctx.fillStyle = '#20242c'; ctx.fill();
        ctx.save(); sector(g0, g1); ctx.clip();
        ctx.strokeStyle = 'rgba(214,190,110,.75)'; ctx.lineWidth = fine;
        ctx.beginPath();
        for (let a = g0 - 0.1; a < g1 + 0.1; a += lite ? 0.09 : 0.045) {
          ctx.moveTo(...P(a, Ri)); ctx.lineTo(...P(a + 0.07, R));
          ctx.moveTo(...P(a + 0.07, Ri)); ctx.lineTo(...P(a, R));
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    // Seams across it; the outer edge catches the light
    ctx.strokeStyle = 'rgba(4,7,14,.5)'; ctx.lineWidth = fine * 0.8;
    const seams = Math.round((lite ? 8 : 20) * (a1 - a0) / Math.PI);
    ctx.beginPath();
    for (let i = 1; i < seams; i++) { const a = a0 + (a1 - a0) * i / seams; ctx.moveTo(...P(a, Ri)); ctx.lineTo(...P(a, R)); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(4,7,14,.7)'; ctx.lineWidth = fine;
    ctx.beginPath(); ctx.ellipse(0, 0, Ri, Ri * K, 0, a0, a1); ctx.stroke();
    ctx.strokeStyle = far ? 'rgba(170,190,220,.45)' : 'rgba(200,215,240,.7)'; ctx.lineWidth = fine;
    ctx.beginPath(); ctx.ellipse(0, 0, R, R * K, 0, a0, a1); ctx.stroke();

    // What sits on it and hangs from it: the anchors, the command module, the yard
    const things = [];
    for (const a of NODES) {
      if (!within(a, span)) continue;
      const [x, y] = P(a, (R + Ri) / 2);
      things.push({ y, draw: () => hub(ctx, x, y, u, lite) });
    }
    if (!far && within(COMMAND, span)) {
      const [x, y] = P(COMMAND, R);
      things.push({ y: y + 0.01, draw: () => command(ctx, x, y, u, color, lite) });
    }
    if (!far && within(RING_YARD, span)) {
      for (const [da, size] of PODS) {
        const [x, y] = P(RING_YARD + da, R);
        things.push({ y: y + 0.02 + size * 0.001, draw: () => pod(ctx, x, y + h, size * u, site, lite) });
      }
      if (site) {
        const [x, y] = P(RING_YARD, R);
        things.push({ y: y + 1, draw: () => crane(ctx, x, y, u) });
      }
    }
    things.sort((p, q) => p.y - q.y).forEach(t => t.draw());
  };

  if (part !== 'front') half(Math.PI, TAU, true);
  if (part !== 'back') half(0, Math.PI, false);
}

/** An anchor: a round hub set into the band, a lens in its middle (ringAnim lights it). */
function hub(ctx, x, y, u, lite) {
  const rx = 3.3 * u, ry = rx * 0.5;
  ctx.beginPath(); ctx.ellipse(x, y + 0.9 * u, rx, ry, 0, 0, TAU);
  ctx.fillStyle = '#1b212d'; ctx.fill();
  const g = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
  g.addColorStop(0, '#7a869b'); g.addColorStop(0.4, '#566074'); g.addColorStop(1, '#2a303c');
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(4,7,14,.7)'; ctx.lineWidth = Math.max(0.4, 0.3 * u); ctx.stroke();
  ctx.fillStyle = LENS;
  ctx.beginPath(); ctx.ellipse(x, y, rx * 0.38, ry * 0.38, 0, 0, TAU); ctx.fill();
  if (!lite) {
    ctx.strokeStyle = 'rgba(127,233,255,.6)'; ctx.lineWidth = 0.3 * u;
    ctx.beginPath(); ctx.ellipse(x, y, rx * 0.7, ry * 0.7, 0, 0, TAU); ctx.stroke();
  }
}

/**
 * A pod of the yard: a drum hanging under the band, a ring of light around
 * its bay. On a site only its frame.
 */
function pod(ctx, x, y, r, site, lite) {
  const cy = y + r * 0.75;
  if (site) {
    ctx.strokeStyle = 'rgba(190,205,230,.8)'; ctx.lineWidth = Math.max(0.5, r * 0.14);
    ctx.setLineDash([r * 0.5, r * 0.35]);
    ctx.beginPath(); ctx.arc(x, cy, r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  // The neck up to the band
  ctx.fillStyle = '#262c38'; ctx.fillRect(x - r * 0.35, y - r * 0.2, r * 0.7, r);
  const g = ctx.createRadialGradient(x - r * 0.35, cy - r * 0.4, r * 0.1, x, cy, r);
  g.addColorStop(0, '#7d889d'); g.addColorStop(0.5, '#454e60'); g.addColorStop(1, '#1b212c');
  ctx.beginPath(); ctx.arc(x, cy, r, 0, TAU);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(4,7,14,.75)'; ctx.lineWidth = Math.max(0.4, r * 0.12); ctx.stroke();
  ctx.strokeStyle = LENS; ctx.lineWidth = Math.max(0.5, r * 0.16);
  ctx.beginPath(); ctx.arc(x, cy, r * 0.58, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#0c1522';
  ctx.beginPath(); ctx.arc(x, cy, r * 0.42, 0, TAU); ctx.fill();
  if (!lite) {
    ctx.fillStyle = 'rgba(190,245,255,.95)';
    ctx.beginPath(); ctx.arc(x, cy, r * 0.16, 0, TAU); ctx.fill();
  }
}

/** The crane of a site, over where the yard is going up. */
function crane(ctx, x, y, u) {
  ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = Math.max(0.7, 0.8 * u);
  ctx.beginPath(); ctx.moveTo(x + 4 * u, y); ctx.lineTo(x + 5.4 * u, y - 9 * u); ctx.lineTo(x - 6 * u, y - 7 * u); ctx.stroke();
  ctx.lineWidth = Math.max(0.4, 0.35 * u);
  ctx.beginPath(); ctx.moveTo(x - 4 * u, y - 7.3 * u); ctx.lineTo(x - 4 * u, y - 3.4 * u); ctx.stroke();
  ctx.fillStyle = '#8f9bb0'; ctx.fillRect(x - 5.6 * u, y - 3.4 * u, 3.2 * u, 1.5 * u);
}

/**
 * The command module: a hull standing out from the band, a bundle of masts
 * and vanes beyond it, lights along its flank.
 */
function command(ctx, x, y, u, color, lite) {
  ctx.save();
  ctx.translate(x, y);
  // Vanes fanning outwards
  ctx.strokeStyle = '#7d889c'; ctx.lineWidth = Math.max(0.4, 0.45 * u); ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [dx, dy] of [[11, -1.5], [11.5, 1.2], [10.4, 3.6], [8.6, 5.4]]) { ctx.moveTo(5 * u, 1.2 * u); ctx.lineTo(dx * u, dy * u); }
  ctx.stroke();
  // The hull: a blunt wedge, lit from the upper left
  const hull = () => {
    ctx.beginPath();
    ctx.moveTo(-3.4 * u, -1.6 * u); ctx.lineTo(3.2 * u, -2.6 * u); ctx.lineTo(6.4 * u, -0.6 * u);
    ctx.lineTo(6 * u, 2.6 * u); ctx.lineTo(1.6 * u, 4 * u); ctx.lineTo(-3 * u, 2.6 * u);
    ctx.closePath();
  };
  const g = ctx.createLinearGradient(-3.4 * u, -2.6 * u, 6 * u, 4 * u);
  g.addColorStop(0, '#8a96ab'); g.addColorStop(0.45, '#4c5567'); g.addColorStop(1, '#1f2530');
  hull(); fillShadowed(ctx, g, u * 0.6);
  ctx.strokeStyle = 'rgba(4,7,14,.75)'; ctx.lineWidth = Math.max(0.4, 0.3 * u); hull(); ctx.stroke();
  ctx.fillStyle = tone(color, 0.4);
  ctx.fillRect(-2.2 * u, 1.3 * u, 6.6 * u, Math.max(0.6, 0.55 * u));
  if (!lite) {
    ctx.fillStyle = LENS;
    for (let i = 0; i < 4; i++) ctx.fillRect((-1.6 + i * 1.5) * u, -0.5 * u, 0.8 * u, 0.5 * u);
  }
  // The mast
  ctx.strokeStyle = '#aab6cc'; ctx.lineWidth = Math.max(0.4, 0.45 * u);
  ctx.beginPath(); ctx.moveTo(MAST[0] * u, -2.4 * u); ctx.lineTo(MAST[0] * u, MAST[1] * u); ctx.stroke();
  ctx.restore();
}
/** Top of the command module's mast, relative to where it meets the ring, in ring units (R = 56). */
const MAST = [1.4, -8.5];

/**
 * What moves on the ring, drawn over the still image: light wandering along
 * the band, pulses running down the tethers, the anchors glowing while the
 * shield is up, work in the yard. Same frame as ringStation.
 * @param {object} o
 *   site, lite
 *   shield   0..1: how strong the shield is the anchors carry (0: dark)
 *   color    the owner's
 *   hide     radius of the world in the middle: tethers end on it, and what runs behind it is not drawn
 */
export function ringAnim(ctx, R, t, o = {}) {
  const { site = false, lite = R < 44, shield = 0, color = GLOW, hide = R * 0.5 } = o;
  const u = R / 56, K = RING_K, Ri = R * INNER, h = R * 0.05;
  const P = (a, rad) => [Math.cos(a) * rad, Math.sin(a) * rad * K];
  const built = (a) => !site || (a >= BUILT[0] && a <= BUILT[1]);
  const hidden = (a, x, y) => Math.sin(a) < 0 && Math.hypot(x, y) < hide;
  const spot = (x, y, r, core, halo) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, core); g.addColorStop(0.35, halo); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Light wandering along the band of the near wall
  for (let k = 0; k < (site ? 1 : 3); k++) {
    const a = ((t * 0.35 + k * TAU / 3) % TAU + TAU) % TAU;
    if (Math.sin(a) < 0 || !built(a)) continue;
    const [x, y] = P(a, R);
    spot(x, y + h * 0.55, (lite ? 5 : 4) * u, 'rgba(255,255,255,.9)', hexA(color, 0.5));
  }
  if (!site) {
    NODES.forEach((a, k) => {
      const [x, y] = P(a, Ri), [ex, ey] = tetherEnd(x, y, hide);
      // A pulse running down each tether
      const f = (t * 0.6 + k * 0.27) % 1, px = x + (ex - x) * f, py = y + (ey - y) * f;
      if (!hidden(a, px, py)) spot(px, py, (lite ? 3.4 : 2.6) * u, `rgba(255,255,255,${(0.9 * (1 - f * 0.5)).toFixed(3)})`, 'rgba(120,210,255,.5)');
      // Where it touches the world
      if (!hidden(a, ex, ey)) spot(ex, ey, 3.2 * u, `rgba(200,240,255,${(0.35 + 0.25 * Math.sin(t * 3 + k)).toFixed(3)})`, 'rgba(90,170,255,.25)');
      // The anchor: always a glimmer, bright in the owner's colour while it carries the shield
      const [hx, hy] = P(a, (R + Ri) / 2);
      if (hidden(a, hx, hy)) return;
      const b = 0.35 + 0.2 * Math.sin(t * 2.1 + k);
      spot(hx, hy, 3.4 * u, `rgba(200,245,255,${b.toFixed(3)})`, 'rgba(127,233,255,.3)');
      if (shield > 0.01) {
        const s = (0.5 + 0.3 * Math.sin(t * 2.1) + 0.2 * Math.pow(Math.max(0, Math.sin(t * 1.6 - k * TAU / 4)), 6)) * shield;
        spot(hx, hy, (lite ? 6 : 5) * u, `rgba(255,255,255,${(0.55 * s).toFixed(3)})`, hexA(color, 0.6 * s));
      }
    });
  }
  // The yard: the bays breathe, one after the other; on a site, welding
  if (built(RING_YARD)) {
    PODS.forEach(([da, size], k) => {
      const [x, y] = P(RING_YARD + da, R), cy = y + h + size * u * 0.75;
      const f = site ? Math.pow(Math.max(0, Math.sin(t * 7.3 + k * 2) * Math.sin(t * 2.9 + k)), 3)
        : 0.3 + 0.3 * Math.pow(Math.max(0, Math.sin(t * 1.4 - k * 0.8)), 4);
      spot(x, cy, size * u * 1.5, site ? `rgba(255,220,160,${(0.9 * f).toFixed(3)})` : `rgba(200,245,255,${f.toFixed(3)})`,
        site ? 'rgba(255,170,80,.25)' : 'rgba(127,233,255,.28)');
    });
  }
  ctx.restore();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, a).toFixed(3)})`;
}

/**
 * The ring seen straight on, as an arc along the rim of a huge world - the
 * battle window stands so close that a slanted ring would not fit into the
 * picture. A band at radius R from a0 to a1 (clockwise), the yard at `yardAt`.
 */
export function ringArc(ctx, cx, cy, R, a0, a1, o = {}) {
  const { color = '#9fb0c8', site = false, t = 0, yardAt = (a0 + a1) / 2, shield = 0 } = o;
  const w = Math.max(6, R * 0.036), u = w / 9;
  // A site is plated on the yard's side only.
  const b0 = site ? Math.max(a0, yardAt - 0.42) : a0, b1 = site ? Math.min(a1, yardAt + 0.3) : a1;
  const at = (a, rad) => [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
  ctx.save();
  if (site) {
    ctx.strokeStyle = 'rgba(205,214,232,.7)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    for (const rad of [R - w / 2, R + w / 2]) { ctx.beginPath(); ctx.arc(cx, cy, rad, a0, a1); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  const band = () => { ctx.beginPath(); ctx.arc(cx, cy, R + w / 2, b0, b1); ctx.arc(cx, cy, R - w / 2, b1, b0, true); ctx.closePath(); };
  const g = ctx.createRadialGradient(cx, cy, R - w / 2, cx, cy, R + w / 2);
  g.addColorStop(0, '#1b212d'); g.addColorStop(0.35, '#3d4657'); g.addColorStop(0.75, '#6b768b'); g.addColorStop(1, '#2f3644');
  band(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 8; ctx.fillStyle = g; ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.save(); band(); ctx.clip();
  // Seams, windows towards the world, the owner's colour along the outside
  ctx.strokeStyle = 'rgba(8,12,22,.4)'; ctx.lineWidth = 0.8;
  ctx.beginPath();
  const n = Math.round((b1 - b0) * R / (w * 1.5));
  for (let i = 1; i < n; i++) { const a = b0 + (b1 - b0) * i / n; ctx.moveTo(...at(a, R - w)); ctx.lineTo(...at(a, R + w)); }
  ctx.stroke();
  for (let i = 0; i < n * 3; i++) {
    if (rnd(i, 13) > 0.55) continue;
    const [x, y] = at(b0 + (b1 - b0) * (i + 0.5) / (n * 3), R - w * 0.22);
    ctx.fillStyle = 'rgba(127,233,255,.9)'; ctx.fillRect(x - u * 0.6, y - u * 0.45, u * 1.2, u * 0.9);
  }
  ctx.strokeStyle = hexA(color, 0.35); ctx.lineWidth = w * 0.4;
  ctx.beginPath(); ctx.arc(cx, cy, R + w * 0.28, b0, b1); ctx.stroke();
  ctx.setLineDash([w * 0.9, w * 0.5]);
  ctx.strokeStyle = tone(color, 0.45); ctx.lineWidth = w * 0.16;
  ctx.beginPath(); ctx.arc(cx, cy, R + w * 0.28, b0, b1); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  ctx.strokeStyle = 'rgba(8,12,22,.7)'; ctx.lineWidth = 1; band(); ctx.stroke();
  // Blocks standing out from the band, and the emitters
  for (let i = 0; i < n; i++) {
    const a = b0 + (b1 - b0) * (i + 0.5 + (rnd(i, 2) - 0.5) * 0.6) / n;
    if (Math.abs(a - yardAt) < 0.12 || rnd(i, 3) > 0.7) continue;
    const hgt = w * (0.14 + rnd(i, 4) * 0.3), bw = w * (0.3 + rnd(i, 5) * 0.45);
    ctx.save(); ctx.translate(...at(a, R + w / 2)); ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = rnd(i, 6) > 0.5 ? '#566074' : '#3d4657'; ctx.fillRect(-bw / 2, -hgt, bw, hgt);
    ctx.strokeStyle = 'rgba(8,12,22,.6)'; ctx.lineWidth = 0.7; ctx.strokeRect(-bw / 2, -hgt, bw, hgt);
    ctx.restore();
  }
  // The yard
  ctx.save(); ctx.translate(...at(yardAt, R + w / 2)); ctx.rotate(yardAt + Math.PI / 2);
  const yw = w * 2.4, yh = w * 1;
  if (site) {
    ctx.strokeStyle = 'rgba(205,214,232,.9)'; ctx.lineWidth = 1.2; ctx.strokeRect(-yw / 2, -yh, yw, yh);
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(yw * 0.3, 0); ctx.lineTo(yw * 0.4, -yh * 2.1); ctx.lineTo(-yw * 0.5, -yh * 1.7); ctx.stroke();
  } else {
    const yg = ctx.createLinearGradient(-yw / 2, 0, yw / 2, 0);
    yg.addColorStop(0, '#7d889d'); yg.addColorStop(1, '#2a303c');
    ctx.fillStyle = yg; ctx.fillRect(-yw / 2, -yh, yw, yh);
    ctx.fillStyle = '#121826'; ctx.fillRect(-yw * 0.36, -yh * 0.8, yw * 0.5, yh * 0.56);
    const bg = ctx.createLinearGradient(0, -yh * 0.8, 0, -yh * 0.24);
    bg.addColorStop(0, '#d6fbff'); bg.addColorStop(1, '#3fb6d8');
    ctx.fillStyle = bg; ctx.fillRect(-yw * 0.34, -yh * 0.76, yw * 0.46, yh * 0.48);
    ctx.fillStyle = color; ctx.fillRect(-yw / 2, -yh * 0.16, yw, yh * 0.12);
    ctx.strokeStyle = 'rgba(8,12,22,.7)'; ctx.lineWidth = 1; ctx.strokeRect(-yw / 2, -yh, yw, yh);
    ctx.strokeStyle = '#aab6cc'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(yw * 0.3, -yh); ctx.lineTo(yw * 0.3, -yh * 2); ctx.stroke();
    const blink = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.fillStyle = `rgba(255,90,80,${0.3 + blink * 0.7})`;
    ctx.beginPath(); ctx.arc(yw * 0.3, -yh * 2, 2.4, 0, TAU); ctx.fill();
  }
  ctx.restore();
  // Lights running along, emitters glowing into the shield
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const a = b0 + ((t * 0.12 + k / 3) % 1) * (b1 - b0), [x, y] = at(a, R - w * 0.1);
    const gl = ctx.createRadialGradient(x, y, 0, x, y, w * 0.7);
    gl.addColorStop(0, 'rgba(255,255,255,.9)'); gl.addColorStop(0.4, 'rgba(143,220,255,.5)'); gl.addColorStop(1, 'rgba(143,220,255,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, w * 0.7, 0, TAU); ctx.fill();
  }
  if (shield > 0.01 && !site) {
    const m = Math.max(3, Math.round((a1 - a0) * 3));
    for (let k = 0; k < m; k++) {
      const a = a0 + (a1 - a0) * (k + 0.5) / m, [x, y] = at(a, R + w * 0.2);
      const b = (0.5 + 0.3 * Math.sin(t * 2.1) + 0.2 * Math.pow(Math.max(0, Math.sin(t * 1.6 - k)), 6)) * shield;
      const gl = ctx.createRadialGradient(x, y, 0, x, y, w * 1.5);
      gl.addColorStop(0, `rgba(255,255,255,${(0.85 * b).toFixed(3)})`); gl.addColorStop(0.3, hexA(color, 0.5 * b)); gl.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, w * 1.5, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------- on the grid of 100 units
// The icon and the ship profile show the station as what it is: a ring
// around a world. The world here is nobody's - small, dark, only there to
// be ringed - with a hint of the shield the ring carries.
const GRID_R = 54, GRID_WORLD = 30;

/**
 * Ring and world on the grid.
 * @param {number} S     device pixels per grid unit (for shadows)
 * @param {boolean} site under construction
 * @param {boolean} lite small on the map: no windows, fewer blocks
 */
export function stationBody(ctx, color, S, site = false, lite = false) {
  const ring = (part) => { ctx.save(); ctx.rotate(RING_TILT); ringStation(ctx, GRID_R, { color, site, part, lite, world: GRID_WORLD }); ctx.restore(); };
  ring('back');
  // The world in the middle
  const w = ctx.createRadialGradient(-GRID_WORLD * 0.38, -GRID_WORLD * 0.42, GRID_WORLD * 0.1, 0, 0, GRID_WORLD);
  w.addColorStop(0, '#7fa3cf'); w.addColorStop(0.45, '#3b577f'); w.addColorStop(0.85, '#16233a'); w.addColorStop(1, '#0a111f');
  ctx.beginPath(); ctx.arc(0, 0, GRID_WORLD, 0, TAU);
  fillShadowed(ctx, w, S);
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, GRID_WORLD, 0, TAU); ctx.clip();
  ctx.fillStyle = 'rgba(190,220,255,.1)';
  for (const [x, y, rx, ry, a] of [[-8, -10, 15, 5, 0.3], [9, 5, 13, 4, -0.2], [-12, 13, 10, 3.4, 0.1]]) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, a, 0, TAU); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(160,200,255,.35)'; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.arc(0, 0, GRID_WORLD - 0.3, Math.PI * 0.75, Math.PI * 1.85); ctx.stroke();
  // The shield: a faint shell in the owner's colour, not on a site
  if (!site && !lite) {
    const sh = ctx.createRadialGradient(0, 0, GRID_R * 0.72, 0, 0, GRID_R * 1.02);
    sh.addColorStop(0, hexA(color, 0)); sh.addColorStop(0.9, hexA(color, 0.09)); sh.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = sh;
    ctx.beginPath(); ctx.arc(0, 0, GRID_R * 1.02, 0, TAU); ctx.fill();
  }
  ring('front');
}

/** What moves, on the grid (see ringAnim). */
export function stationAnim(ctx, t, site = false, lite = false) {
  ctx.save();
  ctx.rotate(RING_TILT);
  ringAnim(ctx, GRID_R, t, { site, lite, shield: site ? 0 : 1, hide: GRID_WORLD, color: '#8fdcff' });
  ctx.restore();
}

const onGrid = (a, rad, dx = 0, dy = 0) => {
  const [x, y] = ringPoint(a, rad), c = Math.cos(RING_TILT), s = Math.sin(RING_TILT);
  return { x: (x + dx) * c - (y + dy) * s, y: (x + dx) * s + (y + dy) * c };
};
const G = GRID_R / 56;
/** Where the blinking lights sit - shared with the map sprite. */
export const STATION_LIGHTS = {
  station: [
    { ...onGrid(COMMAND, GRID_R, MAST[0] * G, MAST[1] * G), r: 1.2, color: RED, off: 0 },
    { ...onGrid(Math.PI, GRID_R), r: 1, color: RED, off: 0.4 },
    { ...onGrid(0, GRID_R, 11.5 * G, 1.2 * G), r: 0.9, color: GREEN, off: 0.4 },
    { ...onGrid(RING_YARD, GRID_R, 0, 9 * G), r: 0.9, color: WHITE, off: 0.2, strobe: true }
  ],
  stationSite: [
    { ...onGrid(RING_YARD, GRID_R, 5.4 * G, -9 * G), r: 1.2, color: AMBER, off: 0, strobe: true },
    { ...onGrid(BUILT[1] - 0.05, GRID_R), r: 0.9, color: AMBER, off: 0.5, strobe: true }
  ]
};

export const station = {
  r: 68,
  engines: [],
  lights: STATION_LIGHTS.station,
  body: (ctx, color, S) => stationBody(ctx, color, S, false),
  anim: (ctx, t) => stationAnim(ctx, t, false)
};

export const stationSite = {
  r: 68,
  engines: [],
  lights: STATION_LIGHTS.stationSite,
  body: (ctx, color, S) => stationBody(ctx, color, S, true),
  anim: (ctx, t) => stationAnim(ctx, t, true)
};
