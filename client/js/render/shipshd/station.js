// The orbital station and its construction site (see ../shipshd.js) - one
// drawing for the map, the icons, the ship profile and the battle.
// Seen from the side and upright, unlike the ships: a heavy open ring on top,
// covered with blocks and lit windows and carried on spokes, a stepped tower
// with rows of windows, a hangar bulge with lit docking bays, a sphere at the
// foot with a glowing band and a bundle of antennas below. The owner's color
// runs along the ring's outer wall and around the hangar. The site: tower
// and hangar stand, part of the ring is plated, the rest is scaffold, a crane
// swings the next block in.
// Drawn on the grid of 100 units around the origin, y downwards.
import { RED, GREEN, WHITE, fillShadowed, metal, bevel, TAU, tone } from './kit.js';

const AMBER = '#ffb347';
const GLOW = '#8fdcff';
const HULL = '#9aa6bb';

/** Metal across a vertical body: light from the upper left, dark on the right. */
function cylinder(ctx, x0, x1, base = HULL) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, tone(base, -0.35));
  g.addColorStop(0.22, tone(base, 0.55));
  g.addColorStop(0.45, base);
  g.addColorStop(0.8, tone(base, -0.45));
  g.addColorStop(1, tone(base, -0.7));
  return g;
}

/** Rows of lit windows on a vertical body between x0 and x1. */
function windows(ctx, x0, x1, ys, step, seed, lite) {
  if (lite) return;
  for (const y of ys) {
    for (let x = x0 + step / 2, i = 0; x < x1; x += step, i++) {
      // Some dark - a pattern, not noise: the same every frame.
      if (Math.sin(i * 7.31 + y * 3.17 + seed) > 0.55) continue;
      const shade = Math.abs((x - (x0 + x1) / 2) / ((x1 - x0) / 2));
      ctx.fillStyle = `rgba(255,226,170,${(0.95 - shade * 0.55).toFixed(2)})`;
      ctx.fillRect(x - 0.45, y - 0.35, 0.9, 0.7);
    }
  }
}

/**
 * The whole station.
 * @param {number} S     device pixels per grid unit (for shadows)
 * @param {boolean} site under construction
 * @param {boolean} lite small on the map: no windows, fewer seams
 */
