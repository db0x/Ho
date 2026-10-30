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
// nozzles. Line widths depend on the ship length so they
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

/** Glint on glass. */
function glint(ctx, x, y, rx, ry) {
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, -0.4, 0, Math.PI * 2); ctx.fill();
}

/* ---------------------------------------------------------------- Scout */
function drawScout(ctx, L, color, phase) {
  // After the Raptor in plan view (units of L/100): a round canopy in front,
  // right behind it the broad body with big five-sided wing panels, two
  // engine pods close together at the stern and long pointed stabilizers
  // reaching back and out - wide and compact, unlike the slim fighter.
  const u = L / 100;
  const P = (pts, s = 1) => tracePath(ctx, pts.map(([x, y]) => [x * u, s * y * u]));
  const mirror = pts => [...pts, ...pts.slice(1, -1).reverse().map(([x, y]) => [x, -y])];
  for (const s of [-1, 1]) engineGlow(ctx, -L * 0.41, s * 8.4 * u, L * 0.2, phase + s);
  // Long pointed stabilizers
  for (const s of [-1, 1]) {
    P([[-10, 15], [-50, 28.4], [-46, 24], [-15, 11]], s); ctx.closePath();
    ctx.fillStyle = '#8a95a8'; ctx.fill(); outline(ctx, fine(L) * 0.8);
  }
  // Two engine pods with ribs
  for (const s of [-1, 1]) {
    const y = s * 8.4 * u;
    nozzle(ctx, L, -38 * u, y, 5 * u);
    ctx.fillStyle = metalGradient(ctx, y - 6.5 * u, y + 6.5 * u);
    ctx.beginPath(); ctx.roundRect(-38 * u, y - 6.5 * u, 26 * u, 13 * u, 3 * u); ctx.fill(); outline(ctx, 0.8);
    ctx.fillStyle = 'rgba(200,210,225,.55)';
    for (const x of [-33, -25, -17]) ctx.fillRect(x * u, y - 6.5 * u, Math.max(0.5, 1.6 * u), 13 * u);
  }
  // Five-sided wing panels in the empire color
  for (const s of [-1, 1]) {
    P([[24.5, 13], [13.6, 39], [-8.2, 39], [-17.3, 20], [-17.3, 13]], s); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    // Light from above: the lower wing lies in shade, both darken outwards
    const g = ctx.createLinearGradient(0, s * 13 * u, 0, s * 39 * u);
    g.addColorStop(0, `rgba(10,14,26,${s < 0 ? 0 : 0.2})`);
    g.addColorStop(1, `rgba(10,14,26,${s < 0 ? 0.25 : 0.5})`);
    ctx.fillStyle = g; ctx.fill(); outline(ctx, 0.9);
    ctx.fillStyle = 'rgba(16,20,32,.5)';
    for (const [x, y, w, h] of [[6, 20, 6, 5], [-3, 20, 6, 5], [-3, 28, 6, 5]]) {
      ctx.fillRect(x * u, (s > 0 ? y : -y - h) * u, w * u, h * u);
    }
  }
  edgeLight(ctx, L, [[24.5 * u, -13 * u], [13.6 * u, -39 * u]], 0.45);
  // Broad body, rounded at the front
  P(mirror([[50, 0], [49, -6], [45, -9.5], [36, -12], [26, -15], [0, -16], [-17, -14], [-17, 0]])); ctx.closePath();
  ctx.fillStyle = hullGradient(ctx, L * 0.3); ctx.fill(); outline(ctx, 1);
  edgeLight(ctx, L, [[48 * u, -6 * u], [36 * u, -11.5 * u], [0, -15.4 * u]]);
  seam(ctx, L, [[24 * u, -14.6 * u], [24 * u, 14.6 * u]]);
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.7, L * 0.018);
  ctx.beginPath(); ctx.arc(8 * u, 0, 4 * u, -Math.PI + 0.8, Math.PI - 0.8); ctx.stroke();
  // Round canopy with a dark frame
  P(mirror([[47.5, 0], [46.5, -5], [43, -8.2], [34, -9.4], [27, -8.4], [27, 0]])); ctx.closePath();
  ctx.fillStyle = 'rgba(80,200,220,.9)'; ctx.fill();
  ctx.lineWidth = Math.max(0.8, L * 0.018); ctx.strokeStyle = 'rgba(10,14,24,.95)'; ctx.stroke();
  seam(ctx, L, [[37 * u, -9 * u], [37 * u, 9 * u]]);
  glint(ctx, 42 * u, -4 * u, 3.6 * u, 1.3 * u);
}

