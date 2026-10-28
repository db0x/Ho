// Small drawing helpers shared by the flat and the 3D map.
import { rgb } from '../../shared/rules.js';

export function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Sprite cache with a pixel budget instead of a count. Mobile browsers cap
 * the memory of all canvases together (iOS Safari a few hundred MB, Android
 * the GPU memory); once it is used up, new canvases stay blank and worlds
 * vanish from the map. The least recently used sprites go first, and their
 * backing store is released right away instead of whenever the GC runs.
 * Callers must not hold on to a sprite across frames without checking
 * canvas.width - an evicted sprite has width 0.
 */
export class SpriteCache {
  constructor(maxPixels) {
    this.max = maxPixels;
    this.map = new Map();
    this.pixels = 0;
  }

  get(key) {
    const sp = this.map.get(key);
    if (sp) { this.map.delete(key); this.map.set(key, sp); }
    return sp;
  }

  set(key, sp) {
    this.map.set(key, sp);
    this.pixels += sp.canvas.width * sp.canvas.height;
    for (const [k, old] of this.map) {
      if (this.pixels <= this.max || old === sp) break;
      this.map.delete(k);
      this.pixels -= old.canvas.width * old.canvas.height;
      old.canvas.width = old.canvas.height = 0;
    }
  }
}

