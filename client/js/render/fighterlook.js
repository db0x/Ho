// How a fighter looks, from the tech it was built with: the outline changes
// with the generation (Mk I - III, from weapons, shields and speed), the
// equipment with each research field in four steps. Shared by the detailed
// drawing (shipshd/fighter.js) and the map icon (ships.js), so both show the
// same ship.

/** Step of a research field: 1-9, 10-19, 20-29, 30-40. */
export const tierOf = (level) => level < 10 ? 0 : level < 20 ? 1 : level < 30 ? 2 : 3;

/** Generation from the mean of weapons, shields and speed: Mk I up to 12, Mk II up to 25, Mk III above. */
export function genOf(tech) {
  const avg = ((tech?.weapons || 1) + (tech?.shields || 1) + (tech?.speed || 1)) / 3;
  return avg <= 12 ? 0 : avg <= 25 ? 1 : 2;
}

/**
 * The look of a fighter: generation and the step of every field - and a
 * short key for caches. Without tech (a foreign ship whose tech is unknown)
 * the plain Mk I.
 * @returns {{gen: number, w: number, s: number, v: number, r: number, key: string}}
 */
export function fighterLook(tech) {
  const look = tech ? {
    gen: genOf(tech), w: tierOf(tech.weapons || 1), s: tierOf(tech.shields || 1),
    v: tierOf(tech.speed || 1), r: tierOf(tech.range || 1)
  } : { gen: 0, w: 0, s: 0, v: 0, r: 0 };
  look.key = `${look.gen}${look.w}${look.s}${look.v}${look.r}`;
  return look;
}
export const PLAIN = fighterLook(null);

/** Roman numeral of the generation, for lists ("Mk II"). */
export const MARK = ['I', 'II', 'III'];

/** Flame color by the step of the drive: blue, blue-violet, violet, white-hot. */
export const FLAME = ['#7fd8ff', '#8fb4ff', '#b98cff', '#eaf6ff'];
/** How much longer the flame gets with the drive. */
export const FLAME_LEN = [1, 1.25, 1.3, 1.45];

/**
 * The outlines on a grid of 100 units of ship length, pointing to +x.
 * An interceptor of its own: a slender, almost parallel fuselage, the
 * canopy well forward and running into the dorsal spine, a wider engine section at the back
 * with the nozzles bunched together, short clipped wings set well aft with
 * a gun pod on each tip, and a tall tail.
 */
export const GENS = [
  { // Mk I: slim fuselage, short clipped delta wings, one tall fin
    hull: [[46, 1.2], [45, 2.6], [42, 4], [34, 5.4], [30, 6], [18, 7], [0, 7.4], [-12, 7.8], [-20, 9.6], [-34, 10], [-40, 9.4], [-43, 7.8], [-44, 5.8]],
    nose: 46, tail: -44,
    wing: [[-2, 7.5], [-22, 26], [-30, 26], [-33, 14], [-37, 10]],
    podY: 26.6, tip: { x0: -31, x1: -18 },
    spine: [[16, 0], [14, -3.2], [-26, -3.4], [-36, -2.6], [-43, -1.6], [-44, 0]],
    fins: 'single', canards: null,
    cab: [[30, 0], [29, -2.4], [26.5, -3.6], [14, -3.6], [12, -2.8], [11.5, 0]], cabTint: '#4f7cf0',
    seams: [38, 22, 4, -14, -30], stripeFrom: 32, engX: -49, r: 56
  },
  { // Mk II: longer, wider wings, twin tail
    hull: [[52, 1.2], [51, 2.6], [48, 4], [40, 5.6], [36, 6.2], [22, 7.3], [2, 7.6], [-12, 8.2], [-20, 10.2], [-34, 10.6], [-41, 10], [-45, 8.2], [-46, 6]],
    nose: 52, tail: -46,
    wing: [[0, 7.6], [-21, 30], [-30, 30], [-33, 16], [-38, 10.6]],
    podY: 30.6, tip: { x0: -31, x1: -17 },
    spine: [[21, 0], [19, -3.2], [-28, -3.4], [-38, -2.6], [-45, -1.6], [-46, 0]],
    fins: 'twin', canards: null,
    cab: [[36, 0], [35, -2.4], [32.5, -3.6], [19, -3.6], [17, -2.8], [16.5, 0]], cabTint: '#4fb6f0',
    seams: [44, 28, 10, -12, -28, -40], stripeFrom: 38, engX: -51, r: 60
  },
  { // Mk III: the fuselage blended into a cranked arrow wing, canted fins, golden canopy
    hull: [[56, 1.1], [55, 2.4], [52, 3.8], [42, 5.6], [38, 6.2], [22, 8], [0, 9.6], [-20, 11], [-36, 11.4], [-45, 10], [-50, 7.2]],
    nose: 56, tail: -50,
    wing: [[14, 8.4], [-28, 32], [-36, 32], [-40, 20], [-45, 13], [-49, 9]],
    podY: 32.6, tip: { x0: -37, x1: -24 },
    spine: [[23, 0], [21, -3.4], [-34, -4.2], [-44, -3.4], [-49, -2], [-50, 0]],
    fins: 'canted', canards: null,
    cab: [[38, 0], [37, -2.4], [34, -3.6], [21, -3.6], [19, -2.6], [18.6, 0]], cabTint: '#e8b04a',
    seams: [46, 32, 4, -20, -38], stripeFrom: 40, engX: -54, r: 64
  }
];

