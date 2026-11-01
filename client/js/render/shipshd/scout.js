// Ship profile: scout (see ../shipshd.js).
import {
  RED, GREEN, WHITE, poly, fillShadowed, metal, inside, seam, bevel, nozzle, tone, rivets, sym, glass
} from './kit.js';

// After the Raptor in plan view - the same outline as the map icon
// (ships.js): a round canopy in front, right behind it the broad body with
// big five-sided wing panels, two ribbed engine pods close together at the
// stern and long pointed stabilizers reaching back and out.
export const scout = {
  r: 58,
  engines: [
    { x: -40, y: -8.4, r: 5, color: '#7fd8ff' },
    { x: -40, y: 8.4, r: 5, color: '#7fd8ff' }
  ],
  lights: [
    { x: 13.6, y: -39, r: 1, color: RED, off: 0 },
    { x: 13.6, y: 39, r: 1, color: GREEN, off: 0 },
    { x: -47, y: -26.6, r: 0.8, color: WHITE, off: 1, strobe: true },
    { x: -47, y: 26.6, r: 0.8, color: WHITE, off: 1, strobe: true }
  ],
  body(ctx, color, S) {
    // Long pointed stabilizers
    for (const s of [-1, 1]) {
      const st = () => poly(ctx, [[-10, s * 15], [-50, s * 28.4], [-46, s * 24], [-15, s * 11]]);
      st(); fillShadowed(ctx, metal(ctx, -28, 28, '#8f9aae'), S * 0.6);
      inside(ctx, st, () => seam(ctx, -13, s * 13, -47, s * 26, 0.3));
      bevel(ctx, st, 0.5);
    }
    // Two ribbed engine pods close together
    for (const s of [-1, 1]) {
      const y = s * 8.4;
      nozzle(ctx, -40, y, 5, 5);
      const pod = () => { ctx.beginPath(); ctx.roundRect(-38, y - 6.5, 26, 13, 3); };
      pod(); fillShadowed(ctx, metal(ctx, y - 6.5, y + 6.5, '#6f7a8e'), S);
      inside(ctx, pod, () => {
        for (const x of [-31.4, -23.4, -15.4]) {
          ctx.fillStyle = 'rgba(10,14,22,.75)'; ctx.fillRect(x, y - 5.2, 6.4, 10.4);
          ctx.fillStyle = 'rgba(255,255,255,.12)';
          for (let i = 0; i < 5; i++) ctx.fillRect(x + 0.5, y - 4.6 + i * 2.1, 5.4, 0.4);
        }
        ctx.fillStyle = '#a7b2c4';
        for (const x of [-33, -25, -17]) ctx.fillRect(x, y - 6.5, 1.6, 13);
      });
      bevel(ctx, pod, 0.6);
    }
    // Five-sided wing panels in the empire color
    for (const s of [-1, 1]) {
      const w = () => poly(ctx, [[24.5, s * 13], [13.6, s * 39], [-8.2, s * 39], [-17.3, s * 20], [-17.3, s * 13]]);
      w();
      const g = ctx.createLinearGradient(0, s * 13, 0, s * 39);
      g.addColorStop(0, tone(color, s < 0 ? 0.2 : -0.15));
      g.addColorStop(1, tone(color, s < 0 ? -0.2 : -0.5));
      fillShadowed(ctx, g, S);
      inside(ctx, w, () => {
        // Dark panels as on the original
        ctx.fillStyle = 'rgba(16,20,32,.6)';
        for (const [x, y, wd, h] of [[12, 19, 4, 4.5], [6, 20, 6, 5], [-3, 20, 6, 5], [6, 28, 6, 5], [-3, 28, 6, 5], [-10, 24, 5, 8]]) {
          ctx.fillRect(x, s > 0 ? y : -y - h, wd, h);
        }
        seam(ctx, 19, s * 15, 10, s * 37, 0.3);
        seam(ctx, -14, s * 16, -5, s * 37, 0.3);
        ctx.fillStyle = 'rgba(255,255,255,.16)';
        poly(ctx, [[24.5, s * 13], [13.6, s * 39], [12.4, s * 37.5], [22.6, s * 13.4]]); ctx.fill();
        rivets(ctx, 4, -6, s * 36, 5, 0.3);
      });
      bevel(ctx, w, 0.8);
    }
    // Broad body with the C emblem in the empire color
    const body = () => sym(ctx, [[50, 0], [49, -6], [45, -9.5], [36, -12], [26, -15], [0, -16], [-17, -14], [-17, 0]]);
    body(); fillShadowed(ctx, metal(ctx, -16, 16, '#a3adbd'), S);
    inside(ctx, body, () => {
      seam(ctx, 24, -16, 24, 16); seam(ctx, -1, -16, -1, 16);
      seam(ctx, 22, -11.5, 0, -11.5, 0.3); seam(ctx, 22, 11.5, 0, 11.5, 0.3);
      ctx.strokeStyle = color; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(8, 0, 4, -Math.PI + 0.8, Math.PI - 0.8); ctx.stroke();
      // Panel with the chevron
      ctx.fillStyle = 'rgba(16,20,32,.5)'; ctx.fillRect(-14, -5, 7, 10);
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(-8.5, -3.5); ctx.lineTo(-12.5, 0); ctx.lineTo(-8.5, 3.5); ctx.stroke();
      rivets(ctx, 20, 2, -13.5, 6, 0.3); rivets(ctx, 20, 2, 13.5, 6, 0.3);
    });
    bevel(ctx, body, 0.9);
    // Round canopy with a heavy dark frame
    const cab = () => sym(ctx, [[47.5, 0], [46.5, -5], [43, -8.2], [34, -9.4], [27, -8.4], [27, 0]]);
    glass(ctx, cab, 27, 47.5, -9.4, 9.4, '#3fb7c9', S);
    ctx.strokeStyle = 'rgba(14,18,28,.95)'; ctx.lineWidth = 1.3; cab(); ctx.stroke();
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(37, -9.2); ctx.lineTo(37, 9.2);
    ctx.moveTo(27, -4.2); ctx.lineTo(46, -3); ctx.moveTo(27, 4.2); ctx.lineTo(46, 3); ctx.stroke();
    // Sensor prongs at the nose
    ctx.strokeStyle = '#c8d2e4'; ctx.lineWidth = 0.4;
    for (const y of [-2.5, 2.5]) { ctx.beginPath(); ctx.moveTo(49, y); ctx.lineTo(53, y * 1.5); ctx.stroke(); }
  }
};
