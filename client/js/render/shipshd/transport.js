// Ship profile: transporter (see ../shipshd.js).
import {
  WHITE, nozzle, fillShadowed, metal, inside, seam, vents, bevel, TAU, sym, rivets, glass
} from './kit.js';

// An open satellite carrier: a lattice spine with a flat bridge pod
// in front and an engine nacelle on each side at the stern; along the spine
// five cradles, left and right in turn, each holding a folded satellite with
// its hub in the empire color.
const CRADLES = [[26, -1], [14, 1], [2, -1], [-10, 1], [-22, -1]];

export const transport = {
  r: 58,
  engines: [
    { x: -47, y: -13, r: 3.8, color: '#ffd08a' },
    { x: -47, y: 13, r: 3.8, color: '#ffd08a' }
  ],
  lights: [
    { x: -40, y: 0, r: 0.9, color: WHITE, off: 0.8, strobe: true }
  ],
  body(ctx, color, S) {
    // Engine nacelles on both sides at the stern, joined by a crossbeam
    for (const s of [-1, 1]) {
      const y = s * 13;
      nozzle(ctx, -47, y, 3.8, 5);
      const nac = () => { ctx.beginPath(); ctx.roundRect(-45, y - 4.4, 15, 8.8, 4); };
      nac(); fillShadowed(ctx, metal(ctx, y - 4.4, y + 4.4, '#7d889c'), S);
      inside(ctx, nac, () => {
        seam(ctx, -40, y - 4.4, -40, y + 4.4);
        vents(ctx, -39, y, 3, 3.6, 1.7);
        ctx.fillStyle = color; ctx.fillRect(-34.5, y - 4.4, 2.5, 8.8);
      });
      bevel(ctx, nac, 0.6);
    }
    const beam = () => { ctx.beginPath(); ctx.rect(-40, -10, 6, 20); };
    beam(); fillShadowed(ctx, metal(ctx, -10, 10, '#6f7a8e'), S); bevel(ctx, beam, 0.5);
    // Lattice spine: two rails with diagonal bracing
    const rails = () => { ctx.beginPath(); ctx.rect(-42, -4.6, 78, 9.2); };
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 3 * S; ctx.shadowOffsetY = 0.8 * S;
    ctx.fillStyle = '#9aa6ba';
    ctx.fillRect(-42, -4.6, 78, 1.8); ctx.fillRect(-42, 2.8, 78, 1.8);
    ctx.restore();
    ctx.strokeStyle = '#7d889c'; ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let x = -42, i = 0; x < 36; x += 6, i++) {
      ctx.moveTo(x, i % 2 ? -3 : 3); ctx.lineTo(x + 6, i % 2 ? 3 : -3);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(-42, -4.6, 78, 0.4); ctx.fillRect(-42, 2.8, 78, 0.4);
    ctx.strokeStyle = 'rgba(10,14,24,.6)'; ctx.lineWidth = 0.3; rails(); ctx.stroke();
    // Cradles with folded satellites
    for (const [x, s] of CRADLES) {
      const y = s * 11;
      // Clamp arms from the rail to the cradle
      ctx.fillStyle = '#5d6578';
      ctx.fillRect(x - 3.2, s < 0 ? y + 3 : 4.6, 1.4, 3.4);
      ctx.fillRect(x + 1.8, s < 0 ? y + 3 : 4.6, 1.4, 3.4);
      // Folded solar wings along the spine
      for (const d of [-1, 1]) {
        const p = () => { ctx.beginPath(); ctx.rect(x + d * 3.6 - (d < 0 ? 4.6 : 0), y - 2.6, 4.6, 5.2); };
        p(); fillShadowed(ctx, '#2c4a8a', S * 0.4);
        inside(ctx, p, () => {
          ctx.strokeStyle = 'rgba(160,200,255,.45)'; ctx.lineWidth = 0.25;
          for (let k = 1; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x + d * 3.6 - (d < 0 ? 4.6 : 0) + k * 1.53, y - 2.6); ctx.lineTo(x + d * 3.6 - (d < 0 ? 4.6 : 0) + k * 1.53, y + 2.6); ctx.stroke(); }
          ctx.beginPath(); ctx.moveTo(x + d * 3.6 - (d < 0 ? 4.6 : 0), y); ctx.lineTo(x + d * 3.6 + (d < 0 ? 0 : 4.6), y); ctx.stroke();
        });
        bevel(ctx, p, 0.3);
      }
      // Hexagonal body with the hub in the empire color
      const hex = () => { ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6; ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * 4.2, y + Math.sin(a) * 4.2); } ctx.closePath(); };
      hex(); fillShadowed(ctx, metal(ctx, y - 4.2, y + 4.2, '#a9b4c6'), S * 0.6);
      bevel(ctx, hex, 0.5);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 1.9, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(10,14,24,.7)'; ctx.lineWidth = 0.4; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(x - 0.6, y - 0.6, 0.6, 0, TAU); ctx.fill();
    }
    // Flat bridge pod in front
    const br = () => sym(ctx, [[47, 0], [46.6, -5], [44.4, -8], [36, -9], [33, -7], [33, 0]]);
    br(); fillShadowed(ctx, metal(ctx, -9, 9), S);
    inside(ctx, br, () => {
      seam(ctx, 38, -9, 38, 9);
      ctx.fillStyle = color; ctx.fillRect(34.4, -9, 2, 18);
      rivets(ctx, 40, 40, -6.5, 1, 0.3); rivets(ctx, 40, 40, 6.5, 1, 0.3);
    });
    bevel(ctx, br, 0.8);
    const win = () => sym(ctx, [[46, 0], [45.7, -4], [43.8, -6.5], [41.8, -6.5], [41.8, 0]]);
    glass(ctx, win, 41.8, 46, -6.5, 6.5, '#7fe0ff', S);
  }
};
