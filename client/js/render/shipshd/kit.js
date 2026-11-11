// The workshop every ship profile is drawn with: colors, outlines, metal
// and glass, seams, rivets, nozzles - and the moving parts, exhaust flames
// and navigation lights, drawn anew every frame.


export const TAU = Math.PI * 2;

function hexRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16));
}
const rgba = (hex, a) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; };
/** Color lighter (f > 0) or darker (f < 0). */
export function tone(hex, f) {
  const c = hexRgb(hex).map(v => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Mirror-symmetric outline: points of the upper half from front to back. */
export function sym(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i][1] === 0 && (i === 0 || i === pts.length - 1)) continue;
    ctx.lineTo(pts[i][0], -pts[i][1]);
  }
  ctx.closePath();
}

export function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** Metal across the longitudinal axis: lit from above, shadowed below. */
export function metal(ctx, y0, y1, base = '#9aa6bb') {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, tone(base, 0.75));
  g.addColorStop(0.18, tone(base, 0.35));
  g.addColorStop(0.5, base);
  g.addColorStop(0.62, tone(base, -0.18));
  g.addColorStop(1, tone(base, -0.62));
  return g;
}

/** Fills the current path with a drop shadow onto whatever lies beneath. */
export function fillShadowed(ctx, style, S) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 5 * S;
  ctx.shadowOffsetY = 1.2 * S;
  ctx.fillStyle = style;
  ctx.fill();
  ctx.restore();
}

/**
 * Light edge and contour: inside a bright line along the top edge, a dark one
 * along the bottom edge, outside a fine dark rim.
 */
export function bevel(ctx, pathFn, w = 0.9) {
  ctx.save();
  pathFn(); ctx.clip();
  ctx.lineWidth = w * 1.6;
  ctx.save(); ctx.translate(0, w * 0.9); pathFn();
  ctx.strokeStyle = 'rgba(255,255,255,.42)'; ctx.stroke(); ctx.restore();
  ctx.save(); ctx.translate(0, -w * 0.9); pathFn();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke(); ctx.restore();
  ctx.restore();
  pathFn();
  ctx.lineWidth = w * 0.55;
  ctx.strokeStyle = 'rgba(5,8,16,.9)';
  ctx.stroke();
}

/** Draw inside the path. */
export function inside(ctx, pathFn, fn) {
  ctx.save(); pathFn(); ctx.clip(); fn(); ctx.restore();
}

/** Panel line: a dark seam with a bright edge next to it. */
export function seam(ctx, x0, y0, x1, y1, w = 0.35) {
  ctx.lineCap = 'round';
  ctx.lineWidth = w;
  ctx.strokeStyle = 'rgba(10,14,24,.6)';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.beginPath(); ctx.moveTo(x0 + w * 0.8, y0 + w * 0.8); ctx.lineTo(x1 + w * 0.8, y1 + w * 0.8); ctx.stroke();
}

export function rivets(ctx, x0, x1, y, n, r = 0.38) {
  for (let i = 0; i < n; i++) {
    const x = x0 + (x1 - x0) * (n === 1 ? 0.5 : i / (n - 1));
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath(); ctx.arc(x + r * 0.3, y + r * 0.3, r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(235,242,255,.75)';
    ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, TAU); ctx.fill();
  }
}

/** Vent slots. */
export function vents(ctx, x, y, n, len = 4, gap = 1.4) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = 'rgba(8,12,22,.75)';
    ctx.beginPath(); ctx.roundRect(x + i * gap, y - len / 2, gap * 0.5, len, 0.25); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    ctx.fillRect(x + i * gap + gap * 0.5, y - len / 2, 0.2, len);
  }
}

/** Glass with depth and reflection. */
export function glass(ctx, pathFn, x0, x1, y0, y1, tint = '#5fd2ff', S = 1) {
  ctx.save();
  pathFn();
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, tone(tint, 0.65));
  g.addColorStop(0.35, tint);
  g.addColorStop(1, tone(tint, -0.7));
  fillShadowed(ctx, g, S * 0.4);
  inside(ctx, pathFn, () => {
    // Interior: a dark core so it looks deep
    const k = ctx.createRadialGradient((x0 + x1) / 2, (y0 + y1) / 2 + (y1 - y0) * 0.2, 0,
      (x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) * 0.6);
    k.addColorStop(0, 'rgba(0,20,40,.0)');
    k.addColorStop(1, 'rgba(0,10,30,.45)');
    ctx.fillStyle = k; ctx.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
    // Reflection stripe
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath();
    ctx.ellipse(x0 + (x1 - x0) * 0.55, y0 + (y1 - y0) * 0.24, (x1 - x0) * 0.32, (y1 - y0) * 0.09, -0.08, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath();
    ctx.ellipse(x0 + (x1 - x0) * 0.3, y0 + (y1 - y0) * 0.68, (x1 - x0) * 0.1, (y1 - y0) * 0.05, 0, 0, TAU);
    ctx.fill();
  });
  bevel(ctx, pathFn, 0.6);
  ctx.restore();
}

