// Ship profile: satellite (see ../shipshd.js).
import {
  RED, GREEN, WHITE, fillShadowed, inside, capsule, metal, bevel, TAU, seam, rivets, tone
} from './kit.js';

export const satellite = {
  r: 60,
  engines: [],
  lights: [
    { x: -53, y: -27, r: 0.9, color: RED, off: 0 },
    { x: 53, y: 27, r: 0.9, color: GREEN, off: 0 },
    { x: 0, y: -27, r: 0.9, color: WHITE, off: 0.3, strobe: true }
  ],
  body(ctx, color, S) {
    // Lattice girder
    for (const s of [-1, 1]) {
      ctx.strokeStyle = '#8a95aa'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(s * 14, -2.4); ctx.lineTo(s * 24, -2.4); ctx.moveTo(s * 14, 2.4); ctx.lineTo(s * 24, 2.4); ctx.stroke();
      ctx.lineWidth = 0.5; ctx.beginPath();
      for (let i = 0; i < 5; i++) { ctx.moveTo(s * (14 + i * 2), i % 2 ? 2.4 : -2.4); ctx.lineTo(s * (16 + i * 2), i % 2 ? -2.4 : 2.4); }
      ctx.stroke();
    }
    // Solar wings
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -54 : 24, wdt = 30, h = 26;
      const frame = () => { ctx.beginPath(); ctx.rect(x0, -h, wdt, h * 2); };
      frame(); fillShadowed(ctx, '#1b2742', S);
      const cols = 3, rows = 6, gx = wdt / cols, gy = h * 2 / rows;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const cx = x0 + i * gx + 0.5, cy = -h + j * gy + 0.5;
        const g = ctx.createLinearGradient(cx, cy, cx + gx, cy + gy);
        g.addColorStop(0, '#4f7fd0'); g.addColorStop(0.5, '#2b4f99'); g.addColorStop(1, '#1a3270');
        ctx.fillStyle = g; ctx.fillRect(cx, cy, gx - 1, gy - 1);
        ctx.strokeStyle = 'rgba(160,200,255,.18)'; ctx.lineWidth = 0.2;
        ctx.beginPath();
        for (let k = 1; k < 4; k++) { ctx.moveTo(cx + (gx - 1) * k / 4, cy); ctx.lineTo(cx + (gx - 1) * k / 4, cy + gy - 1); }
        ctx.stroke();
      }
      inside(ctx, frame, () => {
        // Gloss across the panel
        const sh = ctx.createLinearGradient(x0, -h, x0 + wdt, h);
        sh.addColorStop(0.3, 'rgba(255,255,255,0)');
        sh.addColorStop(0.45, 'rgba(200,230,255,.28)');
        sh.addColorStop(0.55, 'rgba(255,255,255,0)');
        ctx.fillStyle = sh; ctx.fillRect(x0, -h, wdt, h * 2);
      });
      ctx.strokeStyle = '#aeb8cc'; ctx.lineWidth = 0.8; frame(); ctx.stroke();
      // Joint
      capsule(ctx, s < 0 ? -26 : 22, s < 0 ? -22 : 26, 0, 3.2, '#7a8599', S * 0.5);
    }
    // Radiator fins
    for (const s of [-1, 1]) for (let i = -2; i <= 2; i++) {
      const f = () => { ctx.beginPath(); ctx.rect(i * 4 - 1.2, s < 0 ? -30 : 18, 2.4, 12); };
      f(); fillShadowed(ctx, metal(ctx, -2, 2, '#c3cad6'), S * 0.4); bevel(ctx, f, 0.4);
    }
    // Core: octagon
    const core = () => {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU + TAU / 16;
        i ? ctx.lineTo(Math.cos(a) * 17, Math.sin(a) * 17) : ctx.moveTo(Math.cos(a) * 17, Math.sin(a) * 17);
      }
      ctx.closePath();
    };
    core(); fillShadowed(ctx, metal(ctx, -17, 17, '#a3aec2'), S);
    inside(ctx, core, () => {
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU + TAU / 16;
        seam(ctx, Math.cos(a) * 11, Math.sin(a) * 11, Math.cos(a) * 17, Math.sin(a) * 17, 0.3);
      }
      ctx.strokeStyle = 'rgba(10,14,24,.5)'; ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.arc(0, 0, 13.5, 0, TAU); ctx.stroke();
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * TAU;
        rivets(ctx, Math.cos(a) * 15.2, Math.cos(a) * 15.2, Math.sin(a) * 15.2, 1, 0.3);
      }
      // Warning stripes
      ctx.fillStyle = '#e8c547';
      ctx.fillRect(-16, 9, 6, 2);
      ctx.fillStyle = '#1e2230';
      for (let i = 0; i < 3; i++) ctx.fillRect(-16 + i * 2, 9, 1, 2);
    });
    bevel(ctx, core, 0.9);
    // Sensor dish
    ctx.save();
    ctx.translate(-9, -11);
    const dish = () => { ctx.beginPath(); ctx.ellipse(0, 0, 4.4, 3, -0.6, 0, TAU); };
    dish();
    const dg = ctx.createRadialGradient(-1, -1, 0, 0, 0, 4.4);
    dg.addColorStop(0, '#f4f7fc'); dg.addColorStop(1, '#7c879b');
    fillShadowed(ctx, dg, S * 0.5); bevel(ctx, dish, 0.4);
    ctx.strokeStyle = '#3a4152'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(2.2, -1.6); ctx.stroke();
    ctx.restore();
    // Turret with twin barrels
    for (const s of [-1, 1]) {
      const b = () => { ctx.beginPath(); ctx.roundRect(4, s * 2.6 - 1.1, 22, 2.2, 0.8); };
      b(); fillShadowed(ctx, metal(ctx, s * 2.6 - 1.1, s * 2.6 + 1.1, '#5a6276'), S * 0.6); bevel(ctx, b, 0.4);
      ctx.fillStyle = '#2a2f3b'; ctx.fillRect(24, s * 2.6 - 1.4, 3, 2.8);
      ctx.fillStyle = '#ffb45c'; ctx.beginPath(); ctx.arc(27, s * 2.6, 0.7, 0, TAU); ctx.fill();
    }
    const tur = () => { ctx.beginPath(); ctx.arc(0, 0, 8.6, 0, TAU); };
    tur();
    const tg = ctx.createRadialGradient(-2.5, -3, 0, 0, 0, 9);
    tg.addColorStop(0, tone(color, 0.5)); tg.addColorStop(0.6, color); tg.addColorStop(1, tone(color, -0.55));
    fillShadowed(ctx, tg, S);
    inside(ctx, tur, () => { seam(ctx, -8.6, 0, -2, 0, 0.3); rivets(ctx, -5, 5, 5.4, 4, 0.28); });
    bevel(ctx, tur, 0.7);
    ctx.fillStyle = '#20252f'; ctx.beginPath(); ctx.arc(1.5, 0, 3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffb45c'; ctx.beginPath(); ctx.arc(1.5, 0, 1.3, 0, TAU); ctx.fill();
  }
};
