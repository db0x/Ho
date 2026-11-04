// Ship profiles: the aliens (see ../shipshd.js) - the same outlines as the
// map icons (../alienshapes.js). Green armour in long curved panels, no
// windows, no empire colors.
import { raiderWing, raiderHead, raiderHump, star, starArms, armHalf as half } from '../alienshapes.js';
import { TAU, tone, fillShadowed, bevel, inside, seam } from './kit.js';

const HULL = '#3fae6c';
const GLOW = '#7dffa8';

/** Armour lit from above: bright rim, deep shade. */
function shell(ctx, y0, y1, base = HULL) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, tone(base, 0.7));
  g.addColorStop(0.2, tone(base, 0.25));
  g.addColorStop(0.5, base);
  g.addColorStop(0.7, tone(base, -0.35));
  g.addColorStop(1, tone(base, -0.75));
  return g;
}

/** A curved panel line. */
function line(ctx, pts, w = 0.35, a = 0.6) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = `rgba(4,20,10,${a})`; ctx.lineWidth = w; ctx.stroke();
  ctx.translate(w * 0.8, w * 0.8);
  ctx.strokeStyle = 'rgba(220,255,230,.18)'; ctx.lineWidth = w * 0.7; ctx.stroke();
  ctx.restore();
}

function glowAt(ctx, x, y, r, a) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(235,255,240,${a})`);
  g.addColorStop(0.3, `rgba(125,255,168,${a * 0.8})`);
  g.addColorStop(1, 'rgba(60,255,120,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}

export const alienFighter = {
  r: 56,
  engines: [
    { x: -47, y: -4, r: 2, color: GLOW },
    { x: -47, y: 4, r: 2, color: GLOW }
  ],
  lights: [],
  body(ctx, color, S) {
    // The crescent: claws reaching forward to sharp points
    const wing = () => raiderWing(ctx);
    wing(); fillShadowed(ctx, shell(ctx, -38, 38), S);
    inside(ctx, wing, () => {
      for (const s of [-1, 1]) {
        // A panel line following the curve of the claw, joints across it
        line(ctx, [[-39, s * 14], [-28, s * 26], [-6, s * 32], [20, s * 30], [44, s * 21]]);
        for (const [x0, y0, x1, y1] of [[-42, 6, -32, 4], [-30, 30, -24, 22], [-2, 37, 0, 27], [26, 33, 24, 25], [42, 25, 40, 21]]) {
          line(ctx, [[x0, s * y0], [x1, s * y1]], 0.3);
        }
        // Ribbed band on the claw
        for (let k = 0; k < 5; k++) line(ctx, [[8 + k * 1.8, s * 36.5], [8 + k * 1.8, s * 27]], 0.25, 0.45);
      }
      // The outer rim catches the light
      ctx.strokeStyle = 'rgba(220,255,230,.35)'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(53, -16); ctx.bezierCurveTo(36, -30, 6, -37, -20, -33); ctx.stroke();
    });
    bevel(ctx, wing, 0.9);
    // Guns beneath the head, barrels pointing forward
    for (const s of [-1, 1]) {
      const gun = () => { ctx.beginPath(); ctx.roundRect(-4, s * 5 - 0.9, 21, 1.8, 0.9); };
      gun(); fillShadowed(ctx, shell(ctx, s * 5 - 0.9, s * 5 + 0.9, '#2a7048'), S * 0.4);
      ctx.fillStyle = '#0a1c12'; ctx.fillRect(16, s * 5 - 0.4, 1.4, 0.8);
    }
    // The head in the opening
    const head = () => raiderHead(ctx);
    head(); fillShadowed(ctx, shell(ctx, -12, 12, '#46b673'), S);
    inside(ctx, head, () => {
      for (const x of [-30, -16, -4]) seam(ctx, x, -12, x + 2, 12, 0.3);
      line(ctx, [[-42, -4], [-16, -9], [4, -6]], 0.3, 0.4);
      line(ctx, [[-42, 4], [-16, 9], [4, 6]], 0.3, 0.4);
    });
    bevel(ctx, head, 0.7);
    // The hump along its back
    const hump = () => raiderHump(ctx);
    hump(); fillShadowed(ctx, shell(ctx, -7, 7, '#55c784'), S * 0.8);
    inside(ctx, hump, () => {
      ctx.fillStyle = 'rgba(255,255,255,.2)';
      ctx.beginPath(); ctx.ellipse(-22, -3, 18, 1.5, 0, 0, TAU); ctx.fill();
      for (const x of [-36, -24, -12]) seam(ctx, x, -7, x + 1, 7, 0.25);
    });
    bevel(ctx, hump, 0.5);
    // The slit of the eye across the front of the head
    const slit = () => { ctx.beginPath(); ctx.ellipse(7.5, 0, 1.6, 5.5, 0, 0, TAU); };
    slit(); ctx.fillStyle = '#040e08'; ctx.fill();
    bevel(ctx, slit, 0.3);
  }
};

const along = (a, r, across = 0) => [Math.cos(a) * r - Math.sin(a) * across, Math.sin(a) * r + Math.cos(a) * across];
/** Half width of a star's arm at radius r - roughly, for the details on it. */
const armHalf = (r, len) => Math.max(0.2, half(r, len, len < 49 ? 3.2 : 3.8) - 0.3);

export const alienCarrier = {
  r: 54,
  engines: [],
  lights: [],
  body(ctx, color, S) {
    // The lower star, a sixth of a turn offset: ribbed, machinery, in shade
    const lower = () => star(ctx, Math.PI / 3, 47, 3.2);
    lower(); fillShadowed(ctx, shell(ctx, -46, 46, '#21603b'), S);
    inside(ctx, lower, () => {
      for (const a of starArms(Math.PI / 3)) {
        // Segments like vertebrae, a darker spine along the middle
        for (let r = 8; r < 42; r += 3.2) {
          const w = armHalf(r, 47);
          line(ctx, [along(a, r, -w), along(a, r + 1, 0), along(a, r, w)], 0.4, 0.6);
        }
        line(ctx, [along(a, 6, 0), along(a, 44, 0)], 0.6, 0.45);
      }
    });
    bevel(ctx, lower, 0.7);
    // The upper star: smooth, a bright ridge along every arm
    const upper = () => star(ctx, 0, 50, 3.8);
    upper(); fillShadowed(ctx, shell(ctx, -50, 50), S * 1.4);
    inside(ctx, upper, () => {
      for (const a of starArms(0)) {
        ctx.save();
        ctx.lineCap = 'round';
        // Light along the upper flank of the tube, shade along the lower
        ctx.strokeStyle = 'rgba(230,255,238,.4)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(...along(a, 5, -1.4)); ctx.lineTo(...along(a, 40, -1.2)); ctx.lineTo(...along(a, 48, -0.2)); ctx.stroke();
        ctx.strokeStyle = 'rgba(4,20,10,.45)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(...along(a, 5, 2.2)); ctx.lineTo(...along(a, 40, 1.9)); ctx.lineTo(...along(a, 48, 0.3)); ctx.stroke();
        ctx.restore();
        // A few faint panel joints across the arm
        for (const r of [20, 31]) {
          const w = armHalf(r, 50) + 0.6;
          line(ctx, [along(a, r, -w), along(a, r, w)], 0.25, 0.35);
        }
      }
    });
    bevel(ctx, upper, 0.8);
    // The middle: a dark dome where the two stars meet
    ctx.fillStyle = '#0a2416';
    ctx.beginPath(); ctx.arc(0, 0, 2.8, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(220,255,230,.3)'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.arc(0, 0, 2.8, Math.PI, TAU * 0.85); ctx.stroke();
  },
  /** The dome glows; small lights run out along the arms. */
  anim(ctx, t) {
    glowAt(ctx, 0, 0, 3.6, 0.4 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.4), 2));
    for (const a of starArms(0)) {
      const f = (t * 0.35) % 1;
      const [x, y] = along(a, 8 + f * 38);
      glowAt(ctx, x, y, 1.8, 0.6 * Math.sin(f * Math.PI));
    }
  }
};
