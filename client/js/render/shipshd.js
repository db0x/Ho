// Ausführliche Schiffsgrafik für große Darstellungen (Steckbrief). Gleiche
// Silhouetten wie ships.js, aber mit Lichtkanten, Panellinien, Nieten,
// Düsen, Positionslichtern und Abgasflammen. Gezeichnet wird nach rechts
// zeigend in einem Raster von 100 Einheiten Schiffslänge; der Aufrufer
// rotiert.

const TAU = Math.PI * 2;

/* ------------------------------------------------------------- Helfer */

function hexRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16));
}
const rgba = (hex, a) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; };
/** Farbe heller (f > 0) oder dunkler (f < 0). */
function tone(hex, f) {
  const c = hexRgb(hex).map(v => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Spiegelbildlicher Umriss: Punkte der oberen Hälfte von vorn nach hinten. */
function sym(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i][1] === 0 && (i === 0 || i === pts.length - 1)) continue;
    ctx.lineTo(pts[i][0], -pts[i][1]);
  }
  ctx.closePath();
}

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** Metall quer zur Längsachse: oben angestrahlt, unten im Schatten. */
function metal(ctx, y0, y1, base = '#9aa6bb') {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, tone(base, 0.75));
  g.addColorStop(0.18, tone(base, 0.35));
  g.addColorStop(0.5, base);
  g.addColorStop(0.62, tone(base, -0.18));
  g.addColorStop(1, tone(base, -0.62));
  return g;
}

/** Füllt den aktuellen Pfad mit Schlagschatten auf das, was darunter liegt. */
function fillShadowed(ctx, style, S) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 5 * S;
  ctx.shadowOffsetY = 1.2 * S;
  ctx.fillStyle = style;
  ctx.fill();
  ctx.restore();
}

/**
 * Lichtkante und Kontur: innen eine helle Linie an der Oberkante, eine dunkle
 * an der Unterkante, außen ein feiner dunkler Rand.
 */
function bevel(ctx, pathFn, w = 0.9) {
  ctx.save();
  pathFn(); ctx.clip();
  ctx.lineWidth = w * 1.6;
  ctx.save(); ctx.translate(0, w * 0.9); pathFn();
  ctx.strokeStyle = 'rgba(255,255,255,.42)'; ctx.stroke(); ctx.restore();
  ctx.save(); ctx.translate(0, -w * 0.9); pathFn();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke(); ctx.restore();
  ctx.restore();
  pathFn();
  ctx.lineWidth = w * 0.55;
  ctx.strokeStyle = 'rgba(5,8,16,.9)';
  ctx.stroke();
}

/** Innerhalb des Pfades zeichnen. */
function inside(ctx, pathFn, fn) {
  ctx.save(); pathFn(); ctx.clip(); fn(); ctx.restore();
}

/** Panellinie: dunkle Fuge mit heller Kante daneben. */
function seam(ctx, x0, y0, x1, y1, w = 0.35) {
  ctx.lineCap = 'round';
  ctx.lineWidth = w;
  ctx.strokeStyle = 'rgba(10,14,24,.6)';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.beginPath(); ctx.moveTo(x0 + w * 0.8, y0 + w * 0.8); ctx.lineTo(x1 + w * 0.8, y1 + w * 0.8); ctx.stroke();
}

function rivets(ctx, x0, x1, y, n, r = 0.38) {
  for (let i = 0; i < n; i++) {
    const x = x0 + (x1 - x0) * (n === 1 ? 0.5 : i / (n - 1));
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath(); ctx.arc(x + r * 0.3, y + r * 0.3, r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(235,242,255,.75)';
    ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, TAU); ctx.fill();
  }
}

/** Lüftungsschlitze. */
function vents(ctx, x, y, n, len = 4, gap = 1.4) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = 'rgba(8,12,22,.75)';
    ctx.beginPath(); ctx.roundRect(x + i * gap, y - len / 2, gap * 0.5, len, 0.25); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    ctx.fillRect(x + i * gap + gap * 0.5, y - len / 2, 0.2, len);
  }
}