/* -------------------------------------------------------------- Fighter */
function drawFighter(ctx, L, color, phase) {
  // After the Viper Mk VII in plan view (units of L/100): a straight wedge of
  // a fuselage up to the wing roots, slimmer again at the stern, the blue
  // canopy in front of big swept wings with straight cut tips, gun pods
  // beneath the wings near the tips, a dorsal spine, three engines.
  const u = L / 100;
  const P = (pts, s = 1) => tracePath(ctx, pts.map(([x, y]) => [x * u, s * y * u]));
  const mirror = pts => [...pts, ...pts.slice(1, -1).reverse().map(([x, y]) => [x, -y])];
  // Three engines close together
  engineGlow(ctx, -L * 0.53, 0, L * 0.24, phase);
  for (const s of [-1, 1]) engineGlow(ctx, -L * 0.51, s * 4.6 * u, L * 0.17, phase + 0.9 * s);
  for (const s of [-1, 1]) {
    // Gun pod beneath the wing: only its front and the barrel show
    const y = s * 26 * u;
    ctx.strokeStyle = '#c3ccd8'; ctx.lineWidth = Math.max(0.6, L * 0.018);
    ctx.beginPath(); ctx.moveTo(-4 * u, y); ctx.lineTo(0.5 * u, y); ctx.stroke();
    ctx.fillStyle = '#8994a8';
    ctx.beginPath(); ctx.roundRect(-17 * u, y - 1.3 * u, 13 * u, 2.6 * u, 1.3 * u); ctx.fill();
    outline(ctx, fine(L) * 0.6);
    // Big swept silver wings - the empire color sits on the fuselage stripes
    P([[3, 11.5], [-12.4, 30.4], [-21.6, 30.4], [-24.6, 15.6], [-27.4, 12.4], [-31.5, 9]], s); ctx.closePath();
    ctx.fillStyle = '#b4bfd0'; ctx.fill();
    // Light from above: the lower wing lies in shade, both darken outwards
    const g = ctx.createLinearGradient(0, s * 9 * u, 0, s * 30 * u);
    g.addColorStop(0, `rgba(10,14,26,${s < 0 ? 0 : 0.2})`);
    g.addColorStop(1, `rgba(10,14,26,${s < 0 ? 0.25 : 0.5})`);
    ctx.fillStyle = g; ctx.fill(); outline(ctx, 0.9);
    seam(ctx, L, [[-3 * u, s * 13 * u], [-17 * u, s * 29.6 * u]]);
    // Rail along the straight wing tip
    ctx.fillStyle = '#aab4c6';
    ctx.beginPath(); ctx.roundRect(-22.6 * u, s * 31.1 * u - 0.8 * u, 14 * u, 1.6 * u, 0.8 * u); ctx.fill();
    outline(ctx, fine(L) * 0.6);
  }
  edgeLight(ctx, L, [[3 * u, -11.5 * u], [-12.4 * u, -30.4 * u]], 0.45);
  nozzle(ctx, L, -47 * u, 0, 3.4 * u);
  for (const s of [-1, 1]) nozzle(ctx, L, -46 * u, s * 4.6 * u, 2.8 * u);
  // Fuselage: a wedge from the rounded nose to the wing roots, slimmer again
  // at the stern (same points as in shipshd.js)
  P(mirror([[60, 0], [60, -1.1], [58, -1.9], [56, -2.1], [2, -12.4], [-10, -11.2], [-24, -10.2], [-31, -9.4],
    [-40, -8.4], [-43, -7.4], [-45, -5.6], [-45, 0]])); ctx.closePath();
  ctx.fillStyle = hullGradient(ctx, L * 0.3); ctx.fill(); outline(ctx, 1);
  // Empire stripes left and right just inside the edge: a fine point behind
  // the nose, full width from the canopy back (same as in shipshd.js). Small
  // on the map they get wider - the empire must still be recognizable there.
  const half = [[34, 6.3], [2, 12.4], [-10, 11.2], [-24, 10.2], [-31, 9.4], [-40, 8.4], [-43, 7.4]];
  const k = L < 30 ? 2 : L < 60 ? 1.5 : 1;
  for (const s of [-1, 1]) {
    const w = x => Math.min(1, (34 - x) / 30) * 2.4 * k;
    P([...half.map(([x, h]) => [x, h - 1]), ...half.slice().reverse().map(([x, h]) => [x, h - 1 - w(x)])], s);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = `rgba(10,14,26,${s < 0 ? 0 : 0.2})`; ctx.fill();
  }
  edgeLight(ctx, L, [[56 * u, -1.7 * u], [2 * u, -11.9 * u], [-10 * u, -10.7 * u]]);
  seam(ctx, L, [[-22 * u, -10.2 * u], [-22 * u, 10.2 * u]]);
  // Dorsal spine with the tail fin as a light ridge
  P(mirror([[-1, 0], [-3, -3.4], [-28, -3.8], [-37, -3], [-44, -1.8], [-45, 0]])); ctx.closePath();
  ctx.fillStyle = '#a2aec0'; ctx.fill(); outline(ctx, fine(L) * 0.7);
  P(mirror([[-12, 0], [-18, -1.3], [-41, -1.7], [-43, 0]])); ctx.closePath();
  ctx.fillStyle = '#bcc5d3'; ctx.fill(); outline(ctx, fine(L) * 0.5);
  // Blue canopy in front of the wings
  const cg = ctx.createLinearGradient(-1 * u, 0, 16 * u, 0);
  cg.addColorStop(0, 'rgba(60,100,230,.95)');
  cg.addColorStop(1, 'rgba(140,175,255,.9)');
  ctx.fillStyle = cg;
  P(mirror([[16.5, 0], [15.6, -2.6], [13, -3.8], [1.5, -3.8], [-0.4, -2.6], [-0.8, 0]])); ctx.closePath(); ctx.fill();
  outline(ctx, fine(L) * 0.8);
  glint(ctx, 10 * u, -1.6 * u, 3.6 * u, 0.9 * u);
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
  // Hull: a narrow girder with a blunt bow - the domes stick out left and right
  ctx.fillStyle = hullGradient(ctx, L);
  tracePath(ctx, [[L * 0.44, 0], [L * 0.436, -L * 0.06], [L * 0.41, -L * 0.095], [L * 0.34, -L * 0.105],
    [-L * 0.44, -L * 0.104], [-L * 0.48, 0], [-L * 0.44, L * 0.104], [L * 0.34, L * 0.105],
    [L * 0.41, L * 0.095], [L * 0.436, L * 0.06]]);
  ctx.closePath(); ctx.fill(); outline(ctx, 1);
  edgeLight(ctx, L, [[L * 0.43, -L * 0.06], [L * 0.34, -L * 0.095], [-L * 0.42, -L * 0.09]]);
  // Flat bridge: a wide window band across the bow
  ctx.fillStyle = 'rgba(140,225,255,.9)';
  tracePath(ctx, [[L * 0.43, 0], [L * 0.427, -L * 0.045], [L * 0.405, -L * 0.075], [L * 0.38, -L * 0.075],
    [L * 0.38, L * 0.075], [L * 0.405, L * 0.075], [L * 0.427, L * 0.045]]);
  ctx.closePath(); ctx.fill(); outline(ctx, fine(L) * 0.7);
  // Three habitat domes protruding over the hull - the hallmark of the settler
  // ship. As in the detailed drawing: a large one in the middle, a smaller one
  // fore and aft, none overlapping; the rear one reaches over the engines.
  for (const [x, r] of [[-L * 0.491, L * 0.15], [-L * 0.1355, L * 0.197], [L * 0.22, L * 0.15]]) habitatDome(ctx, L, x, r);
}

