// Shared game rules - imported by the server and by the browser client.
// Everything here is purely functional and free of side effects.

export const MAX_PLAYERS = 16;

/** Ideal living conditions - the same for every race (as in the classic). */
export const IDEAL = { temp: 20, grav: 1.0 };

export const TEMP_RANGE = { min: -180, max: 220 };
export const GRAV_RANGE = { min: 0.1, max: 4.0 };

export const PLAYER_COLORS = [
  '#ff4d4d', '#4da6ff', '#3fd96b', '#ffd23f', '#c06cff', '#ff8c42',
  '#2fe0d0', '#ff6fb5', '#9bd642', '#6f7dff', '#e0c36c', '#49b3a1',
  '#ff5ea8', '#8ad6ff', '#d4ff4d', '#b07a4d'
];

export const PLAYER_EMBLEMS = [
  'Star', 'Comet', 'Crown', 'Anchor', 'Blade', 'Eye', 'Wave', 'Bolt',
  'Moon', 'Ring', 'Spear', 'Wheel', 'Flame', 'Arrow', 'Shield', 'Hat'
];

/**
 * Personalities of the AI empires. How they play is in server/bot.js;
 * name and description are in the catalog under persona.<key> / persona.<key>.desc.
 */
export const AI_PERSONAS = ['conqueror', 'settler', 'technocrat', 'raider', 'bulwark', 'vulture'];

/**
 * How well an AI empire plays. 'normal' follows its personality; 'hard' on
 * top of that learns from its mistakes (server/bot.js). Named in the catalog
 * under ai.<level>.
 */
export const AI_LEVELS = ['normal', 'hard'];

// ----------------------------------------------------------------- Technology

export const TECH_FIELDS = ['range', 'speed', 'weapons', 'shields', 'mini', 'radical', 'recycling'];

// Names, abbreviations and descriptions of the tech fields live in the catalogs
// (client/i18n/*.js) under tech.<field>.name / .short / .desc - only what has
// no language stays here.
export const techKey = (field, part = 'name') => `tech.${field}.${part}`;

export const TECH_START_LEVEL = 1;
export const TECH_MAX_LEVEL = 40;

/**
 * Highest level that still brings something. Recycling reaches its limits
 * (see recycleRates) well before the general maximum - research beyond that
 * would be money down the drain.
 */
export function techMaxLevel(field) {
  return field === 'recycling' ? RECYCLE_FULL_LEVEL : TECH_MAX_LEVEL;
}

/** Research points needed to get from `level` to `level + 1`. */
export function techCostToNext(level) {
  return Math.round(40 * Math.pow(level, 1.8));
}

// --------------------------------------------------------------------- Ships

export const SHIP_TYPES = ['scout', 'fighter', 'satellite', 'colony', 'tanker', 'transport'];

// Ship names and descriptions live in the catalogs under
// ship.<type>.name / .desc; only values that hold in every language are here.
export const shipKey = (type, part = 'name') => `ship.${type}.${part}`;

export const SHIP_DEFS = {
  scout: {
    icon: 'scout',
    money: 8, metal: 3, hull: 10,
    techs: ['range', 'speed'],
    attackMul: 0, shieldMul: 0.4, speedMul: 1.7, rangeMul: 1.9
  },
  fighter: {
    icon: 'fighter',
    money: 14, metal: 7, hull: 22,
    techs: ['range', 'speed', 'weapons', 'shields'],
    attackMul: 1, shieldMul: 1, speedMul: 1, rangeMul: 1
  },
  satellite: {
    icon: 'satellite',
    money: 10, metal: 5, hull: 34,
    techs: ['weapons', 'shields'],
    attackMul: 1.25, shieldMul: 1.6, speedMul: 0, rangeMul: 0
  },
  colony: {
    icon: 'colony',
    money: 30, metal: 12, hull: 16,
    techs: ['range', 'speed'],
    attackMul: 0, shieldMul: 0.6, speedMul: 0.8, rangeMul: 1.3,
    colonists: 8
  },
  tanker: {
    icon: 'tanker',
    money: 18, metal: 6, hull: 20,
    techs: ['range', 'speed'],
    attackMul: 0, shieldMul: 0.5, speedMul: 0.9, rangeMul: 2.6,
    tanker: true
  },
  // Carries satellites from one own world to another - as far and as fast as
  // a tanker, but without extending the fleet's range.
  transport: {
    icon: 'transport',
    money: 20, metal: 8, hull: 26,
    techs: ['range', 'speed'],
    attackMul: 0, shieldMul: 0.6, speedMul: 0.9, rangeMul: 2.6,
    cargo: 5
  }
};

