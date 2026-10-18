// Gemeinsame Spielregeln - wird vom Server und vom Browser-Client importiert.
// Alles hier ist rein funktional und ohne Seiteneffekte.

export const MAX_PLAYERS = 16;

/** Ideale Lebensbedingungen - für alle Rassen gleich (wie im Klassiker). */
export const IDEAL = { temp: 20, grav: 1.0 };

export const TEMP_RANGE = { min: -180, max: 220 };
export const GRAV_RANGE = { min: 0.1, max: 4.0 };

export const PLAYER_COLORS = [
  '#ff4d4d', '#4da6ff', '#3fd96b', '#ffd23f', '#c06cff', '#ff8c42',
  '#2fe0d0', '#ff6fb5', '#9bd642', '#6f7dff', '#e0c36c', '#49b3a1',
  '#ff5ea8', '#8ad6ff', '#d4ff4d', '#b07a4d'
];

export const PLAYER_EMBLEMS = [
  'Stern', 'Komet', 'Krone', 'Anker', 'Klinge', 'Auge', 'Welle', 'Blitz',
  'Mond', 'Ring', 'Speer', 'Rad', 'Flamme', 'Pfeil', 'Schild', 'Hut'
];

/**
 * Persönlichkeiten der KI-Reiche. Wie sie spielen, steht in server/bot.js;
 * Name und Beschreibung im Katalog unter persona.<key> / persona.<key>.desc.
 */
export const AI_PERSONAS = ['conqueror', 'settler', 'technocrat', 'raider', 'bulwark', 'vulture'];

// ---------------------------------------------------------------- Technologie

export const TECH_FIELDS = ['range', 'speed', 'weapons', 'shields', 'mini', 'radical'];

// Namen, Kuerzel und Beschreibungen der Techfelder stehen in den Katalogen
// (client/i18n/*.js) unter tech.<feld>.name / .short / .desc - hier bleibt nur,
// was keine Sprache hat.
export const techKey = (feld, teil = 'name') => `tech.${feld}.${teil}`;

export const TECH_START_LEVEL = 1;
export const TECH_MAX_LEVEL = 40;

/** Forschungspunkte, um von `level` auf `level + 1` zu kommen. */
export function techCostToNext(level) {
  return Math.round(40 * Math.pow(level, 1.8));
}

// ------------------------------------------------------------------- Schiffe

export const SHIP_TYPES = ['scout', 'fighter', 'satellite', 'colony', 'tanker'];

// Schiffsnamen und -beschreibungen stehen in den Katalogen unter
// ship.<typ>.name / .desc; hier stehen nur Werte, die in jeder Sprache gelten.
export const shipKey = (typ, teil = 'name') => `ship.${typ}.${teil}`;

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
  }
};

/** Technologie-Aufschlag auf den Preis: hohe Stufen sind teuer. */
function techSurcharge(level) {
  return 2.6 * Math.pow(Math.max(0, level - 1), 1.45);
}

/** Miniaturisierung verbilligt alles. */
export function miniFactor(miniLevel) {
  return 1 / (1 + 0.11 * (miniLevel - 1));
}

/**
 * Kosten eines Schiffs, gebaut mit dem übergebenen Technologiestand.
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

/** Aufschlag der Werft beim Umrüsten - teurer als gleich richtig bauen. */
export const REFIT_FEE = 1.25;

/**
 * Umrüstung eines bestehenden Schiffs auf den aktuellen Stand: nur die
 * Technik, die der Typ überhaupt eingebaut hat, und nur nach oben. Bezahlt
 * wird der Aufpreis der neuen Stufen samt Werftzuschlag; der Rumpf bleibt.
 * @returns {{tech: Record<string, number>, money: number, metal: number} | null}
 *   null, wenn es nichts zu verbessern gibt
 */
export function refitCost(type, shipTech, tech) {
  const def = SHIP_DEFS[type];
  if (!def) return null;
  const next = { ...shipTech };
  let extra = 0;
  for (const f of def.techs) {
    const alt = shipTech[f] || 1, neu = tech[f] || 1;
    if (neu <= alt) continue;
    next[f] = neu;
    extra += techSurcharge(neu) - techSurcharge(alt);
  }
  if (extra <= 0) return null;
  const mf = miniFactor(tech.mini || 1) * REFIT_FEE;
  return {
    tech: next,
    money: Math.max(1, Math.round(extra * mf)),
    metal: Math.max(1, Math.round(extra * 0.35 * mf))
  };
}

/** Summe über mehrere Schiffe; `count` = wie viele davon veraltet sind. */
export function refitTotal(ships, tech) {
  let money = 0, metal = 0, count = 0;
  for (const s of ships) {
    const c = refitCost(s.type, s.tech || {}, tech);
    if (!c) continue;
    money += c.money; metal += c.metal; count++;
  }
  return { money, metal, count };
}