/** Nozzle: bell with a hot ring, pointing backwards (-x). */
export function nozzle(ctx, x, y, r, len = r * 1.1) {
  const p = () => {
    ctx.beginPath();
    ctx.moveTo(x + len, y - r * 0.62);
    ctx.quadraticCurveTo(x + len * 0.3, y - r * 0.7, x, y - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x + len * 0.3, y + r * 0.7, x + len, y + r * 0.62);
    ctx.closePath();
  };
  p();
  ctx.fillStyle = metal(ctx, y - r, y + r, '#6d7486');
  ctx.fill();
  inside(ctx, p, () => {
    for (let i = 1; i <= 3; i++) seam(ctx, x + len * i / 4, y - r, x + len * i / 4, y + r, 0.25);
  });
  bevel(ctx, p, 0.5);
  // Opening with glow
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, '#fff3d6');
  g.addColorStop(0.45, '#ff9a4a');
  g.addColorStop(1, '#4a1a10');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.28, r * 0.9, 0, 0, TAU); ctx.fill();
  ctx.lineWidth = 0.35; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke();
}

/** Rocket-like attachment: weapon, sensor, tank. */
export function capsule(ctx, x0, x1, y, h, base, S) {
  const p = () => { ctx.beginPath(); ctx.roundRect(x0, y - h, x1 - x0, h * 2, h); };
  p(); fillShadowed(ctx, metal(ctx, y - h, y + h, base), S);
  bevel(ctx, p, 0.6);
  return p;
}

/** Exhaust flame behind a nozzle at (x, y), radius r - lenMul makes it longer. */
export function plume(ctx, x, y, r, color, t, seed, lenMul = 1) {
  const f = 0.86 + 0.1 * Math.sin(t * 9.3 + seed) + 0.05 * Math.sin(t * 23.7 + seed * 2.1);
  const len = r * 4.2 * f * lenMul;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // soft glow around the nozzle
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
  halo.addColorStop(0, rgba(color, 0.5 * f));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, TAU); ctx.fill();
  // Flame: colored outside, white inside
  for (const [w, l, a, c] of [[1, 1, 0.75, color], [0.55, 0.62, 0.95, '#ffffff']]) {
    const g = ctx.createLinearGradient(x, 0, x - len * l, 0);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(0.35, rgba(color, a * 0.7));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y - r * w * 0.85);
    ctx.quadraticCurveTo(x - len * l * 0.35, y - r * w * 1.05, x - len * l, y);
    ctx.quadraticCurveTo(x - len * l * 0.35, y + r * w * 1.05, x, y + r * w * 0.85);
    ctx.closePath();
    ctx.fill();
  }
  // Shock diamonds
  for (let i = 1; i <= 3; i++) {
    const dx = x - len * 0.16 * i - Math.sin(t * 5 + i) * 0.4;
    ctx.fillStyle = `rgba(255,255,255,${0.32 / i})`;
    ctx.beginPath(); ctx.ellipse(dx, y, r * 0.3 / Math.sqrt(i), r * 0.22, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/** Navigation light; `strobe` flashes briefly, otherwise it pulses gently. */
export function light(ctx, x, y, r, color, t, off, strobe) {
  const a = strobe
    ? Math.pow(Math.max(0, Math.sin(t * 2.6 + off)), 14)
    : 0.55 + 0.45 * Math.sin(t * 1.9 + off);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * (strobe ? 6 : 3.6));
  g.addColorStop(0, rgba(color, 0.9 * a));
  g.addColorStop(0.25, rgba(color, 0.35 * a));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * (strobe ? 6 : 3.6), 0, TAU); ctx.fill();
  ctx.restore();
  ctx.fillStyle = rgba(color, 0.45 + 0.55 * a);
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

export const RED = '#ff4a3d', GREEN = '#3dff8a', WHITE = '#ffffff';
