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

// Während ein Sprite gebaut wird, sammelt dieser Puffer die bewegten Teile,
// statt sie ins Standbild zu zeichnen - siehe drawShip.
let collect = null;

function paintGlow(ctx, x, y, r, phase, color) {
  const flick = 0.75 + 0.25 * Math.sin(phase * 6.0 + x);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * flick);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.28, color);
  g.addColorStop(1, 'rgba(60,150,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * flick, 0, Math.PI * 2); ctx.fill();
}

function engineGlow(ctx, x, y, r, phase, color = '#8fdcff') {
  // Die Fackel flackert und liegt unter dem Rumpf: beim Sprite-Bau nur vormerken.
  if (collect) { collect.push({ over: false, run: (c, ph) => paintGlow(c, x, y, r, ph + phase, color) }); return; }
  paintGlow(ctx, x, y, r, phase, color);
}

function paintBlink(ctx, x, y, r, phase) {
  const blink = 0.5 + 0.5 * Math.sin(phase * 3);
  ctx.fillStyle = `rgba(255,90,80,${0.3 + blink * 0.7})`;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function blinkLight(ctx, x, y, r, phase) {
  // Das Blinklicht sitzt obenauf, sonst wie die Fackel.
  if (collect) { collect.push({ over: true, run: (c, ph) => paintBlink(c, x, y, r, ph + phase) }); return; }
  paintBlink(ctx, x, y, r, phase);
}

function outline(ctx, w = 1) {
  ctx.lineWidth = w;
  ctx.strokeStyle = 'rgba(6,10,20,.85)';
  ctx.stroke();
}

/* -------------------------------------------------------- Feinheiten */
// Details, die auch bei 20-30 px Kartengroesse noch tragen: Fugen,
// Lichtkanten, Duesen, Positionslichter. Strichstaerken haengen an der
// Schiffslaenge, damit sie beim Zoomen mitwachsen.

const fein = L => Math.max(0.45, L * 0.022);

function linie(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
}

/** Eingravierte Fuge: dunkle Linie, darunter eine helle Kante. */
function fuge(ctx, L, pts) {
  const w = fein(L);
  ctx.save();
  ctx.lineCap = 'round';
  linie(ctx, pts);
  ctx.strokeStyle = 'rgba(8,12,24,.6)'; ctx.lineWidth = w; ctx.stroke();
  ctx.translate(0, w * 0.9);
  linie(ctx, pts);
  ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = w * 0.7; ctx.stroke();
  ctx.restore();
}

/** Lichtkante: das Licht kommt von oben, also eine helle Linie am oberen Rand. */
function kante(ctx, L, pts, a = 0.55) {
  ctx.save();
  ctx.lineCap = 'round';
  linie(ctx, pts);
  ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = fein(L) * 0.9; ctx.stroke();
  ctx.restore();
}

/** Duesengehaeuse am Heck: dunkler Kragen mit hellem Rand. */
function duese(ctx, L, x, y, r) {
  ctx.save();
  ctx.fillStyle = '#1b2130';
  ctx.beginPath(); ctx.roundRect(x - r * 0.9, y - r, r * 1.3, r * 2, r * 0.35); ctx.fill();
  ctx.strokeStyle = 'rgba(190,205,230,.55)'; ctx.lineWidth = fein(L) * 0.8; ctx.stroke();
  ctx.fillStyle = 'rgba(150,220,255,.5)';
  ctx.beginPath(); ctx.ellipse(x - r * 0.9, y, r * 0.18, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Positionslicht mit kleinem Hof - rot links (backbord), gruen rechts. */
function positionslicht(ctx, L, x, y, farbe) {
  const r = Math.max(0.7, L * 0.03);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, farbe);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill();
}
const BACKBORD = '#ff4a3d', STEUERBORD = '#3dff8a';

/** Glanzpunkt auf Glas. */
function glanz(ctx, x, y, rx, ry) {
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, -0.4, 0, Math.PI * 2); ctx.fill();
}

/* --------------------------------------------------------------- Späher */
function drawScout(ctx, L, color, phase) {
  const W = L * 0.34;
  // Antriebsfackel
  engineGlow(ctx, -L * 0.54, 0, L * 0.3, phase);
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
  // Fluegelholme
  for (const s of [-1, 1]) fuge(ctx, L, [[-L * 0.12, s * W * 0.2], [-L * 0.36, s * W * 0.8]]);
  kante(ctx, L, [[-L * 0.04, -W * 0.18], [-L * 0.4, -W * 0.9]], 0.4);
  // Duese
  duese(ctx, L, -L * 0.45, 0, W * 0.2);
  // Rumpf: schlanker Pfeil
  ctx.fillStyle = hullGradient(ctx, L);
  ctx.beginPath();
  ctx.moveTo(L * 0.52, 0);
  ctx.lineTo(L * 0.05, -W * 0.3);
  ctx.lineTo(-L * 0.44, -W * 0.22);
  ctx.lineTo(-L * 0.44, W * 0.22);
  ctx.lineTo(L * 0.05, W * 0.3);
  ctx.closePath();
  ctx.fill(); outline(ctx, 0.9);
  kante(ctx, L, [[L * 0.46, -W * 0.04], [L * 0.05, -W * 0.25], [-L * 0.4, -W * 0.18]]);
  // Panelfugen und Farbband am Bug
  fuge(ctx, L, [[-L * 0.06, -W * 0.24], [-L * 0.06, W * 0.24]]);
  fuge(ctx, L, [[-L * 0.26, -W * 0.22], [-L * 0.26, W * 0.22]]);
  fuge(ctx, L, [[-L * 0.06, 0], [-L * 0.4, 0]]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(L * 0.4, -W * 0.08); ctx.lineTo(L * 0.34, -W * 0.13);
  ctx.lineTo(L * 0.34, W * 0.13); ctx.lineTo(L * 0.4, W * 0.08); ctx.closePath(); ctx.fill();
  // Kanzel
  ctx.fillStyle = 'rgba(120,230,255,.9)';
  ctx.beginPath(); ctx.ellipse(L * 0.18, 0, L * 0.11, W * 0.17, 0, 0, Math.PI * 2); ctx.fill();
  outline(ctx, fein(L) * 0.8);
  glanz(ctx, L * 0.2, -W * 0.07, L * 0.035, W * 0.05);
  // Positionslichter an den Fluegelspitzen
  positionslicht(ctx, L, -L * 0.4, -W * 0.9, BACKBORD);
  positionslicht(ctx, L, -L * 0.4, W * 0.9, STEUERBORD);
}

/* ---------------------------------------------------------------- Jäger */
function drawFighter(ctx, L, color, phase) {
  const W = L * 0.46;
  engineGlow(ctx, -L * 0.52, -W * 0.33, L * 0.26, phase);
  engineGlow(ctx, -L * 0.52, W * 0.33, L * 0.26, phase + 1.3);
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
  // Fluegelplatten und Klappen an der Hinterkante
  for (const s of [-1, 1]) {
    fuge(ctx, L, [[L * 0.08, s * W * 0.32], [-L * 0.3, s * W * 0.84]]);
    fuge(ctx, L, [[-L * 0.08, s * W * 0.3], [-L * 0.36, s * W * 0.74]]);
    ctx.fillStyle = 'rgba(10,14,26,.45)';
    ctx.beginPath();
    ctx.moveTo(-L * 0.3, s * W * 0.78); ctx.lineTo(-L * 0.4, s * W * 0.7);
    ctx.lineTo(-L * 0.26, s * W * 0.4); ctx.lineTo(-L * 0.2, s * W * 0.45); ctx.closePath(); ctx.fill();
  }
  kante(ctx, L, [[L * 0.26, -W * 0.04], [-L * 0.22, -W * 0.94]], 0.45);
  // Waffenpods mit Lauf
  for (const s of [-1, 1]) {
    const y = s * W * 0.62;
    ctx.strokeStyle = '#9aa6bb'; ctx.lineWidth = Math.max(0.6, L * 0.025);
    ctx.beginPath(); ctx.moveTo(L * 0.3, y); ctx.lineTo(L * 0.44, y); ctx.stroke();
    ctx.fillStyle = '#2f3648';
    ctx.beginPath();
    ctx.roundRect(L * 0.02, y - L * 0.045, L * 0.3, L * 0.09, L * 0.03);
    ctx.fill(); outline(ctx, 0.7);
    kante(ctx, L, [[L * 0.04, y - L * 0.03], [L * 0.29, y - L * 0.03]], 0.35);
    ctx.fillStyle = '#ff7a5c';
    ctx.beginPath(); ctx.arc(L * 0.33, y, L * 0.035, 0, Math.PI * 2); ctx.fill();
  }
  // Duesen
  for (const s of [-1, 1]) duese(ctx, L, -L * 0.44, s * W * 0.33, W * 0.11);
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
  kante(ctx, L, [[L * 0.5, -W * 0.03], [L * 0.2, -W * 0.26], [-L * 0.42, -W * 0.3]]);
  // Lufteinlaesse neben der Kanzel
  ctx.fillStyle = '#141a28';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(L * 0.04, s * W * 0.2); ctx.lineTo(-L * 0.1, s * W * 0.27);
    ctx.lineTo(-L * 0.1, s * W * 0.17); ctx.closePath(); ctx.fill();
  }
  // Panelfugen auf dem Rumpf
  fuge(ctx, L, [[-L * 0.14, -W * 0.3], [-L * 0.14, W * 0.3]]);
  fuge(ctx, L, [[-L * 0.32, -W * 0.32], [-L * 0.32, W * 0.32]]);
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
  outline(ctx, fein(L) * 0.8);
  fuge(ctx, L, [[L * 0.1, -W * 0.17], [L * 0.1, W * 0.17]]);
  glanz(ctx, L * 0.2, -W * 0.07, L * 0.04, W * 0.035);
  // Kielstreifen in Spielerfarbe
  ctx.fillStyle = color;
  ctx.fillRect(-L * 0.42, -L * 0.03, L * 0.3, L * 0.06);
  // Positionslichter
  positionslicht(ctx, L, -L * 0.24, -W * 0.97, BACKBORD);
  positionslicht(ctx, L, -L * 0.24, W * 0.97, STEUERBORD);
}

/* -------------------------------------------------------------- Satellit */
function drawSatellite(ctx, L, color, phase) {
  const R = L * 0.3;
  // Solarpanele: Rahmen, Zellenraster, Glanz
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * L * 0.34, 0);
    const pg = ctx.createLinearGradient(0, -R * 1.05, 0, R * 1.05);
    pg.addColorStop(0, '#5a86c8');
    pg.addColorStop(0.5, '#32568e');
    pg.addColorStop(1, '#1f3866');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.rect(-L * 0.16, -R * 1.05, L * 0.32, R * 2.1); ctx.fill();
    outline(ctx, 0.8);
    ctx.strokeStyle = 'rgba(10,16,30,.6)';
    ctx.lineWidth = fein(L) * 0.8;
    for (let i = 1; i < 6; i++) {
      const yy = -R * 1.05 + (R * 2.1 / 6) * i;
      ctx.beginPath(); ctx.moveTo(-L * 0.16, yy); ctx.lineTo(L * 0.16, yy); ctx.stroke();
    }
    for (const xx of [-L * 0.053, L * 0.053]) {
      ctx.beginPath(); ctx.moveTo(xx, -R * 1.05); ctx.lineTo(xx, R * 1.05); ctx.stroke();
    }
    kante(ctx, L, [[-L * 0.15, -R * 1.02], [L * 0.15, -R * 1.02]], 0.45);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath();
    ctx.moveTo(-L * 0.16, -R * 1.05); ctx.lineTo(L * 0.02, -R * 1.05);
    ctx.lineTo(-L * 0.16, -R * 0.2); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // Mast mit Gelenken
  ctx.strokeStyle = '#8a94a8'; ctx.lineWidth = Math.max(1.2, L * 0.07);
  ctx.beginPath(); ctx.moveTo(-L * 0.34, 0); ctx.lineTo(L * 0.34, 0); ctx.stroke();
  ctx.fillStyle = '#5b6578';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.arc(s * L * 0.18, 0, L * 0.05, 0, Math.PI * 2); ctx.fill(); outline(ctx, fein(L));
  }
  // Antenne mit Schuessel
  ctx.strokeStyle = '#aab6cc'; ctx.lineWidth = fein(L);
  ctx.beginPath(); ctx.moveTo(0, R * 0.6); ctx.lineTo(0, R * 1.25); ctx.stroke();
  ctx.fillStyle = '#c9d3e4';
  ctx.beginPath(); ctx.ellipse(0, R * 1.28, L * 0.09, L * 0.035, 0, 0, Math.PI * 2); ctx.fill(); outline(ctx, fein(L) * 0.8);
  // Kern
  ctx.fillStyle = hullGradient(ctx, L);
  const sechseck = (r) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + Math.PI / 6;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
  sechseck(R); ctx.fill(); outline(ctx, 1);
  // Innere Fase
  sechseck(R * 0.72);
  ctx.strokeStyle = 'rgba(8,12,24,.45)'; ctx.lineWidth = fein(L); ctx.stroke();
  kante(ctx, L, [[-R * 0.86, -R * 0.5], [0, -R], [R * 0.86, -R * 0.5]], 0.5);
  // Geschuetzturm mit Lauf nach vorn
  ctx.strokeStyle = '#2f3648'; ctx.lineWidth = Math.max(0.9, L * 0.05);
  ctx.beginPath(); ctx.moveTo(R * 0.3, 0); ctx.lineTo(R * 0.95, 0); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2); ctx.fill(); outline(ctx, fein(L));
  ctx.fillStyle = '#ffb45c';
  ctx.beginPath(); ctx.arc(0, 0, R * 0.17, 0, Math.PI * 2); ctx.fill();
  glanz(ctx, -R * 0.12, -R * 0.18, R * 0.1, R * 0.06);
  // Blinklicht
  blinkLight(ctx, 0, -R * 1.05, L * 0.05, phase);
}