export function stationBody(ctx, color, S, site = false, lite = false) {
  // Everything below the ring is a body of revolution, seen at the same
  // slant as the ring: a lit cap on top of every step, edges and seams that
  // curve with it, windows narrowing towards the sides. Painted bottom-up -
  // every step covers the cap of the one beneath it.

  // ----- Antennas at the foot, a dish on one of them
  ctx.strokeStyle = '#7d889c'; ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (const [x, y] of [[-3.4, 60], [0, 63], [3.4, 59]]) { ctx.moveTo(x * 0.45, 50); ctx.lineTo(x, y); }
  ctx.stroke();
  if (!lite) {
    ctx.fillStyle = '#c9d3e4';
    ctx.beginPath(); ctx.ellipse(-3.6, 58.6, 1.8, 0.7, -0.4, 0, TAU); ctx.fill();
  }

  // ----- Sphere at the foot: latitudes, lights, a glowing equator
  const sy = 40, sr = 12.5;
  const sph = () => { ctx.beginPath(); ctx.arc(0, sy, sr, 0, TAU); };
  sph();
  const sg = ctx.createRadialGradient(-4.5, sy - 6, 1, 0, sy, sr * 1.05);
  sg.addColorStop(0, '#f2f6fc'); sg.addColorStop(0.4, '#a9b4c8'); sg.addColorStop(0.85, '#4a5468'); sg.addColorStop(1, '#262d3b');
  fillShadowed(ctx, sg, S);
  ctx.save(); sph(); ctx.clip();
  for (const f of [-0.62, -0.3, 0.32, 0.64]) {
    const yy = sy + f * sr, rr = Math.sqrt(1 - f * f) * sr;
    arcFront(ctx, yy, rr, 'rgba(8,12,22,.35)', 0.3);
    if (!lite) curvedWindows(ctx, yy - 1.2, rr, 14, 0.5, f * 9);
  }
  if (!lite) for (const t of [0.35, 0.7, 1.05, 1.4, 1.75, 2.1, 2.45, 2.8]) meridian(ctx, sy, sr, t);
  ctx.restore();
  bevel(ctx, sph, 0.6);
  glowArc(ctx, sy + 1, sr * 0.99, GLOW, 1.1);

  // ----- Lower tower: two drums with a collar, pipes and hatches
  drum(ctx, 22, 30, 7, S, lite, { windows: [25.5], seed: 1 });
  drum(ctx, 19.5, 22.4, 8.6, S, lite, { base: '#7f8a9f' });          // collar
  drum(ctx, 9, 20, 10.5, S, lite, { windows: [12.2, 15.2, 18], seed: 2, seams: [13.8, 16.8], ribs: 9 });
  if (!lite) {
    // Pipes down the tower's left, a hatch and a small dish on the right
    for (const x of [-8.4, -6.9]) {
      ctx.strokeStyle = '#59637a'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(x, 10.5); ctx.lineTo(x, 20 + 2.2 * Math.sqrt(1 - (x / 10.5) ** 2)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 0.2;
      ctx.beginPath(); ctx.moveTo(x - 0.2, 10.5); ctx.lineTo(x - 0.2, 20); ctx.stroke();
    }
    ctx.fillStyle = '#2a3142'; ctx.fillRect(4.2, 14, 2.6, 3.2);
    ctx.strokeStyle = '#c9d3e4'; ctx.lineWidth = 0.35; ctx.strokeRect(4.2, 14, 2.6, 3.2);
    ctx.strokeStyle = '#8a95aa'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(10.4, 12); ctx.lineTo(14.5, 9.5); ctx.stroke();
    ctx.fillStyle = '#d8e0ec';
    ctx.beginPath(); ctx.ellipse(15.4, 8.9, 2.4, 1.1, -0.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(8,12,22,.5)'; ctx.lineWidth = 0.25; ctx.stroke();
  }

  // ----- Hangar: a body of revolution, widest just above its foot
  const prof = [[-9, 13], [-6.5, 19], [-3, 23.5], [1, 26], [5, 26.4], [8.5, 25], [10.5, 23]];
  const rAt = (y) => {
    for (let i = 1; i < prof.length; i++) {
      if (y <= prof[i][0]) {
        const [y0, r0] = prof[i - 1], [y1, r1] = prof[i];
        return r0 + (r1 - r0) * (y - y0) / (y1 - y0);
      }
    }
    return prof[prof.length - 1][1];
  };
  // Docking arms with a ferry each, behind the hangar's sides
  if (!lite) {
    for (const sx of [-1, 1]) {
      ctx.strokeStyle = '#7d889c'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(sx * 22, 3); ctx.lineTo(sx * 34, 1.5); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(sx * 22, 2.4); ctx.lineTo(sx * 34, 0.9); ctx.stroke();
      ferry(ctx, sx * 37, 1, sx, color);
    }
  }
  const hull = () => {
    ctx.beginPath();
    ctx.moveTo(-prof[0][1], prof[0][0]);
    for (const [y, r] of prof) ctx.lineTo(-r, y);
    ctx.ellipse(0, prof[prof.length - 1][0], prof[prof.length - 1][1], prof[prof.length - 1][1] * K, 0, Math.PI, 0, true);
    for (let i = prof.length - 1; i >= 0; i--) ctx.lineTo(prof[i][1], prof[i][0]);
    ctx.ellipse(0, prof[0][0], prof[0][1], prof[0][1] * K, 0, 0, Math.PI, true);
    ctx.closePath();
  };
  hull(); fillShadowed(ctx, cylinder(ctx, -26.4, 26.4), S);
  ctx.save(); hull(); ctx.clip();
  // Its upper slope faces the light
  const up = ctx.createLinearGradient(0, -9, 0, 4);
  up.addColorStop(0, 'rgba(255,255,255,.35)'); up.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = up; ctx.fillRect(-27, -10, 54, 14);
  // Latitudes and meridians
  for (const y of lite ? [1] : [-6.5, -3, 1, 5, 8.5]) arcFront(ctx, y, rAt(y), 'rgba(8,12,22,.35)', 0.3);
  if (!lite) {
    for (let t = 0.3; t < Math.PI; t += Math.PI / 12) {
      ctx.strokeStyle = 'rgba(8,12,22,.22)'; ctx.lineWidth = 0.25;
      ctx.beginPath();
      prof.forEach(([y, r], i) => { const p = [Math.cos(t) * r, y + Math.sin(t) * r * K]; i ? ctx.lineTo(...p) : ctx.moveTo(...p); });
      ctx.stroke();
    }
    curvedWindows(ctx, -5.2, rAt(-5.2), 34, 0.55, 3);
    curvedWindows(ctx, 7, rAt(7), 44, 0.6, 5);
  }
  // Docking bays: lit openings that follow the curve and narrow to the sides
  for (const t of [0.62, 1.12, 1.57, 2.02, 2.52]) {
    const w = 0.17, y0 = -0.2, y1 = 4.2;
    const pt = (tt, y) => [Math.cos(tt) * rAt(y), y + Math.sin(tt) * rAt(y) * K];
    const quad = () => { ctx.beginPath(); ctx.moveTo(...pt(t - w, y0)); ctx.lineTo(...pt(t + w, y0)); ctx.lineTo(...pt(t + w, y1)); ctx.lineTo(...pt(t - w, y1)); ctx.closePath(); };
    quad(); ctx.fillStyle = '#121826'; ctx.fill();
    ctx.save(); quad(); ctx.clip();
    // The opening sits lower towards the middle (the curve) - light it all, the clip keeps the frame.
    const top = pt(t, y0)[1];
    const bg = ctx.createLinearGradient(0, top, 0, top + (y1 - y0));
    bg.addColorStop(0, '#fff4d6'); bg.addColorStop(1, '#ff9f45');
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t);
    ctx.fillStyle = bg; ctx.fillRect(-30, top + 0.5, 60, y1 - y0 + 4);
    ctx.restore();
    ctx.strokeStyle = 'rgba(8,12,22,.8)'; ctx.lineWidth = 0.35; quad(); ctx.stroke();
  }
  ctx.restore();
  bevel(ctx, hull, 0.6);
  // The owner's color along its foot, a glowing seam above
  arcFront(ctx, 10.5, 23, color, 1.6);
  glowArc(ctx, 9.2 - 0.5, 24.6, GLOW, 0.6);
  // Top cap where the neck stands
  const cap = () => { ctx.beginPath(); ctx.ellipse(0, -9, 13, 13 * K, 0, 0, TAU); };
  cap();
  const cg = ctx.createLinearGradient(-13, -12, 13, -6);
  cg.addColorStop(0, '#eef3fa'); cg.addColorStop(1, '#8792a7');
  ctx.fillStyle = cg; ctx.fill();
  ctx.strokeStyle = 'rgba(8,12,22,.55)'; ctx.lineWidth = 0.35; ctx.stroke();

  // ----- The ring on top, seen at a slant: open in the middle, a heavy
  // band covered with blocks, towers and lit windows; a smooth track with
  // lights along its inner edge, a ribbed outer wall with the owner's color.
  // Painted back to front: the far half, the tower and the spokes through
  // the hole, then the near half.
  ring(ctx, color, S, site, lite);
}


/** Slant of the whole station: how flat a circle of the body looks. */
const K = 0.24;

/** The near half of a circle at height y - a seam or an edge. */
function arcFront(ctx, y, r, style, w) {
  ctx.strokeStyle = style; ctx.lineWidth = w;
  ctx.beginPath(); ctx.ellipse(0, y, r, r * K, 0, 0, Math.PI); ctx.stroke();
}

/** A glowing band around the body at height y. */
function glowArc(ctx, y, r, color, w) {
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = w * 3;
  arcFront(ctx, y, r, color, w);
  ctx.restore();
}

/** A meridian of the sphere: from pole to pole across its near side. */
function meridian(ctx, cy, r, t) {
  ctx.strokeStyle = 'rgba(8,12,22,.2)'; ctx.lineWidth = 0.22;
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const f = -1 + i / 6, rr = Math.sqrt(Math.max(0, 1 - f * f)) * r;
    const p = [Math.cos(t) * rr, cy + f * r + Math.sin(t) * rr * K];
    i ? ctx.lineTo(...p) : ctx.moveTo(...p);
  }
  ctx.stroke();
}

