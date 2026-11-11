// How a fighter looks, from the tech it was built with: the outline changes
// with the generation (Mk I - III, from weapons, shields and speed), the
// equipment with each research field in four steps. Shared by the detailed
// drawing (shipshd/fighter.js) and the map icon (ships.js), so both show the
// same ship. Mk I with nothing researched is the fighter as it always was.

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
 * Mk I is the fighter as before (after the Viper Mk VII in plan view).
 */
export const GENS = [
  { // Mk I: straight wedge of a fuselage, big swept wings, one tail fin
    hull: [[60, 1.1], [58, 1.9], [56, 2.1], [2, 12.4], [-10, 11.2], [-24, 10.2], [-31, 9.4], [-40, 8.4], [-43, 7.4], [-45, 5.6]],
    nose: 60, tail: -45,
    wing: [[3, 11.5], [-12.4, 30.4], [-21.6, 30.4], [-24.6, 15.6], [-27.4, 12.4], [-31.5, 9]],
    podY: 26, tip: { x0: -22.6, x1: -8.6 },
    spine: [[-1, 0], [-3, -3.4], [-28, -3.8], [-37, -3], [-44, -1.8], [-45, 0]],
    fins: 'single', canards: null,
    cab: [[16.5, 0], [15.6, -2.6], [13, -3.8], [1.5, -3.8], [-0.4, -2.6], [-0.8, 0]], cabTint: '#4f7cf0',
    seams: [46, 30, -8, -22, -36], stripeFrom: 34, engX: -50, r: 62
  },
  { // Mk II: longer nose with canards, sharper sweep, twin tail
    hull: [[66, 1], [64, 2], [60, 2.6], [22, 8.4], [0, 11.6], [-14, 11], [-28, 10], [-38, 9], [-44, 7.6], [-47, 5.8]],
    nose: 66, tail: -47,
    wing: [[-2, 11.2], [-23, 36], [-31, 36], [-31.5, 19], [-35, 13.5], [-39, 9.4]],
    podY: 31, tip: { x0: -32, x1: -19 },
    spine: [[4, 0], [2, -3.2], [-30, -3.6], [-40, -2.8], [-46, -1.6], [-47, 0]],
    fins: 'twin', canards: [[36, 7], [25, 15.5], [20.5, 15.5], [22, 8]],
    cab: [[27, 0], [26, -2.6], [22.5, -3.6], [6, -3.6], [4, -2.4], [3.5, 0]], cabTint: '#4fb6f0',
    seams: [52, 40, 12, -12, -26, -40], stripeFrom: 44, engX: -52, r: 66
  },
  { // Mk III: delta with the fuselage blended into the wing, canted fins, golden canopy
    hull: [[64, 0.8], [62, 1.8], [58, 2.8], [32, 6.4], [12, 10.4], [-16, 12.6], [-36, 12.2], [-45, 10.4], [-50, 7.4]],
    nose: 64, tail: -50,
    wing: [[24, 7.4], [-30, 39], [-39, 39], [-41, 24], [-45.5, 14], [-49, 9.6]],
    podY: 33, tip: { x0: -40, x1: -26 },
    spine: [[10, 0], [8, -3], [-34, -4.2], [-44, -3.4], [-49, -2], [-50, 0]],
    fins: 'canted', canards: null,
    cab: [[37, 0], [36, -2.4], [32.5, -3.4], [17, -3.4], [15, -2.2], [14.6, 0]], cabTint: '#e8b04a',
    seams: [50, 38, 0, -20, -38], stripeFrom: 46, engX: -54, r: 68
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

/** Front of the gun pods: a little ahead of the leading edge, as on the Mk I of old. */
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