/** Technology surcharge on the price: high levels are expensive. */
function techSurcharge(level) {
  return 2.6 * Math.pow(Math.max(0, level - 1), 1.45);
}

/** Miniaturization makes everything cheaper. */
export function miniFactor(miniLevel) {
  return 1 / (1 + 0.11 * (miniLevel - 1));
}

/**
 * Cost of a ship built with the given technology levels.
 * @param {string} type
 * @param {Record<string, number>} tech
 */
export function shipCost(type, tech) {
  const def = SHIP_DEFS[type];
  let extra = 0;
  for (const f of def.techs) extra += techSurcharge(tech[f] || 1);
  const mf = miniFactor(tech.mini || 1);
  return {
    money: Math.max(1, Math.round((def.money + extra) * mf)),
    metal: Math.max(1, Math.round((def.metal + extra * 0.35) * mf))
  };
}

/** Shipyard fee for refits - more expensive than building it right in the first place. */
export const REFIT_FEE = 1.25;

/**
 * Refit of an existing ship to the current levels: only the tech the type
 * has built in at all, and only upwards. The price is the surcharge of the
 * new levels plus the shipyard fee; the hull stays.
 * @returns {{tech: Record<string, number>, money: number, metal: number} | null}
 *   null if there is nothing to improve
 */
export function refitCost(type, shipTech, tech) {
  const def = SHIP_DEFS[type];
  if (!def) return null;
  const next = { ...shipTech };
  let extra = 0;
  for (const f of def.techs) {
    const old = shipTech[f] || 1, current = tech[f] || 1;
    if (current <= old) continue;
    next[f] = current;
    extra += techSurcharge(current) - techSurcharge(old);
  }
  if (extra <= 0) return null;
  const mf = miniFactor(tech.mini || 1) * REFIT_FEE;
  return {
    tech: next,
    money: Math.max(1, Math.round(extra * mf)),
    metal: Math.max(1, Math.round(extra * 0.35 * mf))
  };
}

// ------------------------------------------------------------------ Recycling

/**
 * Recycling takes ships apart again at an own shipyard: it costs money and
 * returns part of the metal. Level 1 means not yet researched; from level 2
 * on it is possible, and every level makes it cheaper and more thorough -
 * fast at first, then more slowly, until RECYCLE_FULL_LEVEL reaches the
 * limits: never more than 80% of the metal back, never cheaper than 5% of
 * the build price.
 */
export const RECYCLE_MIN_LEVEL = 2;
export const RECYCLE_FULL_LEVEL = 16;
export const RECYCLE_MAX_METAL = 0.8;
export const RECYCLE_MIN_COST = 0.05;

/**
 * Shares of the build price at this level: `cost` of the money is charged,
 * `metal` of the metal comes back. Null while not yet researched.
 */
export function recycleRates(level) {
  if (!(level >= RECYCLE_MIN_LEVEL)) return null;
  const x = Math.min(1, Math.sqrt((level - RECYCLE_MIN_LEVEL) / (RECYCLE_FULL_LEVEL - RECYCLE_MIN_LEVEL)));
  return {
    metal: 0.25 + (RECYCLE_MAX_METAL - 0.25) * x,
    cost: 0.5 - (0.5 - RECYCLE_MIN_COST) * x
  };
}

/**
 * What recycling these ships costs and yields. The basis is what each ship
 * cost when it was built - with the levels it carries. Rounded so the limits
 * hold: the cost up, the metal down.
 * @returns {{money: number, metal: number, count: number} | null} null while not researched
 */
export function recycleValue(ships, level) {
  const r = recycleRates(level);
  if (!r) return null;
  let money = 0, metal = 0;
  for (const s of ships) {
    const c = shipCost(s.type, s.tech || {});
    money += c.money; metal += c.metal;
  }
  return {
    money: ships.length ? Math.max(1, Math.ceil(money * r.cost - 1e-9)) : 0,
    metal: Math.floor(metal * r.metal + 1e-9),
    count: ships.length
  };
}

/** Sum over several ships; `count` = how many of them are outdated. */
export function refitTotal(ships, tech) {
  let money = 0, metal = 0, count = 0;
  for (const s of ships) {
    const c = refitCost(s.type, s.tech || {}, tech);
    if (!c) continue;
    money += c.money; metal += c.metal; count++;
  }
  return { money, metal, count };
}

