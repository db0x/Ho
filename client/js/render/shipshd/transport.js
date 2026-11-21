// Ship profile: transporter (see ../shipshd.js).
import {
  WHITE, RED, GREEN, nozzle, fillShadowed, metal, inside, seam, vents, bevel, TAU, sym, rivets, glass, tone, poly
} from './kit.js';

// The empire's hauler: a heavy bulk freighter. A broad hold with hatch
// covers in rows and a gantry crane across them - whatever there is to
// carry, satellites as well as ore. At the stern the engine block with its
// three nozzles and the bridge raised on top of it, as on a freighter at
// sea. At the bow a wide maw: two heavy jaws opening forward like a funnel,
// a tractor emitter in the throat between them - that is how it catches a
// meteor.

/** The hold: a long box with cut corners. */
const HOLD = [[34, 0], [34, -13], [31, -16.5], [-30, -16.5], [-33, -13.5], [-33, 0]];
/** Hatch covers: centre x of each pair, their length and how far from the axis they reach. */
const HATCHES = [-19, 0, 19];
const HATCH_LEN = 15, HATCH_IN = 2.6, HATCH_OUT = 13.6;
/** One jaw (upper side): from the throat out to a lip with a tooth turned inwards. */
const JAW = [[33, -10.5], [33, -16], [44, -21.4], [54.6, -23], [59.4, -20.6], [58.8, -16.4], [55.6, -15.2],
  [53.4, -16.8], [46, -14.4], [38, -9.4]];
const THROAT = [[39.5, 0], [39.5, -7.2], [37.4, -10.6], [33, -10.6], [33, 0]];
const BRIDGE = [[-28.6, 0], [-29, -4.8], [-30.8, -8], [-44.6, -8], [-46.4, -6], [-46.4, 0]];
const SCREEN = [[-29.4, 0], [-29.7, -4.3], [-31.2, -6.9], [-33.8, -6.9], [-33.8, 0]];
const ENGINE_Y = [-9.6, 0, 9.6];

const jawPath = (ctx, s) => poly(ctx, JAW.map(([x, y]) => [x, y * s]));
const hatchPath = (ctx, x, s) => {
  ctx.beginPath();
  ctx.roundRect(x - HATCH_LEN / 2, s < 0 ? -HATCH_OUT : HATCH_IN, HATCH_LEN, HATCH_OUT - HATCH_IN, 1);
};
const blockPath = (ctx) => { ctx.beginPath(); ctx.roundRect(-50, -15.4, 20, 30.8, 4.5); };