/** A row of windows around the body at height y, narrowing towards the sides, dimmer on the right. */
function curvedWindows(ctx, y, r, n, h, seed) {
  for (let i = 0; i < n; i++) {
    const t = Math.PI * (i + 0.5) / n;
    if (Math.sin(i * 7.31 + seed * 3.17) > 0.5) continue;
    const x = Math.cos(t) * r, yy = y + Math.sin(t) * r * K;
    const w = Math.max(0.15, Math.sin(t) * Math.PI * r / n * 0.45);
    const light = 0.35 + 0.6 * (1 - (Math.cos(t) + 1) / 2 * 0.8) * Math.sin(t);
    ctx.fillStyle = `rgba(255,226,170,${light.toFixed(2)})`;
    ctx.fillRect(x - w / 2, yy - h / 2, w, h);
  }
}

/**
 * A vertical drum from y0 down to y1 with radius r: the side lit from the
 * left, its cap on top, the lower edge curving towards the viewer.
 */
function drum(ctx, y0, y1, r, S, lite, o = {}) {
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(-r, y0); ctx.lineTo(-r, y1);
    ctx.ellipse(0, y1, r, r * K, 0, Math.PI, 0, true);
    ctx.lineTo(r, y0);
    ctx.ellipse(0, y0, r, r * K, 0, 0, Math.PI, true);
    ctx.closePath();
  };
  body(); fillShadowed(ctx, cylinder(ctx, -r, r, o.base || HULL), S * 0.5);
  if (!lite) {
    ctx.save(); body(); ctx.clip();
    for (const y of o.seams || []) arcFront(ctx, y, r, 'rgba(8,12,22,.4)', 0.3);
    for (let i = 1; i < (o.ribs || 0); i++) {
      const x = Math.cos(Math.PI * i / o.ribs) * r;
      const dy = Math.sin(Math.PI * i / o.ribs) * r * K;
      ctx.strokeStyle = 'rgba(8,12,22,.25)'; ctx.lineWidth = 0.25;
      ctx.beginPath(); ctx.moveTo(x, y0 + dy); ctx.lineTo(x, y1 + dy); ctx.stroke();
    }
    for (const y of o.windows || []) curvedWindows(ctx, y, r, Math.round(r * 2.4), 0.6, (o.seed || 0) + y);
    ctx.restore();
  }
  bevel(ctx, body, 0.45);
  const cap = () => { ctx.beginPath(); ctx.ellipse(0, y0, r, r * K, 0, 0, TAU); };
  cap();
  const cg = ctx.createLinearGradient(-r, y0 - r * K, r, y0 + r * K);
  cg.addColorStop(0, '#f1f5fb'); cg.addColorStop(1, '#7d889c');
  ctx.fillStyle = cg; ctx.fill();
  ctx.strokeStyle = 'rgba(8,12,22,.55)'; ctx.lineWidth = 0.3; ctx.stroke();
}

