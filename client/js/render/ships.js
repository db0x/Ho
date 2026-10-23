// Ship graphics. Every class has its own silhouette; drawn pointing to the
// right, the caller rotates.

function hullGradient(ctx, len) {
  const g = ctx.createLinearGradient(0, -len * 0.4, 0, len * 0.4);
  g.addColorStop(0, '#e9f0fb');
  g.addColorStop(0.42, '#aab6cc');
  g.addColorStop(0.55, '#7a8699');
  g.addColorStop(1, '#3c4557');
  return g;
}

// While a sprite is being built, this buffer collects the moving parts
// instead of drawing them into the still image - see drawShip.
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
  // The flame flickers and lies beneath the hull: only note it down while building the sprite.
  if (collect) { collect.push({ over: false, run: (c, ph) => paintGlow(c, x, y, r, ph + phase, color) }); return; }
  paintGlow(ctx, x, y, r, phase, color);
}

function paintBlink(ctx, x, y, r, phase) {
  const blink = 0.5 + 0.5 * Math.sin(phase * 3);
  ctx.fillStyle = `rgba(255,90,80,${0.3 + blink * 0.7})`;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function blinkLight(ctx, x, y, r, phase) {
  // The blinking light sits on top, otherwise like the flame.
  if (collect) { collect.push({ over: true, run: (c, ph) => paintBlink(c, x, y, r, ph + phase) }); return; }
  paintBlink(ctx, x, y, r, phase);
}

function outline(ctx, w = 1) {
  ctx.lineWidth = w;
  ctx.strokeStyle = 'rgba(6,10,20,.85)';
  ctx.stroke();
}

/* ------------------------------------------------------------ Details */
// Details that still hold up at 20-30 px map size: seams, light edges,
// nozzles, navigation lights. Line widths depend on the ship length so they
// grow along when zooming.

const fine = L => Math.max(0.45, L * 0.022);

function tracePath(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
}

/** Engraved seam: a dark line with a bright edge below it. */
function seam(ctx, L, pts) {
  const w = fine(L);
  ctx.save();
  ctx.lineCap = 'round';
  tracePath(ctx, pts);
  ctx.strokeStyle = 'rgba(8,12,24,.6)'; ctx.lineWidth = w; ctx.stroke();
  ctx.translate(0, w * 0.9);
  tracePath(ctx, pts);
  ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = w * 0.7; ctx.stroke();
  ctx.restore();
}

/** Light edge: the light comes from above, so a bright line along the top edge. */
function edgeLight(ctx, L, pts, a = 0.55) {
  ctx.save();
  ctx.lineCap = 'round';
  tracePath(ctx, pts);
  ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = fine(L) * 0.9; ctx.stroke();
  ctx.restore();
}

/** Nozzle housing at the stern: a dark collar with a bright rim. */
function nozzle(ctx, L, x, y, r) {
  ctx.save();
  ctx.fillStyle = '#1b2130';
  ctx.beginPath(); ctx.roundRect(x - r * 0.9, y - r, r * 1.3, r * 2, r * 0.35); ctx.fill();
  ctx.strokeStyle = 'rgba(190,205,230,.55)'; ctx.lineWidth = fine(L) * 0.8; ctx.stroke();
  ctx.fillStyle = 'rgba(150,220,255,.5)';
  ctx.beginPath(); ctx.ellipse(x - r * 0.9, y, r * 0.18, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Navigation light with a small halo - red on the left (port), green on the right. */
function navLight(ctx, L, x, y, color) {
  const r = Math.max(0.7, L * 0.03);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill();
}
const PORT = '#ff4a3d', STARBOARD = '#3dff8a';

/** Glint on glass. */
function glint(ctx, x, y, rx, ry) {
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, -0.4, 0, Math.PI * 2); ctx.fill();
}

/* ---------------------------------------------------------------- Scout */
function drawScout(ctx, L, color, phase) {
  // Same outline as the detailed drawing (shipshd.js, units of L/100), only a
  // little wider so it still reads at map size.
  const u = L / 100, k = 1.2;
  const P = (pts, s = 1) => tracePath(ctx, pts.map(([x, y]) => [x * u, s * y * u * k]));
  // Engine flame
  engineGlow(ctx, -L * 0.54, 0, L * 0.28, phase);
  // Swept wings in the empire color, with a pod at the tip
  for (const s of [-1, 1]) {
    P([[-6, 5], [-30, 26], [-38, 27.5], [-40, 25], [-30, 6]], s); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    // Light from above: the lower wing lies in shade, both darken outwards
    const g = ctx.createLinearGradient(0, s * 5 * u * k, 0, s * 27 * u * k);
    g.addColorStop(0, `rgba(10,14,26,${s < 0 ? 0 : 0.2})`);
    g.addColorStop(1, `rgba(10,14,26,${s < 0 ? 0.25 : 0.5})`);
    ctx.fillStyle = g; ctx.fill(); outline(ctx, 0.8);
    seam(ctx, L, [[-14 * u, s * 9 * u * k], [-33 * u, s * 25 * u * k]]);
    ctx.fillStyle = '#9aa5ba';
    ctx.beginPath(); ctx.roundRect(-41 * u, s * 26.5 * u * k - 1.8 * u * k, 13 * u, 3.6 * u * k, 1.8 * u * k);
    ctx.fill(); outline(ctx, fine(L) * 0.8);
  }
  edgeLight(ctx, L, [[-6 * u, -5 * u * k], [-30 * u, -26 * u * k]], 0.4);
  // Canards
  for (const s of [-1, 1]) {
    P([[30, 4], [22, 10.5], [19, 10], [22, 4]], s); ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); outline(ctx, fine(L) * 0.8);
  }
  nozzle(ctx, L, -L * 0.46, 0, L * 0.06);
  // Hull: long and slim, a dark sensor tip at the bow
  const hull = [[56, 0], [44, -2.6], [26, -5.6], [4, -7.6], [-30, -7.2], [-46, -5.6], [-48, 0],
    [-46, 5.6], [-30, 7.2], [4, 7.6], [26, 5.6], [44, 2.6]];
  P(hull); ctx.closePath();
  ctx.fillStyle = hullGradient(ctx, L * 0.25); ctx.fill(); outline(ctx, 0.9);
  edgeLight(ctx, L, [[50 * u, -1.5 * u * k], [26 * u, -5 * u * k], [-44 * u, -5 * u * k]]);
  seam(ctx, L, [[8 * u, -7 * u * k], [8 * u, 7 * u * k]]);
  seam(ctx, L, [[-16 * u, -7 * u * k], [-16 * u, 7 * u * k]]);
  // Identification stripe as in the detailed drawing
  ctx.fillStyle = color;
  ctx.fillRect(-34 * u, 3 * u * k, 40 * u, Math.max(0.6, 2 * u * k));
  ctx.fillStyle = '#1e2433';
  P([[56, 0], [48, -1.8], [46, 0], [48, 1.8]]); ctx.closePath(); ctx.fill();
  // Canopy: long and narrow
  ctx.fillStyle = 'rgba(120,230,255,.9)';
  ctx.beginPath(); ctx.ellipse(24 * u, 0, 12 * u, 3.4 * u * k, 0, 0, Math.PI * 2); ctx.fill();
  outline(ctx, fine(L) * 0.8);
  glint(ctx, 26 * u, -1.2 * u * k, 4 * u, 0.9 * u * k);
  // Navigation lights on the wing tip pods
  navLight(ctx, L, -36 * u, -26.5 * u * k, PORT);
  navLight(ctx, L, -36 * u, 26.5 * u * k, STARBOARD);
}

/* -------------------------------------------------------------- Fighter */
function drawFighter(ctx, L, color, phase) {
  // Same outline as the detailed drawing (shipshd.js, units of L/100) in the
  // style of the Viper Mk VII - but stockier, with the cannons standing out:
  // at map size that is what tells it apart from the slim scout.
  const u = L / 100, kh = 1.5, kw = 1.15;     // widening of hull and wings
  const P = (pts, k, s = 1) => tracePath(ctx, pts.map(([x, y]) => [x * u, s * y * u * k]));
  const mirror = pts => [...pts, ...pts.slice(1, -1).reverse().map(([x, y]) => [x, -y])];
  const side = 12.5 * u * kh;                 // side engines
  // Three engines side by side, the middle one the largest
  engineGlow(ctx, -L * 0.53, 0, L * 0.28, phase);
  for (const s of [-1, 1]) engineGlow(ctx, -L * 0.52, s * side, L * 0.22, phase + 0.9 * s);
  // Swept wings with cropped tips in the empire color
  for (const s of [-1, 1]) {
    P([[4, 7], [-22, 40], [-28, 42.5], [-35, 41.5], [-37, 9]], kw, s); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    // Light from above: the lower wing lies in shade, both darken outwards
    const g = ctx.createLinearGradient(0, s * 7 * u * kw, 0, s * 42 * u * kw);
    g.addColorStop(0, `rgba(10,14,26,${s < 0 ? 0 : 0.2})`);
    g.addColorStop(1, `rgba(10,14,26,${s < 0 ? 0.25 : 0.5})`);
    ctx.fillStyle = g; ctx.fill(); outline(ctx, 0.9);
    // Dark inner panel and the chevron
    P([[-8, 20], [-20, 34], [-33, 34], [-33, 20]], kw, s); ctx.closePath();
    ctx.fillStyle = 'rgba(20,26,40,.4)'; ctx.fill();
    P([[-16, 25], [-22, 30], [-24, 30], [-18, 25], [-24, 20], [-22, 20]], kw, s); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fill();
  }
  edgeLight(ctx, L, [[4 * u, -7 * u * kw], [-22 * u, -40 * u * kw]], 0.45);
  for (const s of [-1, 1]) nozzle(ctx, L, -46 * u, s * side, 4.8 * u * kh);
  nozzle(ctx, L, -47 * u, 0, 6.4 * u * kh);
  // Cannons along the flanks, the barrels reaching far forward
  for (const s of [-1, 1]) {
    const y = s * 15 * u;
    ctx.strokeStyle = '#b5bfd0'; ctx.lineWidth = Math.max(0.8, L * 0.028);
    ctx.beginPath(); ctx.moveTo(6 * u, y); ctx.lineTo(36 * u, y); ctx.stroke();
    ctx.fillStyle = '#3a4255';
    ctx.beginPath(); ctx.roundRect(-16 * u, y - 3.4 * u, 24 * u, 6.8 * u, 3 * u);
    ctx.fill(); outline(ctx, fine(L) * 0.8);
    ctx.fillStyle = '#ff7a5c';
    ctx.beginPath(); ctx.arc(37 * u, y, Math.max(0.5, L * 0.022), 0, Math.PI * 2); ctx.fill();
  }
  // Hull: chined nose, widening into the engine block at the tail
  P(mirror([[62, 0], [50, -2.4], [34, -5], [16, -6.8], [-6, -7.8], [-26, -8.4],
    [-33, -12], [-37, -17.5], [-44, -17.5], [-45, -15], [-45, 0]]), kh); ctx.closePath();
  ctx.fillStyle = hullGradient(ctx, L * 0.6); ctx.fill(); outline(ctx, 1);
  edgeLight(ctx, L, [[56 * u, -1.4 * u * kh], [16 * u, -6.4 * u * kh], [-26 * u, -8 * u * kh]]);
  seam(ctx, L, [[-14 * u, -8 * u * kh], [-14 * u, 8 * u * kh]]);
  seam(ctx, L, [[-30 * u, -14 * u * kh], [-30 * u, 14 * u * kh]]);
  // Stripe in the empire color along the spine, ahead of the fin
  ctx.fillStyle = color;
  ctx.fillRect(-14 * u, -2 * u * kh, 26 * u, 4 * u * kh);
  ctx.fillStyle = '#1e2433';
  P([[62, 0], [54, -1.8], [52, 0], [54, 1.8]], kh); ctx.closePath(); ctx.fill();
  // Tail fin above the middle engine - from above a thin light ridge
  P([[-14, 0], [-22, -1.4], [-44, -2.2], [-46, 0], [-44, 2.2], [-22, 1.4]], kh); ctx.closePath();
  ctx.fillStyle = '#c3cbd8'; ctx.fill(); outline(ctx, fine(L) * 0.7);
  // Canopy far forward
  const cg = ctx.createLinearGradient(12 * u, 0, 46 * u, 0);
  cg.addColorStop(0, 'rgba(90,200,255,.95)');
  cg.addColorStop(1, 'rgba(220,250,255,.75)');
  ctx.fillStyle = cg;
  P(mirror([[46, 0], [40, -2.6], [28, -4.6], [16, -4.4], [12, 0]]), kh); ctx.closePath(); ctx.fill();
  outline(ctx, fine(L) * 0.8);
  glint(ctx, 32 * u, -1.6 * u * kh, 5 * u, 1 * u * kh);
  // Navigation lights at the wing tips
  navLight(ctx, L, -29 * u, -42 * u * kw, PORT);
  navLight(ctx, L, -29 * u, 42 * u * kw, STARBOARD);
}

/* ------------------------------------------------------------ Satellite */
function drawSatellite(ctx, L, color, phase) {
  const R = L * 0.3;
  // Solar panels: frame, cell grid, gloss
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
    ctx.lineWidth = fine(L) * 0.8;
    for (let i = 1; i < 6; i++) {
      const yy = -R * 1.05 + (R * 2.1 / 6) * i;
      ctx.beginPath(); ctx.moveTo(-L * 0.16, yy); ctx.lineTo(L * 0.16, yy); ctx.stroke();
    }
    for (const xx of [-L * 0.053, L * 0.053]) {
      ctx.beginPath(); ctx.moveTo(xx, -R * 1.05); ctx.lineTo(xx, R * 1.05); ctx.stroke();
    }
    edgeLight(ctx, L, [[-L * 0.15, -R * 1.02], [L * 0.15, -R * 1.02]], 0.45);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath();
    ctx.moveTo(-L * 0.16, -R * 1.05); ctx.lineTo(L * 0.02, -R * 1.05);
    ctx.lineTo(-L * 0.16, -R * 0.2); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // Mast with joints
  ctx.strokeStyle = '#8a94a8'; ctx.lineWidth = Math.max(1.2, L * 0.07);
  ctx.beginPath(); ctx.moveTo(-L * 0.34, 0); ctx.lineTo(L * 0.34, 0); ctx.stroke();
  ctx.fillStyle = '#5b6578';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.arc(s * L * 0.18, 0, L * 0.05, 0, Math.PI * 2); ctx.fill(); outline(ctx, fine(L));
  }
  // Antenna with dish
  ctx.strokeStyle = '#aab6cc'; ctx.lineWidth = fine(L);
  ctx.beginPath(); ctx.moveTo(0, R * 0.6); ctx.lineTo(0, R * 1.25); ctx.stroke();
  ctx.fillStyle = '#c9d3e4';
  ctx.beginPath(); ctx.ellipse(0, R * 1.28, L * 0.09, L * 0.035, 0, 0, Math.PI * 2); ctx.fill(); outline(ctx, fine(L) * 0.8);
  // Core
  ctx.fillStyle = hullGradient(ctx, L);
  const hexagon = (r) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + Math.PI / 6;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
  hexagon(R); ctx.fill(); outline(ctx, 1);
  // Inner bevel
  hexagon(R * 0.72);
  ctx.strokeStyle = 'rgba(8,12,24,.45)'; ctx.lineWidth = fine(L); ctx.stroke();
  edgeLight(ctx, L, [[-R * 0.86, -R * 0.5], [0, -R], [R * 0.86, -R * 0.5]], 0.5);
  // Turret with barrel pointing forward
  ctx.strokeStyle = '#2f3648'; ctx.lineWidth = Math.max(0.9, L * 0.05);
  ctx.beginPath(); ctx.moveTo(R * 0.3, 0); ctx.lineTo(R * 0.95, 0); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2); ctx.fill(); outline(ctx, fine(L));
  ctx.fillStyle = '#ffb45c';
  ctx.beginPath(); ctx.arc(0, 0, R * 0.17, 0, Math.PI * 2); ctx.fill();
  glint(ctx, -R * 0.12, -R * 0.18, R * 0.1, R * 0.06);
  // Blinking light
  blinkLight(ctx, 0, -R * 1.05, L * 0.05, phase);
}

