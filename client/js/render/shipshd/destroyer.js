// Ship profile: destroyer (see ../shipshd.js).
import {
  RED, GREEN, WHITE, tone, TAU, fillShadowed, bevel, poly, nozzle, inside, metal, seam, sym
} from './kit.js';

// The capital ship in plan view, after a battlestar - the same outline as
// the map icon (ships.js). In front a broad head whose flanks curve out
// backwards, a darker deck set into it; behind it the dominant midsection
// with bulging, ribbed flanks, the emblem and gun turrets all along; at the
// stern two short engine nacelles with machinery in
// between. Far out on the sides two curved landing decks, open at both
// ends, held by three broad cross struts. Everything is covered in armor
// plates of slightly different shades. The empire color sits where the
// original carries its red: short marks at the tip of the head and at the
// front ends of the landing decks - plus a narrow band across the head and
// the ring of the emblem.
const DD = {
  pod: 16.4,                // offset of the landing decks from the axis
  nacelle: 6.6,             // offset of the engine nacelles
  struts: [[7.6, 10.8], [-3.4, -0.2], [-14.4, -11.2]]
};
/** Half width of the head: broad at the tip, curving out backwards. */
const ddHeadHalf = x => 6.6 + 6.8 * (1 - ((x - 18) / 33) ** 2);
/** Half width of the midsection: a bulge in the middle. */
const ddMidHalf = x => 9.2 + 1.5 * Math.sin(Math.PI * (19 - x) / 46);
function ddHead() {
  const pts = [[52.2, 0], [52, -4.8], [51.2, -6.2]];
  for (let x = 50; x >= 18; x -= 2) pts.push([x, -ddHeadHalf(x)]);
  pts.push([18, 0]);
  return pts;
}
function ddMid() {
  const pts = [[19, 0]];
  for (let x = 19; x >= -27; x -= 2.3) pts.push([x, -ddMidHalf(x)]);
  pts.push([-27, -ddMidHalf(-27)], [-27, 0]);
  return pts;
}
/**
 * Outline of a landing deck around its center line c, s the side: the outer
 * flank bulges, the inner one only slightly; both ends stay open as bays.
 */
function ddPod(c, s) {
  const out = [], inn = [];
  for (let i = 0; i <= 22; i++) {
    const t = i / 22, x = 17 - 44 * t, b = Math.sin(Math.PI * t);
    out.push([x, c + s * (1.9 + 1.6 * b)]);
    inn.push([x, c - s * (1.9 + 1.0 * b)]);
  }
  return [...out, ...inn.reverse()];
}