/** A small ferry at a docking arm, nose outwards. */
function ferry(ctx, x, y, dir, color) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
  const f = () => { ctx.beginPath(); ctx.moveTo(-3, -1.3); ctx.lineTo(2.5, -1); ctx.lineTo(4.2, 0); ctx.lineTo(2.5, 1.1); ctx.lineTo(-3, 1.3); ctx.closePath(); };
  f(); ctx.fillStyle = metal(ctx, -1.3, 1.3, '#b4bfd1'); ctx.fill(); bevel(ctx, f, 0.25);
  ctx.fillStyle = color; ctx.fillRect(-2.2, -0.35, 2.6, 0.7);
  ctx.fillStyle = '#7fd4ff'; ctx.fillRect(2.4, -0.45, 0.9, 0.5);
  ctx.restore();
}

const CY = -30;                         // the ring's plane
const RO = [54, 13], RI = [36, 7.6];    // outer and inner ellipse (rx, ry)
const RH = 6;                           // height of the band
/** A fixed "random" number in [0, 1) - the same every frame. */
const rnd = (i, k) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
const at = (a, k, dy = 0) => [Math.cos(a) * (RI[0] + (RO[0] - RI[0]) * k), CY + dy + Math.sin(a) * (RI[1] + (RO[1] - RI[1]) * k)];

