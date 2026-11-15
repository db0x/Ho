// Small ships in three dimensions for lists - the fleet panel on the desktop.
// A browser allows only a handful of WebGL contexts, so there is one stage,
// hidden, and every picture is drawn there in turn and copied onto a plain
// canvas of its own. All of them turn together, by the clock: a panel built
// anew (every update) goes on where the old one was.
import { shipStage3D, SOLID_FILL } from './ships3d.js';
import { UPRIGHT } from './ships.js';

const TURN = 0.35;         // radians per second
const TILT = 0.95;         // how far the view has come down from straight above
const FPS = 30;

let stage = null, glCanvas = null, broken = false;
/** Pictures on screen: canvas -> what it shows. */
const thumbs = new Map();
/** Models the stage has built already - a new one costs, one per frame. */
const built = new Set();
let frame = 0, lastPaint = 0;

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('fx-lite');

function ensureStage() {
  if (stage || broken) return stage;
  glCanvas = document.createElement('canvas');
  stage = shipStage3D(glCanvas, { tex: 512, fx: 256, keep: 12 });
  if (!stage) broken = true;
  return stage;
}

/** Whether a type can be shown this way here at all. */
export function canThumb3D(type) {
  return !UPRIGHT.has(type) && !!ensureStage();
}

/**
 * A canvas showing the ship turning in space, `size` CSS pixels square.
 * Null where that is not possible - the caller takes the flat icon.
 */
export function shipThumb3D(type, size, color, tech) {
  if (!canThumb3D(type)) return null;
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = cv.height = Math.round(size * dpr);
  cv.style.width = cv.style.height = size + 'px';
  cv.className = 'thumb3d';
  thumbs.set(cv, { type, color, tech, key: `${type}|${color}|${JSON.stringify(tech || {})}`, drawn: false });
  if (!frame) frame = requestAnimationFrame(paint);
  return cv;
}

function paint(ms) {
  frame = 0;
  // Gone from the page (the panel was rebuilt): forget it. The caller puts a
  // new picture on the page right away, so by now every live one is there.
  for (const cv of thumbs.keys()) if (!cv.isConnected) thumbs.delete(cv);
  if (!thumbs.size || !stage) return;
  const calm = still();
  const due = ms - lastPaint >= 1000 / FPS - 1;
  let fresh = 0;
  if (due) {
    lastPaint = ms;
    const s = ms / 1000;
    for (const [cv, o] of thumbs) {
      if (calm && o.drawn) continue;      // a still picture is drawn once
      if (!built.has(o.key)) {
        if (fresh++) continue;           // the next one in the next frame
        built.add(o.key);
      }
      const px = cv.width * 2;           // twice the size, scaled down: smooth edges
      if (glCanvas.width !== px) glCanvas.width = glCanvas.height = px;
      const ok = stage.draw({
        type: o.type, color: o.color, tech: o.tech, phase: s,
        yaw: 0.6 + (calm ? 0 : s * TURN), tilt: TILT, fill: SOLID_FILL[o.type] || 1
      });
      if (!ok) { broken = true; stage = null; return; }
      const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      g.drawImage(glCanvas, 0, 0, cv.width, cv.height);
      o.drawn = true;
    }
  }
  const pending = [...thumbs.values()].some(o => !o.drawn);
  if (!calm || pending) frame = requestAnimationFrame(paint);
}