/* ---------------------------------------------------------- Transporter */
// An open satellite carrier: five folded satellites in cradles along a
// lattice spine - one look tells what it is for.
function drawTransport(ctx, L, color, phase) {
  const u = L / 100;
  for (const s of [-1, 1]) {
    const y = s * 13 * u;
    engineGlow(ctx, -L * 0.5, y, L * 0.18, phase + s);
    nozzle(ctx, L, -45 * u, y, 3.8 * u);
    ctx.fillStyle = metalGradient(ctx, y - 4.4 * u, y + 4.4 * u);
    ctx.beginPath(); ctx.roundRect(-45 * u, y - 4.4 * u, 15 * u, 8.8 * u, 4 * u); ctx.fill(); outline(ctx, 0.8);
    ctx.fillStyle = color; ctx.fillRect(-34.5 * u, y - 4.4 * u, 2.5 * u, 8.8 * u);
  }
  ctx.fillStyle = metalGradient(ctx, -10 * u, 10 * u);
  ctx.fillRect(-40 * u, -10 * u, 6 * u, 20 * u);
  // Spine: two light rails with bracing
  ctx.fillStyle = '#a7b2c6';
  const rail = Math.max(0.6, 1.8 * u);
  ctx.fillRect(-42 * u, -4.6 * u, 78 * u, rail); ctx.fillRect(-42 * u, 4.6 * u - rail, 78 * u, rail);
  if (L >= 40) {
    ctx.strokeStyle = '#7d889c'; ctx.lineWidth = Math.max(0.5, 0.9 * u);
    ctx.beginPath();
    for (let x = -42, i = 0; x < 36; x += 6, i++) { ctx.moveTo(x * u, (i % 2 ? -3 : 3) * u); ctx.lineTo((x + 6) * u, (i % 2 ? 3 : -3) * u); }
    ctx.stroke();
  } else {
    // Too small for the lattice: a solid girder reads better
    ctx.fillStyle = '#8a95a8'; ctx.fillRect(-42 * u, -4.6 * u, 78 * u, 9.2 * u);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-42 * u, -4.6 * u, 78 * u, rail * 0.6);
  }
  // Folded satellites in their cradles
  // At map size the satellites are drawn larger, otherwise they vanish
  const k = L < 60 ? 1.3 : 1;
  for (const [x, s] of [[26, -1], [14, 1], [2, -1], [-10, 1], [-22, -1]]) {
    const y = s * 11 * u * (k > 1 ? 1.1 : 1), X = x * u;
    ctx.fillStyle = '#2c4a8a';
    ctx.fillRect(X - 8.2 * u * k, y - 2.6 * u * k, 4.6 * u * k, 5.2 * u * k);
    ctx.fillRect(X + 3.6 * u * k, y - 2.6 * u * k, 4.6 * u * k, 5.2 * u * k);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; ctx[i ? 'lineTo' : 'moveTo'](X + Math.cos(a) * 4.2 * u * k, y + Math.sin(a) * 4.2 * u * k); }
    ctx.closePath(); ctx.fillStyle = '#b5bfd0'; ctx.fill(); outline(ctx, fine(L) * 0.8);
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X, y, Math.max(0.7, 2.2 * u * k), 0, Math.PI * 2); ctx.fill();
  }
  // Flat bridge pod in front with its window band
  ctx.fillStyle = hullGradient(ctx, L * 0.3);
  tracePath(ctx, [[47 * u, 0], [46.6 * u, -5 * u], [44.4 * u, -8 * u], [36 * u, -9 * u], [33 * u, -7 * u],
    [33 * u, 7 * u], [36 * u, 9 * u], [44.4 * u, 8 * u], [46.6 * u, 5 * u]]);
  ctx.closePath(); ctx.fill(); outline(ctx, 0.9);
  ctx.fillStyle = color; ctx.fillRect(34.4 * u, -8 * u, 2 * u, 16 * u);
  ctx.fillStyle = 'rgba(140,225,255,.9)';
  tracePath(ctx, [[46 * u, 0], [45.7 * u, -4 * u], [43.8 * u, -6.5 * u], [41.8 * u, -6.5 * u],
    [41.8 * u, 6.5 * u], [43.8 * u, 6.5 * u], [45.7 * u, 4 * u]]);
  ctx.closePath(); ctx.fill(); outline(ctx, fine(L) * 0.7);
}

