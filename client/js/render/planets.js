// Planet rendering in the style of the classic: glossy, richly colored
// spheres - color = temperature, size = gravity.
import { tempColor, rgb, habitability, IDEAL } from '../../shared/rules.js';
import { t, n as n1 } from '../i18n.js';
import { drawHexShield, SHIELD_MIN, SpriteCache } from './fx.js';

// About 64 MB - see SpriteCache for why the budget counts pixels.
const spriteCache = new SpriteCache(16e6);
// Bigger worlds are scaled up from this size. In the 3D view a world right in
// front of the camera would otherwise get a canvas thousands of pixels wide.
const MAX_R = 192;

/** Sprite radius for a radius on screen: whole pixels while small, then
 *  relative steps - the sprite is scaled to the exact size when drawn. */
function radiusStep(r) {
  if (r < 26) return Math.max(4, Math.round(r));
  const step = Math.ceil(Math.log(r / 26) / Math.log(1.08));
  return Math.min(MAX_R, Math.round(26 * Math.pow(1.08, step)));
}

function rngFrom(seed) {
  let a = (seed | 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Radius of a planet: gravity determines the size. */
export function planetRadius(planet) {
  const g = planet.grav ?? 1;
  return 9 + Math.pow(g, 0.78) * 5.4;
}

function shade(c, f) {
  return [
    Math.max(0, Math.min(255, Math.round(c[0] * f))),
    Math.max(0, Math.min(255, Math.round(c[1] * f))),
    Math.max(0, Math.min(255, Math.round(c[2] * f)))
  ];
}
function mix(a, b, f) {
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * f));
}

/**
 * Renders a planet's sphere into its own canvas (cached).
 * @param {object} planet
 * @param {number} r radius in pixels
 */