/** Glas mit Tiefe und Spiegelung. */
function glass(ctx, pathFn, x0, x1, y0, y1, tint = '#5fd2ff', S = 1) {
  ctx.save();
  pathFn();
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, tone(tint, 0.65));
  g.addColorStop(0.35, tint);
  g.addColorStop(1, tone(tint, -0.7));
  fillShadowed(ctx, g, S * 0.4);
  inside(ctx, pathFn, () => {
    // Innenleben: dunkler Kern, damit es nach Tiefe aussieht
    const k = ctx.createRadialGradient((x0 + x1) / 2, (y0 + y1) / 2 + (y1 - y0) * 0.2, 0,
      (x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) * 0.6);
    k.addColorStop(0, 'rgba(0,20,40,.0)');
    k.addColorStop(1, 'rgba(0,10,30,.45)');
    ctx.fillStyle = k; ctx.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
    // Spiegelstreifen
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath();
    ctx.ellipse(x0 + (x1 - x0) * 0.55, y0 + (y1 - y0) * 0.24, (x1 - x0) * 0.32, (y1 - y0) * 0.09, -0.08, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath();
    ctx.ellipse(x0 + (x1 - x0) * 0.3, y0 + (y1 - y0) * 0.68, (x1 - x0) * 0.1, (y1 - y0) * 0.05, 0, 0, TAU);
    ctx.fill();
  });
  bevel(ctx, pathFn, 0.6);
  ctx.restore();
}

/** Düse: Glocke mit Heißring, zeigt nach hinten (-x). */
function nozzle(ctx, x, y, r, len = r * 1.1) {
  const p = () => {
    ctx.beginPath();
    ctx.moveTo(x + len, y - r * 0.62);
    ctx.quadraticCurveTo(x + len * 0.3, y - r * 0.7, x, y - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x + len * 0.3, y + r * 0.7, x + len, y + r * 0.62);
    ctx.closePath();
  };
  p();
  ctx.fillStyle = metal(ctx, y - r, y + r, '#6d7486');
  ctx.fill();
  inside(ctx, p, () => {
    for (let i = 1; i <= 3; i++) seam(ctx, x + len * i / 4, y - r, x + len * i / 4, y + r, 0.25);
  });
  bevel(ctx, p, 0.5);
  // Öffnung mit Glut
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, '#fff3d6');
  g.addColorStop(0.45, '#ff9a4a');
  g.addColorStop(1, '#4a1a10');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.28, r * 0.9, 0, 0, TAU); ctx.fill();
  ctx.lineWidth = 0.35; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke();
}

/** Raketenartiger Anbau: Waffe, Sensor, Tank. */
function capsule(ctx, x0, x1, y, h, base, S) {
  const p = () => { ctx.beginPath(); ctx.roundRect(x0, y - h, x1 - x0, h * 2, h); };
  p(); fillShadowed(ctx, metal(ctx, y - h, y + h, base), S);
  bevel(ctx, p, 0.6);
  return p;
}

/* ------------------------------------------------- Bewegte Teile */