/** The top of the band between two angles (a0 < a1). */
function topPath(ctx, a0, a1) {
  ctx.beginPath();
  ctx.ellipse(0, CY, RO[0], RO[1], 0, a0, a1);
  ctx.ellipse(0, CY, RI[0], RI[1], 0, a1, a0, true);
  ctx.closePath();
}

/** Blocks on the band: a lit top, a front face, sometimes a window or a tower. */
function blocks(ctx, a0, a1, color, lite) {
  const list = [];
  const n = lite ? 22 : 70;
  for (let i = 0; i < n; i++) {
    const a = rnd(i, 1) * TAU;
    if (!(a >= a0 && a <= a1) && !(a + TAU >= a0 && a + TAU <= a1)) continue;
    const k = 0.18 + rnd(i, 2) * 0.64;
    const [x, y] = at(a, k);
    list.push({ i, x, y, w: (lite ? 3.2 : 2) + rnd(i, 3) * (lite ? 3 : 3.6), h: 0.8 + rnd(i, 4) * (rnd(i, 5) > 0.88 ? 7 : 2.6), d: 1 + rnd(i, 6) * 1.6 });
  }
  list.sort((p, q) => p.y - q.y);
  for (const b of list) {
    const x = b.x - b.w / 2, y = b.y;
    // Front face
    const g = ctx.createLinearGradient(x, 0, x + b.w, 0);
    g.addColorStop(0, '#c7d0de'); g.addColorStop(1, '#6d778b');
    ctx.fillStyle = g; ctx.fillRect(x, y - b.h, b.w, b.h);
    // Top
    ctx.fillStyle = '#eef3fa';
    ctx.beginPath(); ctx.moveTo(x, y - b.h); ctx.lineTo(x + b.d * 0.6, y - b.h - b.d * 0.5);
    ctx.lineTo(x + b.w + b.d * 0.6, y - b.h - b.d * 0.5); ctx.lineTo(x + b.w, y - b.h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(10,14,24,.55)'; ctx.lineWidth = 0.22;
    ctx.strokeRect(x, y - b.h, b.w, b.h);
    if (!lite && b.h > 1.6) {
      ctx.fillStyle = rnd(b.i, 7) > 0.8 ? color : 'rgba(255,226,170,.9)';
      ctx.fillRect(x + b.w * 0.3, y - b.h * 0.6, Math.max(0.5, b.w * 0.18), 0.5);
    }
  }
}

function ring(ctx, color, S, site, lite) {
  const back = [Math.PI, TAU], front = [0, Math.PI];
  // On a site only part of the band is plated, the rest is scaffold.
  const built = site ? [Math.PI * 0.55, Math.PI * 1.45] : null;
  const span = ([a0, a1]) => built ? [Math.max(a0, built[0]), Math.min(a1, built[1])] : [a0, a1];
  const plated = ([a0, a1]) => a1 > a0;

  // 1) Far half: the inner wall seen through the hole, then the top.
  const fb = span(back);
  if (plated(fb)) {
    ctx.beginPath();
    ctx.ellipse(0, CY, RI[0], RI[1], 0, fb[0], fb[1]);
    ctx.ellipse(0, CY + RH * 0.8, RI[0], RI[1], 0, fb[1], fb[0], true);
    ctx.closePath();
    ctx.fillStyle = '#3b4456'; ctx.fill();
    // Windows along the inner wall
    if (!lite) {
      for (let i = 0; i < 26; i++) {
        const a = fb[0] + (fb[1] - fb[0]) * (i + 0.5) / 26;
        if (rnd(i, 9) > 0.6) continue;
        ctx.fillStyle = 'rgba(255,226,170,.85)';
        ctx.fillRect(Math.cos(a) * RI[0] - 0.4, CY + 2 + Math.sin(a) * RI[1], 0.8, 0.6);
      }
    }
    topPath(ctx, fb[0], fb[1]);
    const tg = ctx.createLinearGradient(0, CY - RO[1], 0, CY);
    tg.addColorStop(0, '#dfe6f1'); tg.addColorStop(1, '#9aa6bb');
    fillShadowed(ctx, tg, S * 0.5);
    ctx.strokeStyle = 'rgba(8,12,22,.6)'; ctx.lineWidth = 0.35; ctx.stroke();
    track(ctx, fb[0], fb[1], lite);
    blocks(ctx, fb[0], fb[1], color, lite);
  }

  // 2) Through the hole: the tower top, the hub and the spokes.
  drum(ctx, CY + 2, -9, 8.4, S, lite, { windows: [CY + 8, CY + 12.5, -14.5], seed: 3, seams: [CY + 10.2, -12.2], ribs: 7 });
  glowArc(ctx, -10.6, 8.4, GLOW, 0.8);
  for (const a of [Math.PI * 0.18, Math.PI * 0.82, Math.PI * 1.25, Math.PI * 1.75]) {
    const far = a > Math.PI;
    const [x1, y1] = at(a, 0.02, 2.4);
    ctx.strokeStyle = far ? '#5d677a' : '#8a95aa'; ctx.lineWidth = lite ? 2.6 : 2.2;
    ctx.beginPath(); ctx.moveTo(Math.sign(x1) * 7, CY + 1); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.moveTo(Math.sign(x1) * 7, CY + 0.2); ctx.lineTo(x1, y1 - 0.8); ctx.stroke();
  }
  // Hub with the command dome and its mast
  const hub = () => { ctx.beginPath(); ctx.ellipse(0, CY + 1, 11, 3, 0, 0, TAU); };
  hub(); fillShadowed(ctx, cylinder(ctx, -11, 11, '#a9b4c8'), S * 0.4); bevel(ctx, hub, 0.4);
  if (!site) {
    const dm = () => {
      ctx.beginPath();
      ctx.ellipse(0, CY, 8, 2, 0, 0, Math.PI);
      ctx.bezierCurveTo(-7.5, CY - 5, -4, CY - 7.5, 0, CY - 7.5);
      ctx.bezierCurveTo(4, CY - 7.5, 7.5, CY - 5, 8, CY);
      ctx.closePath();
    };
    dm(); fillShadowed(ctx, cylinder(ctx, -8, 8, '#b7c1d3'), S * 0.4); bevel(ctx, dm, 0.35);
    ctx.fillStyle = color; ctx.fillRect(-8, CY - 0.6, 16, 0.8);
    windows(ctx, -7, 7, [CY - 3.2], 1.7, 4, lite);
    ctx.strokeStyle = '#aab6cc'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, CY - 7.5); ctx.lineTo(0, -58); ctx.stroke();
  }

  // 3) Near half: the ribbed outer wall with the owner's color, then the top.
  const fr = span(front);
  if (plated(fr)) {
    const wall = () => {
      ctx.beginPath();
      ctx.ellipse(0, CY, RO[0], RO[1], 0, fr[0], fr[1]);
      ctx.ellipse(0, CY + RH, RO[0], RO[1], 0, fr[1], fr[0], true);
      ctx.closePath();
    };
    wall(); fillShadowed(ctx, cylinder(ctx, -RO[0], RO[0], '#8d98ad'), S);
    ctx.save(); wall(); ctx.clip();
    ctx.strokeStyle = 'rgba(8,12,22,.4)'; ctx.lineWidth = 0.35;
    const ribs = lite ? 12 : 36;
    for (let i = 1; i < ribs; i++) {
      const a = fr[0] + (fr[1] - fr[0]) * i / ribs;
      const x = Math.cos(a) * RO[0], y = CY + Math.sin(a) * RO[1];
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + RH); ctx.stroke();
    }
    ctx.strokeStyle = color; ctx.lineWidth = lite ? 1.6 : 1.2;
    ctx.beginPath(); ctx.ellipse(0, CY + RH * 0.55, RO[0], RO[1], 0, fr[0], fr[1]); ctx.stroke();
    if (!lite) {
      for (let i = 0; i < 40; i++) {
        const a = fr[0] + (fr[1] - fr[0]) * (i + 0.5) / 40;
        if (rnd(i, 11) > 0.55) continue;
        ctx.fillStyle = 'rgba(255,226,170,.9)';
        ctx.fillRect(Math.cos(a) * RO[0] - 0.4, CY + RH * 0.25 + Math.sin(a) * RO[1], 0.8, 0.6);
      }
    }
    ctx.restore();
    bevel(ctx, wall, 0.5);
    topPath(ctx, fr[0], fr[1]);
    const tg = ctx.createLinearGradient(-RO[0], 0, RO[0], 0);
    tg.addColorStop(0, '#cdd6e4'); tg.addColorStop(0.35, '#f2f6fc'); tg.addColorStop(1, '#8792a7');
    ctx.fillStyle = tg; ctx.fill();
    ctx.strokeStyle = 'rgba(8,12,22,.6)'; ctx.lineWidth = 0.35; ctx.stroke();
    track(ctx, fr[0], fr[1], lite);
    blocks(ctx, fr[0], fr[1], color, lite);
  }

  if (site) {
    // The rest of the band as scaffold; the crane swings the next block in.
    ctx.save();
    ctx.strokeStyle = 'rgba(205,214,232,.85)'; ctx.lineWidth = lite ? 0.9 : 0.55;
    ctx.setLineDash(lite ? [3, 2.5] : [2.2, 1.6]);
    for (const [r, dy] of [[RO, 0], [RI, 0], [RO, RH]]) {
      ctx.beginPath(); ctx.ellipse(0, CY + dy, r[0], r[1], 0, built[1], built[0] + TAU); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let a = built[1] + 0.12; a < built[0] + TAU - 0.05; a += 0.22) {
      const [x0, y0] = at(a, 0), [x1, y1] = at(a + 0.11, 1);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = lite ? 1.2 : 0.9;
    ctx.beginPath(); ctx.moveTo(10, CY + 2); ctx.lineTo(16, -52); ctx.lineTo(44, -46); ctx.stroke();
    ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(40, -46.5); ctx.lineTo(40, -38); ctx.stroke();
    const seg = () => { ctx.beginPath(); ctx.roundRect(35, -38, 10, 4, 0.8); };
    seg(); fillShadowed(ctx, metal(ctx, -38, -34, '#a6b1c5'), S * 0.4); bevel(ctx, seg, 0.3);
    ctx.restore();
  }
}

