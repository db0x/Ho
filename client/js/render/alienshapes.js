// Outlines of the alien ships, shared by the map icons (ships.js) and the
// detailed profiles (shipshd/alien.js) so both show the same silhouette.
// Units of ship length / 100, pointing to the right (+x).

/**
 * The fighter: a crescent whose two long, thin claws reach far forward past
 * the head and end in sharp points; the broad back of it is the stern.
 */
export function raiderWing(ctx, u = 1) {
  const P = (x, y) => [x * u, y * u];
  ctx.beginPath();
  ctx.moveTo(...P(54, -15));                                          // upper claw tip
  ctx.bezierCurveTo(...P(36, -30), ...P(6, -38), ...P(-20, -34));
  ctx.bezierCurveTo(...P(-38, -30), ...P(-46, -16), ...P(-46, 0));
  ctx.bezierCurveTo(...P(-46, 16), ...P(-38, 30), ...P(-20, 34));
  ctx.bezierCurveTo(...P(6, 38), ...P(36, 30), ...P(54, 15));         // lower claw tip
  ctx.bezierCurveTo(...P(34, 23), ...P(8, 27), ...P(-12, 23));
  ctx.bezierCurveTo(...P(-26, 19), ...P(-32, 10), ...P(-32, 0));
  ctx.bezierCurveTo(...P(-32, -10), ...P(-26, -19), ...P(-12, -23));
  ctx.bezierCurveTo(...P(8, -27), ...P(34, -23), ...P(54, -15));
  ctx.closePath();
}

/** The head on the back of the crescent, its front with the eye towards the opening. */
export function raiderHead(ctx, u = 1) {
  const P = (x, y) => [x * u, y * u];
  ctx.beginPath();
  ctx.moveTo(...P(-44, -6));
  ctx.bezierCurveTo(...P(-32, -12), ...P(-6, -12), ...P(4, -8));
  ctx.bezierCurveTo(...P(9, -6), ...P(10, -3), ...P(10, 0));
  ctx.bezierCurveTo(...P(10, 3), ...P(9, 6), ...P(4, 8));
  ctx.bezierCurveTo(...P(-6, 12), ...P(-32, 12), ...P(-44, 6));
  ctx.closePath();
}

/** The hump along the back of the head. */
export function raiderHump(ctx, u = 1) {
  const P = (x, y) => [x * u, y * u];
  ctx.beginPath();
  ctx.moveTo(...P(-46, 0));
  ctx.bezierCurveTo(...P(-42, -6.5), ...P(-14, -6.5), ...P(-2, -3));
  ctx.bezierCurveTo(...P(1, -1.5), ...P(1, 1.5), ...P(-2, 3));
  ctx.bezierCurveTo(...P(-14, 6.5), ...P(-42, 6.5), ...P(-46, 0));
  ctx.closePath();
}

/** Where the arms of a star point: three, a third of a turn apart. */
export const starArms = (offset) => [0, 1, 2].map(i => offset + i * Math.PI * 2 / 3);

/**
 * Half width of an arm at radius r: flared at the root, where it grows out
 * of the core, then a tube almost to the end and a needle point.
 */
export function armHalf(r, len, thick) {
  const f = Math.min(1, Math.max(0, (r - ROOT) / (len - ROOT)));
  return thick * (1 - Math.pow(f, 2.4)) * (1 + FLARE * Math.pow(1 - f, 4));
}
const ROOT = 7;
const FLARE = 0.8;      // the root is this much wider than the tube

/**
 * One star of the base ship: three long tubular arms ending in needle
 * points, joined near the middle by small rounded hollows. `len` is the
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