/** Abgasflamme hinter einer Düse bei (x, y), Radius r. */
function plume(ctx, x, y, r, color, t, seed) {
  const f = 0.86 + 0.1 * Math.sin(t * 9.3 + seed) + 0.05 * Math.sin(t * 23.7 + seed * 2.1);
  const len = r * 4.2 * f;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // weicher Schein um die Düse
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
  halo.addColorStop(0, rgba(color, 0.5 * f));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, TAU); ctx.fill();
  // Flamme: außen farbig, innen weiß
  for (const [w, l, a, c] of [[1, 1, 0.75, color], [0.55, 0.62, 0.95, '#ffffff']]) {
    const g = ctx.createLinearGradient(x, 0, x - len * l, 0);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(0.35, rgba(color, a * 0.7));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y - r * w * 0.85);
    ctx.quadraticCurveTo(x - len * l * 0.35, y - r * w * 1.05, x - len * l, y);
    ctx.quadraticCurveTo(x - len * l * 0.35, y + r * w * 1.05, x, y + r * w * 0.85);
    ctx.closePath();
    ctx.fill();
  }
  // Schockdiamanten
  for (let i = 1; i <= 3; i++) {
    const dx = x - len * 0.16 * i - Math.sin(t * 5 + i) * 0.4;
    ctx.fillStyle = `rgba(255,255,255,${0.32 / i})`;
    ctx.beginPath(); ctx.ellipse(dx, y, r * 0.3 / Math.sqrt(i), r * 0.22, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/** Positionslicht; `strobe` blitzt kurz, sonst pulsiert es sanft. */
function light(ctx, x, y, r, color, t, off, strobe) {
  const a = strobe
    ? Math.pow(Math.max(0, Math.sin(t * 2.6 + off)), 14)
    : 0.55 + 0.45 * Math.sin(t * 1.9 + off);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * (strobe ? 6 : 3.6));
  g.addColorStop(0, rgba(color, 0.9 * a));
  g.addColorStop(0.25, rgba(color, 0.35 * a));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * (strobe ? 6 : 3.6), 0, TAU); ctx.fill();
  ctx.restore();
  ctx.fillStyle = rgba(color, 0.45 + 0.55 * a);
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

const RED = '#ff4a3d', GREEN = '#3dff8a', WHITE = '#ffffff';

/* --------------------------------------------------------------- Späher */
const scout = {
  r: 58,
  engines: [{ x: -50, y: 0, r: 5.2, color: '#7fd8ff' }],
  lights: [
    { x: -36, y: -31, r: 0.9, color: RED, off: 0 },
    { x: -36, y: 31, r: 0.9, color: GREEN, off: 0 },
    { x: -40, y: 0, r: 0.8, color: WHITE, off: 1, strobe: true }
  ],
  body(ctx, color, S) {
    nozzle(ctx, -50, 0, 5.2, 6);
    // Flügel
    for (const s of [-1, 1]) {
      const w = () => poly(ctx, [[-6, s * 5], [-30, s * 29], [-38, s * 31], [-40, s * 28], [-30, s * 7]]);
      w();
      const g = ctx.createLinearGradient(0, s * 5, 0, s * 31);
      g.addColorStop(0, tone(color, s < 0 ? 0.25 : -0.1));
      g.addColorStop(1, tone(color, s < 0 ? -0.15 : -0.45));
      fillShadowed(ctx, g, S);
      inside(ctx, w, () => {
        seam(ctx, -14, s * 9, -34, s * 28);
        seam(ctx, -20, s * 6, -24, s * 17);
        ctx.fillStyle = 'rgba(255,255,255,.12)';
        poly(ctx, [[-6, s * 5], [-30, s * 29], [-31, s * 27], [-9, s * 6]]); ctx.fill();
        // Warnstreifen an der Spitze
        ctx.fillStyle = 'rgba(20,24,34,.7)';
        for (let i = 0; i < 3; i++) { poly(ctx, [[-33 - i * 2.4, s * 25], [-31.6 - i * 2.4, s * 25], [-34.6 - i * 2.4, s * 31], [-36 - i * 2.4, s * 31]]); ctx.fill(); }
      });
      bevel(ctx, w, 0.7);
      // Flügelspitzen-Pod
      capsule(ctx, -40, -28, s * 30, 1.6, '#8a96aa', S);
    }
    // Canards
    for (const s of [-1, 1]) {
      const c = () => poly(ctx, [[30, s * 4], [22, s * 10.5], [19, s * 10], [22, s * 4]]);
      c(); fillShadowed(ctx, tone(color, -0.1), S * 0.5); bevel(ctx, c, 0.5);
    }
    // Rumpf
    const hull = () => sym(ctx, [[56, 0], [44, -2.6], [26, -5.6], [4, -7.6], [-30, -7.2], [-46, -5.6], [-48, 0]]);
    hull(); fillShadowed(ctx, metal(ctx, -8, 8), S);
    inside(ctx, hull, () => {
      seam(ctx, 34, -8, 34, 8); seam(ctx, 8, -8, 8, 8); seam(ctx, -16, -8, -16, 8); seam(ctx, -36, -8, -36, 8);
      seam(ctx, -36, -3.6, 8, -3.6, 0.3);
      // Kennstreifen
      ctx.fillStyle = color;
      ctx.fillRect(-34, 3.2, 40, 1.5);
      ctx.fillStyle = tone(color, -0.4); ctx.fillRect(-34, 4.7, 40, 0.5);
      vents(ctx, -30, -1.2, 6, 2.6, 1.6);
      rivets(ctx, -14, 6, -5.6, 7, 0.3);
      rivets(ctx, -14, 6, 5.6, 7, 0.3);
      // Sensorspitze
      ctx.fillStyle = 'rgba(30,36,50,.85)';
      sym(ctx, [[56, 0], [48, -1.8], [46, 0]]); ctx.fill();
    });
    bevel(ctx, hull, 0.9);
    // Kanzel
    const cab = () => { ctx.beginPath(); ctx.ellipse(24, 0, 12, 3.4, 0, 0, TAU); };
    glass(ctx, cab, 12, 36, -3.4, 3.4, '#58d4ff', S);
    // Antenne
    ctx.strokeStyle = '#c8d2e4'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-36, -2.5); ctx.stroke();
    ctx.fillStyle = '#e8eef8'; ctx.beginPath(); ctx.arc(-36, -2.5, 0.6, 0, TAU); ctx.fill();
  }
};