/* ---------------------------------------------------------- Colony ship */
function drawColony(ctx, L, color, phase) {
  const W = L * 0.4;
  engineGlow(ctx, -L * 0.54, 0, L * 0.3, phase, '#aaffd0');
  // Struts between girder and cargo pods - light, so they still read at map size
  ctx.strokeStyle = '#9aa5ba'; ctx.lineWidth = Math.max(1, L * 0.04);
  for (const s of [-1, 1]) for (const x of [-L * 0.22, L * 0.04]) {
    ctx.beginPath(); ctx.moveTo(x, s * L * 0.1); ctx.lineTo(x, s * L * 0.25); ctx.stroke();
  }
  // Cargo pods with color mark at the stern and lit windows
  for (const s of [-1, 1]) {
    const y = s * L * 0.33;
    const h = L * 0.09;
    const pg = ctx.createLinearGradient(0, y - h, 0, y + h);
    pg.addColorStop(0, '#c9d1de'); pg.addColorStop(0.45, '#8f9aae'); pg.addColorStop(1, '#4f586b');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.roundRect(-L * 0.36, y - h, L * 0.52, h * 2, h);
    ctx.fill(); outline(ctx, 0.8);
    for (const xx of [-L * 0.2, -L * 0.04]) seam(ctx, L, [[xx, y - h * 0.9], [xx, y + h * 0.9]]);
    edgeLight(ctx, L, [[-L * 0.32, y - h * 0.7], [L * 0.12, y - h * 0.7]], 0.4);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(-L * 0.36, y - h, L * 0.52, h * 2, h); ctx.clip();
    ctx.fillStyle = color; ctx.fillRect(-L * 0.36, y - h, L * 0.07, h * 2);
    ctx.restore();
    ctx.fillStyle = '#ffe9a8';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(L * 0.03 + i * L * 0.035, y, Math.max(0.45, L * 0.013), 0, Math.PI * 2); ctx.fill();
    }
  }
  nozzle(ctx, L, -L * 0.46, 0, W * 0.22);
  // Hull: a narrow girder - the domes should stick out on the left and right
  ctx.fillStyle = hullGradient(ctx, L);
  ctx.beginPath();
  ctx.moveTo(L * 0.5, 0);
  ctx.lineTo(L * 0.34, -W * 0.27);
  ctx.lineTo(-L * 0.44, -W * 0.26);
  ctx.lineTo(-L * 0.48, 0);
  ctx.lineTo(-L * 0.44, W * 0.26);
  ctx.lineTo(L * 0.34, W * 0.27);
  ctx.closePath(); ctx.fill(); outline(ctx, 1);
  edgeLight(ctx, L, [[L * 0.46, -W * 0.04], [L * 0.34, -W * 0.23], [-L * 0.42, -W * 0.22]]);
  // Bow cap in the player color
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(L * 0.5, 0); ctx.lineTo(L * 0.42, -W * 0.15); ctx.lineTo(L * 0.42, W * 0.15); ctx.closePath(); ctx.fill();
  // Three habitat domes protruding over the hull - the hallmark of the settler
  // ship. As in the detailed drawing: a large one in the middle, a small one
  // fore and aft, none overlapping.
  for (const [x, r] of [[-L * 0.41, L * 0.14], [-L * 0.07, L * 0.19], [L * 0.27, L * 0.14]]) habitatDome(ctx, L, x, r);
  navLight(ctx, L, -L * 0.2, -L * 0.33, PORT);
  navLight(ctx, L, -L * 0.2, L * 0.33, STARBOARD);
}

