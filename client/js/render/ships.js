// Ship graphics. Every class has its own silhouette; drawn pointing to the
// right, the caller rotates.
import { raiderWing, raiderHead, raiderHump, star, starArms } from './alienshapes.js';
import { stationBody, stationAnim, STATION_LIGHTS, ringStation, ringAnim, ringSpot, RING_TILT, RING_YARD } from './shipshd/station.js';
import { tone } from './shipshd/kit.js';
import { SHIELD_MIN } from './fx.js';
import { GENS, FLAME, FLAME_LEN, PLAIN, fighterLook, bestFighter, halfWidth, leadX, podX, engineLayout, emitters } from './fighterlook.js';

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
function drawFighter(ctx, L, color, phase, look = PLAIN) {
  // The same outlines as the detailed drawing (fighterlook.js, units of
  // L/100): Mk I after the Viper Mk VII in plan view - a straight wedge of a
  // fuselage, the blue canopy in front of big swept wings, gun pods beneath
  // the wings near the tips, a dorsal spine, three engines. Mk II and III
  // change the outline; nozzles and flame follow the drive. Missiles, tanks
  // and shield emitters only once the ship is big enough to show them.
  const G = GENS[look.gen];
  const u = L / 100;
  const P = (pts, s = 1) => tracePath(ctx, pts.map(([x, y]) => [x * u, s * y * u]));
  const mirror = pts => [...pts, ...pts.slice(1, -1).reverse().map(([x, y]) => [x, -y])];
  const detail = L >= 34;
  const eng = engineLayout(G, look.v);
  for (const [i, e] of eng.entries()) engineGlow(ctx, (e.x - 2) * u, e.y * u, e.r * 6 * u * FLAME_LEN[look.v] ** 0.5, phase + i * 0.9, FLAME[look.v]);
  const [[ax, ay], [bx, by]] = G.wing;
  for (const s of [-1, 1]) {
    // Gun pod beneath the wing: only its front and the barrel show
    const y = s * G.podY * u, lx = podX(G);
    ctx.strokeStyle = look.w === 3 ? '#8fe6ff' : '#c3ccd8'; ctx.lineWidth = Math.max(0.6, L * 0.018);
    ctx.beginPath(); ctx.moveTo(lx * u, y); ctx.lineTo((lx + (look.w === 3 ? 8 : 4.5)) * u, y); ctx.stroke();
    ctx.fillStyle = '#8994a8';
    ctx.beginPath(); ctx.roundRect((lx - 13) * u, y - 1.3 * u, 13 * u, 2.6 * u, 1.3 * u); ctx.fill();
    outline(ctx, fine(L) * 0.6);
    // Big swept silver wings - the empire color sits on the fuselage stripes
    P(G.wing, s); ctx.closePath();
    ctx.fillStyle = '#b4bfd0'; ctx.fill();
    // Light from above: the lower wing lies in shade, both darken outwards
    const g = ctx.createLinearGradient(0, s * ay * u, 0, s * by * u);
    g.addColorStop(0, `rgba(10,14,26,${s < 0 ? 0 : 0.2})`);
    g.addColorStop(1, `rgba(10,14,26,${s < 0 ? 0.25 : 0.5})`);
    ctx.fillStyle = g; ctx.fill(); outline(ctx, 0.9);
    // Armour band along the leading edge (shields 2+)
    if (look.s >= 1) {
      P([[ax, ay], [bx, by], [bx - 4, by], [ax - 4, ay]], s); ctx.closePath();
      ctx.fillStyle = 'rgba(70,80,100,.55)'; ctx.fill();
    }
    seam(ctx, L, [[(ax - 6) * u, s * (ay + 1.5) * u], [(bx - 4.6) * u, s * (by - 0.8) * u]]);
    // Rail along the straight wing tip
    ctx.fillStyle = '#aab4c6';
    ctx.beginPath(); ctx.roundRect(G.tip.x0 * u, s * (by + 0.7) * u - 0.8 * u, (G.tip.x1 - G.tip.x0) * u, 1.6 * u, 0.8 * u); ctx.fill();
    outline(ctx, fine(L) * 0.6);
    if (G.canards) {
      P(G.canards, s); ctx.closePath();
      ctx.fillStyle = '#b4bfd0'; ctx.fill(); outline(ctx, fine(L) * 0.7);
    }
    if (detail && look.r >= 1) {
      const ty = s * (ay + (look.r >= 2 ? 4.6 : 4)) * u, h = (look.r >= 2 ? 1.9 : 1.5) * u;
      const x1 = (leadX(G, ay + 4) - 1) * u, x0 = x1 - (look.r >= 2 ? 19 : 15) * u;
      ctx.fillStyle = '#c8ccd6';
      ctx.beginPath(); ctx.roundRect(x0, ty - h, x1 - x0, h * 2, h); ctx.fill(); outline(ctx, fine(L) * 0.5);
      if (look.r >= 2) { ctx.fillStyle = color; ctx.fillRect(x0 + 5 * u, ty - h, 2.2 * u, h * 2); }
    }
    if (detail && look.w >= 2) {
      for (const dy of [-2.3, 2.3]) {
        const my = G.podY - 6.5 + dy, x1 = leadX(G, my) + 3.5;
        ctx.fillStyle = '#e7ebf2';
        ctx.beginPath(); ctx.roundRect((x1 - 12) * u, s * my * u - 0.8 * u, 12 * u, 1.6 * u, 0.8 * u); ctx.fill();
        outline(ctx, fine(L) * 0.4);
        ctx.fillStyle = '#e04a3a'; ctx.fillRect((x1 - 2.6) * u, s * my * u - 0.8 * u, 2.6 * u, 1.6 * u);
      }
    }
  }
  edgeLight(ctx, L, [[ax * u, -ay * u], [bx * u, -by * u]], 0.45);
  // Four and five nozzles sit in an engine block
  const spread = Math.max(...eng.map(e => Math.abs(e.y) + e.r));
  if (eng.length > 3) {
    ctx.fillStyle = '#7d8799';
    ctx.beginPath(); ctx.roundRect((G.engX + 4) * u, -(spread + 1) * u, (G.tail - G.engX + 6) * u, (spread + 1) * 2 * u, 2 * u); ctx.fill();
    outline(ctx, fine(L) * 0.7);
  }
  for (const e of eng) nozzle(ctx, L, (e.x + 4) * u, e.y * u, e.r * 0.88 * u);
  // Fuselage
  const H = G.hull;
  P(mirror([[G.nose, 0], ...H.map(([x, h]) => [x, -h]), [G.tail, 0]])); ctx.closePath();
  ctx.fillStyle = hullGradient(ctx, L * 0.3); ctx.fill(); outline(ctx, 1);
  // Empire stripes left and right just inside the edge: a fine point behind
  // the nose, full width further back (as in shipshd). Small on the map they
  // get wider - the empire must still be recognizable there.
  const half = [[G.stripeFrom, halfWidth(H, G.stripeFrom)], ...H.filter(([x]) => x < G.stripeFrom && x > G.tail + 1)];
  const k = L < 30 ? 2 : L < 60 ? 1.5 : 1;
  for (const s of [-1, 1]) {
    const w = x => Math.min(1, (G.stripeFrom - x) / 30) * 2.4 * k;
    P([...half.map(([x, h]) => [x, h - 1]), ...half.slice().reverse().map(([x, h]) => [x, h - 1 - w(x)])], s);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = `rgba(10,14,26,${s < 0 ? 0 : 0.2})`; ctx.fill();
  }
  const wide = H.reduce((a, p) => p[1] > a[1] ? p : a);
  edgeLight(ctx, L, [[(G.nose - 4) * u, -H[2][1] * 0.8 * u], [wide[0] * u, -(wide[1] - 0.5) * u], [(wide[0] - 12) * u, -(halfWidth(H, wide[0] - 12) - 0.5) * u]]);
  seam(ctx, L, [[(G.tail + 23) * u, -halfWidth(H, G.tail + 23) * u], [(G.tail + 23) * u, halfWidth(H, G.tail + 23) * u]]);
  // Dorsal spine with the tail fin(s) as light ridges
  P(mirror(look.r === 3 ? G.spine.map(([x, y]) => [x, y * 1.45]) : G.spine)); ctx.closePath();
  ctx.fillStyle = look.r === 3 ? '#b7bcc6' : '#a2aec0'; ctx.fill(); outline(ctx, fine(L) * 0.7);
  if (G.fins === 'single') {
    P(mirror([[-12, 0], [-18, -1.3], [-41, -1.7], [-43, 0]])); ctx.closePath();
    ctx.fillStyle = '#bcc5d3'; ctx.fill(); outline(ctx, fine(L) * 0.5);
  } else {
    const off = G.fins === 'twin' ? 6.2 : 8, lean = G.fins === 'canted' ? 3.5 : 0;
    for (const s of [-1, 1]) {
      P([[-22, off], [-44, off + lean + 1], [-47, off + lean + 0.8], [-46, off + lean - 0.6], [-26, off - 1]], s); ctx.closePath();
      ctx.fillStyle = '#bcc5d3'; ctx.fill(); outline(ctx, fine(L) * 0.5);
    }
  }
  // Canopy in front of the wings: blue, turquoise on Mk II, gold on Mk III
  const C = G.cab, cx0 = C[C.length - 1][0], cx1 = C[0][0];
  const cg = ctx.createLinearGradient(cx0 * u, 0, cx1 * u, 0);
  cg.addColorStop(0, tone(G.cabTint, -0.15));
  cg.addColorStop(1, tone(G.cabTint, 0.4));
  ctx.fillStyle = cg;
  P(mirror(C)); ctx.closePath(); ctx.fill();
  outline(ctx, fine(L) * 0.8);
  glint(ctx, (cx0 + (cx1 - cx0) * 0.62) * u, -1.6 * u, 3.6 * u, 0.9 * u);
  if (detail && look.s >= 2) {
    ctx.fillStyle = '#8fe6ff';
    for (const e of emitters(G)) { ctx.beginPath(); ctx.arc(e.x * u, e.y * u, 1.3 * u, 0, Math.PI * 2); ctx.fill(); }
  }
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
// A long hauler, as in the detailed drawing (shipshd/colony.js): a dark spine
// from an armoured bow to the engine block, and on it three biospheres -
// wide glass domes over green parks, the hallmark of the settler ship and
// what tells it apart at map size.
function drawColony(ctx, L, color, phase) {
  const u = L / 100;
  engineGlow(ctx, -L * 0.56, 0, L * 0.24, phase, '#a6e6ff');
  for (const s of [-1, 1]) engineGlow(ctx, -L * 0.54, s * 8.6 * u, L * 0.15, phase + s, '#a6e6ff');
  nozzle(ctx, L, -50 * u, 0, 5.4 * u);
  // The spine
  ctx.fillStyle = metalGradient(ctx, -4.6 * u, 4.6 * u);
  ctx.fillRect(-36 * u, -4.6 * u, 68 * u, 9.2 * u);
  ctx.strokeStyle = 'rgba(6,10,20,.85)'; ctx.lineWidth = Math.max(0.6, fine(L));
  ctx.strokeRect(-36 * u, -4.6 * u, 68 * u, 9.2 * u);
  edgeLight(ctx, L, [[-35 * u, -3.8 * u], [31 * u, -3.8 * u]], 0.45);
  // The bow: an armoured wedge with the empire color across it
  const hg = ctx.createLinearGradient(0, -9.2 * u, 0, 9.2 * u);
  hg.addColorStop(0, '#b9c3d3'); hg.addColorStop(0.42, '#6f7a8e'); hg.addColorStop(1, '#333b4a');
  const sym = (half) => tracePath(ctx, [...half, ...half.slice().reverse().map(([x, y]) => [x, -y])].map(([x, y]) => [x * u, y * u]));
  ctx.fillStyle = hg;
  sym([[50, 0], [49.2, -3], [45, -6.6], [36.5, -9.2], [31, -9.2]]);
  ctx.closePath(); ctx.fill(); outline(ctx, 1);
  ctx.fillStyle = color; ctx.fillRect(32.4 * u, -8.6 * u, 2.6 * u, 17.2 * u);
  ctx.fillStyle = 'rgba(140,235,255,.95)';
  sym([[49.2, 0], [48.6, -1.9], [46.4, -3], [45, -3]]);
  ctx.closePath(); ctx.fill();
  // The stern block and the bridge on it
  ctx.fillStyle = hg;
  sym([[-32, 0], [-32, -7], [-35, -12.4], [-47, -12.4], [-50, -9]]);
  ctx.closePath(); ctx.fill(); outline(ctx, 1);
  ctx.fillStyle = metalGradient(ctx, -5.2 * u, 5.2 * u);
  ctx.beginPath(); ctx.roundRect(-45 * u, -5.2 * u, 10.6 * u, 10.4 * u, 1.4 * u); ctx.fill(); outline(ctx, 0.7);
  ctx.fillStyle = '#6fe0d6';
  sym([[-34.9, 0], [-35.2, -3.2], [-36.6, -4.2], [-39.4, -4.2]]);
  ctx.closePath(); ctx.fill(); outline(ctx, fine(L) * 0.7);
  // The biospheres, from stern to bow, over the spine
  for (const [x, r] of [[-26.5, 10], [-3.5, 13.3], [21, 11]]) biosphere(ctx, L, x * u, r * u, color);
}

/**
 * A biosphere as in the detailed drawing, reduced to what reads at map
 * size: a dark collar with the empire color, bright green with a blue lake
 * under glass, a bright rim and a gloss.
 */
function biosphere(ctx, L, x, r, color) {
  ctx.beginPath(); ctx.arc(x, 0, r + 1.9 * L / 100, 0, Math.PI * 2);
  ctx.fillStyle = '#39414f'; ctx.fill(); outline(ctx, Math.max(0.6, L * 0.016));
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.8, L * 0.013); ctx.lineCap = 'butt';
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    ctx.beginPath(); ctx.arc(x, 0, r + 1 * L / 100, a - 0.32, a + 0.32); ctx.stroke();
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(x, 0, r, 0, Math.PI * 2); ctx.clip();
  const lawn = ctx.createRadialGradient(x - r * 0.25, -r * 0.3, 0, x, 0, r);
  lawn.addColorStop(0, '#a6f596'); lawn.addColorStop(0.65, '#4fc463'); lawn.addColorStop(1, '#2a8f48');
  ctx.fillStyle = lawn; ctx.fillRect(x - r, -r, r * 2, r * 2);
  ctx.fillStyle = '#4aa8ee';
  ctx.beginPath(); ctx.ellipse(x + r * 0.3, r * 0.26, r * 0.36, r * 0.23, 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1f7a3c';
  for (const [dx, dy] of [[-0.45, 0.45], [-0.55, -0.2], [0.5, -0.5], [0.05, -0.6]]) { ctx.beginPath(); ctx.arc(x + dx * r, dy * r, r * 0.13, 0, Math.PI * 2); ctx.fill(); }
  const rim = ctx.createRadialGradient(x, 0, r * 0.62, x, 0, r);
  rim.addColorStop(0, 'rgba(0,25,35,0)'); rim.addColorStop(1, 'rgba(0,25,35,.4)');
  ctx.fillStyle = rim; ctx.fillRect(x - r, -r, r * 2, r * 2);
  ctx.restore();
  glint(ctx, x - r * 0.25, -r * 0.5, r * 0.48, r * 0.18);
  ctx.strokeStyle = 'rgba(205,250,255,.95)'; ctx.lineWidth = Math.max(0.7, L * 0.012);
  ctx.beginPath(); ctx.arc(x, 0, r, 0, Math.PI * 2); ctx.stroke();
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
// sides two curved landing decks on three broad cross struts. The empire color
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
  // A narrow band across the head as well - very small it would turn the
  // ship into a rocket again, so only from a middle size on.
  if (!small) {
    ctx.fillRect(46.2 * u, -6.6 * u, 1.4 * u, 2.6 * u); ctx.fillRect(46.2 * u, 4 * u, 1.4 * u, 2.6 * u);
    const h = ddHeadHalf(42.8) - 0.4;
    ctx.fillRect(42.2 * u, -h * u, 1.2 * u, 2 * h * u);
  }
  // Emblem: a ring in the empire color around a golden center
  ctx.beginPath(); ctx.arc(14.6 * u, 0, 2.9 * u * Math.min(k, 1.4), 0, Math.PI * 2); ctx.fill(); outline(ctx, fine(L) * 0.6);
  if (L >= 30) { ctx.fillStyle = '#e8c547'; ctx.beginPath(); ctx.arc(14.6 * u, 0, 1.8 * u, 0, Math.PI * 2); ctx.fill(); }
  // Cross struts over everything
  const reach = pod + 3.4;
  for (const x0 of [7.6, -3.4, -14.4]) {
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
    for (const x of [5.4, 2.8, -17.4, -20]) for (const y of [-1.4, 1.4]) guns.push([x, y]);
    for (const x of [22.5, 28.5, 34.5]) for (const y of [-8.6, 8.6]) guns.push([x, y]);
    for (const x of [16.4, 13, 3.8, -7.8, -20.6, -25]) for (const y of [-7.9, 7.9]) guns.push([x, y]);
    for (const [x, y] of guns) {
      ctx.beginPath(); ctx.arc(x * u, y * u, 1.05 * u, 0, Math.PI * 2); ctx.fill(); outline(ctx, fine(L) * 0.5);
    }
  }
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

/* ---------------------------------------------------------------- Aliens */
// Not of this galaxy: organic green armour instead of grey plates, no
// windows, no empire stripes. The fighter is a crescent with its claws
// reaching forward; the carrier two needle-armed three-pointed stars
// stacked crosswise.
const ALIEN_GLOW = '#7dffa8';

function alienMetal(ctx, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#b6ffd0');
  g.addColorStop(0.35, '#4fc27f');
  g.addColorStop(0.62, '#23764a');
  g.addColorStop(1, '#0d3220');
  return g;
}

function paintPulse(ctx, x, y, r, phase) {
  const a = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(phase * 2.4), 2);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
  g.addColorStop(0, `rgba(220,255,230,${a})`);
  g.addColorStop(0.35, `rgba(90,255,140,${a * 0.8})`);
  g.addColorStop(1, 'rgba(60,255,120,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
}

/** A green light that swells and fades - arm tips and the carrier's core. */
function pulse(ctx, x, y, r, phase) {
  if (collect) { collect.push({ over: true, run: (c, ph) => paintPulse(c, x, y, r, ph + phase) }); return; }
  paintPulse(ctx, x, y, r, phase);
}

function drawAlienFighter(ctx, L, color, phase) {
  // A crescent with long thin claws reaching forward past the head.
  const u = L / 100;
  for (const s of [-1, 1]) engineGlow(ctx, -L * 0.46, s * 4 * u, L * 0.1, phase + s, ALIEN_GLOW);
  raiderWing(ctx, u);
  ctx.fillStyle = alienMetal(ctx, -38 * u, 38 * u); ctx.fill(); outline(ctx, 1);
  for (const s of [-1, 1]) seam(ctx, L, [[-36 * u, s * 18 * u], [-20 * u, s * 29 * u], [10 * u, s * 31 * u], [40 * u, s * 22 * u]]);
  edgeLight(ctx, L, [[52 * u, -16 * u], [30 * u, -30 * u], [0, -36 * u], [-24 * u, -33 * u]], 0.4);
  ctx.fillStyle = '#123b26';
  for (const s of [-1, 1]) ctx.fillRect(0, s * 5 * u - 0.7 * u, 16 * u, 1.4 * u);
  raiderHead(ctx, u);
  ctx.fillStyle = alienMetal(ctx, -12 * u, 12 * u); ctx.fill(); outline(ctx, 0.8);
  raiderHump(ctx, u);
  ctx.fillStyle = alienMetal(ctx, -7 * u, 7 * u); ctx.fill(); outline(ctx, 0.6);
  ctx.fillStyle = '#05140c';
  ctx.beginPath(); ctx.ellipse(7.5 * u, 0, 1.6 * u, 5.5 * u, 0, 0, Math.PI * 2); ctx.fill();
}

function drawAlienCarrier(ctx, L, color, phase) {
  // Two needle-armed three-pointed stars stacked a sixth of a turn apart:
  // the lower one smooth and in shadow, the upper one lit.
  const u = L / 100;
  star(ctx, Math.PI / 3, 47, 3.2, u);
  const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, 47 * u);
  shade.addColorStop(0, '#2a7148');
  shade.addColorStop(1, '#0f3320');
  ctx.fillStyle = shade; ctx.fill(); outline(ctx, 0.9);
  star(ctx, 0, 50, 3.8, u);
  ctx.fillStyle = alienMetal(ctx, -50 * u, 50 * u); ctx.fill(); outline(ctx, 1);
  for (const a of starArms(0)) edgeLight(ctx, L, [[Math.cos(a) * 6 * u, Math.sin(a) * 6 * u], [Math.cos(a) * 46 * u, Math.sin(a) * 46 * u]], 0.4);
  pulse(ctx, 0, 0, 2.2 * u, phase);
}

/* ------------------------------------------------------ Orbital station */
// A ring around a world, never turned with a heading - the same drawing as
// the ship profile (shipshd/station.js), without windows at icon size. On
// the map the ring goes around the real world instead (drawPlanetStation).
function stationParts(ctx, L, color, phase, site) {
  const u = L / 100;
  ctx.save();
  ctx.scale(u, u);
  stationBody(ctx, color, u, site, L < 70);
  ctx.restore();
  // The lights on the ring move: above the still image, like the blinking lights.
  const moving = (c, ph) => { c.save(); c.scale(u, u); stationAnim(c, ph, site, L < 70); c.restore(); };
  if (collect) collect.push({ over: true, run: (c, ph) => moving(c, ph + phase) });
  else moving(ctx, phase);
  for (const l of STATION_LIGHTS[site ? 'stationSite' : 'station']) {
    blinkLight(ctx, l.x * u, l.y * u, Math.max(0.7, l.r * u * 1.6), phase + l.off * 3);
  }
}
const drawStation = (ctx, L, color, phase) => stationParts(ctx, L, color, phase, false);
const drawStationSite = (ctx, L, color, phase) => stationParts(ctx, L, color, phase, true);
/** Types that stand upright everywhere instead of turning with a heading. */
export const UPRIGHT = new Set(['station', 'stationSite']);

const DRAW = {
  scout: drawScout, fighter: drawFighter, satellite: drawSatellite,
  colony: drawColony, tanker: drawTanker, transport: drawTransport, destroyer: drawDestroyer,
  alienFighter: drawAlienFighter, alienCarrier: drawAlienCarrier,
  station: drawStation, stationSite: drawStationSite
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
 * smaller, the fighter slightly bigger, the colony ship a big hauler, the
 * destroyer clearly the largest. The detailed drawing (shipshd.js)
 * uses the same factors.
 */
export const SHIP_SCALE = { scout: 0.85, fighter: 1.08, colony: 1.3, destroyer: 1.5, alienFighter: 1, alienCarrier: 1.45, station: 1.35, stationSite: 1.35 };
/**
 * How far the middle of a hull lies ahead of the origin, in units of the
 * length/100: the destroyer's bow reaches out to 52, its stern only to -40.
 */
const SHIP_CENTER = { destroyer: 6 };

function lenStep(len) {
  return Math.max(4, Math.round(len));
}

function shipSprite(type, len, color, shadow, look) {
  // Pre-render at screen resolution - on high-resolution displays the fine
  // lines would otherwise be upscaled and washed out.
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const key = `${type}|${len}|${color}|${shadow ? 1 : 0}|${dpr}|${look?.key ?? ''}`;
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
  fn(g, len, color, 0, look || undefined);
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
 * @param {{type:string,x:number,y:number,angle?:number,len?:number,color?:string,phase?:number,tech?:object}} o
 *   tech: what the ship was built with - the fighter looks different with it
 */
export function drawShip(ctx, o) {
  const look = o.type === 'fighter' && o.tech ? fighterLook(o.tech) : null;
  const sp = shipSprite(o.type, lenStep((o.len || 26) * (SHIP_SCALE[o.type] || 1)), o.color || '#9fb0c8', o.shadow !== false, look);
  const phase = o.phase || 0;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.angle || 0);
  // Flames lie beneath the hull, the blinking light above it - the still image
  // in between. The moving parts get no shadow of their own: a shadowBlur per
  // ship and frame cost far more than it showed.
  for (const a of sp.anim) if (!a.over) a.run(ctx, phase);
  ctx.drawImage(sp.canvas, -sp.half, -sp.half, sp.size, sp.size);
  for (const a of sp.anim) if (a.over) a.run(ctx, phase);
  ctx.restore();
}

/**
 * An alien swarm on the map: the carrier, its fighters around it. Big
 * swarms show at most SWARM_MAX fighters - the badge tells the full number.
 * Two looks, SWARM_STYLE picks one:
 * - 'cloud': the fighters circle the carrier like a swarm of insects, each
 *   on an orbit of its own - other radius, speed and direction, a little
 *   breathing in and out.
 * - 'formation': the carrier in the lead, the fighters fanned out behind
 *   it in a V, each one drifting a little on its own.
 * Positions are in the carrier's frame (x ahead), in units of `len`.
 */
const SWARM_STYLE = 'cloud';
const SWARM_MAX = 8;
const CARRIER_SPIN = 0.175;  // radians per second
/** A fixed "random" number in [0, 1) per fighter and purpose - the same every frame. */
const hash = (i, k) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };

function cloudSpot(i, phase, cx) {
  const dir = hash(i, 1) < 0.7 ? 1 : -1;               // most go round one way, some against it
  const speed = 0.35 + hash(i, 2) * 0.45;               // radians per second
  const a = hash(i, 3) * Math.PI * 2 + dir * speed * phase;
  const r = 0.95 + hash(i, 4) * 0.7 + Math.sin(phase * (0.5 + hash(i, 5)) + i) * 0.12;
  const squash = 0.65 + hash(i, 6) * 0.35;              // orbits a little flattened, tilted at random
  const tilt = hash(i, 7) * Math.PI;
  const ex = Math.cos(a) * r, ey = Math.sin(a) * r * squash;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  // Heading along the orbit: the derivative of the point.
  const vx = -Math.sin(a) * dir, vy = Math.cos(a) * squash * dir;
  return { dx: cx + ex * ct - ey * st, dy: ex * st + ey * ct, heading: Math.atan2(vx * st + vy * ct, vx * ct - vy * st) };
}

export function drawAlienSwarm(ctx, o, ships) {
  const len = o.len || 26;
  const phase = o.phase || 0;
  const angle = o.angle || 0;
  const carriers = ships.filter(s => s.type === 'alienCarrier').length;
  const fighters = Math.min(SWARM_MAX, ships.filter(s => s.type === 'alienFighter').length);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const at = (dx, dy) => [o.x + (dx * cos - dy * sin) * len, o.y + (dx * sin + dy * cos) * len];
  const fl = len * 0.6;
  const fighter = (dx, dy, heading, i) => {
    const [x, y] = at(dx, dy);
    drawShip(ctx, { type: 'alienFighter', x, y, angle: angle + heading, len: fl, color: o.color, phase: phase + i, shadow: o.shadow });
  };
  // Two carriers one behind the other; the cloud circles the pair.
  const mid = -(carriers - 1) * 0.7;
  const cloud = SWARM_STYLE === 'cloud' ? [...Array(fighters).keys()].map(i => ({ i, ...cloudSpot(i, phase, mid) })) : [];
  // On one half of their orbit the fighters pass behind the carrier, on
  // the other in front of it.
  for (const c of cloud) if (c.dy < 0) fighter(c.dx, c.dy, c.heading, c.i);
  if (SWARM_STYLE !== 'cloud') {
    for (let i = 0; i < fighters; i++) {
      const row = 1 + (i >> 1), side = i & 1 ? 1 : -1;
      const wob = phase * 1.3 + i * 2.1;
      fighter(0.15 - row * 0.45 + Math.sin(wob) * 0.04, side * (0.3 + row * 0.38) + Math.cos(wob * 0.8) * 0.04, 0, i);
    }
  }
  // The carriers turn slowly about their core - a second one the other way.
  for (let i = carriers - 1; i >= 0; i--) {
    const [x, y] = at(-i * 1.4, 0);
    const spin = phase * CARRIER_SPIN * (i & 1 ? -1 : 1);
    drawShip(ctx, { type: 'alienCarrier', x, y, angle: angle + spin, len, color: o.color, phase: phase + i, shadow: o.shadow });
  }
  for (const c of cloud) if (c.dy >= 0) fighter(c.dx, c.dy, c.heading, c.i);
}

/**
 * The ships of a fleet on the map: an alien swarm as a whole swarm, any
 * other fleet by its leading ship - a fighter as the most advanced one.
 */
export function drawFleetShips(ctx, o, f, lead) {
  if (f.ships?.some(s => s.type === 'alienCarrier')) drawAlienSwarm(ctx, o, f.ships);
  else drawShip(ctx, { ...o, type: lead, tech: lead === 'fighter' ? bestFighter(f.ships)?.tech : undefined });
}

// The ring is drawn once per size and colour and copied from then on: a
// few dozen gradients per station and frame would be felt late in a game.
const ringCache = new Map();
function ringImage(R, r, color, site) {
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const key = `${R}|${r}|${color}|${site ? 1 : 0}|${dpr}`;
  let img = ringCache.get(key);
  if (img) return img;
  const half = Math.ceil(R * 1.2 + 10);
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(half * 2 * dpr);
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.translate(half, half);
  g.rotate(RING_TILT);
  // The far half runs behind the world: cut the world's disc out of it.
  g.save();
  g.beginPath(); g.rect(-half * 2, -half * 2, half * 4, half * 4); g.arc(0, 0, r, 0, Math.PI * 2);
  g.clip('evenodd');
  ringStation(g, R, { color, site, part: 'back', world: r });
  g.restore();
  ringStation(g, R, { color, site, part: 'front', world: r });
  img = { canvas: cv, half };
  if (ringCache.size > 120) ringCache.clear();
  ringCache.set(key, img);
  return img;
}

/**
 * The orbital station of a world on the map: a ring around it at the
 * height of the satellite shield - the far half behind the world, the near
 * half in front of it, tethers of light holding it to the world. Once ready
 * and with the shield up, its anchors glow in the owner's colour; a site
 * shows the plated part and the scaffold of the rest. The yard hangs from
 * the near side, a little beyond the world's own disc: a click there picks
 * the world, like one on the world itself.
 * @param {{station: object, defenses?: number}} p  the world's view
 * @param {number} r   radius of the world on screen
 * @param {number} sc  orbitScale of the zoom
 * @returns {{x: number, y: number, r: number} | null} where the yard is, to click on
 */
export function drawPlanetStation(ctx, p, x, y, r, sc, color, phase) {
  if (!p.station) return null;
  // The shield's radius - the same formula as where the map draws the shield.
  const R = Math.round(r * 1.14 + 20 * sc);
  if (R < 9) return null;
  const site = p.station.building > 0;
  const img = ringImage(R, Math.max(1, Math.round(r)), color, site);
  ctx.drawImage(img.canvas, x - img.half, y - img.half, img.half * 2, img.half * 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(RING_TILT);
  ringAnim(ctx, R, phase + (p.id || 0), { site, hide: r, color, shield: !site && (p.defenses || 0) >= SHIELD_MIN ? 1 : 0 });
  ctx.restore();
  // The pods hang under the band's near edge.
  const [yx, yy] = ringSpot(RING_YARD, R);
  return { x: x + yx, y: y + yy + R * 0.06, r: Math.max(9, R * 0.22) };
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
/** Icon for lists and build menus - with tech, a fighter shows its generation and equipment. */
export function shipIcon(type, px = 34, color = '#9fb0c8', tech = null) {
  const look = type === 'fighter' && tech ? fighterLook(tech) : null;
  const key = type + '|' + px + '|' + color + '|' + (look?.key ?? '');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const blank = () => {
    const cv = document.createElement('canvas');
    cv.width = px * dpr; cv.height = px * dpr;
    cv.style.width = px + 'px'; cv.style.height = px + 'px';
    return cv;
  };
  // Drawn once, handed out as a copy: one canvas element can only hang in one
  // place - two destroyers in a fleet would otherwise share a single image,
  // and only the last row would keep it.
  const copy = (src) => {
    const cv = blank();
    cv.getContext('2d').drawImage(src, 0, 0);
    return cv;
  };
  if (iconCache.has(key)) return copy(iconCache.get(key));
  const cv = blank();
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  // The whole ship must fit into the square - a class drawn larger than the
  // others (the destroyer) would otherwise lose its bow and stern.
  const len = Math.min(px * 0.82, px * 0.95 / (SHIP_SCALE[type] || 1));
  // Ships whose hull does not sit around their origin are moved by that much,
  // so the hull - not the origin - is in the middle of the square.
  const shift = (SHIP_CENTER[type] || 0) * len * (SHIP_SCALE[type] || 1) / 100;
  drawShip(ctx, { type, x: px / 2, y: px / 2 + shift, angle: UPRIGHT.has(type) ? 0 : -Math.PI / 2, len, color, phase: 0.4, shadow: false, tech: look ? tech : undefined });
  iconCache.set(key, cv);
  return cv;
}