/* -------------------------------------------------------- Kolonieschiff */
function drawColony(ctx, L, color, phase) {
  const W = L * 0.4;
  engineGlow(ctx, -L * 0.54, 0, L * 0.3, phase, '#aaffd0');
  // Frachtpods mit Spanten, Farbmarke und erleuchteten Fenstern
  for (const s of [-1, 1]) {
    const y = s * W * 0.72;
    ctx.fillStyle = metallVerlauf(ctx, y - L * 0.1, y + L * 0.1);
    ctx.beginPath();
    ctx.roundRect(-L * 0.3, y - L * 0.1, L * 0.42, L * 0.2, L * 0.07);
    ctx.fill(); outline(ctx, 0.8);
    for (const xx of [-L * 0.13, -L * 0.01]) fuge(ctx, L, [[xx, y - L * 0.09], [xx, y + L * 0.09]]);
    kante(ctx, L, [[-L * 0.26, y - L * 0.075], [L * 0.08, y - L * 0.075]], 0.4);
    ctx.fillStyle = color;
    ctx.fillRect(-L * 0.26, y - L * 0.03, L * 0.1, L * 0.06);
    ctx.fillStyle = '#ffe9a8';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(L * 0.02 + i * L * 0.035, y, Math.max(0.45, L * 0.014), 0, Math.PI * 2); ctx.fill();
    }
  }
  // Streben
  ctx.strokeStyle = '#78839a'; ctx.lineWidth = Math.max(1, L * 0.045);
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(-L * 0.1, s * W * 0.2); ctx.lineTo(-L * 0.1, s * W * 0.72); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(L * 0.06, s * W * 0.25); ctx.lineTo(-L * 0.04, s * W * 0.62);
    ctx.lineWidth = fein(L); ctx.stroke(); ctx.lineWidth = Math.max(1, L * 0.045);
  }
  duese(ctx, L, -L * 0.46, 0, W * 0.22);
  // Rumpf: schmaler Traeger - die Kuppeln sollen links und rechts ueberstehen
  ctx.fillStyle = hullGradient(ctx, L);
  ctx.beginPath();
  ctx.moveTo(L * 0.5, 0);
  ctx.lineTo(L * 0.34, -W * 0.27);
  ctx.lineTo(-L * 0.44, -W * 0.26);
  ctx.lineTo(-L * 0.48, 0);
  ctx.lineTo(-L * 0.44, W * 0.26);
  ctx.lineTo(L * 0.34, W * 0.27);
  ctx.closePath(); ctx.fill(); outline(ctx, 1);
  kante(ctx, L, [[L * 0.46, -W * 0.04], [L * 0.34, -W * 0.23], [-L * 0.42, -W * 0.22]]);
  // Bugkappe in Spielerfarbe
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(L * 0.5, 0); ctx.lineTo(L * 0.42, -W * 0.15); ctx.lineTo(L * 0.42, W * 0.15); ctx.closePath(); ctx.fill();
  // Drei grosse Wohnkuppeln, die ueber den Rumpf ragen - das Kennzeichen
  // des Siedlerschiffs. Von hinten nach vorn, die vordere liegt obenauf.
  for (const x of [-L * 0.29, -L * 0.02, L * 0.25]) wohnkuppel(ctx, L, x, L * 0.165);
  positionslicht(ctx, L, -L * 0.2, -W * 0.82, BACKBORD);
  positionslicht(ctx, L, -L * 0.2, W * 0.82, STEUERBORD);
}