/** Kampf- und Flugwerte eines Schiffs anhand seines eingebauten Techstands. */
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
    isTanker: !!def.tanker
  };
}

// -------------------------------------------------------------------- Planeten

/** 0 = tödlich, 1 = paradiesisch. */
export function habitability(planet) {
  const dT = Math.abs(planet.temp - IDEAL.temp) / 100;
  const dG = Math.abs(planet.grav - IDEAL.grav) / 1.5;
  return clamp(1 - dT - dG, 0, 1);
}

/** Maximale Bevölkerung in Mio. */
export function planetCapacity(planet) {
  const hab = habitability(planet);
  return Math.round((1.5 + 44 * Math.pow(hab, 1.25)) * (0.75 + 0.5 * planet.sizeFactor));
}

export const POP_GROWTH = 0.12;
export const INCOME_PER_POP = 1.6;
export const MINE_PER_POP = 0.5;

/** Einkommen eines Planeten pro Runde. */
export function planetIncome(planet) {
  return planet.pop * INCOME_PER_POP * (0.55 + 0.45 * habitability(planet));
}

/**
 * Tiefbau: Ist der Vorrat erschöpft, fördert eine Welt noch diesen Anteil.
 * Ohne ihn friert jede lange Partie ein, sobald überall das Erz verbraucht
 * ist - dann lassen sich keine Schiffe mehr bauen, auch keine Kolonieschiffe.
 */
export const DEEP_MINING = 0.1;

/** Metallabbau pro Runde: aus dem Vorrat, danach im Tiefbau. */
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

/** Kann der Planet mit diesem Radikal-Level überhaupt angefasst werden? */
export function terraformable(planet, radicalLevel) {
  const lim = terraLimits(radicalLevel);
  return {
    temp: Math.abs(planet.temp - IDEAL.temp) <= lim.temp + 0.001,
    grav: Math.abs(planet.grav - IDEAL.grav) <= lim.grav + 0.001
  };
}

/** Was würde es kosten, diesen Planeten komplett ins Ideal zu bringen? */
export function terraformFullCost(planet, radicalLevel) {
  const ok = terraformable(planet, radicalLevel);
  let cost = 0;
  if (ok.temp) cost += Math.abs(planet.temp - IDEAL.temp) * TERRA_COST_PER_DEGREE;
  if (ok.grav) cost += Math.abs(planet.grav - IDEAL.grav) * TERRA_COST_PER_G;
  return Math.round(cost);
}

// ---------------------------------------------------------------------- Kampf

export const COMBAT_ROUNDS = 12;

/**
 * Planetare Abwehrbatterien. Jede bewohnte Welt verteidigt sich selbst -
 * große Bevölkerungen sind harte Brocken. Die Batterie wird nie dauerhaft
 * zerstört, sie steht jede Runde neu bereit.
 */
export function batteryStats(pop, tech) {
  if (!(pop >= 0.5)) return null;
  return {
    hp: Math.round(pop * 45 * (1 + 0.14 * ((tech.shields || 1) - 1))),
    attack: Math.round(pop * 1.1 * (1 + 0.22 * ((tech.weapons || 1) - 1)) * 10) / 10
  };
}

// --------------------------------------------------------------------- Helfer

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Abstand im Raum. Ohne z (Klassik) ist es der Abstand in der Ebene. */
export function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ------------------------------------------------- Sperrzone: schwarzes Loch

/**
 * Sperrzone um das schwarze Loch, als Vielfaches seines Weltradius. Die
 * sichtbaren Strudelarme reichen bis etwa das 1,4-fache - die Zone liegt
 * darueber, damit klar ist, dass nicht nur der Schlund selbst gemeint ist.
 * Nach oben begrenzt sie die Karte: keine Welt kommt dem Loch naeher als das
 * 2,5-fache, es bleibt also immer ein Anflugweg frei.
 */
export const HOLE_BLOCK = 1.8;

/** Verbotener Bereich einer Galaxie, oder null ohne schwarzes Loch. */
export function holeZone(galaxy) {
  const bh = galaxy && galaxy.blackHole;
  if (!bh) return null;
  return { x: bh.x, y: bh.y, z: bh.z || 0, r: bh.r * HOLE_BLOCK };
}