/** Half width of the fuselage at x. */
export function halfWidth(hull, x) {
  for (let i = 1; i < hull.length; i++) {
    const [x0, y0] = hull[i - 1], [x1, y1] = hull[i];
    if (x <= x0 && x >= x1) return y0 + (y1 - y0) * (x0 - x) / (x0 - x1);
  }
  return hull[hull.length - 1][1];
}

/** x of the wing's leading edge at height y. */
export function leadX(G, y) {
  const [[x0, y0], [x1, y1]] = G.wing;
  return x0 + (x1 - x0) * (y - y0) / (y1 - y0);
}

/** Front of the gun pods on the wing tips: a little ahead of the leading edge. */
export function podX(G) {
  return leadX(G, G.podY) + 4.8;
}

/**
 * The nozzles by the step of the drive: 3, 3 bigger, 4, 5 - the middle one
 * of an odd number a little bigger and further back. Three sit close
 * together as always; four and five need an engine block.
 */
export function engineLayout(G, v) {
  const n = [3, 3, 4, 5][v], k = [1, 1.18, 1.1, 1.08][v];
  const base = 3.4 * k, gap = base * (n === 3 ? 1.35 : 1.95);
  const out = [];
  for (let i = 0; i < n; i++) {
    const centre = n % 2 === 1 && i === (n - 1) / 2;
    out.push({ x: G.engX - (centre ? 1 : 0), y: (i - (n - 1) / 2) * gap, r: centre ? base * 1.12 : base * 0.94 });
  }
  return out;
}

/** Where the shield emitters sit: both wing tips and the spine. */
export function emitters(G) {
  const ty = G.wing[1][1];
  return [{ x: G.tip.x1 - 3, y: -(ty - 2.4) }, { x: G.tip.x1 - 3, y: ty - 2.4 }, { x: G.spine[2][0] + 4, y: 0 }];
}

/** The fighter of a fleet that shows it on the map: the most advanced one. */
export function bestFighter(ships) {
  let best = null, score = -1;
  for (const s of ships || []) {
    if (s.type !== 'fighter' || !s.tech) continue;
    const l = fighterLook(s.tech);
    const v = l.gen * 100 + l.w + l.s + l.v + l.r;
    if (v > score) { score = v; best = s; }
  }
  return best;
}

/** The tech of a unit in a battle replay ([side, type, hp, maxHp, [w, s, v, r]]) - only fighters carry it. */
export function unitTech(u) {
  const t = u[4];
  return t ? { weapons: t[0], shields: t[1], speed: t[2], range: t[3] } : undefined;
}