/** Combat and flight stats of a ship based on its built-in tech levels. */
export function shipStats(type, tech) {
  const def = SHIP_DEFS[type];
  const speedL = tech.speed || 1, rangeL = tech.range || 1;
  const weapL = tech.weapons || 1, shieldL = tech.shields || 1;
  return {
    speed: def.speedMul * (42 + 13 * (speedL - 1)),
    range: def.rangeMul * (170 + 52 * (rangeL - 1)),
    attack: def.attackMul * (5 + 3.1 * (weapL - 1)),
    maxHp: Math.round(def.hull * (1 + def.shieldMul * 0.32 * (shieldL - 1))),
    mobile: def.speedMul > 0,
    colonists: def.colonists || 0,
    isTanker: !!def.tanker,
    cargo: def.cargo || 0
  };
}

/**
 * Satellites a fleet carries and how many it could carry. On the server a
 * transporter holds its cargo as a list, in the view only as a number.
 */
export function cargoOf(ships) {
  let used = 0, capacity = 0;
  for (const s of ships) {
    capacity += SHIP_DEFS[s.type]?.cargo || 0;
    used += Array.isArray(s.cargo) ? s.cargo.length : (s.cargo || 0);
  }
  return { used, capacity, room: capacity - used };
}

// --------------------------------------------------------------------- Planets

/** 0 = deadly, 1 = paradise. */
export function habitability(planet) {
  const dT = Math.abs(planet.temp - IDEAL.temp) / 100;
  const dG = Math.abs(planet.grav - IDEAL.grav) / 1.5;
  return clamp(1 - dT - dG, 0, 1);
}

/** Maximum population in millions. */
export function planetCapacity(planet) {
  const hab = habitability(planet);
  return Math.round((1.5 + 44 * Math.pow(hab, 1.25)) * (0.75 + 0.5 * planet.sizeFactor));
}

export const POP_GROWTH = 0.12;
export const INCOME_PER_POP = 1.6;
export const MINE_PER_POP = 0.5;

/** Income of a planet per turn. */
export function planetIncome(planet) {
  return planet.pop * INCOME_PER_POP * (0.55 + 0.45 * habitability(planet));
}

/**
 * Deep mining: once the reserve is exhausted, a world still mines this share.
 * Without it every long game freezes as soon as the ore is used up everywhere -
 * then no more ships can be built, not even colony ships.
 */
export const DEEP_MINING = 0.1;

/** Metal mined per turn: from the reserve, afterwards by deep mining. */
export function planetMining(planet) {
  const rate = planet.pop * MINE_PER_POP * planet.metalRichness;
  return Math.max(Math.min(planet.metalReserve, rate), rate * DEEP_MINING);
}

// Terraforming
export const TERRA_COST_PER_DEGREE = 9;
export const TERRA_COST_PER_G = 520;

export function terraLimits(radicalLevel) {
  return {
    temp: 30 + 26 * (radicalLevel - 1),
    grav: 0.35 + 0.3 * (radicalLevel - 1)
  };
}

/** Can the planet be touched at all with this radical level? */
export function terraformable(planet, radicalLevel) {
  const lim = terraLimits(radicalLevel);
  return {
    temp: Math.abs(planet.temp - IDEAL.temp) <= lim.temp + 0.001,
    grav: Math.abs(planet.grav - IDEAL.grav) <= lim.grav + 0.001
  };
}

/** What would it cost to bring this planet fully to the ideal? */
export function terraformFullCost(planet, radicalLevel) {
  const ok = terraformable(planet, radicalLevel);
  let cost = 0;
  if (ok.temp) cost += Math.abs(planet.temp - IDEAL.temp) * TERRA_COST_PER_DEGREE;
  if (ok.grav) cost += Math.abs(planet.grav - IDEAL.grav) * TERRA_COST_PER_G;
  return Math.round(cost);
}

// -------------------------------------------------------------------- Combat

export const COMBAT_ROUNDS = 12;

/**
 * Interception: whoever departs from an orbit holding an armed enemy fights
 * this many rounds before getting away. Three are enough for a single fighter
 * to reliably catch a scout.
 */
export const INTERCEPT_ROUNDS = 3;

/**
 * Planetary defense batteries. Every inhabited world defends itself -
 * large populations are tough nuts. The battery is never destroyed for
 * good, it is ready again every turn.
 */
