// Meteors on the map (server/meteors.js): a lumpy chunk of rock with veins
// of ore glinting in it, its front glowing from the speed, a tail of hot
// dust behind it - and, faint, the straight course ahead. The same drawing
// on the flat map and in space; only the projection differs.
import { meteorAt } from '../../shared/rules.js';
import { t } from '../i18n.js';

/** The color meteors are known by: hot rock. */
export const METEOR_COLOR = '#ffb46a';
/** Smallest radius on screen, so a meteor stays visible when zoomed out. */
export const METEOR_MIN_PX = 3.5;

/**
 * Radius in world units: bigger with more ore - yet always a small rock,
 * smaller than a ship and far smaller than a world (planets: 14-20).
 */
export const meteorRadius = (m) => 2.4 + Math.sqrt(Math.max(0, m.metal)) * 0.14;

/** A small random stream from the meteor's seed - the same rock every frame. */
function rngOf(seed) {
  let h = (seed | 0) ^ 0x9e3779b9;
  return () => {
    h = (h + 0x6D2B79F5) | 0;
    let x = Math.imul(h ^ (h >>> 15), h | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const shapes = new Map();
/** Outline, craters and ore veins of one rock, in units of its radius. */
function shapeOf(seed) {
  let s = shapes.get(seed);
  if (s) return s;
  const r = rngOf(seed);
  const n = 11;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + (r() - 0.5) * 0.35;
    const d = 0.74 + r() * 0.26;
    pts.push([Math.cos(a) * d, Math.sin(a) * d]);
  }
  const craters = Array.from({ length: 3 }, () => {
    const a = r() * Math.PI * 2, d = r() * 0.45;
    return [Math.cos(a) * d, Math.sin(a) * d, 0.12 + r() * 0.12];
  });
  const glints = Array.from({ length: 5 }, () => {
    const a = r() * Math.PI * 2, d = 0.15 + r() * 0.5;
    return [Math.cos(a) * d, Math.sin(a) * d, 0.05 + r() * 0.05];
  });
  s = { pts, craters, glints, spin: (r() < 0.5 ? -1 : 1) * (0.15 + r() * 0.25), turn: r() * Math.PI * 2 };
  shapes.set(seed, s);
  return s;
}

/**
 * One meteor at (x, y) on screen, radius R in pixels, flying in the screen
 * direction `angle` with a tail of `tail` pixels.
 */
export function drawMeteor(ctx, x, y, R, angle, phase, { seed = 1, tail = R * 4, alpha = 1 } = {}) {
  const s = shapeOf(seed);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);

  // Tail: hot dust behind it, wide at the rock, thinning out.
  ctx.save();
  ctx.rotate(angle);
  const len = Math.max(R * 2.5, tail);
  const g = ctx.createLinearGradient(0, 0, -len, 0);
  g.addColorStop(0, 'rgba(255,190,120,.55)');
  g.addColorStop(0.35, 'rgba(255,140,70,.22)');
  g.addColorStop(1, 'rgba(255,110,50,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(R * 0.2, -R * 0.85);
  ctx.quadraticCurveTo(-len * 0.4, -R * 0.75, -len, 0);
  ctx.quadraticCurveTo(-len * 0.4, R * 0.75, R * 0.2, R * 0.85);
  ctx.closePath();
  ctx.fill();
  const core = ctx.createLinearGradient(0, 0, -len * 0.7, 0);
  core.addColorStop(0, 'rgba(255,236,200,.6)');
  core.addColorStop(1, 'rgba(255,200,140,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.3);
  ctx.lineTo(-len * 0.7, 0);
  ctx.lineTo(0, R * 0.3);
  ctx.closePath();
  ctx.fill();
  // Glow at the front, where the rock heats up.
  const glow = ctx.createRadialGradient(R * 0.3, 0, 0, R * 0.3, 0, R * 2);
  glow.addColorStop(0, 'rgba(255,190,120,.35)');
  glow.addColorStop(1, 'rgba(255,150,80,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(R * 0.3, 0, R * 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Small on screen: a bright core, so it still stands out from the stars.
  if (R < 10) {
    const k = (10 - R) / 5;
    const c = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 2.6);
    c.addColorStop(0, `rgba(255,214,160,${(0.55 * Math.min(1, k)).toFixed(2)})`);
    c.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(0, 0, R * 2.6, 0, Math.PI * 2); ctx.fill();
  }

  // The rock, slowly tumbling. Light from the upper left, as on the worlds.
  ctx.save();
  ctx.rotate(s.turn + phase * s.spin);
  const outline = () => {
    ctx.beginPath();
    s.pts.forEach(([px, py], i) => ctx[i ? 'lineTo' : 'moveTo'](px * R, py * R));
    ctx.closePath();
  };
  outline();
  ctx.restore();
  const body = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R * 1.05);
  body.addColorStop(0, '#c2a988');
  body.addColorStop(0.55, '#7a6350');
  body.addColorStop(1, '#3a2d24');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.rotate(s.turn + phase * s.spin);
  if (R >= 6) {
    for (const [cx, cy, cr] of s.craters) {
      ctx.fillStyle = 'rgba(30,22,16,.45)';
      ctx.beginPath(); ctx.arc(cx * R, cy * R, cr * R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(230,205,170,.3)';
      ctx.lineWidth = Math.max(0.5, R * 0.04);
      ctx.beginPath(); ctx.arc(cx * R + cr * R * 0.15, cy * R + cr * R * 0.15, cr * R, Math.PI * 0.9, Math.PI * 1.9); ctx.stroke();
    }
  }
  // Ore: gold glints that catch the light now and then.
  for (const [gx, gy, gr] of s.glints) {
    const tw = 0.55 + 0.45 * Math.sin(phase * 2.2 + gx * 9 + gy * 7);
    ctx.fillStyle = `rgba(255,214,120,${(0.5 + 0.5 * tw).toFixed(2)})`;
    ctx.beginPath(); ctx.arc(gx * R, gy * R, Math.max(0.6, gr * R), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // The hot front edge.
  ctx.save();
  ctx.clip();
  ctx.rotate(angle);
  const heat = ctx.createLinearGradient(R, 0, -R * 0.2, 0);
  heat.addColorStop(0, 'rgba(255,170,90,.75)');
  heat.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.fillStyle = heat;
  ctx.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 2.4);
  ctx.restore();
  ctx.strokeStyle = 'rgba(12,8,6,.75)';
  ctx.lineWidth = Math.max(0.6, R * 0.06);
  ctx.stroke();
  ctx.restore();
}

/**
 * The course ahead, faint: a dotted line along its straight path with a
 * small mark for every turn - until it leaves the map, at most `max` turns.
 * `toScreen` maps a world point to [x, y] on screen (null if behind the camera).
 */
export function drawMeteorCourse(ctx, m, toScreen, phase, { hot = false, max = 12 } = {}) {
  const turns = Math.min(max, m.left ?? max);
  if (turns < 1) return;
  const pts = [];
  for (let k = 0; k <= turns; k++) {
    const p = toScreen(meteorAt(m, k));
    if (!p) break;
    pts.push(p);
  }
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = `rgba(255,180,106,${hot ? 0.75 : 0.3})`;
  ctx.lineWidth = hot ? 1.6 : 1;
  ctx.setLineDash([2, 5]);
  ctx.lineDashOffset = -phase * 10;
  ctx.beginPath();
  pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = `rgba(255,180,106,${hot ? 0.8 : 0.35})`;
  for (const [x, y] of pts.slice(1)) { ctx.beginPath(); ctx.arc(x, y, hot ? 2 : 1.4, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

/** Lines of the hover tooltip: ore, speed, how long it is still on the map. */
export function meteorLines(m) {
  const speed = Math.round(Math.hypot(m.vx, m.vy, m.vz || 0));
  return [
    [t('meteor.ore', { metal: m.metal }), '#ffd877'],
    [t('meteor.speed', { speed }), '#d6deef'],
    [t('meteor.leaves', { n: m.left, count: m.left }), '#9aa8c4'],
    [t('meteor.catchHint'), METEOR_COLOR]
  ];
}