/* ---------------------------------------------------------------- Jäger */
const fighter = {
  r: 62,
  engines: [
    { x: -50, y: -13, r: 5.6, color: '#7fd8ff' },
    { x: -50, y: 13, r: 5.6, color: '#7fd8ff' }
  ],
  lights: [
    { x: -27, y: -45, r: 1, color: RED, off: 0 },
    { x: -27, y: 45, r: 1, color: GREEN, off: 0 },
    { x: -44, y: 0, r: 0.9, color: WHITE, off: 0.6, strobe: true }
  ],
  body(ctx, color, S) {
    for (const s of [-1, 1]) nozzle(ctx, -50, s * 13, 5.6, 6);
    // Deltaflügel
    for (const s of [-1, 1]) {
      const w = () => poly(ctx, [[28, s * 6], [-20, s * 45], [-30, s * 46], [-42, s * 40], [-36, s * 16]]);
      w();
      const g = ctx.createLinearGradient(0, s * 6, 0, s * 46);
      g.addColorStop(0, tone(color, s < 0 ? 0.2 : -0.15));
      g.addColorStop(1, tone(color, s < 0 ? -0.2 : -0.5));
      fillShadowed(ctx, g, S);
      inside(ctx, w, () => {
        // dunkles Innenfeld
        ctx.fillStyle = 'rgba(20,26,40,.45)';
        poly(ctx, [[10, s * 14], [-18, s * 36], [-32, s * 36], [-30, s * 18]]); ctx.fill();
        seam(ctx, 10, s * 14, -18, s * 36); seam(ctx, -18, s * 36, -32, s * 36); seam(ctx, -30, s * 18, -32, s * 36);
        seam(ctx, 0, s * 12, -36, s * 30, 0.3);
        // Klappen an der Hinterkante
        seam(ctx, -39, s * 30, -34, s * 18, 0.3);
        // Winkel als Abzeichen
        ctx.fillStyle = 'rgba(255,255,255,.7)';
        poly(ctx, [[-8, s * 25], [-14, s * 30], [-16, s * 30], [-10, s * 25], [-16, s * 20], [-14, s * 20]]); ctx.fill();
        // Vorderkante glänzt
        ctx.fillStyle = 'rgba(255,255,255,.14)';
        poly(ctx, [[28, s * 6], [-20, s * 45], [-21, s * 43], [25, s * 7]]); ctx.fill();
        rivets(ctx, -4, -26, s * 32, 5, 0.3);
      });
      bevel(ctx, w, 0.8);
      // Lenkflugkörper unter dem Flügel
      for (const [yy, x0] of [[30, -16], [38, -22]]) {
        const m = capsule(ctx, x0, x0 + 14, s * yy, 1.3, '#c9d0dc', S * 0.6);
        inside(ctx, m, () => { ctx.fillStyle = '#e04a3a'; ctx.fillRect(x0 + 11.5, s * yy - 2, 3, 4); });
        ctx.fillStyle = '#3a4152'; poly(ctx, [[x0, s * yy - 2.2], [x0 + 2.5, s * yy - 1], [x0 + 2.5, s * yy + 1], [x0, s * yy + 2.2]]); ctx.fill();
      }
      // Kanonenpod
      const pod = capsule(ctx, -6, 26, s * 22, 2.6, '#5d6578', S);
      inside(ctx, pod, () => { seam(ctx, 6, s * 22 - 3, 6, s * 22 + 3, 0.3); vents(ctx, -3, s * 22, 4, 2, 1.3); });
      ctx.fillStyle = '#2a303d'; ctx.fillRect(26, s * 22 - 0.8, 12, 1.6);
      ctx.fillStyle = '#ff8a5c'; ctx.beginPath(); ctx.arc(38.4, s * 22, 1, 0, TAU); ctx.fill();
      // Triebwerksgondel
      const nac = () => { ctx.beginPath(); ctx.roundRect(-46, s * 13 - 6, 32, 12, 4); };
      nac(); fillShadowed(ctx, metal(ctx, s * 13 - 6, s * 13 + 6, '#8893a8'), S);
      inside(ctx, nac, () => {
        seam(ctx, -38, s * 13 - 6, -38, s * 13 + 6); seam(ctx, -26, s * 13 - 6, -26, s * 13 + 6);
        ctx.fillStyle = 'rgba(10,14,22,.8)'; ctx.fillRect(-16.5, s * 13 - 4.5, 2.5, 9);
        vents(ctx, -36, s * 13, 5, 3.2, 1.6);
      });
      bevel(ctx, nac, 0.7);
    }
    // Rumpf
    const hull = () => sym(ctx, [[60, 0], [46, -3.4], [24, -8.6], [-8, -11.4], [-40, -10.4], [-48, -8], [-48, 0]]);
    hull(); fillShadowed(ctx, metal(ctx, -12, 12), S);
    inside(ctx, hull, () => {
      for (const x of [40, 14, -12, -32]) seam(ctx, x, -12, x, 12);
      seam(ctx, -44, -5, 14, -5, 0.3); seam(ctx, -44, 5, 14, 5, 0.3);
      // Rückenstreifen in Reichsfarbe
      ctx.fillStyle = color; ctx.fillRect(-44, -2, 50, 4);
      ctx.fillStyle = tone(color, 0.45); ctx.fillRect(-44, -2, 50, 0.6);
      ctx.fillStyle = tone(color, -0.45); ctx.fillRect(-44, 1.4, 50, 0.6);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 3; i++) poly(ctx, [[-28 + i * 4, -2], [-26 + i * 4, 0], [-28 + i * 4, 2], [-29.4 + i * 4, 2], [-27.4 + i * 4, 0], [-29.4 + i * 4, -2]]), ctx.fill();
      rivets(ctx, -30, 10, -8, 9, 0.32); rivets(ctx, -30, 10, 8, 9, 0.32);
      ctx.fillStyle = 'rgba(30,36,50,.85)';
      sym(ctx, [[60, 0], [52, -2.2], [50, 0]]); ctx.fill();
    });
    bevel(ctx, hull, 1);
    // Kanzel mit Rahmen
    const cab = () => sym(ctx, [[42, 0], [34, -3.2], [20, -5.4], [10, -4.6], [8, 0]]);
    glass(ctx, cab, 8, 42, -5.4, 5.4, '#5fd2ff', S);
    ctx.strokeStyle = 'rgba(40,46,60,.9)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(22, -5.3); ctx.lineTo(22, 5.3); ctx.stroke();
  }
};

