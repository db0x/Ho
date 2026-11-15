// Outlines of the alien ships, shared by the map icons (ships.js) and the
// detailed profiles (shipshd/alien.js) so both show the same silhouette.
// Units of ship length / 100, pointing to the right (+x).

/**
 * The fighter: a broad crescent. Its back is a heavy mass, the two blades
 * stay wide for most of their length, curve inwards and end in sharp points
 * far ahead of the head; the opening between them is narrow.
 */
export function raiderWing(ctx, u = 1) {
  const P = (x, y) => [x * u, y * u];
  ctx.beginPath();
  ctx.moveTo(...P(54, -8));                                           // upper claw tip
  ctx.bezierCurveTo(...P(32, -24), ...P(8, -39), ...P(-18, -36.5));
  ctx.bezierCurveTo(...P(-38, -34), ...P(-46, -18), ...P(-46, 0));
  ctx.bezierCurveTo(...P(-46, 18), ...P(-38, 34), ...P(-18, 36.5));
  ctx.bezierCurveTo(...P(8, 39), ...P(32, 24), ...P(54, 8));          // lower claw tip
  ctx.bezierCurveTo(...P(32, 13.5), ...P(10, 15), ...P(-4, 12.5));
  ctx.bezierCurveTo(...P(-11, 11), ...P(-14, 6), ...P(-14, 0));
  ctx.bezierCurveTo(...P(-14, -6), ...P(-11, -11), ...P(-4, -12.5));
  ctx.bezierCurveTo(...P(10, -15), ...P(32, -13.5), ...P(54, -8));
  ctx.closePath();
}

/** The head: a slim pod on the back of the crescent, reaching out into the opening, the eye in front. */
export function raiderHead(ctx, u = 1) {
  const P = (x, y) => [x * u, y * u];
  ctx.beginPath();
  ctx.moveTo(...P(-48, -3.5));
  ctx.bezierCurveTo(...P(-36, -7), ...P(-6, -7), ...P(4, -5));
  ctx.bezierCurveTo(...P(8.5, -3.8), ...P(10, -2), ...P(10, 0));
  ctx.bezierCurveTo(...P(10, 2), ...P(8.5, 3.8), ...P(4, 5));
  ctx.bezierCurveTo(...P(-6, 7), ...P(-36, 7), ...P(-48, 3.5));
  ctx.closePath();
}

/** The hump along the back of the head. */
export function raiderHump(ctx, u = 1) {
  const P = (x, y) => [x * u, y * u];
  ctx.beginPath();
  ctx.moveTo(...P(-47, 0));
  ctx.bezierCurveTo(...P(-43, -4), ...P(-16, -4), ...P(-4, -2));
  ctx.bezierCurveTo(...P(-1, -1), ...P(-1, 1), ...P(-4, 2));
  ctx.bezierCurveTo(...P(-16, 4), ...P(-43, 4), ...P(-47, 0));
  ctx.closePath();
}

/** One of the two engine pods at the stern, either side of the head (s = -1 or 1). */
export function raiderPod(ctx, s, u = 1) {
  ctx.beginPath();
  ctx.roundRect(-48 * u, (s * 12.5 - 3.6) * u, 26 * u, 7.2 * u, 3.6 * u);
}

/** Where the arms of a star point: three, a third of a turn apart. */
/** The two stars of the base ship: turn, reach of an arm, half width. */
export const STAR_UPPER = [0, 50, 6], STAR_LOWER = [Math.PI / 3, 47, 5.4];

export const starArms = (offset) => [0, 1, 2].map(i => offset + i * Math.PI * 2 / 3);

/**
 * Half width of an arm at radius r: broadest at the root, where it grows
 * out of the core, then a blade narrowing steadily to its point.
 */
export function armHalf(r, len, thick) {
  const f = Math.min(1, Math.max(0, (r - ROOT) / (len - ROOT)));
  return thick * (1 - Math.pow(f, 1.5)) * (1 + FLARE * Math.pow(1 - f, 4));
}
const ROOT = 7;
const FLARE = 0.25;     // the root is this much wider than the blade

/**
 * One star of the base ship: three long, broad blades tapering to points,
 * joined near the middle by small rounded hollows. `len` is the
 * reach of an arm, `thick` its half width.
 */
export function star(ctx, offset, len, thick, u = 1) {
  const arms = starArms(offset);
  // A point on an arm: r along it, w across it.
  const at = (a, r, w) => [(Math.cos(a) * r - Math.sin(a) * w) * u, (Math.sin(a) * r + Math.cos(a) * w) * u];
  const N = 14;
  ctx.beginPath();
  arms.forEach((a, i) => {
    // Out along one side to the point, back along the other
    for (let k = 0; k <= N; k++) {
      const r = ROOT + (len - ROOT) * k / N;
      const p = at(a, r, -armHalf(r, len, thick));
      if (i === 0 && k === 0) ctx.moveTo(...p); else ctx.lineTo(...p);
    }
    for (let k = N; k >= 0; k--) {
      const r = ROOT + (len - ROOT) * k / N;
      ctx.lineTo(...at(a, r, armHalf(r, len, thick)));
    }
    // The hollow over to the next arm
    const b = arms[(i + 1) % 3], mid = (a + b) / 2 + (i === 2 ? Math.PI : 0);
    const root = armHalf(ROOT, len, thick);
    ctx.quadraticCurveTo(Math.cos(mid) * root * 1.1 * u, Math.sin(mid) * root * 1.1 * u, ...at(b, ROOT, -root));
  });
  ctx.closePath();
}
