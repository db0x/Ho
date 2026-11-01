// Ship profile: colony ship (see ../shipshd.js).
import {
  RED, GREEN, WHITE, nozzle, tone, fillShadowed, bevel, capsule, inside, TAU, rivets, sym, metal, seam,
  glass
} from './kit.js';

// Habitat domes from back to front: position, rotation of the park and size
// relative to the drawn dome (radius 15, rim 15.8). The large middle one
// carries the ship; the domes do not overlap, and the rear one reaches back
// over the engines.
const DOMES = [[-49.1, 2.1, 0.95], [-13.55, -0.9, 1.25], [22, 0.5, 0.95]];

export const colony = {
  r: 66,
  engines: [
    { x: -52, y: 0, r: 6.5, color: '#9dffc8' },
    { x: -46, y: -10.5, r: 3.2, color: '#9dffc8' },
    { x: -46, y: 10.5, r: 3.2, color: '#9dffc8' }
  ],
  lights: [
    { x: -6, y: -40, r: 1, color: RED, off: 0 },
    { x: -6, y: 40, r: 1, color: GREEN, off: 0 },
    { x: 42, y: 0, r: 0.9, color: WHITE, off: 1.4, strobe: true }
  ],
  body(ctx, color, S) {
    nozzle(ctx, -52, 0, 6.5, 6.5);
    for (const s of [-1, 1]) nozzle(ctx, -46, s * 10.5, 3.2, 4);
    // Struts to the cargo modules
    for (const s of [-1, 1]) for (const x of [-22, 4]) {
      const st = () => { ctx.beginPath(); ctx.rect(x - 1.6, s < 0 ? -26 : 12, 3.2, 14); };
      // Shaded across the strut, not along the ship's axis - otherwise the
      // lower struts fall into the dark end of the gradient and vanish.
      const rod = ctx.createLinearGradient(x - 1.6, 0, x + 1.6, 0);
      rod.addColorStop(0, tone('#7d889c', 0.5)); rod.addColorStop(0.45, '#7d889c'); rod.addColorStop(1, tone('#7d889c', -0.5));
      st(); fillShadowed(ctx, rod, S * 0.5); bevel(ctx, st, 0.4);
      ctx.strokeStyle = 'rgba(10,14,24,.5)'; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(x - 1.6, s * 13); ctx.lineTo(x + 1.6, s * 25); ctx.stroke();
    }
    // Cargo modules
    for (const s of [-1, 1]) {
      const pod = capsule(ctx, -36, 16, s * 31, 8.5, '#8994a8', S);
      inside(ctx, pod, () => {
        for (let x = -28; x <= 8; x += 6) {
          ctx.fillStyle = 'rgba(10,14,24,.35)'; ctx.fillRect(x, s * 31 - 9, 1.4, 18);
          ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x + 1.4, s * 31 - 9, 0.4, 18);
        }
        ctx.fillStyle = color; ctx.fillRect(-35, s * 31 - 9, 5, 18);
        ctx.fillStyle = tone(color, -0.4); ctx.fillRect(-30.4, s * 31 - 9, 0.6, 18);
        // Hatch
        ctx.fillStyle = 'rgba(20,26,38,.7)'; ctx.beginPath(); ctx.arc(11, s * 31, 3, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 0.3; ctx.stroke();
        rivets(ctx, -24, 4, s * 31 - s * 6.2, 6, 0.3);
      });
    }
    // Hull
    // Narrow girder: the three domes should stick out on the left and right.
    const hull = () => sym(ctx, [[44, 0], [43.6, -6], [41, -9.5], [34, -10.5], [-30, -10.5], [-44, -8.5], [-50, -4.5], [-50, 0]]);
    hull(); fillShadowed(ctx, metal(ctx, -11, 11), S);
    inside(ctx, hull, () => {
      for (const x of [37, -48]) seam(ctx, x, -12, x, 12);
      seam(ctx, -48, -6.5, 36, -6.5, 0.3); seam(ctx, -48, 6.5, 36, 6.5, 0.3);
      rivets(ctx, 34.5, 34.5, -8.5, 1, 0.3); rivets(ctx, 34.5, 34.5, 8.5, 1, 0.3);
    });
    bevel(ctx, hull, 1);
    // Bridge
    // Flat bridge: a wide window band across the blunt bow
    const br = () => sym(ctx, [[43, 0], [42.7, -4.5], [40.5, -7.5], [38, -7.5], [38, 0]]);
    glass(ctx, br, 38, 43, -7.5, 7.5, '#7fe0ff', S);
    // Three large habitat domes with a park - the hallmark of the settler ship.
    // Each park is rotated a little so they do not look copied.
    // From back to front: the front one always lies on top.
    for (const [x, dreh, size] of DOMES) {
      ctx.save();
      ctx.translate(x, 0); ctx.scale(size, size); ctx.translate(-4, 0);
      const dome = () => { ctx.beginPath(); ctx.arc(4, 0, 15, 0, TAU); };
      ctx.save();
      dome(); fillShadowed(ctx, '#173a2c', S);
      inside(ctx, dome, () => {
        // Only the park rotates - glass and reflection keep their light from above.
        ctx.save(); ctx.translate(4, 0); ctx.rotate(dreh); ctx.translate(-4, 0);
        const lawn = ctx.createRadialGradient(4, 0, 0, 4, 0, 15);
        lawn.addColorStop(0, '#4fae5e'); lawn.addColorStop(1, '#1d5a35');
        ctx.fillStyle = lawn; ctx.fillRect(-12, -16, 32, 32);
        // Water, paths, trees, houses
        ctx.fillStyle = '#3a8fc7'; ctx.beginPath(); ctx.ellipse(8, 4, 4.2, 2.6, 0.4, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(230,220,180,.6)'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(-10, -4); ctx.quadraticCurveTo(2, -1, 16, -6); ctx.moveTo(4, -14); ctx.lineTo(4, 14); ctx.stroke();
        const trees = [[-6, 6], [-3, 9], [-8, 1], [12, -9], [9, -11], [0, -9], [-4, -11], [14, 1], [-1, 4]];
        for (const [x, y] of trees) {
          ctx.fillStyle = '#1f6b3a'; ctx.beginPath(); ctx.arc(x + 0.4, y + 0.4, 1.8, 0, TAU); ctx.fill();
          ctx.fillStyle = '#5fc46e'; ctx.beginPath(); ctx.arc(x, y, 1.4, 0, TAU); ctx.fill();
        }
        for (const [x, y] of [[9, -3], [11, -2], [0, 1], [-2, -4]]) {
          ctx.fillStyle = '#e8e2d0'; ctx.fillRect(x, y, 1.6, 1.6);
          ctx.fillStyle = '#ffd77a'; ctx.fillRect(x + 0.5, y + 0.5, 0.6, 0.6);
        }
        ctx.restore();
        // Glass vault: ribs, reflection, rim shadow
        ctx.strokeStyle = 'rgba(210,240,255,.35)'; ctx.lineWidth = 0.35;
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI;
          ctx.beginPath(); ctx.ellipse(4, 0, 15, 15 * Math.abs(Math.cos(a)), Math.PI / 2, 0, TAU); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(4, 0, 9, 0, TAU); ctx.stroke();
        const rim = ctx.createRadialGradient(4, 0, 9, 4, 0, 15);
        rim.addColorStop(0, 'rgba(0,20,30,0)'); rim.addColorStop(1, 'rgba(0,20,30,.55)');
        ctx.fillStyle = rim; ctx.fillRect(-12, -16, 32, 32);
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.beginPath(); ctx.ellipse(1, -8, 8, 2.6, -0.25, 0, TAU); ctx.fill();
      });
      ctx.lineWidth = 1.4; ctx.strokeStyle = '#c3ccdb'; dome(); ctx.stroke();
      ctx.lineWidth = 0.4; ctx.strokeStyle = 'rgba(5,8,16,.9)'; ctx.beginPath(); ctx.arc(4, 0, 15.8, 0, TAU); ctx.stroke();
      ctx.restore();
      ctx.restore();
    }
  }
};
