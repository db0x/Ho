// Ship profiles: the aliens (see ../shipshd.js) - the same outlines as the
// map icons (../alienshapes.js). Green armour in long curved panels, no
// windows, no empire colors.
import { raiderWing, raiderHead, raiderHump, raiderPod, star, starArms, armHalf as half } from '../alienshapes.js';
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
    { x: -48, y: -12.5, r: 2.6, color: GLOW },
    { x: -48, y: 12.5, r: 2.6, color: GLOW }
  ],
  lights: [],
  // In space: the crescent is a blade - thick at its back, thin along the
  // rim - that rises a little from the middle and then arches down to its
  // rim and its claw tips. The head rides on its back, the hump on the
  // head, an engine pod either side.
  solid: {
    hull: {
      r: 12, h: 4.6,
      z(x, y) {
        const a = Math.abs(y) / 38, f = Math.max(0, (x - 4) / 50);
        return 5 * a - 14 * a * a - 5 * f * f;
      }
    },
    parts: [
      ...[-1, 1].map(s => ({ over: true, r: 3.6, h: 3.4, z: 1.6, belly: 1, path: (ctx) => raiderPod(ctx, s) })),
      { over: true, r: 7, h: 6, z: 3.4, path: (ctx) => raiderHead(ctx) },
      { over: true, r: 4, h: 2.8, z: 8.2, belly: 0, path: (ctx) => raiderHump(ctx) }
    ]
  },
  body(ctx, color, S) {
    // The crescent: broad blades reaching forward to sharp points
    const wing = () => raiderWing(ctx);
    wing(); fillShadowed(ctx, shell(ctx, -38, 38), S);
    inside(ctx, wing, () => {
      for (const s of [-1, 1]) {
        // Panel lines following the curve of the blade, joints across it
        line(ctx, [[-40, s * 12], [-30, s * 25], [-8, s * 30], [18, s * 26.5], [42, s * 14.5]]);
        line(ctx, [[-24, s * 12], [-14, s * 19], [4, s * 20.5], [24, s * 18], [44, s * 11.5]], 0.3, 0.45);
        for (const [x0, y0, x1, y1] of [[-45, 9, -15, 7], [-34, 31, -19, 16], [-4, 37.5, -1, 13.5], [20, 32.5, 18, 15], [38, 22, 37, 13.5]]) {
          line(ctx, [[x0, s * y0], [x1, s * y1]], 0.3);
        }
        // Ribbed band on the blade
        for (let k = 0; k < 6; k++) line(ctx, [[6 + k * 1.8, s * 34], [6.6 + k * 1.8, s * 28]], 0.25, 0.45);
        // The guns, lying in the opening beside the head
        ctx.fillStyle = '#0d2a1b'; ctx.fillRect(-13, s * 9 - 0.6, 21, 1.2);
        ctx.fillStyle = 'rgba(220,255,230,.25)'; ctx.fillRect(-13, s * 9 - 0.6, 21, 0.3);
      }
      // The outer rim catches the light
      ctx.strokeStyle = 'rgba(220,255,230,.35)'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(53, -9); ctx.bezierCurveTo(32, -24.5, 8, -38, -18, -35.5); ctx.stroke();
    });
    bevel(ctx, wing, 0.9);
    // The guns reach out of the back of the opening
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#123b26'; ctx.fillRect(-13, s * 9 - 0.6, 21, 1.2);
      ctx.fillStyle = 'rgba(220,255,230,.3)'; ctx.fillRect(-13, s * 9 - 0.6, 21, 0.3);
    }
    // Engine pods either side of the head
    for (const s of [-1, 1]) {
      const pod = () => raiderPod(ctx, s);
      pod(); fillShadowed(ctx, shell(ctx, s * 12.5 - 3.6, s * 12.5 + 3.6, '#3a9f63'), S * 0.7);
      inside(ctx, pod, () => { for (const x of [-42, -36, -30]) seam(ctx, x, s * 12.5 - 4, x, s * 12.5 + 4, 0.25); });
      bevel(ctx, pod, 0.5);
    }
    // The head in the opening
    const head = () => raiderHead(ctx);
    head(); fillShadowed(ctx, shell(ctx, -7, 7, '#46b673'), S);
    inside(ctx, head, () => {
      for (const x of [-32, -18, -5]) seam(ctx, x, -7, x + 1.5, 7, 0.3);
      line(ctx, [[-44, -3], [-16, -5.4], [4, -3.6]], 0.3, 0.4);
      line(ctx, [[-44, 3], [-16, 5.4], [4, 3.6]], 0.3, 0.4);
    });
    bevel(ctx, head, 0.7);
    // The hump along its back
    const hump = () => raiderHump(ctx);
    hump(); fillShadowed(ctx, shell(ctx, -4, 4, '#55c784'), S * 0.8);
    inside(ctx, hump, () => {
      ctx.fillStyle = 'rgba(255,255,255,.2)';
      ctx.beginPath(); ctx.ellipse(-24, -1.8, 18, 0.9, 0, 0, TAU); ctx.fill();
      for (const x of [-36, -24, -12]) seam(ctx, x, -4, x + 1, 4, 0.25);
    });
    bevel(ctx, hump, 0.5);
    // The slit of the eye across the front of the head
    const slit = () => { ctx.beginPath(); ctx.ellipse(8, 0, 1.3, 3.2, 0, 0, TAU); };
    slit(); ctx.fillStyle = '#040e08'; ctx.fill();
    bevel(ctx, slit, 0.3);
  }
};