export function batteryStats(pop, tech) {
  if (!(pop >= 0.5)) return null;
  return {
    hp: Math.round(pop * 45 * (1 + 0.14 * ((tech.shields || 1) - 1))),
    attack: Math.round(pop * 1.1 * (1 + 0.22 * ((tech.weapons || 1) - 1)) * 10) / 10
  };
}

// -------------------------------------------------------------------- Helpers

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Distance in space. Without z (classic) it is the distance in the plane. */
export function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ---------------------------------------------- Exclusion zone: black hole

/**
 * Exclusion zone around the black hole, as a multiple of its world radius.
 * The visible swirl arms reach out to about 1.4 times - the zone lies beyond
 * that, so it is clear that more than just the maw itself is meant.
 * The map limits it from above: no world comes closer to the hole than
 * 2.5 times, so an approach path always stays free.
 */
export const HOLE_BLOCK = 1.8;

/** Forbidden area of a galaxy, or null without a black hole. */
export function holeZone(galaxy) {
  const bh = galaxy && galaxy.blackHole;
  if (!bh) return null;
  return { x: bh.x, y: bh.y, z: bh.z || 0, r: bh.r * HOLE_BLOCK };
}

/** Shortest distance of the segment a-b to a point c. */
function segDist(a, b, c) {
  const vx = b.x - a.x, vy = b.y - a.y, vz = (b.z || 0) - (a.z || 0);
  const wx = c.x - a.x, wy = c.y - a.y, wz = (c.z || 0) - (a.z || 0);
  const len2 = vx * vx + vy * vy + vz * vz;
  const t = len2 > 0 ? clamp((wx * vx + wy * vy + wz * vz) / len2, 0, 1) : 0;
  const dx = wx - vx * t, dy = wy - vy * t, dz = wz - vz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Does the segment cross the exclusion zone? */
export function blocked(a, b, zone) {
  return !!zone && segDist(a, b, zone) < zone.r;
}

const TAU2 = Math.PI * 2;
const ARC_STEP = Math.PI / 12;        // approximate the arc in 15-degree pieces

/**
 * Path from a to b that goes around the outside of the exclusion zone: two
 * tangents and an arc, on the shorter of the two sides. Computed in the plane
 * through a, b and the center - so the same method works flat and in 3D.
 * Returns the waypoints after a; the last one is b.
 */
export function route(a, b, zone) {
  const to = { x: b.x, y: b.y, z: b.z || 0 };
  if (!blocked(a, b, zone)) return [to];
  const c = zone;
  // The arc is flown as a polyline; its chords would lie inside the circle.
  // That is why the detour radius is inflated just enough for the chords to
  // lie exactly on the zone boundary - otherwise every fleet would scrape by
  // a little too close to the hole.
  const r = zone.r / Math.cos(ARC_STEP / 2);
  // Span the plane: ex points to a, ey across it towards b.
  const p = { x: a.x - c.x, y: a.y - c.y, z: (a.z || 0) - c.z };
  const q = { x: b.x - c.x, y: b.y - c.y, z: (b.z || 0) - c.z };
  const dA = Math.hypot(p.x, p.y, p.z) || 1e-6;
  const ex = { x: p.x / dA, y: p.y / dA, z: p.z / dA };
  const qe = q.x * ex.x + q.y * ex.y + q.z * ex.z;
  let perp = { x: q.x - ex.x * qe, y: q.y - ex.y * qe, z: q.z - ex.z * qe };
  let pl = Math.hypot(perp.x, perp.y, perp.z);
  if (pl < 1e-6) {                     // a, b and center on one line
    perp = Math.abs(ex.z) < 0.9
      ? { x: -ex.y, y: ex.x, z: 0 }
      : { x: 1, y: 0, z: 0 };
    const px = perp.x - ex.x * (perp.x * ex.x + perp.y * ex.y + perp.z * ex.z);
    const py = perp.y - ex.y * (perp.x * ex.x + perp.y * ex.y + perp.z * ex.z);
    const pz = perp.z - ex.z * (perp.x * ex.x + perp.y * ex.y + perp.z * ex.z);
    perp = { x: px, y: py, z: pz };
    pl = Math.hypot(perp.x, perp.y, perp.z) || 1e-6;
  }
  const ey = { x: perp.x / pl, y: perp.y / pl, z: perp.z / pl };
  const dB = Math.hypot(q.x, q.y, q.z) || 1e-6;

  // Angles in this plane: a lies at 0, b somewhere between 0 and PI.
  const thA = 0, thB = Math.atan2(pl, qe);
  // If a point lies inside the detour radius, it goes straight outwards
  // onto the ring from there instead of along a tangent.
  const phA = dA > r ? Math.acos(clamp(r / dA, -1, 1)) : 0;
  const phB = dB > r ? Math.acos(clamp(r / dB, -1, 1)) : 0;
  const tanA = dA > r ? Math.sqrt(dA * dA - r * r) : 0;
  const tanB = dB > r ? Math.sqrt(dB * dB - r * r) : 0;

  let best = null;
  for (const s of [1, -1]) {
    const aA = thA + s * phA, aB = thB - s * phB;
    let sweep = s > 0 ? (aB - aA) : (aA - aB);
    sweep = ((sweep % TAU2) + TAU2) % TAU2;
    const len = tanA + r * sweep + tanB;
    if (!best || len < best.len) best = { s, aA, sweep, len };
  }
  const at = (ang) => ({
    x: c.x + (ex.x * Math.cos(ang) + ey.x * Math.sin(ang)) * r,
    y: c.y + (ex.y * Math.cos(ang) + ey.y * Math.sin(ang)) * r,
    z: c.z + (ex.z * Math.cos(ang) + ey.z * Math.sin(ang)) * r
  });
  const steps = Math.max(1, Math.ceil(best.sweep / ARC_STEP));
  const out = [];
  for (let i = 0; i <= steps; i++) out.push(at(best.aA + best.s * best.sweep * (i / steps)));
  out.push(to);
  return out;
}

/** Length of a path starting at a. */
export function routeLength(a, path) {
  let len = 0, prev = a;
  for (const p of path) { len += dist(prev, p); prev = p; }
  return len;
}

/** Distance along the allowed path - that is how far it really is. */
export function travelDistance(a, b, zone) {
  if (!blocked(a, b, zone)) return dist(a, b);
  return routeLength(a, route(a, b, zone));
}

/**
 * One turn's worth along the path. Returns the new position and whether the
 * destination (the last waypoint) is reached with it.
 */
export function advance(a, path, speed) {
  let left = speed, cur = { x: a.x, y: a.y, z: a.z || 0 };
  for (const p of path) {
    const d = dist(cur, p);
    if (d <= left) { left -= d; cur = { x: p.x, y: p.y, z: p.z || 0 }; continue; }
    const t = left / d;
    return {
      x: cur.x + (p.x - cur.x) * t,
      y: cur.y + (p.y - cur.y) * t,
      z: cur.z + (p.z - cur.z) * t,
      done: false
    };
  }
  return { ...cur, done: true };
}

/**
 * Distance to the nearest supply base - along the flyable path. Server and UI
 * call the same function so the range you see and the range decisions are
 * based on can never drift apart.
 */
export function supplyDistance(bases, point, zone) {
  let best = Infinity;
  for (const b of bases) best = Math.min(best, travelDistance(b, point, zone));
  return best;
}

/**
 * Outline of the area reachable from a base with `range`: per direction the
 * largest distance that can still be flown. Without an exclusion zone that is
 * a circle; with one it gets a dent where the path leads around the outside -
 * exactly what a drawn circle would hide.
 */
export function reachOutline(base, range, zone, n = 72) {
  const points = [];
  const z = base.z || 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const at = (d) => ({ x: base.x + dx * d, y: base.y + dy * d, z });
    let r = range;
    if (zone && travelDistance(base, at(range), zone) > range) {
      // The path grows with the distance, so bisection is enough.
      let lo = 0, hi = range;
      for (let k = 0; k < 14; k++) {
        const m = (lo + hi) / 2;
        if (travelDistance(base, at(m), zone) <= range) lo = m; else hi = m;
      }
      r = lo;
    }
    points.push(at(r));
  }
  return points;
}

/** Color of a planet by temperature - the palette of the classic. */
export function tempColor(temp) {
  const stops = [
    [-180, [ 92, 108, 196]],
    [ -90, [ 72, 168, 228]],
    [ -30, [ 92, 212, 206]],
    [  20, [ 96, 206, 108]],
    [  70, [224, 206,  86]],
    [ 130, [232, 142,  58]],
    [ 220, [206,  62,  58]]
  ];
  if (temp <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (temp <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const f = (temp - t0) / (t1 - t0);
      return [0, 1, 2].map(k => Math.round(c0[k] + (c1[k] - c0[k]) * f));
    }
  }
  return stops[stops.length - 1][1];
}

export function rgb(c, a) {
  return a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
