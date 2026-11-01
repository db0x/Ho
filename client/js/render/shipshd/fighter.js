// Ship profile: fighter (see ../shipshd.js).
import {
  RED, GREEN, WHITE, nozzle, capsule, inside, seam, TAU, poly, tone, fillShadowed, bevel, metal, sym,
  vents, rivets, glass
} from './kit.js';

// After the Viper Mk VII in plan view - the same outline as the map icon
// (ships.js): a straight wedge of a fuselage from the rounded nose to the
// wing roots, tapering again towards the stern, the blue canopy in front of
// the wings, big swept wings with straight cut tips and a rail along them,
// gun pods beneath the wings near the tips whose barrels reach past the
// leading edge, a dorsal spine with the tail fin and three engines in a cage.
// Silver of the fighter's wings, a touch brighter than the fuselage.
const WING = '#b4bfd0';
// Half width of the fighter's fuselage along its length - the points of hull() below.
const FIGHTER_HULL = [[60, 1.1], [58, 1.9], [56, 2.1], [2, 12.4], [-10, 11.2], [-24, 10.2], [-31, 9.4],
  [-40, 8.4], [-43, 7.4], [-45, 5.6]];
function fighterHalfWidth(x) {
  for (let i = 1; i < FIGHTER_HULL.length; i++) {
    const [x0, y0] = FIGHTER_HULL[i - 1], [x1, y1] = FIGHTER_HULL[i];
    if (x <= x0 && x >= x1) return y0 + (y1 - y0) * (x0 - x) / (x0 - x1);
  }
  return 5.6;
}