/* -------------------------------------------------------------- Satellit */
const satellite = {
  r: 60,
  engines: [],
  lights: [
    { x: -53, y: -27, r: 0.9, color: RED, off: 0 },
    { x: 53, y: 27, r: 0.9, color: GREEN, off: 0 },
    { x: 0, y: -27, r: 0.9, color: WHITE, off: 0.3, strobe: true }
  ],
  body(ctx, color, S) {
    // Gitterträger
    for (const s of [-1, 1]) {
      ctx.strokeStyle = '#8a95aa'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(s * 14, -2.4); ctx.lineTo(s * 24, -2.4); ctx.moveTo(s * 14, 2.4); ctx.lineTo(s * 24, 2.4); ctx.stroke();
      ctx.lineWidth = 0.5; ctx.beginPath();
      for (let i = 0; i < 5; i++) { ctx.moveTo(s * (14 + i * 2), i % 2 ? 2.4 : -2.4); ctx.lineTo(s * (16 + i * 2), i % 2 ? -2.4 : 2.4); }
      ctx.stroke();
    }
    // Solarflügel
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
        // Glanz quer über das Panel
        const sh = ctx.createLinearGradient(x0, -h, x0 + wdt, h);
        sh.addColorStop(0.3, 'rgba(255,255,255,0)');
        sh.addColorStop(0.45, 'rgba(200,230,255,.28)');
        sh.addColorStop(0.55, 'rgba(255,255,255,0)');
        ctx.fillStyle = sh; ctx.fillRect(x0, -h, wdt, h * 2);
      });
      ctx.strokeStyle = '#aeb8cc'; ctx.lineWidth = 0.8; frame(); ctx.stroke();
      // Gelenk
      capsule(ctx, s < 0 ? -26 : 22, s < 0 ? -22 : 26, 0, 3.2, '#7a8599', S * 0.5);
    }
    // Radiatorrippen
    for (const s of [-1, 1]) for (let i = -2; i <= 2; i++) {
      const f = () => { ctx.beginPath(); ctx.rect(i * 4 - 1.2, s < 0 ? -30 : 18, 2.4, 12); };
      f(); fillShadowed(ctx, metal(ctx, -2, 2, '#c3cad6'), S * 0.4); bevel(ctx, f, 0.4);
    }
    // Kern: Achteck
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
      // Warnstreifen
      ctx.fillStyle = '#e8c547';
      ctx.fillRect(-16, 9, 6, 2);
      ctx.fillStyle = '#1e2230';
      for (let i = 0; i < 3; i++) ctx.fillRect(-16 + i * 2, 9, 1, 2);
    });
    bevel(ctx, core, 0.9);
    // Sensorschüssel
    ctx.save();
    ctx.translate(-9, -11);
    const dish = () => { ctx.beginPath(); ctx.ellipse(0, 0, 4.4, 3, -0.6, 0, TAU); };
    dish();
    const dg = ctx.createRadialGradient(-1, -1, 0, 0, 0, 4.4);
    dg.addColorStop(0, '#f4f7fc'); dg.addColorStop(1, '#7c879b');
    fillShadowed(ctx, dg, S * 0.5); bevel(ctx, dish, 0.4);
    ctx.strokeStyle = '#3a4152'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(2.2, -1.6); ctx.stroke();
    ctx.restore();
    // Geschützturm mit Zwillingsrohr
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