/* ------------------------------------------------------------ Destroyer */
// The capital ship in plan view, after a battlestar (units of L/100): a
// broad head whose flanks curve out backwards, the dominant midsection with
// the emblem and gun turrets, two short engine nacelles at the stern, and far out on the
// sides two curved landing decks on two broad cross struts. The empire color
// sits where the original carries its red: marks at the tip of the head and
// the front ends of the landing decks, and the ring of the emblem. Same
// shapes as in shipshd.js.
const DD_POD = 16.4, DD_NACELLE = 6.6;
const ddHeadHalf = x => 6.6 + 6.8 * (1 - ((x - 18) / 33) ** 2);
const ddMidHalf = x => 9.2 + 1.5 * Math.sin(Math.PI * (19 - x) / 46);

function drawDestroyer(ctx, L, color, phase) {
  const u = L / 100;
  const P = (pts) => tracePath(ctx, pts.map(([x, y]) => [x * u, y * u]));
  const mirror = pts => [...pts, ...pts.slice(1, -1).reverse().map(([x, y]) => [x, -y])];
  // Small on the map the marks in the empire color grow, or they vanish
  const k = L < 30 ? 2 : L < 60 ? 1.5 : 1;
  // Very small, the landing decks move out a little and the lines get thinner -
  // otherwise decks and hull run together into one block.
  const small = L < 45;
  const pod = DD_POD + (small ? 2.6 : 0);
  const line = small ? Math.max(0.45, L * 0.018) : 0.8;
  // Lighter than the attachments of the small ships: at map size the landing
  // decks would otherwise sink into the dark.
  const light = (y0, y1) => {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#d9dee6'); g.addColorStop(0.45, '#9aa1ad'); g.addColorStop(1, '#555c69');
    return g;
  };
  for (const s of [-1, 1]) engineGlow(ctx, -L * 0.41, s * DD_NACELLE * u, L * 0.15, phase + s);
  for (const s of [-1, 1]) nozzle(ctx, L, -37.5 * u, s * DD_NACELLE * u, 3 * u);
  // Machinery between the nacelles
  ctx.fillStyle = '#4b515b'; ctx.fillRect(-35 * u, -3 * u, 12 * u, 6 * u);
  // Short engine nacelles
  for (const s of [-1, 1]) {
    const c = s * DD_NACELLE * u;
    ctx.fillStyle = light(c - 4.4 * u, c + 4.4 * u);
    ctx.beginPath(); ctx.roundRect(-35 * u, c - 4.2 * u, 13 * u, 8.4 * u, [1 * u, 4.2 * u, 4.2 * u, 1 * u]); ctx.fill(); outline(ctx, line);
  }
  // Curved landing decks, open at both ends
  for (const s of [-1, 1]) {
    const c = s * pod;
    const out = [], inn = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, x = 17 - 44 * t, b = Math.sin(Math.PI * t);
      out.push([x, c + s * (1.9 + 1.6 * b)]);
      inn.push([x, c - s * (1.9 + 1.0 * b)]);
    }
    P([...out, ...inn.reverse()]); ctx.closePath();
    ctx.fillStyle = light((c - 3.5) * u, (c + 3.5) * u); ctx.fill(); outline(ctx, line);
    if (L >= 50) for (let x = -20; x < 14; x += 4.5) seam(ctx, L, [[x * u, (c - 2.6) * u], [x * u, (c + 2.6) * u]]);
    ctx.fillStyle = '#20252c';
    for (const [x0, x1] of [[17, 13.6], [-27, -23.6]]) {
      P([[x0, c - 1.9], [x1, c - 1.2], [x1, c + 1.2], [x0, c + 1.9]]); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.fillRect(14.2 * u, (c - 3.4) * u, 1.8 * u * k, 6.8 * u);
  }
  // Dominant midsection with bulging flanks
  const mid = [[19, 0]];
  for (let x = 19; x >= -27; x -= 4.6) mid.push([x, -ddMidHalf(x)]);
  mid.push([-27, -ddMidHalf(-27)], [-27, 0]);
  P(mirror(mid)); ctx.closePath();
  ctx.fillStyle = hullGradient(ctx, L * 0.22); ctx.fill(); outline(ctx, small ? line : 1);
  if (L >= 40) for (const x of [-14, -6, 2]) seam(ctx, L, [[x * u, -10 * u], [x * u, 10 * u]]);
  // Broad head, the flanks curving out backwards. Very small, the curve and
  // its light edge melt into a round dome - a rocket nose. There the tip
  // stays broad and flat with clear corners, as on the original.
  let head;
  if (small) head = [[51, 0], [51, -7.4], [49, -9], [18, -13.4], [18, 0]];
  else {
    head = [[52.2, 0], [52, -4.8], [51.2, -6.2]];
    for (let x = 49; x >= 18; x -= 3.1) head.push([x, -ddHeadHalf(x)]);
    head.push([18, -ddHeadHalf(18)], [18, 0]);
  }
  P(mirror(head)); ctx.closePath();
  ctx.fillStyle = hullGradient(ctx, L * 0.3); ctx.fill(); outline(ctx, small ? line : 1);
  if (!small) edgeLight(ctx, L, [[51.2 * u, -6.2 * u], [40 * u, -11.5 * u], [26 * u, -13.1 * u]]);
  ctx.fillStyle = 'rgba(30,36,50,.45)'; ctx.fillRect(19 * u, -4.6 * u, 15 * u, 9.2 * u);
  if (L >= 40) for (const x of [26, 40]) seam(ctx, L, [[x * u, -12.5 * u], [x * u, 12.5 * u]]);
  // Two short marks at the tip, as in the detailed drawing - very small
  // they would read as a band around a rocket nose, so the landing decks
  // and the emblem carry the color alone there.
  ctx.fillStyle = color;
  if (!small) { ctx.fillRect(46.2 * u, -6.6 * u, 1.4 * u, 2.6 * u); ctx.fillRect(46.2 * u, 4 * u, 1.4 * u, 2.6 * u); }
  // Emblem: a ring in the empire color around a golden center
  ctx.beginPath(); ctx.arc(11 * u, 0, 2.9 * u * Math.min(k, 1.4), 0, Math.PI * 2); ctx.fill(); outline(ctx, fine(L) * 0.6);
  if (L >= 30) { ctx.fillStyle = '#e8c547'; ctx.beginPath(); ctx.arc(11 * u, 0, 1.8 * u, 0, Math.PI * 2); ctx.fill(); }
  // Cross struts over everything
  const reach = pod + 3.4;
  for (const x0 of [-4.2, -14.4]) {
    // Very small, darker than the decks, so those stand apart from the hull
    ctx.fillStyle = small ? '#6a717d' : light(-reach * u, reach * u);
    ctx.fillRect(x0 * u, -reach * u, 3.2 * u, reach * 2 * u);
    ctx.strokeStyle = 'rgba(6,10,20,.85)'; ctx.lineWidth = small ? line * 0.7 : Math.max(0.5, L * 0.008);
    ctx.strokeRect(x0 * u, -reach * u, 3.2 * u, reach * 2 * u);
    if (L >= 40) {
      ctx.fillStyle = '#2f353e';
      for (const s of [-1, 1]) ctx.fillRect((x0 + 0.5) * u, (s < 0 ? -13.7 : 10.6) * u, 2.2 * u, 3.1 * u);
    }
  }
  // Gun turrets: two groups of four on the spine, rows along the flanks
  if (L >= 50) {
    ctx.fillStyle = '#8e959f';
    const guns = [];
    for (const x of [6.6, 4, -17.4, -20]) for (const y of [-1.4, 1.4]) guns.push([x, y]);
    for (const x of [22.5, 28.5, 34.5]) for (const y of [-8.6, 8.6]) guns.push([x, y]);
    for (const x of [16, 9.5, 1.6, -7.8, -20.6, -25]) for (const y of [-7.9, 7.9]) guns.push([x, y]);
    for (const [x, y] of guns) {
      ctx.beginPath(); ctx.arc(x * u, y * u, 1.05 * u, 0, Math.PI * 2); ctx.fill(); outline(ctx, fine(L) * 0.5);
    }
  }
}