/** Kuerzester Abstand der Strecke a-b zu einem Punkt c. */
function segDist(a, b, c) {
  const vx = b.x - a.x, vy = b.y - a.y, vz = (b.z || 0) - (a.z || 0);
  const wx = c.x - a.x, wy = c.y - a.y, wz = (c.z || 0) - (a.z || 0);
  const len2 = vx * vx + vy * vy + vz * vz;
  const t = len2 > 0 ? clamp((wx * vx + wy * vy + wz * vz) / len2, 0, 1) : 0;
  const dx = wx - vx * t, dy = wy - vy * t, dz = wz - vz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Schneidet die Strecke die Sperrzone? */
export function blocked(a, b, zone) {
  return !!zone && segDist(a, b, zone) < zone.r;
}

const TAU2 = Math.PI * 2;
const ARC_STEP = Math.PI / 12;        // Bogen in 15-Grad-Stuecken annaehern

/**
 * Weg von a nach b, der die Sperrzone aussen umgeht: zwei Tangenten und ein
 * Bogen, auf der kuerzeren der beiden Seiten. Gerechnet wird in der Ebene
 * durch a, b und den Mittelpunkt - damit gilt dasselbe Verfahren flach wie
 * raeumlich. Zurueck kommen die Wegpunkte nach a; der letzte ist b.
 */
export function route(a, b, zone) {
  const to = { x: b.x, y: b.y, z: b.z || 0 };
  if (!blocked(a, b, zone)) return [to];
  const c = zone;
  // Der Bogen wird als Streckenzug gefahren; seine Sehnen lägen innerhalb des
  // Kreises. Deshalb wird der Umfahrungsradius so weit aufgeblasen, dass die
  // Sehnen genau auf der Zonengrenze liegen - sonst schrammte jede Flotte ein
  // Stück zu dicht am Loch vorbei.
  const r = zone.r / Math.cos(ARC_STEP / 2);
  // Ebene aufspannen: ex zeigt zu a, ey quer dazu in Richtung b.
  const p = { x: a.x - c.x, y: a.y - c.y, z: (a.z || 0) - c.z };
  const q = { x: b.x - c.x, y: b.y - c.y, z: (b.z || 0) - c.z };
  const dA = Math.hypot(p.x, p.y, p.z) || 1e-6;
  const ex = { x: p.x / dA, y: p.y / dA, z: p.z / dA };
  const qe = q.x * ex.x + q.y * ex.y + q.z * ex.z;
  let perp = { x: q.x - ex.x * qe, y: q.y - ex.y * qe, z: q.z - ex.z * qe };
  let pl = Math.hypot(perp.x, perp.y, perp.z);
  if (pl < 1e-6) {                     // a, b und Mitte auf einer Linie
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

  // Winkel in dieser Ebene: a liegt bei 0, b irgendwo zwischen 0 und PI.
  const thA = 0, thB = Math.atan2(pl, qe);
  // Liegt ein Punkt innerhalb des Umfahrungsradius, geht es von dort gerade
  // nach aussen auf den Ring statt auf eine Tangente.
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

/** Laenge eines Weges, beginnend bei a. */
export function routeLength(a, path) {
  let len = 0, prev = a;
  for (const p of path) { len += dist(prev, p); prev = p; }
  return len;
}

/** Entfernung auf dem erlaubten Weg - so weit ist es wirklich. */
export function travelDistance(a, b, zone) {
  if (!blocked(a, b, zone)) return dist(a, b);
  return routeLength(a, route(a, b, zone));
}

/**
 * Einen Zug weit am Weg entlang. Gibt die neue Lage zurueck und ob das Ziel
 * (der letzte Wegpunkt) damit erreicht ist.
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
 * Entfernung zur nächsten Versorgungsbasis - auf dem fliegbaren Weg. Server
 * und Oberfläche rufen dieselbe Funktion, damit die Reichweite, die man sieht,
 * und die, nach der entschieden wird, nicht auseinanderlaufen können.
 */
export function supplyDistance(bases, point, zone) {
  let best = Infinity;
  for (const b of bases) best = Math.min(best, travelDistance(b, point, zone));
  return best;
}

/**
 * Umriss der Fläche, die von einer Basis aus mit `range` erreichbar ist: je
 * Richtung die größte noch fliegbare Entfernung. Ohne Sperrzone ist das ein
 * Kreis; mit Sperrzone bekommt er dort eine Delle, wo der Weg außen herum
 * führt - genau das, was ein gezeichneter Kreis verschweigen würde.
 */
export function reachOutline(base, range, zone, n = 72) {
  const punkte = [];
  const z = base.z || 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const bei = (d) => ({ x: base.x + dx * d, y: base.y + dy * d, z });
    let r = range;
    if (zone && travelDistance(base, bei(range), zone) > range) {
      // Der Weg wächst mit der Entfernung, also genügt die Halbierung.
      let lo = 0, hi = range;
      for (let k = 0; k < 14; k++) {
        const m = (lo + hi) / 2;
        if (travelDistance(base, bei(m), zone) <= range) lo = m; else hi = m;
      }
      r = lo;
    }
    punkte.push(bei(r));
  }
  return punkte;
}

/** Farbe eines Planeten nach Temperatur - die Palette des Klassikers. */
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