export function planetSprite(planet, r) {
  // Round the radius in steps so the cache does not overflow when zooming
  const rr = radiusStep(r);
  const tBucket = Math.round((planet.temp ?? 0) / 4) * 4;
  const gBucket = Math.round((planet.grav ?? 1) * 10);
  const key = `${planet.id}|${rr}|${tBucket}|${gBucket}|${planet.known || 'live'}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;

  const pad = Math.ceil(rr * 0.9) + 6;
  const size = (rr + pad) * 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const cx = size / 2, cy = size / 2;

  const base = tempColor(planet.temp ?? 0);
  const hab = habitability(planet);
  // The more habitable a world, the more earth-like: oceans spread over the
  // sphere, the continents keep the temperature color. That keeps the ground
  // rule "color = temperature" readable - a world that is too warm has yellow
  // continents, a cool one blue-green ones - and an ice world still stays
  // distinguishable because its blue carries no land masses.
  const earth = Math.max(0, Math.min(1, (hab - 0.55) / 0.3));
  const OCEAN = [30, 84, 168];
  const surface = earth > 0 ? mix(base, OCEAN, earth * 0.82) : base;
  const seed = planet.ringSeed ?? (planet.id * 2654435761);
  const rnd = rngFrom(seed);
  const hasRing = (seed % 11) === 0 && rr > 7;
  const memory = planet.known === 'memory';

  // ---- Atmosphere / corona
  const glowR = rr * (1.5 + hab * 0.35);
  const glow = g.createRadialGradient(cx, cy, rr * 0.85, cx, cy, glowR);
  const glowCol = mix(surface, [255, 255, 255], 0.25);
  glow.addColorStop(0, rgb(glowCol, (0.3 + hab * 0.3) * (memory ? 0.4 : 1)));
  glow.addColorStop(0.45, rgb(glowCol, 0.1 * (memory ? 0.4 : 1)));
  glow.addColorStop(1, rgb(glowCol, 0));
  g.fillStyle = glow;
  g.beginPath(); g.arc(cx, cy, glowR, 0, Math.PI * 2); g.fill();

  // ---- Ring (rare, purely cosmetic)
  if (hasRing) {
    g.save();
    g.translate(cx, cy);
    g.rotate(-0.42);
    g.scale(1, 0.26);
    const rg = g.createLinearGradient(-rr * 1.8, 0, rr * 1.8, 0);
    rg.addColorStop(0, rgb(shade(surface, 0.6), 0.0));
    rg.addColorStop(0.3, rgb(mix(surface, [255, 240, 210], 0.6), 0.55));
    rg.addColorStop(0.7, rgb(mix(surface, [255, 240, 210], 0.6), 0.55));
    rg.addColorStop(1, rgb(shade(surface, 0.6), 0.0));
    g.strokeStyle = rg;
    g.lineWidth = rr * 0.34;
    g.beginPath(); g.arc(0, 0, rr * 1.55, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  // ---- Sphere
  g.save();
  g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.clip();

  const lx = cx - rr * 0.34, ly = cy - rr * 0.36;
  const body = g.createRadialGradient(lx, ly, rr * 0.08, cx, cy, rr * 1.18);
  body.addColorStop(0, rgb(mix(surface, [255, 255, 255], 0.55)));
  body.addColorStop(0.28, rgb(mix(surface, [255, 255, 255], 0.16)));
  body.addColorStop(0.62, rgb(surface));
  body.addColorStop(0.9, rgb(shade(surface, 0.52)));
  body.addColorStop(1, rgb(shade(surface, 0.32)));
  g.fillStyle = body;
  g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);

  // Surface: continents on the ocean, otherwise spots and craters.
  const continental = hab > 0.3;
  const blobs = Math.round(3 + rnd() * 5) + Math.round(earth * 3);
  // On the ocean, land should sit opaque rather than shine through.
  const land = mix(base, [34, 112, 52], 0.3 + earth * 0.2);
  for (let i = 0; i < blobs; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.pow(rnd(), 0.6) * rr * 0.82;
    const bx = cx + Math.cos(a) * d, by = cy + Math.sin(a) * d;
    const br = rr * (0.16 + rnd() * 0.3) * (1 - earth * 0.3);
    const tint = continental ? land : shade(base, 0.74);
    g.fillStyle = rgb(tint, continental ? 0.5 + earth * 0.42 : 0.42);
    g.beginPath();
    // Irregular outlines; on earth-like worlds they get more jagged so they
    // look like coastlines and not like dots.
    const steps = earth > 0 ? 15 : 9;
    const jag = 0.56 + earth * 0.5;
    for (let s = 0; s <= steps; s++) {
      const ang = (s / steps) * Math.PI * 2;
      const wob = br * (0.72 + rngFrom(seed + i * 31 + s)() * jag);
      const px = bx + Math.cos(ang) * wob, py = by + Math.sin(ang) * wob * 0.82;
      s === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath(); g.fill();
  }
  // Islands: a few dots to keep the coastlines company
  if (earth > 0.35 && rr > 9) {
    g.fillStyle = rgb(land, 0.55 + earth * 0.3);
    for (let i = 0; i < Math.round(earth * 5); i++) {
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.5) * rr * 0.86;
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d,
        rr * (0.04 + rnd() * 0.05), rr * (0.03 + rnd() * 0.04), rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Polar caps of earth-like worlds: small, but they are what makes the
  // sphere an Earth. Ice worlds get their much larger caps further below.
  if (earth > 0.15) {
    const cap = 0.26 + earth * 0.16;
    for (const sgn of [-1, 1]) {
      const kg = g.createRadialGradient(cx, cy + sgn * rr * 1.02, rr * 0.05,
        cx, cy + sgn * rr * 1.02, rr * (0.5 + earth * 0.22));
      kg.addColorStop(0, `rgba(248,252,255,${0.78 * earth})`);
      kg.addColorStop(0.6, `rgba(236,246,255,${0.4 * earth})`);
      kg.addColorStop(1, 'rgba(236,246,255,0)');
      g.fillStyle = kg;
      g.beginPath();
      g.ellipse(cx, cy + sgn * rr * (1 - cap * 0.52), rr * (0.52 + earth * 0.16),
        rr * cap, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Ice caps when cold
  if ((planet.temp ?? 0) < -20) {
    const icy = Math.min(1, (-20 - planet.temp) / 120);
    g.fillStyle = `rgba(242,250,255,${0.3 + icy * 0.55})`;
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx, cy + sgn * rr * (1 - icy * 0.35), rr * (0.55 + icy * 0.5), rr * (0.18 + icy * 0.42), 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Glow when hot
  if ((planet.temp ?? 0) > 110) {
    const heat = Math.min(1, (planet.temp - 110) / 110);
    g.strokeStyle = `rgba(255,228,120,${0.25 + heat * 0.45})`;
    g.lineWidth = Math.max(0.7, rr * 0.07);
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      let px = cx - rr + rnd() * rr * 0.4, py = cy - rr + rnd() * rr * 2;
      g.moveTo(px, py);
      for (let k = 0; k < 4; k++) {
        px += rr * (0.25 + rnd() * 0.3);
        py += rr * (rnd() - 0.5) * 0.7;
        g.lineTo(px, py);
      }
      g.stroke();
    }
  }

  // Clouds: only from a certain size on, otherwise the sphere just turns milky.
  if (earth > 0.4 && rr > 13) {
    g.fillStyle = `rgba(255,255,255,${0.13 + earth * 0.13})`;
    for (let i = 0; i < 3 + Math.round(earth * 3); i++) {
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.6) * rr * 0.76;
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d,
        rr * (0.18 + rnd() * 0.22), rr * (0.045 + rnd() * 0.05),
        rnd() * 0.8 - 0.4, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Terminator: shadow towards the bottom right
  const term = g.createRadialGradient(lx, ly, rr * 0.2, cx + rr * 0.3, cy + rr * 0.35, rr * 1.45);
  term.addColorStop(0, 'rgba(0,0,0,0)');
  term.addColorStop(0.55, 'rgba(0,0,0,0.05)');
  term.addColorStop(1, 'rgba(0,0,8,0.58)');
  g.fillStyle = term;
  g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);

  // Highlight
  const spec = g.createRadialGradient(lx, ly, 0, lx, ly, rr * 0.55);
  spec.addColorStop(0, 'rgba(255,255,255,0.62)');
  spec.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spec;
  g.beginPath(); g.ellipse(lx, ly, rr * 0.5, rr * 0.4, -0.5, 0, Math.PI * 2); g.fill();

  g.restore();

  // Rim light
  g.strokeStyle = rgb(mix(base, [255, 255, 255], 0.45), 0.5);
  g.lineWidth = Math.max(0.6, rr * 0.055);
  g.beginPath(); g.arc(cx, cy, rr - g.lineWidth / 2, Math.PI * 0.75, Math.PI * 1.85); g.stroke();

  if (memory) {
    // Last sighting: darkened, but the temperature color stays readable
    g.fillStyle = 'rgba(12,18,38,0.42)';
    g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.fill();
  }

  const sprite = { canvas: cv, cx, cy, r: rr };
  spriteCache.set(key, sprite);
  return sprite;
}

/** Draws a planet sprite centered at x/y with radius r on screen. */
export function blitPlanet(ctx, sp, x, y, r) {
  const k = r / sp.r;
  ctx.drawImage(sp.canvas, x - sp.cx * k, y - sp.cy * k, sp.canvas.width * k, sp.canvas.height * k);
}

/**
 * Draws a planet including ownership ring, population and metal indicators.
 */
export function drawPlanet(ctx, planet, x, y, zoom, opts = {}) {
  const { ownerColor = null, selected = false, hovered = false, showName = true, scale = 1 } = opts;
  const r = planetRadius(planet) * scale;

  if (planet.known === 'unknown') {
    drawUnknown(ctx, x, y, r, selected || hovered);
    if (showName && zoom > 0.55) label(ctx, planet.name ? planet.name : '???', x, y + r + 12, '#5b6478', zoom);
    return;
  }

  blitPlanet(ctx, planetSprite(planet, r), x, y, r);

  // Ownership ring
  if (ownerColor) {
    ctx.save();
    ctx.strokeStyle = ownerColor;
    ctx.lineWidth = Math.min(3.6, Math.max(1.4, r * 0.11));
    ctx.shadowColor = ownerColor;
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(x, y, r + ctx.lineWidth * 1.4, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // Homeworld marker
  if (planet.isHomeworld) {
    ctx.save();
    ctx.strokeStyle = 'rgba(240,180,41,.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(x, y, r * 1.14 + 5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  if (selected || hovered) {
    ctx.save();
    ctx.strokeStyle = selected ? '#ffd877' : 'rgba(255,255,255,.5)';
    ctx.lineWidth = selected ? 2 : 1.2;
    // Clearly outside the dashed homeworld ring, even when zoomed far in -
    // otherwise the two merge into a scribble.
    const rr = r * 1.14 + 5 + Math.min(14, Math.max(7, r * 0.07)) - (selected ? 0 : 2);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a0 = i * Math.PI / 2 + Math.PI / 4 - 0.38;
      // Start afresh before every arc: otherwise the canvas draws a chord from
      // the end of the last arc to the start of the next one.
      ctx.moveTo(x + Math.cos(a0) * rr, y + Math.sin(a0) * rr);
      ctx.arc(x, y, rr, a0, a0 + 0.76);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Everything outside the sphere is aligned to this radius
  const outer = r * 1.14 + 5;

  // Population (bar on the left) and metal (bar on the right)
  if (zoom > 0.8) {
    const bh = Math.min(26, Math.max(8, r * 1.05)), bw = Math.min(4, Math.max(2.5, r * 0.09));
    if (planet.pop > 0) {
      bar(ctx, x - outer - 3, y + bh / 2, bw, bh, Math.min(1, planet.pop / 45), 'rgba(110,240,138,.85)');
    }
    if (planet.metalReserve > 0) {
      bar(ctx, x + outer + 3, y + bh / 2, bw, bh, Math.min(1, planet.metalReserve / 900), 'rgba(201,180,138,.8)');
    }
  }

  if (showName && zoom > 0.5) {
    for (const l of planetLabels(planet, x, y, zoom, r)) label(ctx, l.text, l.x, l.y, l.color, zoom, l.size);
  }
}

/**
 * Size factor for everything orbiting a world. The flat and the 3D map use it
 * the same way, and the label thereby knows how far the orbit reaches.
 */
export function orbitScale(zoom) {
  return Math.max(0.5, Math.min(1.7, 0.7 + zoom * 0.4));
}

/**
 * Label of a planet. The map draws it in a separate pass so ships in orbit do
 * not cover the names.
 */
export function planetLabels(planet, x, y, zoom, r) {
  if (zoom <= 0.5) return [];
  const outer = r * 1.14 + 5;
  // Orbital defense circles further out - then the name moves down far enough
  // that no satellite runs over it on its round.
  const gap = planet.defenses > 0 ? Math.round(30 * orbitScale(zoom)) : 14;
  const out = [{
    text: planet.name, x, y: y + outer + gap,
    color: planet.known === 'memory' ? '#7c879c' : '#d6deef', size: 12.5
  }];
  if (planet.pop > 0 && zoom > 0.95) {
    out.push({ text: t('word.pop', { n: n1(planet.pop, 1) }),
      x, y: y + outer + gap + 13, color: '#7f8ca3', size: 11 });
  }
  return out;
}

function bar(ctx, x, yBottom, w, h, frac, color) {
  ctx.fillStyle = 'rgba(10,14,26,.6)';
  ctx.fillRect(x - w / 2, yBottom - h, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, yBottom - h * frac, w, h * frac);
}

function drawUnknown(ctx, x, y, r, highlight) {
  ctx.save();
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
  g.addColorStop(0, 'rgba(90,100,125,.5)');
  g.addColorStop(1, 'rgba(30,36,52,.65)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = highlight ? 'rgba(255,255,255,.6)' : 'rgba(120,135,165,.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(170,185,210,.7)';
  ctx.font = `600 ${Math.round(r * 0.9)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('?', x, y + 0.5);
  ctx.restore();
}

export function label(ctx, text, x, y, color, zoom, size = 12.5) {
  ctx.save();
  ctx.font = `500 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(3,5,12,.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Small planet icon for the side panel; color: the owner's, for the shield. */
export function planetThumb(planet, size = 42, color = null) {
  // Draw in device pixels, otherwise the fine honeycomb mesh blurs.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.round(size * dpr);
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  cv.style.width = cv.style.height = size + 'px';
  const ctx = cv.getContext('2d');
  // As on the map: from SHIELD_MIN satellites on, the shield surrounds the world.
  // The world then gets a little smaller so the sphere fits into the picture.
  const shielded = (planet.defenses || 0) >= SHIELD_MIN;
  const r = px * (shielded ? 0.27 : 0.34);
  blitPlanet(ctx, planetSprite({ ...planet, known: 'live' }, r), px / 2, px / 2, r);
  if (shielded) drawHexShield(ctx, px / 2, px / 2, px * 0.4, planet.id, 1, color);
  return cv;
}

export { IDEAL };