export const transport = {
  r: 60,
  engines: ENGINE_Y.map(y => ({ x: -51.5, y, r: 3.9, color: '#ffd08a' })),
  lights: [
    { x: -40, y: 0, r: 0.9, color: WHITE, off: 0.8, strobe: true },
    { x: 31, y: -16.6, r: 0.8, color: RED, off: 0 },
    { x: 31, y: 16.6, r: 0.8, color: GREEN, off: 0 },
    { x: 59, y: -19.6, r: 0.8, color: '#ffb46a', off: 0.2 },
    { x: 59, y: 19.6, r: 0.8, color: '#ffb46a', off: 1.4 }
  ],
  // In space: the hold and the engine block are stout boxes, the hatch
  // covers low lids on the hold, the gantry a frame standing over them;
  // the jaws are thick plates, the bridge a house on the engine block whose
  // windscreen leans back to the bow.
  solid: {
    under: true,
    hull: { r: 2, h: 3, belly: 1 },
    parts: [
      { r: 3.4, h: 7.5, belly: 1, path: blockPath },
      { r: 3.6, h: 7, belly: 1, path: (ctx) => sym(ctx, HOLD) },
      ...HATCHES.flatMap(x => [-1, 1].map(s => ({ over: true, r: 0.9, h: 1.3, belly: 0, path: (ctx) => hatchPath(ctx, x, s) }))),
      { over: true, r: 0.6, h: 2.6, belly: 0, path: (ctx) => { ctx.beginPath(); ctx.rect(8.2, -16, 2.6, 32); } },
      ...[-1, 1].map(s => ({ r: 1.8, h: 4.2, belly: 1, path: (ctx) => jawPath(ctx, s) })),
      { r: 2, h: 5, belly: 1, path: (ctx) => sym(ctx, THROAT) },
      {
        over: true, r: 2.2, h: 5.2, belly: 0,
        scale: (x) => 1 - 0.65 * Math.min(1, Math.max(0, (x + 33.8) / 5.2)),
        path: (ctx) => sym(ctx, BRIDGE)
      }
    ]
  },
  body(ctx, color, S, look, opts) {
    const under = opts?.under;

    // Tractor field: a faint cone from the throat to the lips - only drawn
    // flat, it is light, not hull
    if (!opts?.solid) {
      const f = ctx.createLinearGradient(40, 0, 60, 0);
      f.addColorStop(0, 'rgba(255,190,120,.32)');
      f.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = f;
      poly(ctx, [[39.5, -4], [58, -15.5], [62, 0], [58, 15.5], [39.5, 4]]); ctx.fill();
    }

    // Jaws: heavy plates with a hydraulic ram each, the lips in hazard stripes
    for (const s of [-1, 1]) {
      const jaw = () => jawPath(ctx, s);
      jaw(); fillShadowed(ctx, metal(ctx, -23 * s, -9.4 * s, '#7f899b'), S);
      inside(ctx, jaw, () => {
        seam(ctx, 44, -21.4 * s, 41, -12.2 * s, 0.35);
        rivets(ctx, 35, 41, -14 * s, 3, 0.3);
        // Hazard stripes on the lip
        ctx.save();
        ctx.beginPath(); ctx.rect(53.4, s > 0 ? -24 : 14.6, 6.4, 9.4); ctx.clip();
        ctx.fillStyle = '#e8c547'; ctx.fillRect(53, -25, 7, 50);
        ctx.strokeStyle = '#22252c'; ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (let k = -28; k < 28; k += 2.8) { ctx.moveTo(52, k); ctx.lineTo(61, k + 6 * s); }
        ctx.stroke();
        ctx.restore();
        // Worn bright where it bites
        ctx.strokeStyle = 'rgba(235,240,248,.6)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(58.8, -16.4 * s); ctx.lineTo(55.6, -15.2 * s); ctx.lineTo(53.4, -16.8 * s); ctx.stroke();
      });
      bevel(ctx, jaw, 0.6);
      if (!under) {
        ctx.strokeStyle = '#c9d1de'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(30, -12.6 * s); ctx.lineTo(45, -18.4 * s); ctx.stroke();
        ctx.strokeStyle = '#4f576a'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(30, -12.6 * s); ctx.lineTo(37, -15.3 * s); ctx.stroke();
      }
    }

    // Throat between the jaws, with the tractor emitter
    const th = () => sym(ctx, THROAT);
    th(); fillShadowed(ctx, metal(ctx, -10.6, 10.6, '#5d6678'), S);
    inside(ctx, th, () => { seam(ctx, 36, -10.6, 36, 10.6); vents(ctx, 33.8, 0, 3, 3, 1.6); });
    bevel(ctx, th, 0.6);
    if (!under) {
      const em = () => { ctx.beginPath(); ctx.ellipse(39.2, 0, 1.6, 4.4, 0, 0, TAU); };
      em(); ctx.fillStyle = '#23180f'; ctx.fill();
      const glow = ctx.createRadialGradient(39.4, 0, 0, 39.4, 0, 4.4);
      glow.addColorStop(0, '#fff1d0'); glow.addColorStop(0.45, '#ffb46a'); glow.addColorStop(1, 'rgba(255,140,60,.2)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(39.4, 0, 1.1, 3.6, 0, 0, TAU); ctx.fill();
      bevel(ctx, em, 0.4);
    }

    // Engine block with three nozzles
    for (const y of ENGINE_Y) nozzle(ctx, -51.5, y, 3.9, 4.6);
    const block = () => blockPath(ctx);
    block(); fillShadowed(ctx, metal(ctx, -15.4, 15.4, '#727d91'), S);
    inside(ctx, block, () => {
      seam(ctx, -44, -15.4, -44, 15.4);
      for (const y of [-12.6, 12.6]) vents(ctx, -42.5, y, 4, 2.2, 1.5);
      rivets(ctx, -48.5, -48.5, -12, 1, 0.35); rivets(ctx, -48.5, -48.5, 12, 1, 0.35);
    });
    bevel(ctx, block, 0.8);

    // The hold: dark steel, a band in the empire colour across its stern
    // end, chevrons at the bow
    const hold = () => sym(ctx, HOLD);
    hold(); fillShadowed(ctx, metal(ctx, -16.5, 16.5, '#68738a'), S);
    inside(ctx, hold, () => {
      ctx.fillStyle = color; ctx.fillRect(-30, -17, 3.4, 34);
      ctx.fillStyle = tone(color, 0.35); ctx.fillRect(-30, -17, 0.5, 34);
      ctx.fillStyle = 'rgba(10,14,24,.35)'; ctx.fillRect(-26.6, -17, 0.4, 34);
      // Side decks along the hatches
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(-26, -16.5, 56, 2.2); ctx.fillRect(-26, 14.3, 56, 2.2);
      rivets(ctx, -24, 28, -15.4, 14, 0.24); rivets(ctx, -24, 28, 15.4, 14, 0.24);
      if (under) {
        for (const x of [-18, -6, 6, 18]) seam(ctx, x, -16.5, x, 16.5);
        seam(ctx, -33, 0, 34, 0);
        vents(ctx, -10, 8, 4, 3, 1.6); vents(ctx, -10, -8, 4, 3, 1.6);
        return;
      }
      // Walkway down the middle
      ctx.fillStyle = 'rgba(20,24,34,.45)'; ctx.fillRect(-27, -1.3, 58, 2.6);
      ctx.fillStyle = 'rgba(220,228,240,.28)';
      for (let x = -26; x < 30; x += 2) ctx.fillRect(x, -0.9, 1, 1.8);
      // Chevrons at the bow end
      ctx.fillStyle = tone(color, 0.15);
      for (const x of [28.4, 31]) {
        poly(ctx, [[x, -6], [x + 1.6, 0], [x, 6], [x - 1.2, 6], [x + 0.4, 0], [x - 1.2, -6]]); ctx.fill();
      }
    });
    bevel(ctx, hold, 0.9);

    if (!under) {
      // Hatch covers: ochre lids with ribs along them and a hinge on the
      // walkway side
      for (const x of HATCHES) for (const s of [-1, 1]) {
        const y0 = s < 0 ? -HATCH_OUT : HATCH_IN, y1 = y0 + HATCH_OUT - HATCH_IN;
        const h = () => hatchPath(ctx, x, s);
        h(); fillShadowed(ctx, metal(ctx, y0, y1, '#b9853f'), S * 0.6);
        inside(ctx, h, () => {
          for (let k = 1; k < 4; k++) {
            const y = y0 + (y1 - y0) * k / 4;
            ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x - HATCH_LEN / 2, y, HATCH_LEN, 0.5);
            ctx.fillStyle = 'rgba(255,240,210,.22)'; ctx.fillRect(x - HATCH_LEN / 2, y + 0.5, HATCH_LEN, 0.3);
          }
          seam(ctx, x, y0, x, y1, 0.3);
          ctx.fillStyle = tone('#b9853f', -0.4);
          ctx.fillRect(x - HATCH_LEN / 2, s < 0 ? y1 - 0.8 : y0, HATCH_LEN, 0.8);
        });
        bevel(ctx, h, 0.45);
      }
      // Gantry crane across the hold, its trolley on one side
      const gantry = () => { ctx.beginPath(); ctx.rect(8.2, -16, 2.6, 32); };
      gantry(); fillShadowed(ctx, metal(ctx, -16, 16, '#d0a640'), S * 0.8);
      inside(ctx, gantry, () => {
        ctx.strokeStyle = 'rgba(30,26,18,.6)'; ctx.lineWidth = 0.3;
        ctx.beginPath();
        for (let y = -16, i = 0; y < 16; y += 2.6, i++) { ctx.moveTo(8.2, y); ctx.lineTo(10.8, y + 2.6); }
        ctx.stroke();
      });
      bevel(ctx, gantry, 0.4);
      const trolley = () => { ctx.beginPath(); ctx.roundRect(7.4, -9.4, 4.2, 4.6, 0.8); };
      trolley(); fillShadowed(ctx, metal(ctx, -9.4, -4.8, '#596274'), S * 0.5); bevel(ctx, trolley, 0.35);
      ctx.fillStyle = '#ffb45c'; ctx.beginPath(); ctx.arc(9.5, -7.1, 0.5, 0, TAU); ctx.fill();
    }

    // Bridge raised on the engine block: a house with a band in the empire
    // colour, the windscreen looking forward over the hold
    const br = () => sym(ctx, BRIDGE);
    br(); fillShadowed(ctx, metal(ctx, -8, 8, '#bcc5d3'), S);
    inside(ctx, br, () => {
      ctx.fillStyle = color; ctx.fillRect(-46.4, -8, 2.4, 16);
      ctx.fillStyle = tone(color, -0.4); ctx.fillRect(-44, -8, 0.3, 16);
      seam(ctx, -38.6, -8, -38.6, 8, 0.3);
      rivets(ctx, -43, -35, -7, 5, 0.26); rivets(ctx, -43, -35, 7, 5, 0.26);
      if (under) return;
      ctx.fillStyle = 'rgba(16,20,32,.3)';
      ctx.fillRect(-42.6, -4.6, 2.6, 2); ctx.fillRect(-42.6, 2.6, 2.6, 2);
      const hatch = () => { ctx.beginPath(); ctx.arc(-36.4, 0, 1.6, 0, TAU); };
      hatch(); ctx.fillStyle = metal(ctx, -1.6, 1.6, '#8f9aae'); ctx.fill(); bevel(ctx, hatch, 0.3);
    });
    bevel(ctx, br, 0.8);
    if (under) return;
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const x = -37.6 + i * 2.1, y = s * 6.4;
      ctx.fillStyle = '#0f1b2a'; ctx.fillRect(x - 0.15, y - 0.7, 1.6, 1.4);
      ctx.fillStyle = i === 1 ? '#ffe2a0' : '#8fe0ff'; ctx.fillRect(x, y - 0.55, 1.3, 1.1);
    }
    const win = () => sym(ctx, SCREEN);
    glass(ctx, win, -33.8, -29.4, -6.9, 6.9, '#7fe0ff', S);
    ctx.strokeStyle = 'rgba(14,18,28,.95)'; ctx.lineWidth = 0.9; win(); ctx.stroke();
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    for (const y of [-4.4, -1.5, 1.5, 4.4]) { ctx.moveTo(-33.8, y); ctx.lineTo(-29.4 - Math.abs(y) * 0.3, y * 0.95); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,214,140,.85)';
    for (const y of [-3, 0, 3]) ctx.fillRect(-33.3, y - 0.3, 1, 0.6);
    // A small dish on the engine block behind the bridge
    const dish = () => { ctx.beginPath(); ctx.ellipse(-47.6, 10.6, 1.5, 2.2, 0, 0, TAU); };
    dish(); ctx.fillStyle = metal(ctx, 8.4, 12.8, '#e4eaf3'); ctx.fill(); bevel(ctx, dish, 0.3);
  }
};