/** Gruene Glaskuppel mit Rippe und Glanz. */
function wohnkuppel(ctx, L, x, r) {
  const dg = ctx.createRadialGradient(x - r * 0.3, -r * 0.35, 0, x, 0, r * 1.1);
  dg.addColorStop(0, 'rgba(200,255,225,.98)');
  dg.addColorStop(0.55, 'rgba(110,200,150,.95)');
  dg.addColorStop(1, 'rgba(40,110,80,.95)');
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.arc(x, 0, r, 0, Math.PI * 2); ctx.fill();
  outline(ctx, Math.max(0.6, L * 0.025));
  ctx.save();
  ctx.beginPath(); ctx.arc(x, 0, r, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.32)'; ctx.lineWidth = fein(L) * 0.7;
  ctx.beginPath(); ctx.ellipse(x, 0, r * 0.45, r, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  glanz(ctx, x - r * 0.3, -r * 0.4, r * 0.32, r * 0.16);
}

/** Grauer Metallverlauf fuer Anbauten, quer zur Laengsachse. */
function metallVerlauf(ctx, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#8d97ab');
  g.addColorStop(0.45, '#5b6578');
  g.addColorStop(1, '#353d4e');
  return g;
}

/* --------------------------------------------------------------- Tanker */
function drawTanker(ctx, L, color, phase) {
  const W = L * 0.42;
  engineGlow(ctx, -L * 0.56, 0, L * 0.26, phase, '#ffd08a');
  // Rohre zwischen Tanks und Rückgrat
  ctx.strokeStyle = '#6c768a'; ctx.lineWidth = Math.max(0.7, L * 0.03);
  for (const s of [-1, 1]) {
    for (const xx of [-L * 0.2, L * 0.16]) {
      ctx.beginPath(); ctx.moveTo(xx, s * W * 0.16); ctx.lineTo(xx, s * W * 0.45); ctx.stroke();
    }
  }
  // Tanks
  for (const s of [-1, 1]) {
    const y = s * W * 0.6;
    const tg = ctx.createLinearGradient(0, y - L * 0.14, 0, y + L * 0.14);
    tg.addColorStop(0, '#dfe6f2');
    tg.addColorStop(0.5, '#98a3b8');
    tg.addColorStop(1, '#4a5366');
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.roundRect(-L * 0.38, y - L * 0.14, L * 0.74, L * 0.28, L * 0.14);
    ctx.fill(); outline(ctx, 0.9);
    for (let i = 1; i < 4; i++) {
      const xx = -L * 0.38 + (L * 0.74 / 4) * i;
      fuge(ctx, L, [[xx, y - L * 0.13], [xx, y + L * 0.13]]);
    }
    // Glanzstreifen und Ventilkappen
    kante(ctx, L, [[-L * 0.3, y - L * 0.08], [L * 0.28, y - L * 0.08]], 0.6);
    ctx.fillStyle = '#c9a64a';
    for (const xx of [-L * 0.39, L * 0.37]) {
      ctx.beginPath(); ctx.arc(xx, y, L * 0.035, 0, Math.PI * 2); ctx.fill(); outline(ctx, fein(L) * 0.7);
    }
    ctx.fillStyle = color;
    ctx.fillRect(-L * 0.34, y - L * 0.04, L * 0.12, L * 0.08);
  }
  duese(ctx, L, -L * 0.48, 0, W * 0.15);
  // Rückgrat
  ctx.fillStyle = hullGradient(ctx, L);
  ctx.beginPath();
  ctx.moveTo(L * 0.5, 0);
  ctx.lineTo(L * 0.34, -W * 0.2);
  ctx.lineTo(-L * 0.5, -W * 0.17);
  ctx.lineTo(-L * 0.5, W * 0.17);
  ctx.lineTo(L * 0.34, W * 0.2);
  ctx.closePath(); ctx.fill(); outline(ctx, 1);
  kante(ctx, L, [[L * 0.46, -W * 0.04], [L * 0.34, -W * 0.16], [-L * 0.46, -W * 0.13]]);
  for (const xx of [L * 0.1, -L * 0.1, -L * 0.3]) fuge(ctx, L, [[xx, -W * 0.16], [xx, W * 0.16]]);
  // Bruecke mit Fensterreihe
  ctx.fillStyle = 'rgba(140,220,255,.85)';
  ctx.beginPath(); ctx.ellipse(L * 0.3, 0, L * 0.08, W * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  outline(ctx, fein(L) * 0.8);
  glanz(ctx, L * 0.31, -W * 0.05, L * 0.025, W * 0.035);
  positionslicht(ctx, L, L * 0.0, -W * 0.88, BACKBORD);
  positionslicht(ctx, L, L * 0.0, W * 0.88, STEUERBORD);
}

const DRAW = {
  scout: drawScout, fighter: drawFighter, satellite: drawSatellite,
  colony: drawColony, tanker: drawTanker
};

/* ------------------------------------------------------------- Sprites */
// Eine Silhouette ändert sich von Bild zu Bild nicht - nur Fackeln und
// Blinklichter bewegen sich. Darum wird das Standbild einmal in ein eigenes
// Canvas gezeichnet und danach nur noch kopiert, so wie es die Planeten
// schon tun. Das spart je Schiff rund sieben Verläufe und ein Dutzend Pfade
// pro Einzelbild.
const shipCache = new Map();
const MAX_SHIPS = 400;

// Länge auf ganze Pixel runden, damit der Zwischenspeicher beim Zoomen nicht
// überläuft. Gröber zu stufen spart kaum etwas: zu einem Zoomstand gibt es
// ohnehin nur zwei Längen, dafür wären die Schiffe sichtbar falsch groß.
function lenStufe(len) {
  return Math.max(4, Math.round(len));
}

function shipSprite(type, len, color, shadow) {
  // In Bildschirmaufloesung vorzeichnen - auf hochaufloesenden Displays
  // waeren die feinen Linien sonst hochskaliert und verwaschen.
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const key = `${type}|${len}|${color}|${shadow ? 1 : 0}|${dpr}`;
  const hit = shipCache.get(key);
  if (hit) return hit;

  const fn = DRAW[type] || drawFighter;
  const pad = 10;                       // Platz für den Schlagschatten (Blur 6, Versatz 2)
  const size = Math.ceil(len * 1.3) + pad * 2;
  const leinwand = () => {
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * dpr);
    return c;
  };

  // Bewegte Teile sammeln statt zeichnen; die Phase ist dabei 0, sodass in
  // anim nur der Versatz je Fackel steckt.
  const roh = leinwand();
  const g = roh.getContext('2d');
  g.scale(dpr, dpr);
  g.translate(size / 2, size / 2);
  const aussen = collect;
  collect = [];
  fn(g, len, color, 0);
  const anim = collect;
  collect = aussen;

  // Der Schatten faellt einmal fuer die ganze Silhouette - je Flaeche
  // gezeichnet, wuerde er jede Fuge und jedes Licht verwischen.
  let cv = roh;
  if (shadow) {
    cv = leinwand();
    const s = cv.getContext('2d');
    s.shadowColor = 'rgba(0,0,0,.6)';
    s.shadowBlur = 6 * dpr;
    s.shadowOffsetY = 2 * dpr;
    s.drawImage(roh, 0, 0);
  }

  const sprite = { canvas: cv, half: size / 2, size, anim };
  if (shipCache.size > MAX_SHIPS) shipCache.clear();
  shipCache.set(key, sprite);
  return sprite;
}

/**
 * Zeichnet ein Schiff.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{type:string,x:number,y:number,angle?:number,len?:number,color?:string,phase?:number}} o
 */
export function drawShip(ctx, o) {
  const sp = shipSprite(o.type, lenStufe(o.len || 26), o.color || '#9fb0c8', o.shadow !== false);
  const phase = o.phase || 0;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.angle || 0);
  // Fackeln liegen unter dem Rumpf, das Blinklicht darüber - dazwischen das Standbild.
  // Der Schatten gilt nur für die bewegten Teile; im Sprite steckt er schon drin.
  if (sp.anim.length && o.shadow !== false) {
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
  }
  for (const a of sp.anim) if (!a.over) a.run(ctx, phase);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.drawImage(sp.canvas, -sp.half, -sp.half, sp.size, sp.size);
  for (const a of sp.anim) if (a.over) a.run(ctx, phase);
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