const along = (a, r, across = 0) => [Math.cos(a) * r - Math.sin(a) * across, Math.sin(a) * r + Math.cos(a) * across];
/** Half width of a star's arm at radius r - roughly, for the details on it. */
const armHalf = (r, len) => Math.max(0.2, half(r, len, len < 49 ? 5.4 : 6) - 0.3);

export const alienCarrier = {
  r: 54,
  engines: [],
  lights: [],
  // In space: two stars of flat blades, one above the other, joined only by
  // the core between them; every blade is a full, rounded body right out
  // to its point, only a little slimmer there than at its root.
  solid: {
    hull: { r: 1, h: 0.3, belly: 1 },
    parts: [
      ...[[-4.6, () => (ctx) => star(ctx, Math.PI / 3, 47, 5.4)], [4.6, () => (ctx) => star(ctx, 0, 50, 6)]].map(([z, path]) => ({
        // Full height close behind the edge, so the points keep their body too
        z, round: true, r: 2.4, h: 2.7, belly: 1, path: path(),
        scale: (x, y) => 1 - 0.35 * Math.min(1, Math.hypot(x, y) / 48)
      })),
      { over: true, r: 9, h: 6.8, belly: 1, path(ctx) { ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); } }
    ]
  },
  body(ctx, color, S, look, opts) {
    /** Grown, not built: a bright vein along a blade, ribs across it, short offshoots. */
    const veins = (offset, len, a0) => {
      for (const a of starArms(offset)) {
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = `rgba(225,255,235,${a0})`;
        ctx.lineWidth = 0.34;
        ctx.beginPath(); ctx.moveTo(...along(a, 10, 0)); ctx.lineTo(...along(a, len - 5, 0)); ctx.stroke();
        ctx.lineWidth = 0.28;
        for (let r = 12, i = 0; r < len - 8; r += 3.6, i++) {
          const w = armHalf(r, len) * 0.82;
          ctx.beginPath();
          ctx.moveTo(...along(a, r, -w)); ctx.lineTo(...along(a, r + 1.7, -w * 0.38));
          ctx.lineTo(...along(a, r + 1.7, w * 0.38)); ctx.lineTo(...along(a, r, w));
          ctx.stroke();
          if (i % 2 && w > 1.6) for (const s of [-1, 1]) {
            ctx.beginPath(); ctx.moveTo(...along(a, r - 1.2, s * w * 0.6)); ctx.lineTo(...along(a, r - 3, s * w * 0.6)); ctx.stroke();
          }
        }
        ctx.restore();
      }
    };
    // The lower star, a sixth of a turn offset. Drawn flat it lies in the
    // shade of the upper one, darker towards the tips; as the skin of a
    // solid it has its own light.
    const lower = () => star(ctx, Math.PI / 3, 47, 5.4);
    lower(); fillShadowed(ctx, shell(ctx, -46, 46, opts?.solid ? '#35995e' : '#21603b'), S);
    inside(ctx, lower, () => {
      if (!opts?.solid) {
        const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 47);
        g.addColorStop(0, 'rgba(4,20,10,0)');
        g.addColorStop(1, 'rgba(4,20,10,.55)');
        ctx.fillStyle = g;
        ctx.fillRect(-48, -48, 96, 96);
      }
      veins(Math.PI / 3, 47, opts?.solid ? 0.5 : 0.22);
    });
    bevel(ctx, lower, 0.7);
    // The upper star: a bright ridge along every blade
    const upper = () => star(ctx, 0, 50, 6);
    upper(); fillShadowed(ctx, shell(ctx, -50, 50), S * 1.4);
    inside(ctx, upper, () => {
      for (const a of starArms(0)) {
        ctx.save();
        ctx.lineCap = 'round';
        // Light along the upper flank of the blade, shade along the lower
        ctx.strokeStyle = 'rgba(230,255,238,.3)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(...along(a, 8, -3.6)); ctx.lineTo(...along(a, 34, -1.9)); ctx.lineTo(...along(a, 48, -0.2)); ctx.stroke();
        ctx.strokeStyle = 'rgba(4,20,10,.4)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(...along(a, 8, 4.2)); ctx.lineTo(...along(a, 34, 2.4)); ctx.lineTo(...along(a, 48, 0.3)); ctx.stroke();
        ctx.restore();
        // A few faint panel joints across the blade
        for (const r of [20, 31]) {
          const w = armHalf(r, 50) + 0.6;
          line(ctx, [along(a, r, -w), along(a, r, w)], 0.25, 0.35);
        }
      }
      veins(0, 50, 0.55);
    });
    bevel(ctx, upper, 0.8);
    // The core where the two stars meet: a ring with spokes around a dark dome
    ctx.strokeStyle = 'rgba(225,255,235,.5)'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.ellipse(0, 0, 7, 6, 0, 0, TAU); ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + Math.PI / 6;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 2.8, Math.sin(a) * 2.8); ctx.lineTo(Math.cos(a) * 7, Math.sin(a) * 6); ctx.stroke();
    }
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