export const fighter = {
  r: 62,
  engines: [
    { x: -51, y: 0, r: 3.8, color: '#7fd8ff' },
    { x: -50, y: -4.6, r: 3.2, color: '#7fd8ff' },
    { x: -50, y: 4.6, r: 3.2, color: '#7fd8ff' }
  ],
  lights: [
    { x: -16, y: -31.1, r: 1, color: RED, off: 0 },
    { x: -16, y: 31.1, r: 1, color: GREEN, off: 0 },
    { x: -38, y: 0, r: 0.9, color: WHITE, off: 0.6, strobe: true }
  ],
  body(ctx, color, S) {
    for (const s of [-1, 1]) nozzle(ctx, -50, s * 4.6, 3.2, 5.5);
    nozzle(ctx, -51, 0, 3.8, 6.5);
    for (const s of [-1, 1]) {
      // Gun pod beneath the wing near the tip: the wing covers its rear, the
      // barrel reaches far past the leading edge
      const cy = s * 26;
      const pod = capsule(ctx, -17, -4, cy, 1.3, '#9aa6b8', S * 0.6);
      inside(ctx, pod, () => seam(ctx, -6.5, cy - 1.5, -6.5, cy + 1.5, 0.25));
      ctx.fillStyle = '#2a303d'; ctx.fillRect(-4, cy - 0.45, 4.4, 0.9);
      ctx.fillStyle = '#ff8a5c'; ctx.beginPath(); ctx.arc(0.4, cy, 0.6, 0, TAU); ctx.fill();
      // Big swept wing with a straight cut tip and a nearly straight trailing
      // edge that blends into the stern
      const w = () => poly(ctx, [[3, s * 11.5], [-12.4, s * 30.4], [-21.6, s * 30.4], [-24.6, s * 15.6],
        [-27.4, s * 12.4], [-31.5, s * 9]]);
      w();
      // Silver wings - the empire color sits on the fuselage stripes instead
      const g = ctx.createLinearGradient(0, s * 9, 0, s * 30.4);
      g.addColorStop(0, tone(WING, s < 0 ? 0.35 : -0.05));
      g.addColorStop(1, tone(WING, s < 0 ? -0.1 : -0.42));
      fillShadowed(ctx, g, S);
      inside(ctx, w, () => {
        // Panel lines parallel to the leading edge, as on the original
        for (const d of [4, 8.5, 13]) seam(ctx, 3 - d, s * 11.5, -12.4 - d, s * 30.4, 0.3);
        seam(ctx, -6, s * 21, -22, s * 21, 0.25);
        // Chevron as insignia, embossed dark into the silver
        ctx.fillStyle = 'rgba(40,46,60,.55)';
        poly(ctx, [[-11, s * 15.5], [-14.5, s * 19], [-16, s * 19], [-12.5, s * 15.5], [-16, s * 12], [-14.5, s * 12]]); ctx.fill();
        // Leading edge shines
        ctx.fillStyle = 'rgba(255,255,255,.16)';
        poly(ctx, [[3, s * 11.5], [-12.4, s * 30.4], [-13.6, s * 29.4], [1.8, s * 11.6]]); ctx.fill();
      });
      bevel(ctx, w, 0.8);
      // Rail along the wing tip, a little ahead of the leading edge
      const rail = () => poly(ctx, [[-8.6, s * 31.1], [-10, s * 30.3], [-22, s * 30.3], [-22.6, s * 31.1],
        [-22, s * 31.9], [-10, s * 31.9]]);
      rail(); fillShadowed(ctx, metal(ctx, s * 30.3, s * 31.9, '#aab6c8'), S * 0.5);
      bevel(ctx, rail, 0.35);
    }
    // Engine cage around the three nozzles
    ctx.strokeStyle = '#596274'; ctx.lineWidth = 0.6;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(-43, s * 7.4); ctx.quadraticCurveTo(-49, s * 8.6, -51.5, s * 7.2); ctx.stroke();
    }
    for (const x of [-46.5, -49.5]) { ctx.beginPath(); ctx.moveTo(x, -8.4); ctx.lineTo(x, 8.4); ctx.stroke(); }
    // Fuselage: a wedge from the rounded nose to the wing roots, slimmer again at the stern
    const hull = () => sym(ctx, [[60, 0], ...FIGHTER_HULL.map(([x, h]) => [x, -h]), [-45, 0]]);
    hull(); fillShadowed(ctx, metal(ctx, -12.4, 12.4, '#a3b1c6'), S);
    inside(ctx, hull, () => {
      // Empire stripes left and right, following the contour just inside the
      // edge: a fine point behind the nose, full width from the canopy back.
      for (const s of [-1, 1]) {
        const xs = [34, 26, 18, 10, 2, -10, -24, -31, -40, -43];
        const at = (x, d) => [x, s * (fighterHalfWidth(x) - 1 - d * Math.min(1, (34 - x) / 30))];
        ctx.beginPath();
        xs.forEach((x, i) => i ? ctx.lineTo(...at(x, 0)) : ctx.moveTo(...at(x, 0)));
        xs.slice().reverse().forEach(x => ctx.lineTo(...at(x, 2.4)));
        ctx.closePath();
        const g = ctx.createLinearGradient(0, s * 3, 0, s * 12);
        g.addColorStop(0, tone(color, s < 0 ? 0.25 : -0.1));
        g.addColorStop(1, tone(color, s < 0 ? -0.1 : -0.45));
        ctx.fillStyle = g; ctx.fill();
      }
      for (const x of [46, 30, -8, -22, -36]) seam(ctx, x, -12.4, x, 12.4);
      seam(ctx, 54, -1.4, 20, -6.6, 0.3); seam(ctx, 54, 1.4, 20, 6.6, 0.3);
      // Sensor openings at the nose
      ctx.fillStyle = 'rgba(20,26,38,.75)';
      for (const x of [55, 52]) { ctx.beginPath(); ctx.arc(x, 0, 0.6, 0, TAU); ctx.fill(); }
      // Vents and rivets beside the spine
      vents(ctx, -36, -4.7, 4, 1.4, 1.5); vents(ctx, -36, 4.7, 4, 1.4, 1.5);
      rivets(ctx, -24, 0, -5.4, 7, 0.3); rivets(ctx, -24, 0, 5.4, 7, 0.3);
    });
    bevel(ctx, hull, 1);
    // Dorsal spine from the canopy to the stern
    const spine = () => sym(ctx, [[-1, 0], [-3, -3.4], [-28, -3.8], [-37, -3], [-44, -1.8], [-45, 0]]);
    spine(); fillShadowed(ctx, metal(ctx, -3.8, 3.8, '#97a4b9'), S * 0.6);
    inside(ctx, spine, () => { seam(ctx, -16, -3.6, -16, 3.6, 0.25); seam(ctx, -32, -3.5, -32, 3.5, 0.25); });
    bevel(ctx, spine, 0.5);
    // Tail fin on top of it - from above only a thin ridge, the empire color on its edge
    const fin = () => sym(ctx, [[-12, 0], [-18, -1.3], [-41, -1.7], [-43, 0]]);
    fin(); fillShadowed(ctx, '#aeb8c9', S * 0.4);
    inside(ctx, fin, () => { ctx.fillStyle = color; ctx.fillRect(-39, -0.45, 21, 0.9); });
    bevel(ctx, fin, 0.4);
    // Blue canopy in front of the wings
    const cab = () => sym(ctx, [[16.5, 0], [15.6, -2.6], [13, -3.8], [1.5, -3.8], [-0.4, -2.6], [-0.8, 0]]);
    glass(ctx, cab, -0.8, 16.5, -3.8, 3.8, '#4f7cf0', S);
    ctx.strokeStyle = 'rgba(40,46,60,.9)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(9, -3.8); ctx.lineTo(9, 3.8); ctx.stroke();
  }
};
