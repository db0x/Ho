// Schiffsgrafik. Jede Klasse hat eine eigene Silhouette; gezeichnet wird
// nach rechts zeigend, der Aufrufer rotiert.

function hullGradient(ctx, len) {
  const g = ctx.createLinearGradient(0, -len * 0.4, 0, len * 0.4);
  g.addColorStop(0, '#e9f0fb');
  g.addColorStop(0.42, '#aab6cc');
  g.addColorStop(0.55, '#7a8699');
  g.addColorStop(1, '#3c4557');
  return g;
}

function engineGlow(ctx, x, y, r, phase, color = '#8fdcff') {
  const flick = 0.75 + 0.25 * Math.sin(phase * 6.0 + x);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * flick);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.28, color);
  g.addColorStop(1, 'rgba(60,150,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * flick, 0, Math.PI * 2); ctx.fill();
}

function outline(ctx, w = 1) {
  ctx.lineWidth = w;
  ctx.strokeStyle = 'rgba(6,10,20,.85)';
  ctx.stroke();
}

/* --------------------------------------------------------------- Späher */
function drawScout(ctx, L, color, phase) {
  const W = L * 0.34;
  // Antriebsfackel
  engineGlow(ctx, -L * 0.52, 0, L * 0.3, phase);
  // Fluegel
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-L * 0.18, 0);
  ctx.lineTo(-L * 0.42, -W * 0.95);
  ctx.lineTo(-L * 0.02, -W * 0.16);
  ctx.closePath();
  ctx.moveTo(-L * 0.18, 0);
  ctx.lineTo(-L * 0.42, W * 0.95);
  ctx.lineTo(-L * 0.02, W * 0.16);
  ctx.closePath();
  ctx.fill(); outline(ctx, 0.8);
  // Rumpf: schlanker Pfeil
  ctx.fillStyle = hullGradient(ctx, L);
  ctx.beginPath();
  ctx.moveTo(L * 0.52, 0);
  ctx.lineTo(L * 0.05, -W * 0.3);
  ctx.lineTo(-L * 0.46, -W * 0.22);
  ctx.lineTo(-L * 0.46, W * 0.22);
  ctx.lineTo(L * 0.05, W * 0.3);
  ctx.closePath();
  ctx.fill(); outline(ctx, 0.9);
  // Kanzel
  ctx.fillStyle = 'rgba(120,230,255,.9)';
  ctx.beginPath(); ctx.ellipse(L * 0.18, 0, L * 0.11, W * 0.17, 0, 0, Math.PI * 2); ctx.fill();
}

/* ---------------------------------------------------------------- Jäger */
function drawFighter(ctx, L, color, phase) {
  const W = L * 0.46;
  engineGlow(ctx, -L * 0.5, -W * 0.33, L * 0.26, phase);
  engineGlow(ctx, -L * 0.5, W * 0.33, L * 0.26, phase + 1.3);
  // Deltafluegel
  const wg = ctx.createLinearGradient(0, -W, 0, W);
  wg.addColorStop(0, color);
  wg.addColorStop(0.5, '#55607a');
  wg.addColorStop(1, color);
  ctx.fillStyle = wg;
  ctx.beginPath();
  ctx.moveTo(L * 0.3, 0);
  ctx.lineTo(-L * 0.24, -W);
  ctx.lineTo(-L * 0.44, -W * 0.72);
  ctx.lineTo(-L * 0.2, -W * 0.18);
  ctx.lineTo(-L * 0.2, W * 0.18);
  ctx.lineTo(-L * 0.44, W * 0.72);
  ctx.lineTo(-L * 0.24, W);
  ctx.closePath();
  ctx.fill(); outline(ctx, 1);
  // Waffenpods
  ctx.fillStyle = '#2f3648';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.rect(L * 0.02, s * W * 0.62 - L * 0.045, L * 0.3, L * 0.09);
    ctx.fill(); outline(ctx, 0.7);
    ctx.fillStyle = '#ff7a5c';
    ctx.beginPath(); ctx.arc(L * 0.33, s * W * 0.62, L * 0.035, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2f3648';
  }
  // Rumpf
  ctx.fillStyle = hullGradient(ctx, L);
  ctx.beginPath();
  ctx.moveTo(L * 0.56, 0);
  ctx.lineTo(L * 0.2, -W * 0.3);
  ctx.lineTo(-L * 0.46, -W * 0.34);
  ctx.lineTo(-L * 0.46, W * 0.34);
  ctx.lineTo(L * 0.2, W * 0.3);
  ctx.closePath();
  ctx.fill(); outline(ctx, 1);
  // Kanzel
  const cg = ctx.createLinearGradient(L * 0.05, 0, L * 0.4, 0);
  cg.addColorStop(0, 'rgba(90,200,255,.95)');
  cg.addColorStop(1, 'rgba(220,250,255,.75)');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(L * 0.36, 0);
  ctx.lineTo(L * 0.1, -W * 0.19);
  ctx.lineTo(L * 0.02, 0);
  ctx.lineTo(L * 0.1, W * 0.19);
  ctx.closePath(); ctx.fill();
  // Kielstreifen in Spielerfarbe
  ctx.fillStyle = color;
  ctx.fillRect(-L * 0.42, -L * 0.03, L * 0.3, L * 0.06);
}

