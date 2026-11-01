// Ship profile: tanker (see ../shipshd.js).
import {
  RED, GREEN, WHITE, nozzle, fillShadowed, metal, bevel, inside, rivets, tone, poly, TAU, sym, seam,
  vents, glass
} from './kit.js';

export const tanker = {
  r: 60,
  engines: [
    { x: -54, y: 0, r: 5.6, color: '#ffc27a' }
  ],
  lights: [
    { x: 30, y: -35, r: 1, color: RED, off: 0 },
    { x: 30, y: 35, r: 1, color: GREEN, off: 0 },
    { x: -46, y: 0, r: 0.9, color: WHITE, off: 2, strobe: true }
  ],
  body(ctx, color, S) {
    nozzle(ctx, -54, 0, 5.6, 6);
    // Pipes between the tanks and the spine
    for (const s of [-1, 1]) for (const x of [-22, 4, 24]) {
      const p = () => { ctx.beginPath(); ctx.rect(x - 1.4, s < 0 ? -12 : 5, 2.8, 7); };
      p(); fillShadowed(ctx, metal(ctx, -2, 2, '#b6becc'), S * 0.4); bevel(ctx, p, 0.35);
      ctx.fillStyle = '#5a6274'; ctx.fillRect(x - 2, s * 8.4 - 0.7, 4, 1.4);
    }
    // Tanks
    for (const s of [-1, 1]) {
      const y = s * 22;
      const tk = () => { ctx.beginPath(); ctx.roundRect(-42, y - 12, 80, 24, 12); };
      tk();
      const g = ctx.createLinearGradient(0, y - 12, 0, y + 12);
      g.addColorStop(0, '#f6f9ff'); g.addColorStop(0.22, '#d2d9e6'); g.addColorStop(0.5, '#98a3b8');
      g.addColorStop(0.75, '#626c80'); g.addColorStop(1, '#2f3646');
      fillShadowed(ctx, g, S);
      inside(ctx, tk, () => {
        // Tension straps
        for (let x = -30; x <= 28; x += 11.6) {
          const b = ctx.createLinearGradient(0, y - 12, 0, y + 12);
          b.addColorStop(0, '#c7cfdc'); b.addColorStop(0.5, '#6a7488'); b.addColorStop(1, '#262c3a');
          ctx.fillStyle = b; ctx.fillRect(x, y - 12, 2.2, 24);
          ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(x, y - 12, 0.4, 24);
          rivets(ctx, x + 1.1, x + 1.1, y - 7, 1, 0.3);
          rivets(ctx, x + 1.1, x + 1.1, y + 7, 1, 0.3);
        }
        // Empire color and warning field
        ctx.fillStyle = color; ctx.fillRect(-38, y - 12, 6, 24);
        ctx.fillStyle = tone(color, 0.4); ctx.fillRect(-38, y - 12, 6, 2);
        ctx.save();
        ctx.beginPath(); ctx.rect(22, y - 12, 6, 24); ctx.clip();
        ctx.fillStyle = '#e8c547'; ctx.fillRect(22, y - 12, 6, 24);
        ctx.fillStyle = '#1f2330';
        for (let k = -4; k < 8; k++) poly(ctx, [[22, y - 12 + k * 4], [28, y - 18 + k * 4], [28, y - 16 + k * 4], [22, y - 10 + k * 4]]), ctx.fill();
        ctx.restore();
        // wide gloss lengthwise
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.beginPath(); ctx.roundRect(-36, y - 9.5, 70, 2.6, 1.3); ctx.fill();
        // Hint of lettering
        ctx.fillStyle = 'rgba(30,36,50,.55)';
        for (let i = 0; i < 4; i++) ctx.fillRect(-12 + i * 3.2, y + 3, 2.2, 3);
      });
      bevel(ctx, tk, 0.8);
      // Valve caps
      for (const x of [-43, 37]) {
        const v = () => { ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); };
        v(); fillShadowed(ctx, metal(ctx, y - 3, y + 3, '#7f8a9e'), S * 0.4); bevel(ctx, v, 0.35);
        ctx.fillStyle = '#d54a3a'; ctx.beginPath(); ctx.arc(x, y, 1.2, 0, TAU); ctx.fill();
      }
    }
    // Spine
    const sp = () => sym(ctx, [[46, 0], [45.6, -3.6], [43.5, -5.8], [34, -6.4], [-48, -5.6], [-54, -4], [-54, 0]]);
    sp(); fillShadowed(ctx, metal(ctx, -6.5, 6.5), S);
    inside(ctx, sp, () => {
      for (const x of [30, 10, -10, -30]) seam(ctx, x, -7, x, 7);
      // Pipeline on top of the spine
      ctx.fillStyle = '#c8cfdb'; ctx.fillRect(-44, -3.2, 70, 1.4);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-44, -1.8, 70, 0.4);
      for (let x = -40; x < 26; x += 8) { ctx.fillStyle = '#6b7488'; ctx.fillRect(x, -3.6, 1, 2.2); }
      vents(ctx, -48, 2.2, 5, 2.4, 1.4);
    });
    bevel(ctx, sp, 0.9);
    // Bridge: a flat window band across the blunt bow
    const br = () => sym(ctx, [[45, 0], [44.7, -3], [43, -4.6], [38, -4.6], [38, 0]]);
    glass(ctx, br, 38, 45, -4.6, 4.6, '#7fd2ff', S);
  }
};
