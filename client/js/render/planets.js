// Planetendarstellung im Stil des Klassikers: glaenzende, satt gefaerbte
// Kugeln - Farbe = Temperatur, Größe = Schwerkraft.
import { tempColor, rgb, habitability, IDEAL } from '/shared/rules.js';
import { t, n as n1 } from '../i18n.js';

const spriteCache = new Map();
const MAX_CACHE = 1400;

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

/** Radius eines Planeten: die Schwerkraft bestimmt die Größe. */
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
 * Rendert die Kugel eines Planeten in ein eigenes Canvas (gecacht).
 * @param {object} planet
 * @param {number} r Radius in Pixeln
 */
export function planetSprite(planet, r) {
  // Radius in Stufen runden, damit der Cache beim Zoomen nicht überläuft
  const rr = r < 26 ? Math.max(4, Math.round(r)) : Math.round(r / 3) * 3;
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
  // Je bewohnbarer eine Welt, desto erdähnlicher: Ozeane legen sich über die
  // Kugel, die Kontinente behalten die Temperaturfarbe. Damit bleibt die
  // Grundregel "Farbe = Temperatur" lesbar - eine zu warme Welt hat gelbe
  // Kontinente, eine kühle blaugrüne - und eine Eiswelt bleibt trotzdem
  // unterscheidbar, weil ihr Blau keine Landmassen trägt.
  const erde = Math.max(0, Math.min(1, (hab - 0.55) / 0.3));
  const OZEAN = [30, 84, 168];
  const basis = erde > 0 ? mix(base, OZEAN, erde * 0.82) : base;
  const seed = planet.ringSeed ?? (planet.id * 2654435761);
  const rnd = rngFrom(seed);
  const hasRing = (seed % 11) === 0 && rr > 7;
  const memory = planet.known === 'memory';

  // ---- Atmosphaere / Korona
  const glowR = rr * (1.5 + hab * 0.35);
  const glow = g.createRadialGradient(cx, cy, rr * 0.85, cx, cy, glowR);
  const glowCol = mix(basis, [255, 255, 255], 0.25);
  glow.addColorStop(0, rgb(glowCol, (0.3 + hab * 0.3) * (memory ? 0.4 : 1)));
  glow.addColorStop(0.45, rgb(glowCol, 0.1 * (memory ? 0.4 : 1)));
  glow.addColorStop(1, rgb(glowCol, 0));
  g.fillStyle = glow;
  g.beginPath(); g.arc(cx, cy, glowR, 0, Math.PI * 2); g.fill();

  // ---- Ring (selten, rein kosmetisch)
  if (hasRing) {
    g.save();
    g.translate(cx, cy);
    g.rotate(-0.42);
    g.scale(1, 0.26);
    const rg = g.createLinearGradient(-rr * 1.8, 0, rr * 1.8, 0);
    rg.addColorStop(0, rgb(shade(basis, 0.6), 0.0));
    rg.addColorStop(0.3, rgb(mix(basis, [255, 240, 210], 0.6), 0.55));
    rg.addColorStop(0.7, rgb(mix(basis, [255, 240, 210], 0.6), 0.55));
    rg.addColorStop(1, rgb(shade(basis, 0.6), 0.0));
    g.strokeStyle = rg;
    g.lineWidth = rr * 0.34;
    g.beginPath(); g.arc(0, 0, rr * 1.55, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  // ---- Kugel
  g.save();
  g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.clip();

  const lx = cx - rr * 0.34, ly = cy - rr * 0.36;
  const body = g.createRadialGradient(lx, ly, rr * 0.08, cx, cy, rr * 1.18);
  body.addColorStop(0, rgb(mix(basis, [255, 255, 255], 0.55)));
  body.addColorStop(0.28, rgb(mix(basis, [255, 255, 255], 0.16)));
  body.addColorStop(0.62, rgb(basis));
  body.addColorStop(0.9, rgb(shade(basis, 0.52)));
  body.addColorStop(1, rgb(shade(basis, 0.32)));
  g.fillStyle = body;
  g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);

  // Oberfläche: Kontinente auf dem Ozean, sonst Flecken und Krater.
  const continental = hab > 0.3;
  const blobs = Math.round(3 + rnd() * 5) + Math.round(erde * 3);
  // Auf dem Ozean soll Land deckend sitzen, nicht durchscheinen.
  const land = mix(base, [34, 112, 52], 0.3 + erde * 0.2);
  for (let i = 0; i < blobs; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.pow(rnd(), 0.6) * rr * 0.82;
    const bx = cx + Math.cos(a) * d, by = cy + Math.sin(a) * d;
    const br = rr * (0.16 + rnd() * 0.3) * (1 - erde * 0.3);
    const tint = continental ? land : shade(base, 0.74);
    g.fillStyle = rgb(tint, continental ? 0.5 + erde * 0.42 : 0.42);
    g.beginPath();
    // Unregelmäßige Umrisse; erdähnlich werden sie zerklüfteter, damit es
    // nach Küsten aussieht und nicht nach Tupfen.
    const steps = erde > 0 ? 15 : 9;
    const zack = 0.56 + erde * 0.5;
    for (let s = 0; s <= steps; s++) {
      const ang = (s / steps) * Math.PI * 2;
      const wob = br * (0.72 + rngFrom(seed + i * 31 + s)() * zack);
      const px = bx + Math.cos(ang) * wob, py = by + Math.sin(ang) * wob * 0.82;
      s === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath(); g.fill();
  }
  // Inseln: ein paar Tupfer, die den Küsten Gesellschaft leisten
  if (erde > 0.35 && rr > 9) {
    g.fillStyle = rgb(land, 0.55 + erde * 0.3);
    for (let i = 0; i < Math.round(erde * 5); i++) {
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.5) * rr * 0.86;
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d,
        rr * (0.04 + rnd() * 0.05), rr * (0.03 + rnd() * 0.04), rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Polkappen der erdähnlichen Welten: klein, aber sie machen die Kugel erst
  // zur Erde. Eiswelten bekommen weiter unten ihre viel größeren Kappen.
  if (erde > 0.15) {
    const kappe = 0.26 + erde * 0.16;
    for (const sgn of [-1, 1]) {
      const kg = g.createRadialGradient(cx, cy + sgn * rr * 1.02, rr * 0.05,
        cx, cy + sgn * rr * 1.02, rr * (0.5 + erde * 0.22));
      kg.addColorStop(0, `rgba(248,252,255,${0.78 * erde})`);
      kg.addColorStop(0.6, `rgba(236,246,255,${0.4 * erde})`);
      kg.addColorStop(1, 'rgba(236,246,255,0)');
      g.fillStyle = kg;
      g.beginPath();
      g.ellipse(cx, cy + sgn * rr * (1 - kappe * 0.52), rr * (0.52 + erde * 0.16),
        rr * kappe, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Eiskappen bei Kaelte
  if ((planet.temp ?? 0) < -20) {
    const icy = Math.min(1, (-20 - planet.temp) / 120);
    g.fillStyle = `rgba(242,250,255,${0.3 + icy * 0.55})`;
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx, cy + sgn * rr * (1 - icy * 0.35), rr * (0.55 + icy * 0.5), rr * (0.18 + icy * 0.42), 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Glut bei Hitze
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

  // Wolken: erst ab einer gewissen Größe, sonst wird die Kugel nur milchig.
  if (erde > 0.4 && rr > 13) {
    g.fillStyle = `rgba(255,255,255,${0.13 + erde * 0.13})`;
    for (let i = 0; i < 3 + Math.round(erde * 3); i++) {
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.6) * rr * 0.76;
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d,
        rr * (0.18 + rnd() * 0.22), rr * (0.045 + rnd() * 0.05),
        rnd() * 0.8 - 0.4, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Terminator: Schatten nach unten rechts
  const term = g.createRadialGradient(lx, ly, rr * 0.2, cx + rr * 0.3, cy + rr * 0.35, rr * 1.45);
  term.addColorStop(0, 'rgba(0,0,0,0)');
  term.addColorStop(0.55, 'rgba(0,0,0,0.05)');
  term.addColorStop(1, 'rgba(0,0,8,0.58)');
  g.fillStyle = term;
  g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);

  // Glanzlicht
  const spec = g.createRadialGradient(lx, ly, 0, lx, ly, rr * 0.55);
  spec.addColorStop(0, 'rgba(255,255,255,0.62)');
  spec.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spec;
  g.beginPath(); g.ellipse(lx, ly, rr * 0.5, rr * 0.4, -0.5, 0, Math.PI * 2); g.fill();

  g.restore();

  // Kantenlicht
  g.strokeStyle = rgb(mix(base, [255, 255, 255], 0.45), 0.5);
  g.lineWidth = Math.max(0.6, rr * 0.055);
  g.beginPath(); g.arc(cx, cy, rr - g.lineWidth / 2, Math.PI * 0.75, Math.PI * 1.85); g.stroke();

  if (memory) {
    // Letzte Sichtung: abgedunkelt, aber die Temperaturfarbe bleibt lesbar
    g.fillStyle = 'rgba(12,18,38,0.42)';
    g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.fill();
  }

  const sprite = { canvas: cv, cx, cy, r: rr };
  if (spriteCache.size > MAX_CACHE) spriteCache.clear();
  spriteCache.set(key, sprite);
  return sprite;
}

/**
 * Zeichnet einen Planeten samt Besitzring, Bevoelkerungs- und Metallanzeige.
 */
export function drawPlanet(ctx, planet, x, y, zoom, opts = {}) {
  const { ownerColor = null, selected = false, hovered = false, showName = true, scale = 1 } = opts;
  const r = planetRadius(planet) * scale;

  if (planet.known === 'unknown') {
    drawUnknown(ctx, x, y, r, selected || hovered);
    if (showName && zoom > 0.55) label(ctx, planet.name ? planet.name : '???', x, y + r + 12, '#5b6478', zoom);
    return;
  }

  const sp = planetSprite(planet, r);
  ctx.drawImage(sp.canvas, x - sp.cx, y - sp.cy);

  // Besitzring
  if (ownerColor) {
    ctx.save();
    ctx.strokeStyle = ownerColor;
    ctx.lineWidth = Math.min(3.6, Math.max(1.4, r * 0.11));
    ctx.shadowColor = ownerColor;
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(x, y, r + ctx.lineWidth * 1.4, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // Heimatwelt-Markierung
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
    // Deutlich ausserhalb des gestrichelten Heimatwelt-Rings, auch wenn weit
    // hereingezoomt ist - sonst verschmelzen die beiden zu einem Gekrakel.
    const rr = r * 1.14 + 5 + Math.min(14, Math.max(7, r * 0.07)) - (selected ? 0 : 2);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a0 = i * Math.PI / 2 + Math.PI / 4 - 0.38;
      // Vor jedem Bogen neu ansetzen: sonst zieht die Leinwand eine Sehne vom
      // Ende des letzten Bogens zum Anfang des naechsten.
      ctx.moveTo(x + Math.cos(a0) * rr, y + Math.sin(a0) * rr);
      ctx.arc(x, y, rr, a0, a0 + 0.76);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Alles außerhalb der Kugel richtet sich nach diesem Radius
  const outer = r * 1.14 + 5;

  // Bevölkerung (Balken links) und Metall (Balken rechts)
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
 * Groessenfaktor fuer alles, was um eine Welt kreist. Flache und raeumliche
 * Karte rechnen damit gleich, und die Beschriftung weiss so, wie weit die
 * Umlaufbahn reicht.
 */
export function orbitScale(zoom) {
  return Math.max(0.5, Math.min(1.7, 0.7 + zoom * 0.4));
}

/**
 * Beschriftung eines Planeten. Wird von der Karte in einem eigenen Durchgang
 * gezeichnet, damit Schiffe im Orbit die Namen nicht verdecken.
 */
export function planetLabels(planet, x, y, zoom, r) {
  if (zoom <= 0.5) return [];
  const outer = r * 1.14 + 5;
  // Orbitalverteidigung kreist weiter aussen - dann rutscht der Name so weit
  // nach unten, dass kein Satellit ihn auf seiner Runde ueberfaehrt.
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

/** Kleines Planetensymbol für die Seitenleiste. */
export function planetThumb(planet, size = 42) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const sp = planetSprite({ ...planet, known: 'live' }, size * 0.34);
  ctx.drawImage(sp.canvas, size / 2 - sp.cx, size / 2 - sp.cy);
  return cv;
}

export { IDEAL };
