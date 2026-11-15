// Ship profile: tanker (see ../shipshd.js).
import {
  RED, GREEN, WHITE, nozzle, fillShadowed, metal, bevel, inside, rivets, tone, poly, TAU, sym, seam,
  vents, glass
} from './kit.js';

// The two tanks: radius, offset from the axis, where they begin and their length.
const TR = 14, TY = 25, TX = -42, TL = 80;
const tankPath = (ctx, s) => { ctx.beginPath(); ctx.roundRect(TX, s * TY - TR, TL, TR * 2, TR); };
const SPINE = [[46, 0], [45.6, -3.6], [43.5, -5.8], [34, -6.4], [-48, -5.6], [-54, -4], [-54, 0]];
/** The bridge: a deckhouse on the bow end of the spine. */
const HOUSE = [[46, 0], [45.6, -3.6], [43.5, -5.8], [34, -6.4], [29.5, -6.4], [29.5, 0]];
const SCREEN = [[45.2, 0], [44.9, -3.1], [43.1, -5], [39.4, -5.4], [39.4, 0]];

export const tanker = {
  r: 60,
  engines: [
    { x: -54, y: 0, r: 5.6, color: '#ffc27a' }
  ],
  lights: [
    { x: 30, y: -(TY + TR - 0.6), r: 1, color: RED, off: 0 },
    { x: 30, y: TY + TR - 0.6, r: 1, color: GREEN, off: 0 },
    { x: -46, y: 0, r: 0.9, color: WHITE, off: 2, strobe: true }
  ],
  // In space: the tanks are true cylinders with domed ends, far thicker
  // than the spine between them; the spine is a girder with steep flanks,
  // the bridge a house on its bow end whose windscreen leans back.
  solid: {
    under: true,
    hull: { r: 3, h: 2.4, belly: 1 },
    parts: [
      ...[-1, 1].map(s => ({ round: true, r: TR, h: TR, belly: 1, path: (ctx) => tankPath(ctx, s) })),
      { over: true, r: 2.6, h: 4.4, belly: 1, path: (ctx) => sym(ctx, SPINE) },
      {
        over: true, r: 2.4, h: 3.6, belly: 0, z: 3.8,
        scale: (x) => 1 - 0.75 * Math.min(1, Math.max(0, (x - 39.5) / 6.5)),
        path: (ctx) => sym(ctx, HOUSE)
      }
    ]
  },
  body(ctx, color, S, look, opts) {
    nozzle(ctx, -54, 0, 5.6, 6);
    // Pipes between the tanks and the spine
    for (const s of [-1, 1]) for (const x of [-22, 4, 24]) {
      const p = () => { ctx.beginPath(); ctx.rect(x - 1.4, s < 0 ? -(TY - TR + 2) : 5, 2.8, TY - TR - 3); };
      p(); fillShadowed(ctx, metal(ctx, -2, 2, '#b6becc'), S * 0.4); bevel(ctx, p, 0.35);
      ctx.fillStyle = '#5a6274'; ctx.fillRect(x - 2, s * 8.4 - 0.7, 4, 1.4);
    }
    // Tanks
    for (const s of [-1, 1]) {
      const y = s * TY;
      const tk = () => tankPath(ctx, s);
      tk();
      // As the skin of a solid the tank is evenly colored - there the light
      // falls on a real cylinder; drawn flat, the shading makes it round.
      const solid = opts?.solid;
      const g = ctx.createLinearGradient(0, y - TR, 0, y + TR);
      if (solid) { g.addColorStop(0, '#c3cbd8'); g.addColorStop(1, '#b3bccb'); } else {
        g.addColorStop(0, '#f6f9ff'); g.addColorStop(0.22, '#d2d9e6'); g.addColorStop(0.5, '#98a3b8');
        g.addColorStop(0.75, '#626c80'); g.addColorStop(1, '#2f3646');
      }
      fillShadowed(ctx, g, S);
      inside(ctx, tk, () => {
        // Tension straps
        for (let x = TX + 12; x <= TX + TL - 10; x += 11.6) {
          const b = ctx.createLinearGradient(0, y - TR, 0, y + TR);
          if (solid) { b.addColorStop(0, '#7d8799'); b.addColorStop(1, '#727c8f'); } else {
            b.addColorStop(0, '#c7cfdc'); b.addColorStop(0.5, '#6a7488'); b.addColorStop(1, '#262c3a');
          }
          ctx.fillStyle = b; ctx.fillRect(x, y - TR, 2.2, TR * 2);
          ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(x, y - TR, 0.4, TR * 2);
          rivets(ctx, x + 1.1, x + 1.1, y - 8, 1, 0.3);
          rivets(ctx, x + 1.1, x + 1.1, y + 8, 1, 0.3);
        }
        // Empire color and warning field
        ctx.fillStyle = color; ctx.fillRect(TX + 4, y - TR, 6, TR * 2);
        ctx.fillStyle = tone(color, 0.4); ctx.fillRect(TX + 4, y - TR, 6, 2);
        ctx.save();
        ctx.beginPath(); ctx.rect(22, y - TR, 6, TR * 2); ctx.clip();
        ctx.fillStyle = '#e8c547'; ctx.fillRect(22, y - TR, 6, TR * 2);
        ctx.fillStyle = '#1f2330';
        for (let k = -4; k < 9; k++) poly(ctx, [[22, y - TR + k * 4], [28, y - TR - 6 + k * 4], [28, y - TR - 4 + k * 4], [22, y - TR + 2 + k * 4]]), ctx.fill();
        ctx.restore();
        // wide gloss lengthwise
        if (!solid) {
          ctx.fillStyle = 'rgba(255,255,255,.35)';
          ctx.beginPath(); ctx.roundRect(TX + 6, y - TR + 2.8, TL - 10, 2.8, 1.4); ctx.fill();
        }
        // Hint of lettering
        ctx.fillStyle = 'rgba(30,36,50,.55)';
        for (let i = 0; i < 4; i++) ctx.fillRect(-12 + i * 3.2, y + 3.5, 2.2, 3.2);
      });
      if (!solid) bevel(ctx, tk, 0.8);
      // Valve caps: at the ends of the tank - on a solid, where the ends are
      // domes, on its back instead
      for (const x of solid ? [TX + 7, TX + TL - 17] : [TX - 1, TX + TL - 5]) {
        const r = solid ? 2.2 : 3;
        const v = () => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); };
        v(); fillShadowed(ctx, metal(ctx, y - r, y + r, '#7f8a9e'), S * 0.4); bevel(ctx, v, 0.35);
        ctx.fillStyle = '#d54a3a'; ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, TAU); ctx.fill();
      }
    }
    // Spine
    const sp = () => sym(ctx, SPINE);
    sp(); fillShadowed(ctx, metal(ctx, -6.5, 6.5), S);
    inside(ctx, sp, () => {
      for (const x of [10, -10, -30]) seam(ctx, x, -7, x, 7);
      // Pipeline on top of the spine
      ctx.fillStyle = '#c8cfdb'; ctx.fillRect(-44, -3.2, 70, 1.4);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-44, -1.8, 70, 0.4);
      for (let x = -40; x < 26; x += 8) { ctx.fillStyle = '#6b7488'; ctx.fillRect(x, -3.6, 1, 2.2); }
      vents(ctx, -48, 2.2, 5, 2.4, 1.4);
    });
    bevel(ctx, sp, 0.9);
    // From below the bow end of the spine is plain plating
    if (opts?.under) {
      inside(ctx, sp, () => { seam(ctx, 30, -7, 30, 7); seam(ctx, 38, -7, 38, 7); rivets(ctx, 32, 44, 0, 5, 0.3); });
      return;
    }
    // The bridge: a deckhouse on the bow, brighter than the spine, a band
    // in the empire color across its back
    const house = () => sym(ctx, HOUSE);
    house(); fillShadowed(ctx, metal(ctx, -6.4, 6.4, '#bcc5d3'), S * 0.7);
    inside(ctx, house, () => {
      ctx.fillStyle = color; ctx.fillRect(29.5, -6.4, 1.5, 12.8);
      ctx.fillStyle = tone(color, -0.4); ctx.fillRect(31, -6.4, 0.3, 12.8);
      seam(ctx, 34, -6.4, 34, 6.4, 0.28);
      // Roof: a hatch, two housings, rivets along the edge
      ctx.fillStyle = 'rgba(16,20,32,.28)';
      ctx.fillRect(32, -3.6, 1.4, 2.2); ctx.fillRect(32, 1.4, 1.4, 2.2);
      const hatch = () => { ctx.beginPath(); ctx.arc(36.4, 0, 1.7, 0, TAU); };
      hatch(); ctx.fillStyle = metal(ctx, -1.7, 1.7, '#8f9aae'); ctx.fill(); bevel(ctx, hatch, 0.3);
      ctx.strokeStyle = 'rgba(10,14,24,.6)'; ctx.lineWidth = 0.25;
      ctx.beginPath(); ctx.moveTo(35.2, 0); ctx.lineTo(37.6, 0); ctx.stroke();
      rivets(ctx, 32.5, 38.5, -5.6, 4, 0.26); rivets(ctx, 32.5, 38.5, 5.6, 4, 0.26);
    });
    bevel(ctx, house, 0.7);
    // Side windows: three lit panes each side
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const x = 32.6 + i * 2.1, y = s * 4.6;
      ctx.fillStyle = '#0f1b2a'; ctx.fillRect(x - 0.15, y - 0.75, 1.7, 1.5);
      ctx.fillStyle = i === 1 ? '#ffe2a0' : '#8fe0ff'; ctx.fillRect(x, y - 0.6, 1.4, 1.2);
    }
    // Windscreen around the blunt bow: glass in a heavy frame, split by mullions
    const screen = () => sym(ctx, SCREEN);
    glass(ctx, screen, 39.4, 45.2, -5.4, 5.4, '#6fd0f5', S);
    ctx.strokeStyle = 'rgba(14,18,28,.95)'; ctx.lineWidth = 0.9; screen(); ctx.stroke();
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    for (const y of [-3.4, -1.2, 1.2, 3.4]) { ctx.moveTo(39.4, y); ctx.lineTo(45.4 - Math.abs(y) * 0.5, y * 0.92); }
    ctx.moveTo(42, -5.3); ctx.lineTo(42, 5.3);
    ctx.stroke();
    // Consoles glowing behind the glass
    ctx.fillStyle = 'rgba(255,214,140,.85)';
    for (const y of [-2.3, 0, 2.3]) ctx.fillRect(40, y - 0.3, 1.1, 0.6);
    // Mast with a dish, and two lamps on the roof
    ctx.strokeStyle = '#d5dce8'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.moveTo(38.4, -3.4); ctx.lineTo(38.4, -7.6); ctx.stroke();
    ctx.fillStyle = '#e4eaf3'; ctx.beginPath(); ctx.ellipse(38.4, -7.8, 1.3, 0.8, 0.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(8,12,22,.5)'; ctx.lineWidth = 0.2; ctx.stroke();
    ctx.fillStyle = '#ffb45c';
    for (const y of [-2.6, 2.6]) { ctx.beginPath(); ctx.arc(38.6, y, 0.45, 0, TAU); ctx.fill(); }
  }
};
