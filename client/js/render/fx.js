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