/** Green glass dome with a rib and gloss. */
function habitatDome(ctx, L, x, r) {
  const dg = ctx.createRadialGradient(x - r * 0.3, -r * 0.35, 0, x, 0, r * 1.1);
  dg.addColorStop(0, 'rgba(200,255,225,.98)');
  dg.addColorStop(0.55, 'rgba(110,200,150,.95)');
  dg.addColorStop(1, 'rgba(40,110,80,.95)');
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.arc(x, 0, r, 0, Math.PI * 2); ctx.fill();
  outline(ctx, Math.max(0.6, L * 0.025));
  ctx.save();
  ctx.beginPath(); ctx.arc(x, 0, r, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.32)'; ctx.lineWidth = fine(L) * 0.7;
  ctx.beginPath(); ctx.ellipse(x, 0, r * 0.45, r, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  glint(ctx, x - r * 0.3, -r * 0.4, r * 0.32, r * 0.16);
}

/** Gray metal gradient for attachments, across the longitudinal axis. */
function metalGradient(ctx, y0, y1) {
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
  // Pipes between the tanks and the spine
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
      seam(ctx, L, [[xx, y - L * 0.13], [xx, y + L * 0.13]]);
    }
    // Gloss stripe and valve caps
    edgeLight(ctx, L, [[-L * 0.3, y - L * 0.08], [L * 0.28, y - L * 0.08]], 0.6);
    ctx.fillStyle = '#c9a64a';
    for (const xx of [-L * 0.39, L * 0.37]) {
      ctx.beginPath(); ctx.arc(xx, y, L * 0.035, 0, Math.PI * 2); ctx.fill(); outline(ctx, fine(L) * 0.7);
    }
    ctx.fillStyle = color;
    ctx.fillRect(-L * 0.34, y - L * 0.04, L * 0.12, L * 0.08);
  }
  nozzle(ctx, L, -L * 0.48, 0, W * 0.15);
  // Spine
  ctx.fillStyle = hullGradient(ctx, L);
  ctx.beginPath();
  ctx.moveTo(L * 0.5, 0);
  ctx.lineTo(L * 0.34, -W * 0.2);
  ctx.lineTo(-L * 0.5, -W * 0.17);
  ctx.lineTo(-L * 0.5, W * 0.17);
  ctx.lineTo(L * 0.34, W * 0.2);
  ctx.closePath(); ctx.fill(); outline(ctx, 1);
  edgeLight(ctx, L, [[L * 0.46, -W * 0.04], [L * 0.34, -W * 0.16], [-L * 0.46, -W * 0.13]]);
  for (const xx of [L * 0.1, -L * 0.1, -L * 0.3]) seam(ctx, L, [[xx, -W * 0.16], [xx, W * 0.16]]);
  // Bridge with a row of windows
  ctx.fillStyle = 'rgba(140,220,255,.85)';
  ctx.beginPath(); ctx.ellipse(L * 0.3, 0, L * 0.08, W * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  outline(ctx, fine(L) * 0.8);
  glint(ctx, L * 0.31, -W * 0.05, L * 0.025, W * 0.035);
  navLight(ctx, L, L * 0.0, -W * 0.88, PORT);
  navLight(ctx, L, L * 0.0, W * 0.88, STARBOARD);
}

