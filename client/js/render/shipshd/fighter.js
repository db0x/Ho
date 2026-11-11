// Ship profile: fighter (see ../shipshd.js). Its look follows the tech it
// was built with (../fighterlook.js): the outline by generation Mk I - III,
// guns, armour, nozzles and tanks by the step of each research field.
// Mk I with nothing researched is the fighter as before: after the Viper
// Mk VII in plan view - a straight wedge of a fuselage, the blue canopy in
// front of big swept wings, gun pods beneath the wings near the tips, a
// dorsal spine with the tail fin and three engines in a cage.
import {
  RED, GREEN, WHITE, nozzle, capsule, inside, seam, TAU, poly, tone, fillShadowed, bevel, metal, sym,
  vents, rivets, glass, light
} from './kit.js';
import { GENS, FLAME, FLAME_LEN, fighterLook, halfWidth, leadX, podX, engineLayout, emitters } from '../fighterlook.js';

// Silver of the fighter's wings, a touch brighter than the fuselage.
const WING = '#b4bfd0';
const ENERGY = '#5fd2ff';

function wingParts(ctx, G, look, color, S, s) {
  const { w: tw, s: ts, r: tr } = look;
  // Gun pod beneath the wing near the tip: the wing covers its rear, the
  // barrel reaches past the leading edge. Doubled barrels from weapons 2,
  // energy guns with coils from weapons 4.
  const cy = s * G.podY;
  const lx = podX(G);
  const laser = tw === 3;
  const pod = capsule(ctx, lx - 13, lx + 1, cy, laser ? 1.6 : 1.3, laser ? '#8b95ad' : '#9aa6b8', S * 0.6);
  inside(ctx, pod, () => seam(ctx, lx - 2.5, cy - 1.6, lx - 2.5, cy + 1.6, 0.25));
  const bl = laser ? 8 : 4.4;
  for (const o of tw >= 1 ? [-0.7, 0.7] : [0]) {
    ctx.fillStyle = laser ? '#3b4660' : '#2a303d'; ctx.fillRect(lx, cy + o - 0.42, bl, 0.84);
    if (!laser) { ctx.fillStyle = '#ff8a5c'; ctx.beginPath(); ctx.arc(lx + bl + 0.1, cy + o, 0.55, 0, TAU); ctx.fill(); }
  }
  if (laser) {
    ctx.strokeStyle = ENERGY; ctx.lineWidth = 0.35;
    for (const x of [lx + 2, lx + 4, lx + 6]) { ctx.beginPath(); ctx.moveTo(x, cy - 1.7); ctx.lineTo(x, cy + 1.7); ctx.stroke(); }
  }

  // The wing - silver, the empire color sits on the fuselage stripes instead
  const w = () => poly(ctx, G.wing.map(([x, y]) => [x, s * y]));
  w();
  const [[ax, ay], [bx, by]] = G.wing;
  const g = ctx.createLinearGradient(0, s * ay, 0, s * by);
  g.addColorStop(0, tone(WING, s < 0 ? 0.35 : -0.05));
  g.addColorStop(1, tone(WING, s < 0 ? -0.1 : -0.42));
  fillShadowed(ctx, g, S);
  inside(ctx, w, () => {
    // Panel lines parallel to the leading edge
    for (const d of [4, 8.5, 13]) seam(ctx, ax - d, s * ay, bx - d, s * by, 0.3);
    // Shields 2+: an armour band along the leading edge
    if (ts >= 1) {
      const band = () => poly(ctx, [[ax + 0.5, s * ay], [bx + 0.5, s * by], [bx - 4.2, s * by], [ax - 4.2, s * ay]]);
      band(); ctx.globalAlpha = 0.9; ctx.fillStyle = metal(ctx, s * ay, s * by, '#5f6a80'); ctx.fill(); ctx.globalAlpha = 1;
      for (let i = 1; i < 5; i++) { const k = i / 5; const x = ax + (bx - ax) * k, y = ay + (by - ay) * k; seam(ctx, x, s * y, x - 4.2, s * y, 0.3); }
      ctx.fillStyle = 'rgba(235,242,255,.6)';
      for (let i = 0; i < 6; i++) {
        const k = (i + 0.5) / 6;
        ctx.beginPath(); ctx.arc(ax + (bx - ax) * k - 2, s * (ay + (by - ay) * k), 0.32, 0, TAU); ctx.fill();
      }
    }
    // Chevron as insignia, embossed dark into the silver
    const my = (ay + by) / 2, cx = leadX(G, my) - 9;
    ctx.fillStyle = 'rgba(40,46,60,.55)';
    poly(ctx, [[cx, s * (my - 2)], [cx - 3.5, s * (my + 1.5)], [cx - 5, s * (my + 1.5)], [cx - 1.5, s * (my - 2)],
      [cx - 5, s * (my - 5.5)], [cx - 3.5, s * (my - 5.5)]]); ctx.fill();
    // Leading edge shines
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    poly(ctx, [[ax, s * ay], [bx, s * by], [bx - 1.2, s * (by - 1)], [ax - 1.2, s * (ay + 0.1)]]); ctx.fill();
  });
  bevel(ctx, w, 0.8);
  // Rail along the wing tip, a little ahead of the leading edge
  const ry = by + 0.7, { x0, x1 } = G.tip;
  const rail = () => poly(ctx, [[x1, s * ry], [x1 - 1.4, s * (ry - 0.8)], [x0 + 0.6, s * (ry - 0.8)], [x0, s * ry],
    [x0 + 0.6, s * (ry + 0.8)], [x1 - 1.4, s * (ry + 0.8)]]);
  rail(); fillShadowed(ctx, metal(ctx, s * (ry - 0.8), s * (ry + 0.8), '#aab6c8'), S * 0.5);
  bevel(ctx, rail, 0.35);

  // Canards (Mk II)
  if (G.canards) {
    const c = () => poly(ctx, G.canards.map(([x, y]) => [x, s * y]));
    c(); fillShadowed(ctx, metal(ctx, s * 7, s * 15.5, '#aeb9cb'), S * 0.5); bevel(ctx, c, 0.5);
  }
  // Range 2+: a tank on the wing near the root, bigger and in empire color from range 3
  if (tr >= 1) {
    const ty = s * (ay + (tr >= 2 ? 4.6 : 4)), h = tr >= 2 ? 1.9 : 1.5;
    const tx1 = leadX(G, ay + 4) - 1, tx0 = tx1 - (tr >= 2 ? 19 : 15);
    const tank = capsule(ctx, tx0, tx1, ty, h, '#c8ccd6', S * 0.6);
    inside(ctx, tank, () => {
      if (tr >= 2) { ctx.fillStyle = color; ctx.fillRect(tx0 + 5, ty - h, 2.2, h * 2); ctx.fillRect(tx1 - 6, ty - h, 1.2, h * 2); }
      seam(ctx, tx0 + 3, ty - h, tx0 + 3, ty + h, 0.25);
    });
  }
  // Weapons 3+: two missiles per wing, red heads, small fins
  if (tw >= 2) {
    for (const dy of [-2.3, 2.3]) {
      const my = G.podY - 6.5 + dy;
      const mx1 = leadX(G, my) + 3.5, mx0 = mx1 - 12;
      const m = capsule(ctx, mx0, mx1, s * my, 0.8, '#e7ebf2', S * 0.4);
      inside(ctx, m, () => {
        ctx.fillStyle = '#e04a3a'; ctx.fillRect(mx1 - 2.6, s * my - 1, 2.6, 2);
        ctx.fillStyle = '#39404f'; ctx.fillRect(mx0 + 1.5, s * my - 1, 0.6, 2);
      });
      ctx.fillStyle = '#596274';
      for (const f of [-1.9, 1.9]) {
        poly(ctx, [[mx0 + 2.4, s * my], [mx0, s * (my + f)], [mx0 - 0.6, s * (my + f)], [mx0 + 0.6, s * my]]); ctx.fill();
      }
    }
  }
}