const glowCache = new Map();
/** Soft blob in the empire color - once per color. */
export function glowSprite(hex) {
  let cv = glowCache.get(hex);
  if (cv) return cv;
  const S = 128;
  cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const c = hexRgb(hex);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, rgb(c, 0.17));
  grad.addColorStop(0.45, rgb(c, 0.075));
  grad.addColorStop(1, rgb(c, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  glowCache.set(hex, cv);
  return cv;
}

/** Brightness levels for stars, prepared once as strings. */
export const STAR_ALPHA = Array.from({ length: 12 },
  (_, k) => `rgba(226,236,255,${((k + 0.5) / 12).toFixed(3)})`);

/** Display size of the black hole: factor on the world radius and a lower
 *  bound in pixels, so the center can be found even from far away. */
export const HOLE_SCALE = 1.3;
export const HOLE_MIN_PX = 16;
const TAU = Math.PI * 2;

// Shape of the swirl - both views compute with it so they look the same.
export const SWIRL = { arms: 7, twist: 2.2, inner: 0.3, outer: 0.75, speed: 0.3 };

/**
 * Point on a swirl arm: t from 0 (inside) to 1 (outside). The arms trail:
 * outwards they run out clockwise, while the rotation goes counterclockwise -
 * that way it looks like sucking in rather than flinging out, and the swirl
 * turns along with the dashed ring of the danger zone.
 */
export function swirlPoint(R, phase, arm, t) {
  const a = -phase * SWIRL.speed + arm * (TAU / SWIRL.arms) + SWIRL.twist * t;
  const r = R * (SWIRL.inner + SWIRL.outer * t * t);
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/** Color and line width of an arm segment - paler and thinner further out. */
export function swirlStroke(ctx, R, t) {
  ctx.strokeStyle = `rgba(162,210,255,${(0.44 * Math.pow(1 - t, 1.5)).toFixed(3)})`;
  ctx.lineWidth = Math.max(0.7, R * 0.055) * (1 - 0.55 * t);
}

/**
 * Maw - the core of the black hole without the arms.
 * Each view draws the arms itself: flat as a spiral, in 3D in the galactic
 * plane.
 */
export function drawHoleCore(ctx, x, y, R) {
  ctx.save();
  const glow = ctx.createRadialGradient(x, y, R * 0.32, x, y, R * 1.6);
  glow.addColorStop(0, 'rgba(126,186,255,0.12)');
  glow.addColorStop(0.5, 'rgba(96,156,255,0.04)');
  glow.addColorStop(1, 'rgba(70,120,230,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y, R * 1.6, 0, TAU); ctx.fill();
  // Softly fading darkness instead of a hard disc - a black circle would look
  // like a planet without a texture among the shiny worlds.
  const dark = ctx.createRadialGradient(x, y, 0, x, y, R * 0.32);
  dark.addColorStop(0, 'rgba(2,4,9,0.97)');
  dark.addColorStop(0.72, 'rgba(3,6,14,0.9)');
  dark.addColorStop(1, 'rgba(4,8,18,0)');
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(x, y, R * 0.32, 0, TAU); ctx.fill();
  ctx.restore();
}

/**
 * Border of the exclusion zone: a dashed ring that rotates slowly. It tells
 * the player how far the hole repels ships - without it a detour would look
 * like a pathfinding bug.
 */
export function drawHoleZone(ctx, x, y, R, phase = 0) {
  if (R < 6) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(150,190,255,.26)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 7]);
  ctx.lineDashOffset = phase * 9;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.stroke();
  ctx.restore();
}

/** Black hole on the flat map: maw plus swirl all around. */
export function drawBlackHole(ctx, x, y, R, phase = 0) {
  drawHoleCore(ctx, x, y, R);
  const pieces = Math.max(6, Math.min(18, Math.round(R / 5)));
  ctx.save();
  for (let k = 0; k < SWIRL.arms; k++) {
    let vx = 0, vy = 0;
    for (let i = 0; i <= pieces; i++) {
      const t = i / pieces;
      const [dx, dy] = swirlPoint(R, phase, k, t);
      if (i) {
        swirlStroke(ctx, R, t);
        ctx.beginPath();
        ctx.moveTo(vx, vy);
        ctx.lineTo(x + dx, y + dy);
        ctx.stroke();
      }
      vx = x + dx; vy = y + dy;
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ Wormhole

/** Display size of a mouth: lower bound in pixels, so it can be found from far away. */
export const WORMHOLE_MIN_PX = 10;

// Colors: violet at the rim, ice blue in the throat. Unstable it turns to
// embers - that is the warning that it will soon be gone.
const HOLE_TINT = {
  calm: { rim: [176, 112, 255], core: [150, 236, 255], ring: [205, 240, 255] },
  shaky: { rim: [255, 104, 74], core: [255, 196, 120], ring: [255, 226, 190] }
};

const holeSprites = new Map();
/** Soft halo, once per tint. */
function holeHalo(tint) {
  const key = 'halo' + tint.rim;
  let cv = holeSprites.get(key);
  if (cv) return cv;
  const S = 192;
  cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, rgb(tint.core, 0.16));
  grad.addColorStop(0.22, rgb(tint.rim, 0.10));
  grad.addColorStop(0.5, rgb(tint.rim, 0.03));
  grad.addColorStop(1, rgb(tint.rim, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  holeSprites.set(key, cv);
  return cv;
}

/**
 * The view through the throat: a starry sky of its own with a nebula in a
 * hue that belongs to this wormhole - another place, seen from here. Once
 * per wormhole, then only rotated and copied.
 */
function holeThroat(seed) {
  const key = 'throat' + seed;
  let cv = holeSprites.get(key);
  if (cv) return cv;
  let h = 0;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 0x9e3779b1);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0; return ((h >>> 0) % 10007) / 10007; };
  const S = 128, c = S / 2;
  cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#03030c';
  g.fillRect(0, 0, S, S);
  const hue = Math.floor(rnd() * 360);
  for (let i = 0; i < 3; i++) {
    const nx = c + (rnd() - 0.5) * S * 0.6, ny = c + (rnd() - 0.5) * S * 0.6;
    const neb = g.createRadialGradient(nx, ny, 0, nx, ny, S * (0.25 + rnd() * 0.25));
    neb.addColorStop(0, `hsla(${hue + i * 25},80%,58%,0.42)`);
    neb.addColorStop(1, `hsla(${hue + i * 25},80%,40%,0)`);
    g.fillStyle = neb;
    g.fillRect(0, 0, S, S);
  }
  for (let i = 0; i < 70; i++) {
    const r = rnd() < 0.85 ? 0.6 : 1.3;
    g.fillStyle = `rgba(235,240,255,${(0.35 + rnd() * 0.65).toFixed(2)})`;
    g.beginPath(); g.arc(rnd() * S, rnd() * S, r, 0, TAU); g.fill();
  }
  // Toward the rim the tunnel swallows the light.
  const vignette = g.createRadialGradient(c, c, 0, c, c, c);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.6, 'rgba(0,0,0,0.15)');
  vignette.addColorStop(1, 'rgba(2,0,10,0.96)');
  g.fillStyle = vignette;
  g.fillRect(0, 0, S, S);
  holeSprites.set(key, cv);
  return cv;
}

const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

/**
 * A wormhole mouth: a halo, matter spiralling in along three arms, a bright
 * lensing ring and in the middle the throat with a view of the far side,
 * where rings sink away into the tunnel. Unstable it flickers, trembles and
 * throws sparks. While it opens it unfolds from a point with a shock wave.
 * @param {{seed: string, unstable?: boolean, open?: number, alpha?: number}} o
 *   open: 0..1 while it unfolds, 1 afterwards
 */
export function drawWormhole(ctx, x, y, R, phase, o) {
  const open = Math.max(0, Math.min(1, o.open ?? 1));
  const tint = o.unstable ? HOLE_TINT.shaky : HOLE_TINT.calm;
  // Unstable: an uneven flicker made of two detuned waves, and a tremble.
  const flicker = o.unstable ? 0.62 + 0.38 * Math.abs(Math.sin(phase * 7.3) * Math.sin(phase * 3.1 + 1)) : 1;
  const r = R * easeOutBack(open) * (o.unstable ? 1 + 0.06 * Math.sin(phase * 17) : 1);
  const alpha = (o.alpha ?? 1) * flicker;
  if (r < 0.5) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  // Shock wave while it opens
  if (open < 1) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgb(tint.ring, 0.45 * (1 - open));
    ctx.lineWidth = Math.max(1, R * 0.12 * (1 - open));
    ctx.beginPath(); ctx.arc(x, y, R * (0.4 + 3.2 * open), 0, TAU); ctx.stroke();
  }

  // Halo
  ctx.globalCompositeOperation = 'lighter';
  const hr = r * 2.0;
  ctx.drawImage(holeHalo(tint), x - hr, y - hr, hr * 2, hr * 2);

  // Throat: the far side, slowly turning, tunnel rings sinking away into it.
  ctx.globalCompositeOperation = 'source-over';
  const tr = r * 0.56;
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, tr, 0, TAU); ctx.clip();
  ctx.translate(x, y);
  ctx.rotate(phase * 0.12);
  ctx.drawImage(holeThroat(o.seed), -tr, -tr, tr * 2, tr * 2);
  ctx.rotate(-phase * 0.12);
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 4; k++) {
    const f = ((k / 4) + phase * 0.22) % 1;
    const rr = tr * (1 - f);
    ctx.strokeStyle = rgb(tint.core, 0.2 * (1 - f) * (1 - f));
    ctx.lineWidth = Math.max(0.6, tr * 0.08 * (1 - f));
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
  }
  ctx.restore();

  // Matter falling in along three arms; each grain drifts inwards and
  // brightens until the throat swallows it.
  ctx.globalCompositeOperation = 'lighter';
  const grains = r > 26 ? 16 : r > 12 ? 11 : 7;
  for (let arm = 0; arm < 3; arm++) {
    for (let i = 0; i < grains; i++) {
      const f = ((i / grains) + phase * 0.16 + arm * 0.13) % 1;           // 0 outside, 1 at the throat
      const rad = r * (1.35 - 0.8 * f);
      const ang = arm * (TAU / 3) - phase * 0.55 + 2.6 * f * f + (i % 3) * 0.06;
      const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad;
      const c = [0, 1, 2].map(j => tint.rim[j] + (tint.core[j] - tint.rim[j]) * f);
      const a = Math.min(1, f * 2.2) * (f > 0.9 ? (1 - f) * 10 : 1);
      const s = Math.max(0.6, r * 0.04) * (0.6 + f * 0.7);
      ctx.fillStyle = rgb(c, 0.07 * a);
      ctx.beginPath(); ctx.arc(px, py, s * 2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = rgb(c, 0.5 * a);
      ctx.beginPath(); ctx.arc(px, py, s, 0, TAU); ctx.fill();
    }
  }

  // Lensing ring: bright, with three slowly wandering highlights.
  const lw = Math.max(0.8, r * 0.055);
  ctx.strokeStyle = rgb(tint.rim, 0.16);
  ctx.lineWidth = lw * 2.5;
  ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, TAU); ctx.stroke();
  const SEG = 36;
  ctx.lineWidth = lw;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * TAU, a1 = ((i + 1.05) / SEG) * TAU;
    const shine = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(a0 * 3 + phase * 1.7), 3);
    ctx.strokeStyle = rgb(tint.ring, 0.6 * shine);
    ctx.beginPath(); ctx.arc(x, y, r * 0.6, a0, a1); ctx.stroke();
  }

  // Unstable: sparks jump off the ring - a new pattern several times a second.
  if (o.unstable) {
    const tick = Math.floor(phase * 9);
    let h = tick * 2654435761 >>> 0;
    const rnd = () => { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; return h / 4294967296; };
    ctx.strokeStyle = rgb(tint.ring, 0.55);
    ctx.lineWidth = Math.max(0.7, r * 0.03);
    for (let k = 0; k < 3; k++) {
      if (rnd() < 0.35) continue;
      let ang = rnd() * TAU, rad = r * 0.6;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
      for (let j = 0; j < 4; j++) {
        ang += (rnd() - 0.5) * 0.5; rad += r * (0.12 + rnd() * 0.12);
        ctx.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * The tunnel between two mouths an empire knows: a faint arc with sparks
 * running along it, in both directions. a and b are screen points.
 */
export function drawWormLink(ctx, a, b, phase, unstable) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 30) return;
  // Bent to one side, so it does not look like a course line.
  const cx = (a.x + b.x) / 2 - dy * 0.18, cy = (a.y + b.y) / 2 + dx * 0.18;
  const at = (t) => [(1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x,
                     (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y];
  const tint = unstable ? HOLE_TINT.shaky : HOLE_TINT.calm;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgb(tint.rim, 0.08);
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cx, cy, b.x, b.y); ctx.stroke();
  ctx.strokeStyle = rgb(tint.ring, 0.14);
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 9]);
  ctx.lineDashOffset = -phase * 30;
  ctx.stroke();
  ctx.setLineDash([]);
  const n = Math.max(2, Math.min(8, Math.round(len / 140)));
  for (let i = 0; i < n; i++) {
    for (const dir of [1, -1]) {
      let t = ((i / n) + phase * 0.07 * dir) % 1;
      if (t < 0) t += 1;
      const [px, py] = at(t);
      const fade = Math.sin(Math.PI * t);
      ctx.fillStyle = rgb(dir > 0 ? tint.core : tint.rim, 0.35 * fade);
      ctx.beginPath(); ctx.arc(px, py, 1.3, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}

/** How far everything not yours steps back while "only mine" is held. */
export const FOCUS_DIM = 0.2;

// ---------------------------------------------------------- Satellite shield

/** From this many satellites on, a world shows the shield instead of individual satellites. */
export const SHIELD_MIN = 5;

const shieldCache = new SpriteCache(6e6);
// Larger shields are scaled up from this one - near the camera in the 3D view
// R is practically unbounded.
const SHIELD_MAX = 320;
// Light from the top left front - the same side the worlds are lit from.
const LIGHT = (() => { const v = [-0.48, -0.58, 0.66]; const l = Math.hypot(...v); return v.map(c => c / l); })();

/**
 * The shield as an image: a sphere of hexagons in the owner's color. The
 * honeycomb mesh lies on the sphere's surface and is projected orthogonally
 * onto the image - towards the center you see the cells from the front,
 * towards the edge obliquely and compressed. Light comes from the top left:
 * there the cells glow a little brighter, the far side stays matte, and at
 * the edge, where you look through the shell at an angle, it becomes denser.
 * Kept faint on purpose: the world inside and its owner ring must stay the
 * eye-catcher, not the shield - late in a game many worlds carry one.
 */
function shieldSprite(R, color) {
  const rr = R < 40 ? Math.max(6, Math.round(R)) : Math.min(SHIELD_MAX, Math.round(R / 4) * 4);
  const key = rr + color;
  let sp = shieldCache.get(key);
  if (sp) return sp;
  const pad = Math.ceil(rr * 0.14) + 4;
  const size = (rr + pad) * 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const c = size / 2;
  // The empire color, lifted a little: drawn additively, dark colors
  // (navy, purple) would otherwise hardly show.
  const base = shieldTone(color, 0.25);
  const tone = (f, a) => `rgba(${shieldTone(color, f)},${a.toFixed(3)})`;

  // Cell size as an angle on the sphere; at the image center at least a few
  // pixels, otherwise the mesh blurs on small maps.
  // Finer when large on screen (battle window), otherwise the cells look coarse.
  const h = Math.max(rr > 120 ? 0.085 : 0.12, 4.2 / rr);
  const dx = Math.sqrt(3) * h, dy = 1.5 * h;
  const EDGE = Math.PI / 2 - h * 0.35;
  // Point on the sphere (distance from the image center as an angle) -> image
  const proj = (u, v) => {
    const th = Math.min(Math.hypot(u, v), Math.PI / 2);
    const k = th < 1e-6 ? 1 : Math.sin(th) / Math.hypot(u, v);
    return [c + u * k * rr, c + v * k * rr];
  };
  g.lineJoin = 'round';
  const n = Math.ceil(EDGE / dy) + 1;
  for (let row = -n; row <= n; row++) {
    const off = (row & 1) ? dx / 2 : 0;
    for (let col = -Math.ceil(EDGE / dx) - 1; col <= Math.ceil(EDGE / dx) + 1; col++) {
      const u = col * dx + off, v = row * dy;
      const th = Math.hypot(u, v);
      if (th > EDGE) continue;
      // Surface normal of the cell and how it faces the light and the eye
      const st = th < 1e-6 ? 0 : Math.sin(th) / th;
      const nx = u * st, ny = v * st, nz = Math.cos(th);
      const light = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
      const lit = Math.max(0, light);
      const rim = Math.pow(1 - nz, 1.6);                   // Fresnel: oblique = dense
      const a = Math.min(0.55, (0.12 + 0.36 * rim + 0.3 * lit * lit) * (light < 0 ? 0.55 : 1));
      const white = Math.pow(lit, 6) * 0.6;                  // only a hint of white in the highlight
      const col3 = base.map(v => Math.round(v + (255 - v) * white));
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const w = Math.PI / 6 + k * Math.PI / 3;
        const [px, py] = proj(u + Math.cos(w) * h * 0.86, v + Math.sin(w) * h * 0.86);
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fillStyle = `rgba(${col3},${(a * 0.12 + lit * 0.025).toFixed(3)})`;
      g.fill();
      // Lines get thinner towards the edge, like the cells themselves
      g.lineWidth = Math.max(0.6, h * rr * 0.07 * (0.45 + 0.55 * nz));
      g.strokeStyle = `rgba(${col3},${a.toFixed(3)})`;
      g.stroke();
    }
  }

  // Shell: a faint haze, a touch brighter towards the light
  const lx = c + LIGHT[0] * rr * 0.5, ly = c + LIGHT[1] * rr * 0.5;
  const shell = g.createRadialGradient(lx, ly, rr * 0.1, c, c, rr);
  shell.addColorStop(0, tone(0.4, 0.05));
  shell.addColorStop(0.7, tone(0, 0.015));
  shell.addColorStop(1, tone(0, 0.05));
  g.fillStyle = shell;
  g.beginPath(); g.arc(c, c, rr, 0, TAU); g.fill();

  // Highlight at the top left - soft, slightly elongated
  g.save();
  g.translate(c + LIGHT[0] * rr * 0.52, c + LIGHT[1] * rr * 0.52);
  g.rotate(Math.atan2(LIGHT[1], LIGHT[0]) + Math.PI / 2);
  g.scale(1, 0.62);
  const gloss = g.createRadialGradient(0, 0, 0, 0, 0, rr * 0.42);
  gloss.addColorStop(0, tone(0.8, 0.22));
  gloss.addColorStop(0.35, tone(0.5, 0.08));
  gloss.addColorStop(1, tone(0.4, 0));
  g.fillStyle = gloss;
  g.beginPath(); g.arc(0, 0, rr * 0.42, 0, TAU); g.fill();
  g.restore();

  // Thin glowing hem, stronger on the lit side
  const hem = g.createRadialGradient(c, c, rr * 0.9, c, c, rr + pad * 0.7);
  hem.addColorStop(0, tone(0.3, 0));
  hem.addColorStop(0.5, tone(0.4, 0.16));
  hem.addColorStop(1, tone(0.3, 0));
  g.fillStyle = hem;
  g.beginPath(); g.arc(c, c, rr + pad * 0.7, 0, TAU); g.fill();
  const arc = g.createLinearGradient(c + LIGHT[0] * rr, c + LIGHT[1] * rr, c - LIGHT[0] * rr, c - LIGHT[1] * rr);
  arc.addColorStop(0, tone(0.7, 0.4));
  arc.addColorStop(0.45, tone(0.4, 0.05));
  arc.addColorStop(1, tone(0.4, 0.14));
  g.strokeStyle = arc;
  g.lineWidth = Math.max(0.8, rr * 0.02);
  g.beginPath(); g.arc(c, c, rr - g.lineWidth / 2, 0, TAU); g.stroke();

  sp = { canvas: cv, half: size / 2, rr };
  shieldCache.set(key, sp);
  return sp;
}

// Default when the owner is not known (e.g. a remembered world).
const SHIELD_COLOR = '#5af08c';

/** The shield color lifted towards white by f (0..1), as "r,g,b". */
function shieldTone(color, f) {
  return hexRgb(color || SHIELD_COLOR).map(v => Math.round(v + (255 - v) * f));
}

/**
 * Shield around a world, in the color of its owner. strength 0..1 makes it
 * paler - in battle it follows the satellites carrying it; at 0 it is gone.
 */
export function drawHexShield(ctx, x, y, R, phase = 0, strength = 1, color = SHIELD_COLOR) {
  if (strength <= 0.01 || R < 4) return;
  const sp = shieldSprite(R, color || SHIELD_COLOR);
  const s = R / sp.rr;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // A weak shield flickers, a full one only breathes slightly
  const flicker = strength < 0.35 ? 0.6 + 0.4 * Math.sin(phase * 31) * Math.sin(phase * 13) : 1;
  ctx.globalAlpha *= strength * flicker * (0.9 + 0.1 * Math.sin(phase * 1.7));
  ctx.drawImage(sp.canvas, x - sp.half * s, y - sp.half * s, sp.canvas.width * s, sp.canvas.height * s);
  // Energy slowly wandering across the shell: a narrow arc of light on the
  // shadow side so the sphere does not look rigid.
  const a = Math.atan2(-LIGHT[1], -LIGHT[0]) + Math.sin(phase * 0.5) * 0.9;
  ctx.strokeStyle = `rgba(${shieldTone(color, 0.5)},0.12)`;
  ctx.lineWidth = Math.max(1, R * 0.02);
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y, R * 0.96, a - 0.35, a + 0.35); ctx.stroke();
  ctx.restore();
}

/** Hit on the shield: a flash in the shield's color at the point of impact, k = 0..1. */
export function drawShieldHit(ctx, x, y, size, k, color = SHIELD_COLOR) {
  if (k < 0 || k > 1) return;
  const a = 1 - k;
  const r = size * (0.6 + 0.6 * k);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${shieldTone(color, 0.8)},${(a * 0.9).toFixed(3)})`);
  g.addColorStop(0.35, `rgba(${shieldTone(color, 0.35)},${(a * 0.55).toFixed(3)})`);
  g.addColorStop(1, `rgba(${shieldTone(color, 0)},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}