const DRAW = {
  scout: drawScout, fighter: drawFighter, satellite: drawSatellite,
  colony: drawColony, tanker: drawTanker
};

/* ------------------------------------------------------------- Sprites */
// A silhouette does not change from frame to frame - only flames and blinking
// lights move. That is why the still image is drawn once into its own canvas
// and only copied afterwards, just as the planets already do. That saves
// about seven gradients and a dozen paths per ship per frame.
const shipCache = new Map();
const MAX_SHIPS = 400;

// Round the length to whole pixels so the cache does not overflow when
// zooming. Coarser steps save hardly anything: there are only two lengths per
// zoom level anyway, and the ships would visibly be the wrong size.
function lenStep(len) {
  return Math.max(4, Math.round(len));
}

function shipSprite(type, len, color, shadow) {
  // Pre-render at screen resolution - on high-resolution displays the fine
  // lines would otherwise be upscaled and washed out.
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const key = `${type}|${len}|${color}|${shadow ? 1 : 0}|${dpr}`;
  const hit = shipCache.get(key);
  if (hit) return hit;

  const fn = DRAW[type] || drawFighter;
  const pad = 10;                       // room for the drop shadow (blur 6, offset 2)
  const size = Math.ceil(len * 1.3) + pad * 2;
  const newCanvas = () => {
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * dpr);
    return c;
  };

  // Collect moving parts instead of drawing them; the phase is 0 here, so
  // anim only holds the offset per flame.
  const raw = newCanvas();
  const g = raw.getContext('2d');
  g.scale(dpr, dpr);
  g.translate(size / 2, size / 2);
  const outer = collect;
  collect = [];
  fn(g, len, color, 0);
  const anim = collect;
  collect = outer;

  // The shadow is cast once for the whole silhouette - drawn per shape, it
  // would smear every seam and every light.
  let cv = raw;
  if (shadow) {
    cv = newCanvas();
    const s = cv.getContext('2d');
    s.shadowColor = 'rgba(0,0,0,.6)';
    s.shadowBlur = 6 * dpr;
    s.shadowOffsetY = 2 * dpr;
    s.drawImage(raw, 0, 0);
  }

  const sprite = { canvas: cv, half: size / 2, size, anim };
  if (shipCache.size > MAX_SHIPS) shipCache.clear();
  shipCache.set(key, sprite);
  return sprite;
}

/**
 * Draws a ship.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{type:string,x:number,y:number,angle?:number,len?:number,color?:string,phase?:number}} o
 */
export function drawShip(ctx, o) {
  const sp = shipSprite(o.type, lenStep(o.len || 26), o.color || '#9fb0c8', o.shadow !== false);
  const phase = o.phase || 0;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.angle || 0);
  // Flames lie beneath the hull, the blinking light above it - the still image in between.
  // The shadow only applies to the moving parts; the sprite already contains it.
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

/** Engine trail for flying fleets. */
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
/** Icon for lists and build menus. */
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