/* -------------------------------------------------------- Kolonieschiff */
const colony = {
  r: 58,
  engines: [
    { x: -52, y: 0, r: 6.5, color: '#9dffc8' },
    { x: -46, y: -10.5, r: 3.2, color: '#9dffc8' },
    { x: -46, y: 10.5, r: 3.2, color: '#9dffc8' }
  ],
  lights: [
    { x: -6, y: -40, r: 1, color: RED, off: 0 },
    { x: -6, y: 40, r: 1, color: GREEN, off: 0 },
    { x: 40, y: 0, r: 0.9, color: WHITE, off: 1.4, strobe: true }
  ],
  body(ctx, color, S) {
    nozzle(ctx, -52, 0, 6.5, 6.5);
    for (const s of [-1, 1]) nozzle(ctx, -46, s * 10.5, 3.2, 4);
    // Streben zu den Frachtmodulen
    for (const s of [-1, 1]) for (const x of [-22, 4]) {
      const st = () => { ctx.beginPath(); ctx.rect(x - 1.6, s < 0 ? -26 : 12, 3.2, 14); };
      st(); fillShadowed(ctx, metal(ctx, -2, 2, '#7d889c'), S * 0.5); bevel(ctx, st, 0.4);
      ctx.strokeStyle = 'rgba(10,14,24,.5)'; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(x - 1.6, s * 13); ctx.lineTo(x + 1.6, s * 25); ctx.stroke();
    }
    // Frachtmodule
    for (const s of [-1, 1]) {
      const pod = capsule(ctx, -36, 16, s * 31, 8.5, '#8994a8', S);
      inside(ctx, pod, () => {
        for (let x = -28; x <= 8; x += 6) {
          ctx.fillStyle = 'rgba(10,14,24,.35)'; ctx.fillRect(x, s * 31 - 9, 1.4, 18);
          ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x + 1.4, s * 31 - 9, 0.4, 18);
        }
        ctx.fillStyle = color; ctx.fillRect(-35, s * 31 - 9, 5, 18);
        ctx.fillStyle = tone(color, -0.4); ctx.fillRect(-30.4, s * 31 - 9, 0.6, 18);
        // Luke
        ctx.fillStyle = 'rgba(20,26,38,.7)'; ctx.beginPath(); ctx.arc(11, s * 31, 3, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 0.3; ctx.stroke();
        rivets(ctx, -24, 4, s * 31 - s * 6.2, 6, 0.3);
      });
    }
    // Rumpf
    const hull = () => sym(ctx, [[50, 0], [44, -7], [32, -14.5], [-30, -15], [-44, -12], [-50, -6], [-50, 0]]);
    hull(); fillShadowed(ctx, metal(ctx, -15, 15), S);
    inside(ctx, hull, () => {
      for (const x of [30, -22, -36]) seam(ctx, x, -16, x, 16);
      seam(ctx, -44, -9, 30, -9, 0.3); seam(ctx, -44, 9, 30, 9, 0.3);
      // Fensterreihen, teils beleuchtet
      for (const s of [-1, 1]) for (let i = 0; i < 9; i++) {
        const x = -32 + i * 2.6 + (i > 3 ? 16 : 0);
        if (x > 28) continue;
        const an = (i * 7 + (s > 0 ? 3 : 0)) % 5 !== 0;
        ctx.fillStyle = an ? '#ffe7a3' : '#2a3142';
        ctx.fillRect(x, s * 11.6 - 0.8, 1.5, 1.6);
        if (an) { ctx.fillStyle = 'rgba(255,220,140,.25)'; ctx.fillRect(x - 0.4, s * 11.6 - 1.2, 2.3, 2.4); }
      }
      vents(ctx, -42, -3, 4, 3, 1.5); vents(ctx, -42, 3, 4, 3, 1.5);
      rivets(ctx, 24, 36, -6, 4, 0.3); rivets(ctx, 24, 36, 6, 4, 0.3);
    });
    bevel(ctx, hull, 1);
    // Brücke
    const br = () => sym(ctx, [[47, 0], [43, -3.6], [37, -4.4], [36, 0]]);
    glass(ctx, br, 36, 47, -4.4, 4.4, '#7fe0ff', S);
    // Wohnkuppel mit Park
    const dome = () => { ctx.beginPath(); ctx.arc(4, 0, 15, 0, TAU); };
    ctx.save();
    dome(); fillShadowed(ctx, '#173a2c', S);
    inside(ctx, dome, () => {
      const lawn = ctx.createRadialGradient(4, 0, 0, 4, 0, 15);
      lawn.addColorStop(0, '#4fae5e'); lawn.addColorStop(1, '#1d5a35');
      ctx.fillStyle = lawn; ctx.fillRect(-12, -16, 32, 32);
      // Wasser, Wege, Bäume, Häuser
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
      // Glaswölbung: Rippen, Spiegelung, Randschatten
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
  }
};

/* --------------------------------------------------------------- Tanker */
const tanker = {
  r: 60,
  engines: [
    { x: -54, y: 0, r: 5.6, color: '#ffc27a' },
    { x: -44, y: -22, r: 2.6, color: '#ffc27a' },
    { x: -44, y: 22, r: 2.6, color: '#ffc27a' }
  ],
  lights: [
    { x: 30, y: -35, r: 1, color: RED, off: 0 },
    { x: 30, y: 35, r: 1, color: GREEN, off: 0 },
    { x: -46, y: 0, r: 0.9, color: WHITE, off: 2, strobe: true }
  ],
  body(ctx, color, S) {
    nozzle(ctx, -54, 0, 5.6, 6);
    for (const s of [-1, 1]) nozzle(ctx, -44, s * 22, 2.6, 3);
    // Leitungen zwischen Tanks und Rückgrat
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
        // Spannbänder
        for (let x = -30; x <= 28; x += 11.6) {
          const b = ctx.createLinearGradient(0, y - 12, 0, y + 12);
          b.addColorStop(0, '#c7cfdc'); b.addColorStop(0.5, '#6a7488'); b.addColorStop(1, '#262c3a');
          ctx.fillStyle = b; ctx.fillRect(x, y - 12, 2.2, 24);
          ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(x, y - 12, 0.4, 24);
          rivets(ctx, x + 1.1, x + 1.1, y - 7, 1, 0.3);
          rivets(ctx, x + 1.1, x + 1.1, y + 7, 1, 0.3);
        }
        // Reichsfarbe und Warnfeld
        ctx.fillStyle = color; ctx.fillRect(-38, y - 12, 6, 24);
        ctx.fillStyle = tone(color, 0.4); ctx.fillRect(-38, y - 12, 6, 2);
        ctx.save();
        ctx.beginPath(); ctx.rect(22, y - 12, 6, 24); ctx.clip();
        ctx.fillStyle = '#e8c547'; ctx.fillRect(22, y - 12, 6, 24);
        ctx.fillStyle = '#1f2330';
        for (let k = -4; k < 8; k++) poly(ctx, [[22, y - 12 + k * 4], [28, y - 18 + k * 4], [28, y - 16 + k * 4], [22, y - 10 + k * 4]]), ctx.fill();
        ctx.restore();
        // breiter Glanz längs
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.beginPath(); ctx.roundRect(-36, y - 9.5, 70, 2.6, 1.3); ctx.fill();
        // Schrift-Andeutung
        ctx.fillStyle = 'rgba(30,36,50,.55)';
        for (let i = 0; i < 4; i++) ctx.fillRect(-12 + i * 3.2, y + 3, 2.2, 3);
      });
      bevel(ctx, tk, 0.8);
      // Ventilkappen
      for (const x of [-43, 37]) {
        const v = () => { ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); };
        v(); fillShadowed(ctx, metal(ctx, y - 3, y + 3, '#7f8a9e'), S * 0.4); bevel(ctx, v, 0.35);
        ctx.fillStyle = '#d54a3a'; ctx.beginPath(); ctx.arc(x, y, 1.2, 0, TAU); ctx.fill();
      }
    }
    // Rückgrat
    const sp = () => sym(ctx, [[50, 0], [44, -4], [34, -6.2], [-48, -5.6], [-54, -4], [-54, 0]]);
    sp(); fillShadowed(ctx, metal(ctx, -6.5, 6.5), S);
    inside(ctx, sp, () => {
      for (const x of [30, 10, -10, -30]) seam(ctx, x, -7, x, 7);
      // Rohrleitung oben auf dem Rückgrat
      ctx.fillStyle = '#c8cfdb'; ctx.fillRect(-44, -3.2, 70, 1.4);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-44, -1.8, 70, 0.4);
      for (let x = -40; x < 26; x += 8) { ctx.fillStyle = '#6b7488'; ctx.fillRect(x, -3.6, 1, 2.2); }
      vents(ctx, -48, 2.2, 5, 2.4, 1.4);
    });
    bevel(ctx, sp, 0.9);
    // Brücke
    const br = () => sym(ctx, [[48, 0], [42, -3.4], [34, -4], [32, 0]]);
    glass(ctx, br, 32, 48, -4, 4, '#7fd2ff', S);
  }
};