export const fighter = {
  look: fighterLook,
  r: (look) => GENS[look.gen].r,
  engines: (look) => engineLayout(GENS[look.gen], look.v).map(e => ({ ...e, color: FLAME[look.v], len: FLAME_LEN[look.v] })),
  lights: (look) => {
    const G = GENS[look.gen], ty = G.wing[1][1] + 0.7;
    return [
      { x: G.tip.x1 - 7, y: -ty, r: 1, color: RED, off: 0 },
      { x: G.tip.x1 - 7, y: ty, r: 1, color: GREEN, off: 0 },
      { x: G.tail + 7, y: 0, r: 0.9, color: WHITE, off: 0.6, strobe: true }
    ];
  },
  body(ctx, color, S, look) {
    const G = GENS[look.gen];
    const { w: tw, s: ts, r: tr } = look;
    const eng = engineLayout(G, look.v);
    const spread = Math.max(...eng.map(e => Math.abs(e.y) + e.r));
    // Four and five nozzles no longer fit the stern: an engine block behind it
    if (eng.length > 3) {
      const blk = () => { ctx.beginPath(); ctx.roundRect(G.engX + 1, -spread - 1.2, G.tail - G.engX + 9, (spread + 1.2) * 2, 2.5); };
      blk(); fillShadowed(ctx, metal(ctx, -spread, spread, '#7d8799'), S * 0.6);
      inside(ctx, blk, () => {
        for (let i = 1; i < eng.length; i++) { const y = (eng[i].y + eng[i - 1].y) / 2; seam(ctx, G.engX + 1, y, G.tail + 9, y, 0.3); }
        vents(ctx, G.tail + 1, 0, 3, spread * 1.2, 1.5);
      });
      bevel(ctx, blk, 0.6);
    }
    for (const e of eng) nozzle(ctx, e.x, e.y, e.r, e.r * 1.7);
    for (const s of [-1, 1]) wingParts(ctx, G, look, color, S, s);
    // Engine cage around the nozzles
    ctx.strokeStyle = '#596274'; ctx.lineWidth = 0.6;
    const lastW = G.hull[G.hull.length - 2][1];
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(G.tail + 2, s * lastW);
      ctx.quadraticCurveTo(G.engX + 1, s * (spread + 0.6), G.engX - 1.5, s * (spread - 0.4)); ctx.stroke();
    }
    for (const x of [G.tail - 1.5, G.engX + 0.5]) { ctx.beginPath(); ctx.moveTo(x, -spread); ctx.lineTo(x, spread); ctx.stroke(); }

    // Fuselage
    const H = G.hull;
    const maxW = Math.max(...H.map(p => p[1]));
    const hull = () => sym(ctx, [[G.nose, 0], ...H.map(([x, h]) => [x, -h]), [G.tail, 0]]);
    hull(); fillShadowed(ctx, metal(ctx, -maxW, maxW, ts >= 1 ? '#97a6bd' : '#a3b1c6'), S);
    inside(ctx, hull, () => {
      // Empire stripes left and right, following the contour just inside the
      // edge: a fine point behind the nose, full width further back.
      for (const s of [-1, 1]) {
        const xs = [];
        for (let x = G.stripeFrom; x >= G.tail + 2; x -= 4) xs.push(x);
        const at = (x, d) => [x, s * (halfWidth(H, x) - 1 - d * Math.min(1, (G.stripeFrom - x) / 30))];
        ctx.beginPath();
        xs.forEach((x, i) => i ? ctx.lineTo(...at(x, 0)) : ctx.moveTo(...at(x, 0)));
        xs.slice().reverse().forEach(x => ctx.lineTo(...at(x, 2.4)));
        ctx.closePath();
        const g = ctx.createLinearGradient(0, s * 3, 0, s * maxW);
        g.addColorStop(0, tone(color, s < 0 ? 0.25 : -0.1));
        g.addColorStop(1, tone(color, s < 0 ? -0.1 : -0.45));
        ctx.fillStyle = g; ctx.fill();
      }
      for (const x of G.seams) seam(ctx, x, -maxW, x, maxW);
      // Shields 2+: an armoured nose cap
      if (ts >= 1) {
        const nx = G.nose - 14;
        ctx.fillStyle = 'rgba(70,80,100,.55)'; ctx.fillRect(nx, -maxW, G.nose - nx + 1, maxW * 2);
        seam(ctx, nx, -maxW, nx, maxW, 0.4);
        const hw = halfWidth(H, nx) * 0.5;
        rivets(ctx, nx + 2, G.nose - 4, -hw, 3, 0.28); rivets(ctx, nx + 2, G.nose - 4, hw, 3, 0.28);
      }
      // Sensor openings at the nose
      ctx.fillStyle = 'rgba(20,26,38,.75)';
      for (const x of [G.nose - 5, G.nose - 8]) { ctx.beginPath(); ctx.arc(x, 0, 0.6, 0, TAU); ctx.fill(); }
      // Vents and rivets beside the spine
      vents(ctx, G.tail + 9, -4.7, 4, 1.4, 1.5); vents(ctx, G.tail + 9, 4.7, 4, 1.4, 1.5);
      rivets(ctx, G.tail + 21, G.tail + 45, -5.4, 7, 0.3); rivets(ctx, G.tail + 21, G.tail + 45, 5.4, 7, 0.3);
    });
    bevel(ctx, hull, 1);
    // Weapons 2+: a gun either side of the nose
    if (tw >= 1) {
      const gx = G.nose - 22;
      for (const s of [-1, 1]) {
        const gy = s * (halfWidth(H, gx) - 0.8);
        ctx.fillStyle = tw === 3 ? '#3b4660' : '#2a303d'; ctx.fillRect(gx, gy - 0.4, tw === 3 ? 13 : 10, 0.8);
      }
    }
    // Dorsal spine from the canopy to the stern - range 4 adds a tank on top
    const big = tr === 3;
    const spine = () => sym(ctx, big ? G.spine.map(([x, y]) => [x, y * 1.45]) : G.spine);
    spine(); fillShadowed(ctx, metal(ctx, -4.5, 4.5, big ? '#b7bcc6' : '#97a4b9'), S * 0.6);
    inside(ctx, spine, () => {
      const a = G.spine[2][0], b = G.spine[1][0];
      seam(ctx, (a + b) / 2, -5, (a + b) / 2, 5, 0.25);
      if (big) { ctx.fillStyle = color; ctx.fillRect(a + 6, -6, 1.6, 12); ctx.fillRect(b - 10, -6, 1.6, 12); }
    });
    bevel(ctx, spine, 0.5);
    // Tail: one fin on the spine (Mk I), two (Mk II), two canted outwards (Mk III)
    if (G.fins === 'single') {
      const fin = () => sym(ctx, [[-12, 0], [-18, -1.3], [-41, -1.7], [-43, 0]]);
      fin(); fillShadowed(ctx, '#aeb8c9', S * 0.4);
      inside(ctx, fin, () => { ctx.fillStyle = color; ctx.fillRect(-39, -0.45, 21, 0.9); });
      bevel(ctx, fin, 0.4);
    } else {
      const off = G.fins === 'twin' ? 6.2 : 8, lean = G.fins === 'canted' ? 3.5 : 0;
      for (const s of [-1, 1]) {
        const fin = () => poly(ctx, [[-22, s * off], [-44, s * (off + lean + 1)], [-47, s * (off + lean + 0.8)],
          [-46, s * (off + lean - 0.6)], [-26, s * (off - 1)]]);
        fin(); fillShadowed(ctx, '#aeb8c9', S * 0.4);
        inside(ctx, fin, () => {
          ctx.strokeStyle = color; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(-26, s * (off - 0.2)); ctx.lineTo(-44, s * (off + lean + 0.4)); ctx.stroke();
        });
        bevel(ctx, fin, 0.4);
      }
    }
    // Canopy - blue, turquoise on Mk II, gold on Mk III
    const C = G.cab;
    const cab = () => sym(ctx, C);
    const cx0 = C[C.length - 1][0], cx1 = C[0][0], ch = Math.min(...C.map(p => p[1]));
    glass(ctx, cab, cx0, cx1, ch, -ch, G.cabTint, S);
    ctx.strokeStyle = 'rgba(40,46,60,.9)'; ctx.lineWidth = 0.6;
    const mid = (cx0 + cx1) / 2 + 1;
    ctx.beginPath(); ctx.moveTo(mid, ch); ctx.lineTo(mid, -ch); ctx.stroke();
    // Shields 3+: emitter domes - their glow is in anim
    if (ts >= 2) for (const e of emitters(G)) {
      ctx.fillStyle = metal(ctx, e.y - 1.4, e.y + 1.4, '#6f7c96');
      ctx.beginPath(); ctx.arc(e.x, e.y, 1.4, 0, TAU); ctx.fill();
      ctx.lineWidth = 0.3; ctx.strokeStyle = 'rgba(5,8,16,.9)'; ctx.stroke();
    }
  },
  /** Moving parts: glowing energy guns, shield emitters, the shield bubble. */
  anim(ctx, t, look) {
    const G = GENS[look.gen];
    if (look.w === 3) {
      const lx = podX(G);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const s of [-1, 1]) {
        const a = 0.55 + 0.35 * Math.sin(t * 4 + s);
        for (const o of [-0.7, 0.7]) {
          const g = ctx.createLinearGradient(lx, 0, lx + 9, 0);
          g.addColorStop(0, `rgba(95,210,255,${0.15 * a})`);
          g.addColorStop(1, `rgba(170,240,255,${0.9 * a})`);
          ctx.fillStyle = g; ctx.fillRect(lx, s * G.podY + o - 0.35, 8.4, 0.7);
          light(ctx, lx + 8.4, s * G.podY + o, 0.45, '#9ff0ff', t * 2, s + o, false);
        }
      }
      ctx.restore();
    }
    if (look.s >= 2) emitters(G).forEach((e, i) => light(ctx, e.x, e.y, 0.7, ENERGY, t, i * 2.1, false));
    if (look.s === 3) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const rx = (G.nose - G.tail) / 2 + 9, ry = G.wing[1][1] + 7, cx = (G.nose + G.tail) / 2;
      const p = 0.6 + 0.4 * Math.sin(t * 1.6);
      const g = ctx.createRadialGradient(cx, 0, ry * 0.6, cx, 0, rx);
      g.addColorStop(0, 'rgba(95,210,255,0)');
      g.addColorStop(0.82, `rgba(95,210,255,${0.06 * p})`);
      g.addColorStop(1, `rgba(140,225,255,${0.22 * p})`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, 0, rx, ry, 0, 0, TAU); ctx.fill();
      // A highlight travelling around the bubble
      const a = t * 0.9;
      ctx.strokeStyle = `rgba(190,240,255,${0.45 * p})`; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.ellipse(cx, 0, rx, ry, 0, a, a + 0.9); ctx.stroke();
      ctx.restore();
    }
  }
};