/* -------------------------------------------------------------- Satellit */
function drawSatellite(ctx, L, color, phase) {
  const R = L * 0.3;
  // Solarpanele
  ctx.fillStyle = '#39629f';
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * L * 0.34, 0);
    ctx.beginPath(); ctx.rect(-L * 0.16, -R * 1.05, L * 0.32, R * 2.1); ctx.fill();
    outline(ctx, 0.8);
    ctx.strokeStyle = 'rgba(10,16,30,.55)';
    ctx.lineWidth = 0.6;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-L * 0.16, -R * 1.05 + (R * 2.1 / 4) * i);
      ctx.lineTo(L * 0.16, -R * 1.05 + (R * 2.1 / 4) * i);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Mast
  ctx.strokeStyle = '#8a94a8'; ctx.lineWidth = Math.max(1.2, L * 0.07);
  ctx.beginPath(); ctx.moveTo(-L * 0.34, 0); ctx.lineTo(L * 0.34, 0); ctx.stroke();
  // Kern
  ctx.fillStyle = hullGradient(ctx, L);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + Math.PI / 6;
    const px = Math.cos(a) * R, py = Math.sin(a) * R;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill(); outline(ctx, 1);
  // Geschuetzturm
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffb45c';
  ctx.beginPath(); ctx.arc(0, 0, R * 0.17, 0, Math.PI * 2); ctx.fill();
  // Blinklicht
  const blink = 0.5 + 0.5 * Math.sin(phase * 3);
  ctx.fillStyle = `rgba(255,90,80,${0.3 + blink * 0.7})`;
  ctx.beginPath(); ctx.arc(0, -R * 1.05, L * 0.05, 0, Math.PI * 2); ctx.fill();
}

/* -------------------------------------------------------- Kolonieschiff */
function drawColony(ctx, L, color, phase) {
  const W = L * 0.4;
  engineGlow(ctx, -L * 0.52, 0, L * 0.3, phase, '#aaffd0');
  // Frachtpods
  ctx.fillStyle = '#5b6578';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.roundRect(-L * 0.3, s * W * 0.72 - L * 0.1, L * 0.42, L * 0.2, L * 0.07);
    ctx.fill(); outline(ctx, 0.8);
    ctx.fillStyle = color;
    ctx.fillRect(-L * 0.26, s * W * 0.72 - L * 0.03, L * 0.1, L * 0.06);
    ctx.fillStyle = '#5b6578';
  }
  // Streben
  ctx.strokeStyle = '#78839a'; ctx.lineWidth = Math.max(1, L * 0.045);
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(-L * 0.1, s * W * 0.2); ctx.lineTo(-L * 0.1, s * W * 0.72); ctx.stroke();
  }
  // Rumpf: gedrungen, mit Kuppel
  ctx.fillStyle = hullGradient(ctx, L);
  ctx.beginPath();
  ctx.moveTo(L * 0.5, 0);
  ctx.lineTo(L * 0.3, -W * 0.42);
  ctx.lineTo(-L * 0.44, -W * 0.38);
  ctx.lineTo(-L * 0.48, 0);
  ctx.lineTo(-L * 0.44, W * 0.38);
  ctx.lineTo(L * 0.3, W * 0.42);
  ctx.closePath(); ctx.fill(); outline(ctx, 1);
  // Wohnkuppel
  const dg = ctx.createRadialGradient(-L * 0.02, -L * 0.06, 0, 0, 0, L * 0.22);
  dg.addColorStop(0, 'rgba(190,255,220,.95)');
  dg.addColorStop(1, 'rgba(60,140,110,.9)');
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.arc(L * 0.02, 0, L * 0.19, 0, Math.PI * 2); ctx.fill(); outline(ctx, 0.8);
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(-L * 0.17, 0); ctx.lineTo(L * 0.21, 0); ctx.stroke();
}

