// Ship profile: colony ship (see ../shipshd.js).
import {
  RED, GREEN, WHITE, nozzle, tone, fillShadowed, bevel, inside, TAU, rivets, sym, metal, seam,
  glass, vents
} from './kit.js';

// A long hauler, the largest of the civilian ships: a dark spine from an
// armoured bow to the engine block - and on it three biospheres, the
// hallmark of the settler ship: wide glass domes, far broader than the
// spine, each over a park of meadows, woods and a lake. They are drawn to be
// read at a glance: bright green and blue under a strong gloss, inside a
// bright rim and a dark collar that carries the empire colour. The bridge
// sits on the stern block, above three engines.
/** The biospheres from stern to bow: position, radius, and how far its park is turned. */
export const DOMES = [[-26.5, 10, 2.1], [-3.5, 13.3, -0.9], [21, 11, 0.5]];
const DARK = '#4d5668', LENS = '#7fe9ff';

/** One biosphere: collar, park, glass. */
function dome(ctx, x, R, turn, color, S) {
  // The collar it sits in, with four marks in the empire colour
  const collar = () => { ctx.beginPath(); ctx.arc(x, 0, R + 1.9, 0, TAU); };
  collar(); fillShadowed(ctx, metal(ctx, -R - 1.9, R + 1.9, '#465064'), S);
  bevel(ctx, collar, 0.6);
  ctx.strokeStyle = color; ctx.lineWidth = 1.1; ctx.lineCap = 'butt';
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    ctx.beginPath(); ctx.arc(x, 0, R + 1.05, a - 0.3, a + 0.3); ctx.stroke();
  }
  const glassPath = () => { ctx.beginPath(); ctx.arc(x, 0, R, 0, TAU); };
  inside(ctx, glassPath, () => {
    // The park: only it is turned - glass and gloss keep their light from above
    ctx.save(); ctx.translate(x, 0); ctx.rotate(turn); ctx.scale(R / 15, R / 15);
    const lawn = ctx.createRadialGradient(-3, -4, 0, 0, 0, 15);
    lawn.addColorStop(0, '#9df08f'); lawn.addColorStop(0.6, '#4fc463'); lawn.addColorStop(1, '#2a8f48');
    ctx.fillStyle = lawn; ctx.fillRect(-16, -16, 32, 32);
    // Meadows of a lighter green, a lake with a shore, a river into it
    ctx.fillStyle = 'rgba(200,245,150,.55)';
    for (const [mx, my, rx, ry, a] of [[-6, -5, 5, 3, 0.4], [7, -8, 4, 2.4, -0.3], [-2, 9, 5, 2.6, 0.1]]) { ctx.beginPath(); ctx.ellipse(mx, my, rx, ry, a, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#e9e2b8'; ctx.beginPath(); ctx.ellipse(5, 3.6, 6, 4, 0.4, 0, TAU); ctx.fill();
    const lake = ctx.createLinearGradient(0, 0, 0, 8);
    lake.addColorStop(0, '#6fd0ff'); lake.addColorStop(1, '#2f86d6');
    ctx.fillStyle = lake; ctx.beginPath(); ctx.ellipse(5, 3.6, 5.2, 3.3, 0.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#4fb4f0'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(1, 2.6); ctx.quadraticCurveTo(-6, 0, -13, 4); ctx.stroke();
    // Woods, and a few roofs with lit windows
    for (const [tx, ty] of [[-7, 7], [-4, 10], [-9, 3], [11, -6], [8, -10], [-1, -9], [-5, -11], [12, -1], [-11, -4], [2, -5]]) {
      ctx.fillStyle = '#1f7a3c'; ctx.beginPath(); ctx.arc(tx + 0.4, ty + 0.4, 1.9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3fae57'; ctx.beginPath(); ctx.arc(tx, ty, 1.5, 0, TAU); ctx.fill();
    }
    for (const [hx, hy] of [[-3, 1.4], [-1, -2], [9, 9], [-9, -8]]) {
      ctx.fillStyle = '#f2ecd8'; ctx.fillRect(hx, hy, 1.8, 1.8);
      ctx.fillStyle = '#ffd77a'; ctx.fillRect(hx + 0.55, hy + 0.55, 0.7, 0.7);
    }
    ctx.restore();
    // The vault: a few ribs, shade towards the rim, a strong gloss
    ctx.strokeStyle = 'rgba(230,250,255,.34)'; ctx.lineWidth = 0.35;
    for (const k of [0.34, 0.72]) {
      ctx.beginPath(); ctx.ellipse(x, 0, R, R * k, 0, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, 0, R * k, R, 0, 0, TAU); ctx.stroke();
    }
    const rim = ctx.createRadialGradient(x, 0, R * 0.62, x, 0, R);
    rim.addColorStop(0, 'rgba(0,25,35,0)'); rim.addColorStop(1, 'rgba(0,25,35,.5)');
    ctx.fillStyle = rim; ctx.fillRect(x - R, -R, R * 2, R * 2);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath(); ctx.ellipse(x - R * 0.22, -R * 0.55, R * 0.5, R * 0.17, -0.25, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath(); ctx.ellipse(x - R * 0.46, -R * 0.4, R * 0.1, R * 0.06, -0.6, 0, TAU); ctx.fill();
  });
  // The bright rim of the glass
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(205,250,255,.95)'; glassPath(); ctx.stroke();
  ctx.lineWidth = 0.35; ctx.strokeStyle = 'rgba(5,8,16,.85)'; ctx.beginPath(); ctx.arc(x, 0, R + 0.5, 0, TAU); ctx.stroke();
}

export const colony = {
  r: 64,
  engines: [
    { x: -52, y: 0, r: 5.2, color: '#8fdcff' },
    { x: -50.5, y: -8.6, r: 3.6, color: '#8fdcff' },
    { x: -50.5, y: 8.6, r: 3.6, color: '#8fdcff' }
  ],
  lights: [
    { x: DOMES[1][0], y: -DOMES[1][1] - 2.4, r: 0.9, color: RED, off: 0 },
    { x: DOMES[1][0], y: DOMES[1][1] + 2.4, r: 0.9, color: GREEN, off: 0 },
    { x: 49, y: 0, r: 0.9, color: WHITE, off: 1.4, strobe: true },
    { x: -31, y: 0, r: 0.8, color: WHITE, off: 0.4, strobe: true }
  ],
  body(ctx, color, S) {
    nozzle(ctx, -52, 0, 5.2, 6);
    for (const s of [-1, 1]) nozzle(ctx, -50.5, s * 8.6, 3.6, 4.6);

    // ----- The spine: a dark girder from bow to stern
    const spine = () => { ctx.beginPath(); ctx.rect(-36, -4.6, 68, 9.2); };
    spine(); fillShadowed(ctx, metal(ctx, -4.6, 4.6, DARK), S);
    inside(ctx, spine, () => {
      for (let x = -32; x <= 30; x += 5.75) seam(ctx, x, -5, x, 5, 0.28);
      seam(ctx, -36, 0, 32, 0, 0.3);
      for (let x = -33; x <= 29; x += 2.3) {
        if (Math.sin(x * 3.1) > 0.35) continue;
        ctx.fillStyle = Math.sin(x * 1.7) > 0.55 ? 'rgba(255,214,140,.95)' : LENS;
        ctx.fillRect(x, -2.5, 1, 0.65); ctx.fillRect(x + 0.6, 1.85, 1, 0.65);
      }
    });
    bevel(ctx, spine, 0.7);

    // ----- The bow: an armoured wedge
    const bow = () => sym(ctx, [[50, 0], [49.2, -3], [45, -6.6], [36.5, -9.2], [31, -9.2], [31, 0]]);
    bow(); fillShadowed(ctx, metal(ctx, -9.2, 9.2, '#5b6578'), S);
    inside(ctx, bow, () => {
      seam(ctx, 36.5, -10, 36.5, 10); seam(ctx, 43, -8, 43, 8);
      seam(ctx, 31, -4.6, 46, -4.6, 0.28); seam(ctx, 31, 4.6, 46, 4.6, 0.28);
      // The empire colour: a band and two chevrons
      ctx.fillStyle = color; ctx.fillRect(32.4, -10, 2.4, 20);
      ctx.fillStyle = tone(color, -0.4); ctx.fillRect(34.8, -10, 0.45, 20);
      for (const s of [-1, 1]) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(38.4, s * 8); ctx.lineTo(41.8, s * 6.4); ctx.lineTo(41.8, s * 5.2); ctx.lineTo(38.4, s * 6.6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = LENS;
        for (let i = 0; i < 3; i++) ctx.fillRect(38 + i * 2, s * 2.2 - 0.35, 1.1, 0.7);
      }
      rivets(ctx, 33, 45, -0.1, 5, 0.3);
    });
    bevel(ctx, bow, 0.9);
    const eye = () => sym(ctx, [[49.2, 0], [48.6, -1.9], [46.4, -3], [45, -3], [45, 0]]);
    glass(ctx, eye, 45, 49.2, -3, 3, LENS, S);

    // ----- The stern block with the engines' housings
    const stern = () => sym(ctx, [[-32, 0], [-32, -7], [-35, -12.4], [-47, -12.4], [-50, -9], [-50, 0]]);
    stern(); fillShadowed(ctx, metal(ctx, -12.4, 12.4, '#566073'), S);
    inside(ctx, stern, () => {
      seam(ctx, -40.5, -13, -40.5, 13); seam(ctx, -47, -13, -47, 13, 0.28);
      for (const s of [-1, 1]) {
        vents(ctx, -46, s * 9.6, 4, 3.6, 1.5);
        ctx.fillStyle = color; ctx.fillRect(-39.6, s * 10.6 - 0.5, 6, 1);
        rivets(ctx, -46, -41.5, s * 5.6, 3, 0.3);
      }
    });
    bevel(ctx, stern, 0.9);
    // The bridge on top of it: a blocky house, glass all round its front
    const house = () => { ctx.beginPath(); ctx.roundRect(-45, -5.2, 10.6, 10.4, 1.4); };
    house(); fillShadowed(ctx, metal(ctx, -5.2, 5.2, '#7b869a'), S * 0.7);
    inside(ctx, house, () => { seam(ctx, -41, -6, -41, 6, 0.28); });
    bevel(ctx, house, 0.6);
    const pane = () => sym(ctx, [[-34.9, 0], [-35.2, -3.2], [-36.6, -4.2], [-39.4, -4.2], [-39.4, 0]]);
    glass(ctx, pane, -39.4, -34.9, -4.2, 4.2, '#4fd0c8', S);
    // A mast and a dish behind it
    ctx.strokeStyle = '#aab6cc'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(-43, 0); ctx.lineTo(-31, 0); ctx.stroke();
    ctx.fillStyle = '#d8e0ec'; ctx.beginPath(); ctx.ellipse(-43.2, -2.6, 1.7, 1.1, 0.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(8,12,22,.5)'; ctx.lineWidth = 0.25; ctx.stroke();

    // ----- The biospheres, from stern to bow - each lies over the spine
    for (const [x, R, turn] of DOMES) dome(ctx, x, R, turn, color, S);
  }
};
