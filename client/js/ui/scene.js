// The stage shared by the sign-in page and the start menu: the drifting
// starry sky and the fade between the two pages.
//
// Kept in a module of its own on purpose: the sign-in page may only load
// what the server hands out without a session (see PUBLIC_EXACT in
// server/auth.js), and this file holds nothing but the scenery.
//
// The sky is the same on both pages: the stars come from a fixed seed and
// their position depends only on the wall clock. When sign-in hands over to
// the start menu, the new page shows exactly the sky the old one left off
// with - the page change itself stays invisible in the background.

const STAR_COUNT = 260;
const FRAME_PX_PER_S = 60;        // speeds below are "pixels per frame at 60 fps"

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Positions as fractions of the canvas, so every window size gets the same sky. */
const STARS = (() => {
  const rnd = seeded(20251021);
  return Array.from({ length: STAR_COUNT }, () => ({
    u: rnd(), v: rnd(),
    r: rnd() * 1.6 + 0.2,
    speed: (rnd() * 0.12 + 0.02) * FRAME_PX_PER_S,
    a: rnd() * 0.7 + 0.2
  }));
})();

/**
 * @param {HTMLCanvasElement} cv
 * @param {() => boolean} [visible] drawing pauses while this returns false
 */
export function startStars(cv, visible = () => true) {
  const ctx = cv.getContext('2d');
  const resize = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);
  const tick = () => {
    if (visible()) {
      const w = cv.clientWidth, h = cv.clientHeight;
      const t = Date.now() / 1000;
      ctx.clearRect(0, 0, w, h);
      for (const s of STARS) {
        const x = (s.u * w + s.speed * t) % w;
        ctx.fillStyle = `rgba(226,236,255,${s.a})`;
        ctx.fillRect(x, s.v * h, s.r, s.r);
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Shows the boxes of the page once its texts are in place - they float in
 * (CSS: html.scene-ready). Before that they stay invisible, so no empty box
 * flashes up while the catalogs load.
 */
export function sceneReady() {
  document.documentElement.classList.add('scene-ready');
}

const LEAVE_MS = 320;            // matches the scene-out animation in style.css

/** Lets the boxes float away, then goes to `url`. The sky keeps running. */
export function leaveTo(url) {
  if (reducedMotion()) { location.replace(url); return; }
  document.documentElement.classList.add('scene-leaving');
  setTimeout(() => location.replace(url), LEAVE_MS);
}