const TYPES = { scout, fighter, satellite, colony, tanker };

/* ------------------------------------------------------------ Ausgabe */

const cache = new Map();

/** Standbild eines Typs in Gerätepixeln, einmal gezeichnet. */
function sprite(type, len, color) {
  const key = `${type}|${len}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const def = TYPES[type] || fighter;
  const S = len / 100;
  const half = Math.ceil(def.r * S + 12);
  const cv = document.createElement('canvas');
  cv.width = cv.height = half * 2;
  const g = cv.getContext('2d');
  g.translate(half, half);
  g.scale(S, S);
  def.body(g, color, S);
  const sp = { canvas: cv, half };
  if (cache.size > 40) cache.clear();
  cache.set(key, sp);
  return sp;
}

/**
 * Zeichnet ein Schiff in voller Ausführung.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{type:string,x:number,y:number,angle?:number,len:number,color?:string,phase?:number}} o
 *   phase in Sekunden - treibt Flammen und Lichter
 */
export function drawShipHD(ctx, o) {
  const def = TYPES[o.type] || fighter;
  const len = Math.round(o.len);
  const color = o.color || '#9fb0c8';
  const t = o.phase || 0;
  const S = len / 100;
  const sp = sprite(o.type, len, color);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.angle || 0);
  ctx.save();
  ctx.scale(S, S);
  def.engines.forEach((e, i) => plume(ctx, e.x, e.y, e.r, e.color, t, i * 1.7));
  ctx.restore();
  ctx.drawImage(sp.canvas, -sp.half, -sp.half);
  ctx.scale(S, S);
  for (const l of def.lights) light(ctx, l.x, l.y, l.r, l.color, t, l.off, l.strobe);
  ctx.restore();
}
