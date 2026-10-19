// Kleine Zeichenhilfen, die sich flache und räumliche Karte teilen.
import { rgb } from '/shared/rules.js';

export function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const glowCache = new Map();
/** Weicher Fleck in der Reichsfarbe - einmal je Farbe. */
export function glowSprite(hex) {
  let cv = glowCache.get(hex);
  if (cv) return cv;
  const S = 128;
  cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const c = hexRgb(hex);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, rgb(c, 0.17));
  grad.addColorStop(0.45, rgb(c, 0.075));
  grad.addColorStop(1, rgb(c, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  glowCache.set(hex, cv);
  return cv;
}

/** Helligkeitsstufen für Sterne, einmal als Zeichenkette vorbereitet. */
export const STAR_ALPHA = Array.from({ length: 12 },
  (_, k) => `rgba(226,236,255,${((k + 0.5) / 12).toFixed(3)})`);

/** Darstellungsgröße des schwarzen Lochs: Faktor auf den Weltradius und eine
 *  Untergrenze in Bildpunkten, damit die Mitte auch von weit weg auffindbar ist. */
export const HOLE_SCALE = 1.3;
export const HOLE_MIN_PX = 16;
const TAU = Math.PI * 2;

// Form des Strudels - beide Ansichten rechnen damit, damit sie gleich aussehen.
export const SWIRL = { arme: 7, drall: 2.2, innen: 0.3, aussen: 0.75, tempo: 0.3 };

/** Punkt auf einem Strudelarm: t von 0 (innen) bis 1 (außen). */
export function swirlPoint(R, phase, arm, t) {
  const a = phase * SWIRL.tempo + arm * (TAU / SWIRL.arme) + SWIRL.drall * t;
  const r = R * (SWIRL.innen + SWIRL.aussen * t * t);
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/** Farbe und Strichstärke eines Armstücks - nach außen blasser und dünner. */
export function swirlStroke(ctx, R, t) {
  ctx.strokeStyle = `rgba(162,210,255,${(0.44 * Math.pow(1 - t, 1.5)).toFixed(3)})`;
  ctx.lineWidth = Math.max(0.7, R * 0.055) * (1 - 0.55 * t);
}

/**
 * Schlund und Photonenbogen - der Kern des schwarzen Lochs ohne die Arme.
 * Die Arme zeichnet jede Ansicht selbst: flach als Spirale, räumlich in der
 * Galaxienebene.
 */
export function drawHoleCore(ctx, x, y, R) {
  ctx.save();
  const glow = ctx.createRadialGradient(x, y, R * 0.32, x, y, R * 1.6);
  glow.addColorStop(0, 'rgba(126,186,255,0.12)');
  glow.addColorStop(0.5, 'rgba(96,156,255,0.04)');
  glow.addColorStop(1, 'rgba(70,120,230,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(x, y, R * 1.6, 0, TAU); ctx.fill();
  // Weich auslaufendes Dunkel statt harter Scheibe - eine schwarze Kreisfläche
  // sähe zwischen den glänzenden Welten aus wie ein Planet ohne Textur.
  const dark = ctx.createRadialGradient(x, y, 0, x, y, R * 0.32);
  dark.addColorStop(0, 'rgba(2,4,9,0.97)');
  dark.addColorStop(0.72, 'rgba(3,6,14,0.9)');
  dark.addColorStop(1, 'rgba(4,8,18,0)');
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(x, y, R * 0.32, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(214,238,255,0.85)';
  ctx.lineWidth = Math.max(0.7, R * 0.035);
  ctx.beginPath(); ctx.arc(x, y, R * 0.34, Math.PI * 0.72, Math.PI * 1.9); ctx.stroke();
  ctx.restore();
}

/**
 * Grenze der Sperrzone: ein gestrichelter Ring, der langsam dreht. Er sagt
 * dem Spieler, wie weit das Loch Schiffe abweist - ohne wuerde ein Umweg wie
 * ein Fehler der Wegfindung aussehen.
 */
export function drawHoleZone(ctx, x, y, R, phase = 0) {
  if (R < 6) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(150,190,255,.26)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 7]);
  ctx.lineDashOffset = phase * 9;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.stroke();
  ctx.restore();
}

/** Schwarzes Loch in der flachen Karte: Schlund plus Strudel ringsum. */
export function drawBlackHole(ctx, x, y, R, phase = 0) {
  drawHoleCore(ctx, x, y, R);
  const stuecke = Math.max(6, Math.min(18, Math.round(R / 5)));
  ctx.save();
  for (let k = 0; k < SWIRL.arme; k++) {
    let vx = 0, vy = 0;
    for (let i = 0; i <= stuecke; i++) {
      const t = i / stuecke;
      const [dx, dy] = swirlPoint(R, phase, k, t);
      if (i) {
        swirlStroke(ctx, R, t);
        ctx.beginPath();
        ctx.moveTo(vx, vy);
        ctx.lineTo(x + dx, y + dy);
        ctx.stroke();
      }
      vx = x + dx; vy = y + dy;
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------ Satellitenschild

/** Ab so vielen Satelliten zeigt eine Welt statt einzelner Satelliten den Schild. */
export const SHIELD_MIN = 5;

const shieldCache = new Map();
// Licht von oben links vorn - dieselbe Seite, von der die Welten beleuchtet sind.
const LICHT = (() => { const v = [-0.48, -0.58, 0.66]; const l = Math.hypot(...v); return v.map(c => c / l); })();

/**
 * Der Schild als Bild: eine Kugel aus Hexagonen. Das Wabennetz liegt auf der
 * Kugeloberflaeche und wird senkrecht aufs Bild projiziert - zur Mitte hin
 * sieht man die Waben von vorn, zum Rand hin schraeg und gestaucht. Licht
 * kommt von oben links: dort leuchten die Waben hell und es sitzt ein
 * Glanzlicht, die abgewandte Seite bleibt matt, und am Rand, wo man schraeg
 * durch die Huelle schaut, wird sie dicht und hell.
 */
function shieldSprite(R) {
  const rr = R < 40 ? Math.max(6, Math.round(R)) : Math.round(R / 4) * 4;
  let sp = shieldCache.get(rr);
  if (sp) return sp;
  const pad = Math.ceil(rr * 0.14) + 4;
  const size = (rr + pad) * 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const c = size / 2;

  // Wabengroesse als Winkel auf der Kugel; in der Bildmitte mindestens ein
  // paar Bildpunkte, sonst verschwimmt das Netz auf kleinen Karten.
  // Gross im Bild (Schlachtfenster) feiner, sonst wirken die Waben grob.
  const h = Math.max(rr > 120 ? 0.085 : 0.12, 4.2 / rr);
  const dx = Math.sqrt(3) * h, dy = 1.5 * h;
  const RAND = Math.PI / 2 - h * 0.35;
  // Punkt auf der Kugel (Abstand vom Bildmittelpunkt als Winkel) -> Bild
  const proj = (u, v) => {
    const th = Math.min(Math.hypot(u, v), Math.PI / 2);
    const k = th < 1e-6 ? 1 : Math.sin(th) / Math.hypot(u, v);
    return [c + u * k * rr, c + v * k * rr];
  };
  g.lineJoin = 'round';
  const n = Math.ceil(RAND / dy) + 1;
  for (let row = -n; row <= n; row++) {
    const off = (row & 1) ? dx / 2 : 0;
    for (let col = -Math.ceil(RAND / dx) - 1; col <= Math.ceil(RAND / dx) + 1; col++) {
      const u = col * dx + off, v = row * dy;
      const th = Math.hypot(u, v);
      if (th > RAND) continue;
      // Flaechennormale der Wabe und wie sie zum Licht und zum Auge steht
      const st = th < 1e-6 ? 0 : Math.sin(th) / th;
      const nx = u * st, ny = v * st, nz = Math.cos(th);
      const licht = nx * LICHT[0] + ny * LICHT[1] + nz * LICHT[2];
      const hell = Math.max(0, licht);
      const rand = Math.pow(1 - nz, 1.6);                  // Fresnel: schraeg = dicht
      const a = Math.min(0.95, (0.24 + 0.55 * rand + 0.55 * hell * hell) * (licht < 0 ? 0.6 : 1));
      const weiss = Math.pow(hell, 6);                       // im Glanz fast weiss
      const col3 = [Math.round(70 + 160 * weiss), Math.round(240 + 15 * weiss), Math.round(120 + 115 * weiss)];
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const w = Math.PI / 6 + k * Math.PI / 3;
        const [px, py] = proj(u + Math.cos(w) * h * 0.86, v + Math.sin(w) * h * 0.86);
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fillStyle = `rgba(${col3},${(a * 0.22 + hell * 0.06).toFixed(3)})`;
      g.fill();
      // Linien werden zum Rand hin schmaler wie die Waben selbst
      g.lineWidth = Math.max(0.7, h * rr * 0.1 * (0.45 + 0.55 * nz));
      g.strokeStyle = `rgba(${col3},${a.toFixed(3)})`;
      g.stroke();
    }
  }

  // Huelle: matter gruener Hauch, zum Licht hin heller
  const lx = c + LICHT[0] * rr * 0.5, ly = c + LICHT[1] * rr * 0.5;
  const huelle = g.createRadialGradient(lx, ly, rr * 0.1, c, c, rr);
  huelle.addColorStop(0, 'rgba(120,255,170,0.10)');
  huelle.addColorStop(0.7, 'rgba(60,200,110,0.04)');
  huelle.addColorStop(1, 'rgba(60,200,110,0.10)');
  g.fillStyle = huelle;
  g.beginPath(); g.arc(c, c, rr, 0, TAU); g.fill();

  // Glanzlicht oben links - weich, leicht in die Laenge gezogen
  g.save();
  g.translate(c + LICHT[0] * rr * 0.52, c + LICHT[1] * rr * 0.52);
  g.rotate(Math.atan2(LICHT[1], LICHT[0]) + Math.PI / 2);
  g.scale(1, 0.62);
  const glanz = g.createRadialGradient(0, 0, 0, 0, 0, rr * 0.42);
  glanz.addColorStop(0, 'rgba(240,255,245,0.6)');
  glanz.addColorStop(0.35, 'rgba(170,255,200,0.24)');
  glanz.addColorStop(1, 'rgba(120,255,170,0)');
  g.fillStyle = glanz;
  g.beginPath(); g.arc(0, 0, rr * 0.42, 0, TAU); g.fill();
  g.restore();

  // Leuchtender Saum, auf der Lichtseite kraeftiger
  const saum = g.createRadialGradient(c, c, rr * 0.88, c, c, rr + pad * 0.85);
  saum.addColorStop(0, 'rgba(90,255,140,0)');
  saum.addColorStop(0.5, 'rgba(120,255,170,0.36)');
  saum.addColorStop(1, 'rgba(90,255,140,0)');
  g.fillStyle = saum;
  g.beginPath(); g.arc(c, c, rr + pad * 0.85, 0, TAU); g.fill();
  const bogen = g.createLinearGradient(c + LICHT[0] * rr, c + LICHT[1] * rr, c - LICHT[0] * rr, c - LICHT[1] * rr);
  bogen.addColorStop(0, 'rgba(220,255,230,0.75)');
  bogen.addColorStop(0.45, 'rgba(140,255,180,0.12)');
  bogen.addColorStop(1, 'rgba(140,255,180,0.28)');
  g.strokeStyle = bogen;
  g.lineWidth = Math.max(1, rr * 0.03);
  g.beginPath(); g.arc(c, c, rr - g.lineWidth / 2, 0, TAU); g.stroke();

  sp = { canvas: cv, half: size / 2, rr };
  if (shieldCache.size > 60) shieldCache.clear();
  shieldCache.set(rr, sp);
  return sp;
}

/**
 * Schild um eine Welt. strength 0..1 macht ihn blasser - in der Schlacht
 * folgt er den Satelliten, die ihn tragen; bei 0 ist er weg.
 */
export function drawHexShield(ctx, x, y, R, phase = 0, strength = 1) {
  if (strength <= 0.01 || R < 4) return;
  const sp = shieldSprite(R);
  const s = R / sp.rr;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Ein schwacher Schild flackert, ein voller atmet nur leicht
  const flimmer = strength < 0.35 ? 0.6 + 0.4 * Math.sin(phase * 31) * Math.sin(phase * 13) : 1;
  ctx.globalAlpha *= strength * flimmer * (0.88 + 0.12 * Math.sin(phase * 1.7));
  ctx.drawImage(sp.canvas, x - sp.half * s, y - sp.half * s, sp.canvas.width * s, sp.canvas.height * s);
  // Energie, die langsam ueber die Huelle wandert: ein schmaler Lichtbogen
  // auf der Schattenseite, damit die Kugel nicht starr wirkt.
  const a = Math.atan2(-LICHT[1], -LICHT[0]) + Math.sin(phase * 0.5) * 0.9;
  ctx.strokeStyle = 'rgba(150,255,190,0.22)';
  ctx.lineWidth = Math.max(1, R * 0.025);
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y, R * 0.96, a - 0.35, a + 0.35); ctx.stroke();
  ctx.restore();
}

/** Treffer auf dem Schild: gruenes Aufleuchten am Einschlagpunkt, k = 0..1. */
export function drawShieldHit(ctx, x, y, size, k) {
  if (k < 0 || k > 1) return;
  const a = 1 - k;
  const r = size * (0.6 + 0.6 * k);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(220,255,230,${(a * 0.9).toFixed(3)})`);
  g.addColorStop(0.35, `rgba(110,255,160,${(a * 0.55).toFixed(3)})`);
  g.addColorStop(1, 'rgba(60,220,110,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}