/**
 * Habitat dome as in the detailed drawing: a park under glass - lawn, a lake
 * and a path - inside a light metal ring, so it catches the eye on the map.
 */
function habitatDome(ctx, L, x, r) {
  const ring = Math.max(0.9, r * 0.16);
  // Light metal ring with a dark outer edge
  ctx.beginPath(); ctx.arc(x, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#dfe6f0'; ctx.fill();
  outline(ctx, Math.max(0.6, L * 0.02));
  const ri = r - ring;
  ctx.save();
  ctx.beginPath(); ctx.arc(x, 0, ri, 0, Math.PI * 2); ctx.clip();
  // Lawn, lake and a path
  const lawn = ctx.createRadialGradient(x - ri * 0.2, -ri * 0.2, 0, x, 0, ri);
  lawn.addColorStop(0, '#9af0a0'); lawn.addColorStop(1, '#3a9a52');
  ctx.fillStyle = lawn; ctx.fillRect(x - ri, -ri, ri * 2, ri * 2);
  ctx.fillStyle = '#3a9ad6';
  ctx.beginPath(); ctx.ellipse(x + ri * 0.3, ri * 0.28, ri * 0.28, ri * 0.18, 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(240,230,190,.7)'; ctx.lineWidth = Math.max(0.4, ri * 0.08);
  ctx.beginPath(); ctx.moveTo(x - ri, -ri * 0.2); ctx.quadraticCurveTo(x, -ri * 0.05, x + ri, -ri * 0.4); ctx.stroke();
  // Glass: ribs, a dark rim and the gloss
  ctx.strokeStyle = 'rgba(220,245,255,.4)'; ctx.lineWidth = fine(L) * 0.6;
  ctx.beginPath(); ctx.ellipse(x, 0, ri * 0.5, ri, 0, 0, Math.PI * 2); ctx.stroke();
  const rim = ctx.createRadialGradient(x, 0, ri * 0.6, x, 0, ri);
  rim.addColorStop(0, 'rgba(0,20,30,0)'); rim.addColorStop(1, 'rgba(0,20,30,.25)');
  ctx.fillStyle = rim; ctx.fillRect(x - ri, -ri, ri * 2, ri * 2);
  ctx.restore();
  glint(ctx, x - ri * 0.3, -ri * 0.45, ri * 0.45, ri * 0.2);
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
  tracePath(ctx, [[L * 0.46, 0], [L * 0.455, -L * 0.045], [L * 0.43, -L * 0.075], [L * 0.34, -W * 0.2],
    [-L * 0.5, -W * 0.17], [-L * 0.5, W * 0.17], [L * 0.34, W * 0.2], [L * 0.43, L * 0.075], [L * 0.455, L * 0.045]]);
  ctx.closePath(); ctx.fill(); outline(ctx, 1);
  edgeLight(ctx, L, [[L * 0.45, -L * 0.045], [L * 0.34, -W * 0.16], [-L * 0.46, -W * 0.13]]);
  for (const xx of [L * 0.1, -L * 0.1, -L * 0.3]) seam(ctx, L, [[xx, -W * 0.16], [xx, W * 0.16]]);
  // Bridge: a flat window band across the blunt bow
  ctx.fillStyle = 'rgba(140,220,255,.85)';
  tracePath(ctx, [[L * 0.45, 0], [L * 0.447, -L * 0.03], [L * 0.43, -L * 0.046], [L * 0.38, -L * 0.046],
    [L * 0.38, L * 0.046], [L * 0.43, L * 0.046], [L * 0.447, L * 0.03]]);
  ctx.closePath(); ctx.fill();
  outline(ctx, fine(L) * 0.8);
}

const DRAW = {
  scout: drawScout, fighter: drawFighter, satellite: drawSatellite,
  colony: drawColony, tanker: drawTanker, transport: drawTransport, destroyer: drawDestroyer
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
/**
 * Size of a class relative to the others, for every view: the scout a bit
 * smaller, the fighter slightly bigger, the destroyer clearly the largest. The detailed drawing (shipshd.js)
 * uses the same factors.
 */
export const SHIP_SCALE = { scout: 0.85, fighter: 1.08, destroyer: 1.5 };

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
  const sp = shipSprite(o.type, lenStep((o.len || 26) * (SHIP_SCALE[o.type] || 1)), o.color || '#9fb0c8', o.shadow !== false);
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
  // The whole ship must fit into the square - a class drawn larger than the
  // others (the destroyer) would otherwise lose its bow and stern.
  const len = Math.min(px * 0.82, px * 0.95 / (SHIP_SCALE[type] || 1));
  drawShip(ctx, { type, x: px / 2, y: px / 2, angle: -Math.PI / 2, len, color, phase: 0.4, shadow: false });
  iconCache.set(key, cv);
  return cv;
}