/** The smooth track along the inner edge, with its row of lights. */
function track(ctx, a0, a1, lite) {
  ctx.strokeStyle = 'rgba(240,246,255,.9)'; ctx.lineWidth = lite ? 1.6 : 1.2;
  ctx.beginPath(); ctx.ellipse(0, CY, RI[0] + 2.2, RI[1] + 0.5, 0, a0, a1); ctx.stroke();
  const n = lite ? 8 : 22;
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i + 0.5) / n;
    ctx.fillStyle = GLOW;
    ctx.beginPath(); ctx.arc(Math.cos(a) * (RI[0] + 2.2), CY + Math.sin(a) * (RI[1] + 0.5), lite ? 0.8 : 0.5, 0, TAU); ctx.fill();
  }
}

/** Where the blinking lights sit - shared with the map sprite. */
export const STATION_LIGHTS = {
  station: [
    { x: 0, y: -58, r: 1.3, color: RED, off: 0 },
    { x: -54, y: -27, r: 1.1, color: RED, off: 0.4 },
    { x: 54, y: -27, r: 1.1, color: GREEN, off: 0.4 },
    { x: 0, y: 63, r: 1.0, color: WHITE, off: 0.2, strobe: true }
  ],
  stationSite: [
    { x: 16, y: -52, r: 1.3, color: AMBER, off: 0, strobe: true },
    { x: -30, y: -21, r: 0.8, color: AMBER, off: 0.5, strobe: true },
    { x: -54, y: -27, r: 1.1, color: RED, off: 0.4 },
    { x: 0, y: 63, r: 1.0, color: WHITE, off: 0.2, strobe: true }
  ]
};

export const station = {
  r: 68,
  engines: [],
  lights: STATION_LIGHTS.station,
  body: (ctx, color, S) => stationBody(ctx, color, S, false)
};

export const stationSite = {
  r: 68,
  engines: [],
  lights: STATION_LIGHTS.stationSite,
  body: (ctx, color, S) => stationBody(ctx, color, S, true)
};