/* --------------------------------------------------------------- Tanker */
function drawTanker(ctx, L, color, phase) {
  const W = L * 0.42;
  engineGlow(ctx, -L * 0.54, 0, L * 0.26, phase, '#ffd08a');
  // Tanks
  for (const s of [-1, 1]) {
    const tg = ctx.createLinearGradient(0, s * W * 0.6 - L * 0.14, 0, s * W * 0.6 + L * 0.14);
    tg.addColorStop(0, '#dfe6f2');
    tg.addColorStop(0.5, '#98a3b8');
    tg.addColorStop(1, '#4a5366');
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.roundRect(-L * 0.38, s * W * 0.6 - L * 0.14, L * 0.74, L * 0.28, L * 0.14);
    ctx.fill(); outline(ctx, 0.9);
    ctx.strokeStyle = 'rgba(20,28,44,.5)'; ctx.lineWidth = 0.7;
    for (let i = 1; i < 4; i++) {
      const xx = -L * 0.38 + (L * 0.74 / 4) * i;
      ctx.beginPath(); ctx.moveTo(xx, s * W * 0.6 - L * 0.13); ctx.lineTo(xx, s * W * 0.6 + L * 0.13); ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.fillRect(-L * 0.34, s * W * 0.6 - L * 0.04, L * 0.12, L * 0.08);
  }
  // Rückgrat
  ctx.fillStyle = hullGradient(ctx, L);
  ctx.beginPath();
  ctx.moveTo(L * 0.5, 0);
  ctx.lineTo(L * 0.34, -W * 0.2);
  ctx.lineTo(-L * 0.5, -W * 0.17);
  ctx.lineTo(-L * 0.5, W * 0.17);
  ctx.lineTo(L * 0.34, W * 0.2);
  ctx.closePath(); ctx.fill(); outline(ctx, 1);
  ctx.fillStyle = 'rgba(140,220,255,.85)';
  ctx.beginPath(); ctx.ellipse(L * 0.3, 0, L * 0.08, W * 0.12, 0, 0, Math.PI * 2); ctx.fill();
}

const DRAW = {
  scout: drawScout, fighter: drawFighter, satellite: drawSatellite,
  colony: drawColony, tanker: drawTanker
};

/**
 * Zeichnet ein Schiff.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{type:string,x:number,y:number,angle?:number,len?:number,color?:string,phase?:number}} o
 */
export function drawShip(ctx, o) {
  const fn = DRAW[o.type] || drawFighter;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.angle || 0);
  if (o.shadow !== false) {
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
  }
  fn(ctx, o.len || 26, o.color || '#9fb0c8', o.phase || 0);
  ctx.restore();
}

/** Antriebsspur für fliegende Flotten. */
export function drawTrail(ctx, x, y, angle, len, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  const g = ctx.createLinearGradient(-len, 0, 0, 0);
  g.addColorStop(0, 'rgba(120,200,255,0)');
  g.addColorStop(1, 'rgba(160,225,255,.5)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(-4, 0); ctx.stroke();
  ctx.restore();
}

const iconCache = new Map();
/** Symbol für Listen und Baumenues. */
export function shipIcon(type, px = 34, color = '#9fb0c8') {
  const key = type + '|' + px + '|' + color;
  if (iconCache.has(key)) return iconCache.get(key);
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = px * dpr; cv.height = px * dpr;
  cv.style.width = px + 'px'; cv.style.height = px + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  drawShip(ctx, { type, x: px / 2, y: px / 2, angle: -Math.PI / 2, len: px * 0.82, color, phase: 0.4, shadow: false });
  iconCache.set(key, cv);
  return cv;
}
