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