export const destroyer = {
  r: 58,
  engines: [
    { x: -38, y: -6.6, r: 3.2, color: '#8fd0ff' },
    { x: -38, y: 6.6, r: 3.2, color: '#8fd0ff' },
    { x: -35.5, y: -1.5, r: 1.2, color: '#8fd0ff' },
    { x: -35.5, y: 1.5, r: 1.2, color: '#8fd0ff' }
  ],
  lights: [
    { x: 16.6, y: -18.1, r: 0.7, color: RED, off: 0 },
    { x: 16.6, y: 18.1, r: 0.7, color: GREEN, off: 0 },
    { x: -32.5, y: 0, r: 0.6, color: WHITE, off: 1.4, strobe: true }
  ],
  body(ctx, color, S) {
    // Fixed random numbers: every destroyer is patched the same way.
    let seed = 1979;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const BASE = '#8d9299';
    /** Matte, weathered gray - not the polished metal of the small ships. */
    const matte = (y0, y1, base = BASE) => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, tone(base, 0.28));
      g.addColorStop(0.45, base);
      g.addColorStop(1, tone(base, -0.38));
      return g;
    };
    /** Armor plates of other shades, scattered over an area. */
    const plates = (x0, x1, y0, y1, n, big = 1) => {
      for (let i = 0; i < n; i++) {
        const w = (1.2 + rnd() * 4.5) * big, h = (0.8 + rnd() * 2.6) * big;
        const x = x0 + rnd() * (x1 - x0 - w), y = y0 + rnd() * (y1 - y0 - h);
        const f = rnd();
        ctx.fillStyle = f < 0.55 ? `rgba(14,18,28,${0.06 + rnd() * 0.2})` : `rgba(255,255,255,${0.04 + rnd() * 0.14})`;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(14,18,28,.22)'; ctx.lineWidth = 0.12; ctx.strokeRect(x, y, w, h);
      }
    };
    /** Grime: many tiny specks, darker and lighter, so nothing looks new. */
    const grime = (x0, x1, y0, y1, n) => {
      for (let i = 0; i < n; i++) {
        const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0), r = 0.15 + rnd() * 0.5;
        ctx.fillStyle = rnd() < 0.7 ? `rgba(20,22,26,${0.08 + rnd() * 0.18})` : `rgba(255,255,255,${0.06 + rnd() * 0.1})`;
        ctx.fillRect(x, y, r * (1 + rnd() * 2), r);
      }
    };
    /** Ribs across the length: a dark and a light line per rib. */
    const ribs = (x0, x1, y0, y1, step) => {
      for (let x = x0; x < x1; x += step) {
        ctx.fillStyle = 'rgba(14,18,28,.34)'; ctx.fillRect(x, y0, step * 0.32, y1 - y0);
        ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(x + step * 0.32, y0, step * 0.14, y1 - y0);
      }
    };
    /** A turret: a dome on a dark ring with two barrels pointing forward. */
    const turret = (x, y, r = 1.15) => {
      ctx.fillStyle = '#3d434e';
      ctx.fillRect(x, y - r * 0.5, r * 2.4, r * 0.28); ctx.fillRect(x, y + r * 0.22, r * 2.4, r * 0.28);
      ctx.fillStyle = 'rgba(14,18,28,.55)'; ctx.beginPath(); ctx.arc(x, y, r * 1.25, 0, TAU); ctx.fill();
      const p = () => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); };
      p(); fillShadowed(ctx, matte(y - r, y + r, '#9aa0a8'), S * 0.3); bevel(ctx, p, 0.25);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, TAU); ctx.fill();
    };
    /** A bay opening at the end of a landing deck, with its approach lights. */
    const bay = (xEdge, dir, c) => {
      const x1 = xEdge - dir * 3.4;
      ctx.fillStyle = '#20252c';
      poly(ctx, [[xEdge, c - 1.9], [x1, c - 1.2], [x1, c + 1.2], [xEdge, c + 1.9]]); ctx.fill();
      ctx.strokeStyle = 'rgba(200,210,220,.35)'; ctx.lineWidth = 0.2; ctx.stroke();
      ctx.fillStyle = 'rgba(255,200,120,.7)';
      for (const d of [-0.8, 0, 0.8]) ctx.fillRect(Math.min(xEdge, x1) + 0.6, c + d - 0.12, 2.2, 0.24);
    };

    // Engines: a big nozzle per nacelle, two small ones in between
    for (const s of [-1, 1]) nozzle(ctx, -38, s * DD.nacelle, 3.2, 3.2);
    for (const s of [-1, 1]) nozzle(ctx, -35.5, s * 1.5, 1.2, 1.8);

    // Machinery between the nacelles: pipes and housings, left open
    const mach = () => { ctx.beginPath(); ctx.rect(-35, -3, 12, 6); };
    mach(); fillShadowed(ctx, '#4b515b', S * 0.4);
    inside(ctx, mach, () => {
      for (const [y, h] of [[-2.2, 0.7], [-0.9, 0.5], [0.4, 0.8], [1.7, 0.5]]) {
        ctx.fillStyle = metal(ctx, y, y + h, '#8a919c'); ctx.fillRect(-34, y, 10, h);
      }
      for (const x of [-30.5]) {
        ctx.fillStyle = '#5f6672'; ctx.fillRect(x, -2.8, 1.6, 5.6);
        ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(x, -2.8, 0.3, 5.6);
      }
      for (const [x, y] of [[-33, -1.6], [-33, 1.6]]) {
        ctx.fillStyle = '#6c7380'; ctx.beginPath(); ctx.arc(x, y, 0.8, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(10,14,24,.6)'; ctx.lineWidth = 0.2; ctx.stroke();
      }
    });
    bevel(ctx, mach, 0.4);

    // Engine nacelles: short, rounded in front, a darker ring towards the nozzle
    for (const s of [-1, 1]) {
      const c = s * DD.nacelle;
      const nac = () => {
        ctx.beginPath();
        ctx.moveTo(-35, c - 4); ctx.lineTo(-27, c - 4.4);
        ctx.quadraticCurveTo(-22, c - 4.4, -22, c); ctx.quadraticCurveTo(-22, c + 4.4, -27, c + 4.4);
        ctx.lineTo(-35, c + 4); ctx.closePath();
      };
      nac(); fillShadowed(ctx, matte(c - 4.4, c + 4.4), S);
      inside(ctx, nac, () => {
        plates(-34, -23, c - 4.4, c + 4.4, 12);
        grime(-35, -22, c - 4.4, c + 4.4, 60);
        seam(ctx, -34.5, c - s * 2.2, -24, c - s * 2.2, 0.2);
        ctx.fillStyle = 'rgba(14,18,28,.3)'; ctx.fillRect(-35, c - 4.4, 2.6, 8.8);
        for (const y of [-2.1, 0, 2.1]) {
          ctx.fillStyle = '#5d636e'; ctx.beginPath(); ctx.arc(-31.2, c + y, 0.65, 0, TAU); ctx.fill();
        }
      });
      bevel(ctx, nac, 0.8);
    }

    // Silver tubes between neighboring struts, from the hull out to the landing decks
    for (let i = 1; i < DD.struts.length; i++) {
      const x0 = Math.max(...DD.struts[i]), x1 = Math.min(...DD.struts[i - 1]);
      for (const s of [-1, 1]) for (const y of [11.4, 12.9]) {
        const p = () => { ctx.beginPath(); ctx.roundRect(x0 - 0.2, s * y - 0.32, x1 - x0 + 0.4, 0.64, 0.32); };
        p(); fillShadowed(ctx, metal(ctx, s * y - 0.32, s * y + 0.32, '#c9d0da'), S * 0.3);
      }
    }

    // Landing decks: curved, ribbed along the outer flank, open at both ends
    for (const s of [-1, 1]) {
      const c = s * DD.pod;
      const pod = () => poly(ctx, ddPod(c, s));
      pod(); fillShadowed(ctx, matte(c - 3.5, c + 3.5), S);
      inside(ctx, pod, () => {
        ribs(-27, 17, s < 0 ? c - 3.6 : c + 0.4, s < 0 ? c - 0.4 : c + 3.6, 0.9);
        plates(-24, 14, s < 0 ? c - 0.6 : c - 3, s < 0 ? c + 3 : c + 0.6, 30, 0.8);
        grime(-27, 17, c - 3.6, c + 3.6, 170);
        seam(ctx, -26, c, 16, c, 0.18);
        for (const x of [-16, -5, 6]) seam(ctx, x, c - 3.6, x, c + 3.6, 0.22);
        bay(17, 1, c);
        bay(-27, -1, c);
        // Empire color at the front corners, where the original has its red
        ctx.fillStyle = color;
        ctx.fillRect(14.4, c - 3.6, 1.7, 1.9); ctx.fillRect(14.4, c + 1.7, 1.7, 1.9);
      });
      bevel(ctx, pod, 0.6);
    }

    // Midsection: bulging, ribbed flanks, plates and a raised spine
    const mid = () => sym(ctx, ddMid());
    mid(); fillShadowed(ctx, matte(-10.7, 10.7), S);
    inside(ctx, mid, () => {
      for (const s of [-1, 1]) ribs(-27, 19, s < 0 ? -10.8 : 5.4, s < 0 ? -5.4 : 10.8, 1);
      plates(-26, 18, -5.4, 5.4, 40, 0.8);
      grime(-27, 19, -10.8, 10.8, 280);
      seam(ctx, -27, -5.4, 19, -5.4, 0.25); seam(ctx, -27, 5.4, 19, 5.4, 0.25);
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(-26, -1.8, 44, 3.6);
      seam(ctx, -26, -1.8, 18, -1.8, 0.16); seam(ctx, -26, 1.8, 18, 1.8, 0.16);
      ctx.fillStyle = 'rgba(14,18,28,.25)'; ctx.fillRect(-9.6, -3, 4.4, 6);
    });
    bevel(ctx, mid, 0.9);
    // Guns all along: the two groups of four on the spine, rows along both
    // ribbed flanks, one on each engine nacelle
    for (const x of [5.4, 2.8]) for (const y of [-1.4, 1.4]) turret(x, y);
    for (const x of [-17.4, -20]) for (const y of [-1.4, 1.4]) turret(x, y);
    for (const x of [16.4, 13, 3.8, -7.8, -20.6, -25]) for (const y of [-7.9, 7.9]) turret(x, y, 1);
    for (const y of [-DD.nacelle, DD.nacelle]) turret(-28.6, y, 1);
    // The emblem: a ring in the empire color around a golden center
    const em = () => { ctx.beginPath(); ctx.arc(14.6, 0, 2.9, 0, TAU); };
    em(); fillShadowed(ctx, color, S * 0.3);
    ctx.fillStyle = '#e8c547'; ctx.beginPath(); ctx.arc(14.6, 0, 1.85, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(120,80,10,.7)'; ctx.lineWidth = 0.2;
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; ctx.beginPath(); ctx.moveTo(14.6, 0); ctx.lineTo(14.6 + Math.cos(a) * 1.8, Math.sin(a) * 1.8); ctx.stroke(); }
    bevel(ctx, em, 0.3);

    // The head: broad, plates all over, the darker deck set into it
    const head = () => sym(ctx, ddHead());
    head(); fillShadowed(ctx, matte(-13.4, 13.4), S);
    inside(ctx, head, () => {
      plates(18, 52, -13.4, 13.4, 80);
      grime(18, 52, -13.4, 13.4, 360);
      // Seams following the curved flanks
      for (const k of [0.35, 0.7]) {
        ctx.beginPath();
        for (let x = 18; x <= 51; x += 1.5) ctx.lineTo(x, -ddHeadHalf(x) * k);
        ctx.strokeStyle = 'rgba(14,18,28,.45)'; ctx.lineWidth = 0.22; ctx.stroke();
        ctx.beginPath();
        for (let x = 18; x <= 51; x += 1.5) ctx.lineTo(x, ddHeadHalf(x) * k);
        ctx.stroke();
      }
      for (const x of [26, 33, 40, 46]) seam(ctx, x, -13.4, x, 13.4, 0.22);
      // Recessed deck with ribs
      const deck = () => { ctx.beginPath(); ctx.rect(19, -4.6, 15, 9.2); };
      deck(); ctx.fillStyle = '#5d636d'; ctx.fill();
      inside(ctx, deck, () => ribs(19, 34, -4.6, 4.6, 0.8));
      ctx.strokeStyle = 'rgba(14,18,28,.6)'; ctx.lineWidth = 0.3; deck(); ctx.stroke();
      ctx.fillStyle = 'rgba(14,18,28,.3)'; ctx.fillRect(36, -3.4, 4.5, 6.8);
      // Empire color: a narrow band across the head, two short marks at the tip
      ctx.fillStyle = color;
      ctx.fillRect(42.2, -13.4, 1.2, 26.8);
      ctx.fillStyle = tone(color, 0.35); ctx.fillRect(42.2, -13.4, 0.35, 26.8);
      ctx.fillStyle = 'rgba(10,14,24,.35)'; ctx.fillRect(43.2, -13.4, 0.2, 26.8);
      ctx.fillStyle = color;
      ctx.fillRect(46.4, -6.6, 1.3, 2.6); ctx.fillRect(46.4, 4, 1.3, 2.6);
    });
    bevel(ctx, head, 0.9);
    // Gun turrets along both flanks of the head
    for (const x of [22.5, 28.5, 34.5]) for (const y of [-8.6, 8.6]) turret(x, y);

    // Cross struts over everything, from one landing deck to the other
    const reach = DD.pod + 3.4;
    for (const [x0, x1] of DD.struts) {
      const x = Math.min(x0, x1), w = Math.abs(x1 - x0);
      const st = () => { ctx.beginPath(); ctx.rect(x, -reach, w, reach * 2); };
      st(); fillShadowed(ctx, matte(-reach, reach, '#999ea5'), S * 0.8);
      inside(ctx, st, () => {
        for (const s of [-1, 1]) {
          // Window grids where the struts reach out over the gap
          const y0 = s < 0 ? -13.7 : 10.6;
          ctx.fillStyle = '#2f353e'; ctx.fillRect(x + 0.5, y0, w - 1, 3.1);
          ctx.strokeStyle = '#757c88'; ctx.lineWidth = 0.18;
          for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(x + 0.5, y0 + k * 0.78); ctx.lineTo(x + w - 0.5, y0 + k * 0.78); ctx.stroke(); }
        }
        for (const y of [-16, -8, 0, 8, 16]) seam(ctx, x, y, x + w, y, 0.2);
        plates(x, x + w, -reach, reach, 10, 0.5);
        grime(x, x + w, -reach, reach, 60);
      });
      bevel(ctx, st, 0.5);
    }
  }
};
