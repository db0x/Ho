// Sternkarten-Generator.
import {
  IDEAL, TEMP_RANGE, GRAV_RANGE, HOLE_BLOCK, dist, clamp, habitability, shipStats, travelDistance
} from '../shared/rules.js';

const PLANET_NAMES = [
  'Ablon', 'Aquila', 'Baruun', 'Belisar', 'Calder', 'Caspia', 'Cygnus', 'Dorne',
  'Draco', 'Elysia', 'Erebus', 'Fenris', 'Galatea', 'Gorgon', 'Haldor', 'Helios',
  'Idun', 'Ixion', 'Janus', 'Kalix', 'Kyros', 'Lacerta', 'Lyra', 'Magris',
  'Mentor', 'Nausika', 'Nemea', 'Oberon', 'Orpheus', 'Pallas', 'Perseus', 'Phoenix',
  'Quintus', 'Rhea', 'Rigel', 'Sabik', 'Selene', 'Shakra', 'Tarsus', 'Thule',
  'Tycho', 'Umbriel', 'Vanth', 'Vega', 'Vesta', 'Weyland', 'Xanthe', 'Yildun',
  'Zephyr', 'Zosma', 'Achird', 'Adhara', 'Alcyone', 'Almach', 'Ankaa', 'Arrakis',
  'Asellus', 'Atria', 'Avior', 'Azelfafage', 'Botein', 'Brachium', 'Cursa', 'Dabih',
  'Edasich', 'Enif', 'Furud', 'Gacrux', 'Gienah', 'Gomeisa', 'Hadar', 'Hamal',
  'Izar', 'Jabbah', 'Kaus', 'Keid', 'Kitalpha', 'Kraz', 'Lesath', 'Maia',
  'Marfik', 'Matar', 'Mebsuta', 'Megrez', 'Meissa', 'Menkar', 'Merak', 'Mimosa',
  'Minkar', 'Mizar', 'Muphrid', 'Naos', 'Nashira', 'Nekkar', 'Nihal', 'Nunki',
  'Peacock', 'Phact', 'Pherkad', 'Polaris', 'Pollux', 'Procyon', 'Rastaban', 'Ruchbah',
  'Sadr', 'Saiph', 'Sargas', 'Scheat', 'Segin', 'Seginus', 'Sheliak', 'Sirrah',
  'Skat', 'Spica', 'Sulafat', 'Syrma', 'Talitha', 'Tania', 'Tarazed', 'Tegmine',
  'Thuban', 'Turais', 'Unukalhai', 'Vindemiatrix', 'Wasat', 'Wezen', 'Yed', 'Zaurak'
];

// Silben für Welten jenseits der Namensliste - die Galaxie wächst, die Liste
// ist endlich.
const SYL_A = ['Ar', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gal', 'Hy', 'Ith', 'Kar',
  'Lum', 'Mor', 'Nyx', 'Or', 'Pra', 'Quel', 'Rha', 'Sol', 'Tir', 'Ul', 'Vor',
  'Wyn', 'Xar', 'Yel', 'Zan', 'Ceph', 'Dir', 'Esh', 'Ghal', 'Ion'];
const SYL_B = ['ka', 'mir', 'dor', 'sae', 'tun', 'vel', 'ran', 'gis', 'lon',
  'thar', 'nis', 'pha', 'ryn', 'sek', 'tor', 'bar', 'dun', 'qis'];
const SYL_C = ['', '', '', 'a', 'is', 'on', 'ar', 'eth', 'ux', 'or'];

/** Breite eines neuen Streifens und Fläche je Welt (hält die Dichte konstant). */
export const BAND = 440;
const AREA_PER_PLANET = 60000;
const MIN_GAP = 78;
// Randstreifen ohne Welten. Er sorgt dafür, dass die Karte nur nachgibt, wenn
// jemand wirklich hinausfliegt - sonst stünde die nächste Welt gleich wieder
// an der neuen Grenze und die Galaxie wüchse von allein weiter.
const MARGIN = 110;
// Räumlicher Modus: die Galaxie ist eine Linse - in der Fläche weit, in der
// Höhe etwa 40 % davon, und zum Rand hin dünner.
const DEPTH_RATIO = 0.3;        // halbe Dicke, bezogen auf die kürzere Kante

/** Deterministischer PRNG (mulberry32), damit Partien reproduzierbar sind. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

const HOLE_NAMES = ['Charybdis', 'Abyssos', 'Erebos', 'Tartaros', 'Mahlstrom', 'Nyx', 'Skylla'];

/**
 * Dichtefeld einer Spiralgalaxie: zwei logarithmische Arme um einen dichten
 * Kern, drumherum ein dünner Halo, und in der Mitte ein Loch - dort sitzt das
 * schwarze Loch. Die Erzeugung würfelt Punkte und nimmt sie mit dieser
 * Wahrscheinlichkeit an; die Ausdehnung später genauso, dann setzen sich die
 * Arme nach außen fort.
 */
function spiralField(cx, cy, rOut, arms, twist) {
  const rIn = rOut * 0.13;
  const b = Math.log(rOut / rIn) / (twist * 2 * Math.PI);
  const period = 2 * Math.PI / arms;
  return {
    cx, cy, rIn, rOut, arms, b,
    density(x, y) {
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (r < rIn) return 0;                       // Sperrzone um das schwarze Loch
      // Welchen Winkel hätte ein Arm bei diesem Radius?
      const armTheta = Math.log(r / rIn) / b;
      let d = (Math.atan2(dy, dx) - armTheta) % period;
      if (d > period / 2) d -= period;
      else if (d < -period / 2) d += period;
      const across = Math.abs(d) * r;              // Abstand quer zum Arm
      const w = rOut * (0.05 + 0.08 * r / rOut);   // Arme werden außen breiter
      const arm = Math.exp(-(across * across) / (2 * w * w));
      const bulge = Math.exp(-((r / (rOut * 0.16)) ** 2));
      const falloff = Math.exp(-r / (rOut * 0.62));
      return Math.min(1, (arm * 0.95 + 0.1) * falloff + bulge);
    }
  };
}

/**
 * Ein Punkt auf den Spiralarmen. Beim Erzeugen wird direkt hier gewürfelt -
 * das gibt deutlich klarere Arme als ein Ablehnungsverfahren über die ganze
 * Fläche, bei dem der dichte Kern den Rest verschluckt.
 */
function spiralPoint(field, rng) {
  const { rIn, rOut, arms, b, cx, cy } = field;
  if (rng() < 0.14) {                                  // Kernwulst
    const r = rIn * (1.05 + rng() * 1.2);
    const a = rng() * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  }
  const t = Math.pow(rng(), 0.7);                      // nach außen hin mehr
  const theta = t * Math.log(rOut / rIn) / b;
  const r = rIn * Math.exp(b * theta);
  const w = rOut * (0.032 + 0.05 * r / rOut);          // Streuung quer zum Arm
  const ang = theta + Math.floor(rng() * arms) * (2 * Math.PI / arms)
    + ((rng() + rng() + rng() - 1.5) * w) / Math.max(r, 1);
  const rr = Math.max(rIn * 1.05, r + (rng() + rng() - 1) * w);
  return [cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr];
}

/** Höhe einer Welt in der Linse: mittig dicker, am Rand flacher. */
function lensZ(galaxy, rng, x, y) {
  const half = galaxy.halfDepth;
  if (!half) return 0;
  const c = galaxy.core;
  const d = Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2) / c.r;
  const thick = half * Math.max(0.25, 1 - 0.55 * Math.min(1.4, d));
  const g = rng() + rng() - 1;                     // -1..1, zur Mitte hin dichter
  return Math.round(g * thick);
}

/**
 * Erzeugt die Galaxie.
 * @param {{playerCount:number, planetsPerPlayer?:number, seed?:number,
 *          mode?:'classic'|'space', shape?:'scatter'|'spiral'}} opts
 */
export function generateGalaxy(opts) {
  const playerCount = clamp(opts.playerCount, 2, 16);
  const perPlayer = opts.planetsPerPlayer ?? 6;
  const seed = opts.seed ?? (Math.random() * 1e9) | 0;
  const rng = makeRng(seed);

  const count = Math.max(playerCount * 2, Math.round(playerCount * perPlayer));
  // Flaeche wächst mit der Planetenzahl, damit die Dichte konstant bleibt.
  const area = count * 60000;
  // Eine Spirale ist rund - im Breitformat blieben die Ecken leer.
  const spiral = opts.shape === 'spiral';
  const aspect = spiral ? 1.1 : 1.45;
  const height = Math.sqrt(area / aspect);
  const width = height * aspect;
  const margin = 110;
  const minGap = 78;

  const space = opts.mode === 'space';
  const halfDepth = space ? Math.round(height * DEPTH_RATIO) : 0;
  const core = { x: width / 2, y: height / 2, r: Math.sqrt(width * width + height * height) / 2 };
  const field = spiral
    ? spiralField(width / 2, height / 2, Math.min(width, height) * 0.47, 2 + (seed % 2), 0.75)
    : null;

  const planets = [];
  const names = PLANET_NAMES.slice();
  // Namen mischen
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }

  let guard = 0;
  while (planets.length < count && guard < count * 400) {
    guard++;
    let p;
    if (field) {
      const [x, y] = spiralPoint(field, rng);
      if (x < margin || y < margin || x > width - margin || y > height - margin) continue;
      p = { x, y };
    } else {
      p = {
        x: margin + rng() * (width - 2 * margin),
        y: margin + rng() * (height - 2 * margin)
      };
    }
    p.z = lensZ({ halfDepth, core }, rng, p.x, p.y);
    if (planets.some(q => dist(p, q) < minGap)) continue;
    planets.push(makePlanet(planets.length, p.x, p.y, names, rng, 0, p.z));
  }

  const blackHole = spiral ? {
    x: Math.round(field.cx), y: Math.round(field.cy), z: 0,
    r: Math.round(field.rIn * 0.42),
    name: pick(rng, HOLE_NAMES)
  } : null;
  const zone = blackHole ? { ...blackHole, r: blackHole.r * HOLE_BLOCK } : null;
  const bounds = { x0: margin, y0: margin, x1: width - margin, y1: height - margin, halfDepth };
  const homes = chooseHomeworlds(planets, playerCount, rng, zone);
  for (const h of homes) ensureNeighbours(planets, planets[h], names, rng, zone, bounds, minGap);
  const galaxy = {
    seed,
    // Grenzen statt fester Maße: die Karte kann in jede Richtung wachsen,
    // Koordinaten dürfen dabei negativ werden.
    minX: 0, minY: 0, maxX: Math.round(width), maxY: Math.round(height),
    minZ: -halfDepth, maxZ: halfDepth,
    width: Math.round(width), height: Math.round(height),
    mode: space ? 'space' : 'classic',
    shape: spiral ? 'spiral' : 'scatter',
    halfDepth,
    field,
    // Das schwarze Loch ist der Mittelpunkt der Spirale - keine Welt kommt ihm
    // nahe, besiedeln lässt es sich nicht.
    blackHole,
    // Kern für den Härtegrad: je weiter draußen, desto rauer und erzreicher
    core,
    epoch: 0,
    names,                      // Rest der gemischten Namensliste
    used: new Set(planets.map(p => p.name)),
    planets, homeworlds: homes
  };
  return galaxy;
}

/** 0 im Startgebiet, darüber hinaus wachsend. */
export function harshnessAt(galaxy, x, y) {
  const c = galaxy.core;
  const d = Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2);
  return Math.max(0, d / c.r - 1);
}

/**
 * Eine Spirale wächst nicht in Rechteckstreifen, sondern nach außen: die Arme
 * reichen weiter, und in dem neu hinzugekommenen Ring entstehen Welten.
 * @returns {object[]} die neuen Welten
 */
export function expandSpiral(galaxy) {
  const g = galaxy, f = g.field;
  if (!f) return [];
  g.epoch++;
  const rng = makeRng((g.seed ^ Math.imul(g.epoch, 0x9E3779B1)) >>> 0);
  const rOld = f.rOut;
  const rNew = rOld + BAND;
  f.rOut = rNew;                                  // Arme reichen weiter hinaus
  // Die Arme füllen den Ring nicht aus - entsprechend weniger Welten.
  const area = Math.PI * (rNew * rNew - rOld * rOld);
  const count = Math.max(2, Math.round(area / AREA_PER_PLANET * 0.42));

  const near = g.planets.filter(q => {
    const r = Math.hypot(q.x - f.cx, q.y - f.cy);
    return r > rOld - 2 * MIN_GAP;
  });
  const added = [];
  let guard = 0;
  while (added.length < count && guard < count * 300) {
    guard++;
    const r = Math.sqrt(rOld * rOld + rng() * (rNew * rNew - rOld * rOld));
    const theta = Math.log(r / f.rIn) / f.b;
    const w = rNew * (0.032 + 0.05 * r / rNew);
    const ang = theta + Math.floor(rng() * f.arms) * (2 * Math.PI / f.arms)
      + ((rng() + rng() + rng() - 1.5) * w) / r;
    const rr = r + (rng() + rng() - 1) * w;
    const x = f.cx + Math.cos(ang) * rr, y = f.cy + Math.sin(ang) * rr;
    const z = lensZ(g, rng, x, y);
    if (near.some(q => dist({ x, y, z }, q) < MIN_GAP)) continue;
    const p = makePlanet(g.planets.length, x, y, g, rng, harshnessAt(g, x, y), z);
    g.planets.push(p);
    near.push(p);
    added.push(p);
  }

  // Grenzen nur so weit ziehen, wie wirklich Welten stehen - sonst umgibt ein
  // riesiges leeres Gitter eine kleine Galaxie.
  let reach = 0;
  for (const p of added) reach = Math.max(reach, Math.hypot(p.x - f.cx, p.y - f.cy));
  if (!reach) return added;
  g.minX = Math.min(g.minX, Math.round(f.cx - reach - MARGIN));
  g.maxX = Math.max(g.maxX, Math.round(f.cx + reach + MARGIN));
  g.minY = Math.min(g.minY, Math.round(f.cy - reach - MARGIN));
  g.maxY = Math.max(g.maxY, Math.round(f.cy + reach + MARGIN));
  g.width = g.maxX - g.minX;
  g.height = g.maxY - g.minY;
  return added;
}

/**
 * Dehnt die Karte in eine Himmelsrichtung aus und füllt den neuen Streifen
 * mit Welten - in derselben Dichte, aber nach außen hin rauer.
 * @param {object} galaxy
 * @param {'left'|'right'|'top'|'bottom'} dir
 * @returns {object[]} die neuen Welten
 */
export function expandGalaxy(galaxy, dir) {
  const g = galaxy;
  const M = MARGIN;
  // Der Streifen liegt überall um MARGIN innerhalb der neuen Grenze.
  const r = {
    left: { x0: g.minX - BAND + M, x1: g.minX, y0: g.minY + M, y1: g.maxY - M },
    right: { x0: g.maxX, x1: g.maxX + BAND - M, y0: g.minY + M, y1: g.maxY - M },
    top: { y0: g.minY - BAND + M, y1: g.minY, x0: g.minX + M, x1: g.maxX - M },
    bottom: { y0: g.maxY, y1: g.maxY + BAND - M, x0: g.minX + M, x1: g.maxX - M }
  }[dir];
  if (!r || r.x1 <= r.x0 || r.y1 <= r.y0) return [];

  g.epoch++;
  const rng = makeRng((g.seed ^ Math.imul(g.epoch, 0x9E3779B1)) >>> 0);
  const count = Math.max(1, Math.round((r.x1 - r.x0) * (r.y1 - r.y0) / AREA_PER_PLANET));
  // Nur Nachbarn in der Nähe des Streifens auf Abstand prüfen
  const near = g.planets.filter(q =>
    q.x > r.x0 - MIN_GAP && q.x < r.x1 + MIN_GAP && q.y > r.y0 - MIN_GAP && q.y < r.y1 + MIN_GAP);

  // In der Spirale wird die Dichte des Streifens als Maßstab genommen, damit
  // dort gleich viele Welten entstehen, die Arme sich aber fortsetzen.
  let ref = 0;
  if (g.field) {
    for (let i = 0; i < 200; i++) {
      ref = Math.max(ref, g.field.density(r.x0 + rng() * (r.x1 - r.x0), r.y0 + rng() * (r.y1 - r.y0)));
    }
    ref = Math.max(ref, 1e-4);
  }

  const added = [];
  let guard = 0;
  while (added.length < count && guard < count * 300) {
    guard++;
    const x = r.x0 + rng() * (r.x1 - r.x0);
    const y = r.y0 + rng() * (r.y1 - r.y0);
    // Hoch gewichtet: lieber ein dünner Streifen entlang der Arme als ein
    // gleichmäßig gefüllter Kasten.
    if (g.field && rng() > Math.pow(g.field.density(x, y) / ref, 2.0)) continue;
    const z = lensZ(g, rng, x, y);
    if (near.some(q => dist({ x, y, z }, q) < MIN_GAP)) continue;
    const p = makePlanet(g.planets.length, x, y, g, rng, harshnessAt(g, x, y), z);
    g.planets.push(p);
    near.push(p);
    added.push(p);
  }

  if (dir === 'left') g.minX -= BAND;
  else if (dir === 'right') g.maxX += BAND;
  else if (dir === 'top') g.minY -= BAND;
  else g.maxY += BAND;
  g.width = g.maxX - g.minX;
  g.height = g.maxY - g.minY;
  return added;
}

/** Namen aus der Liste, danach selbst gemünzt - immer eindeutig. */
function nextName(galaxy, rng, id) {
  while (galaxy.names.length) {
    const n = galaxy.names.pop();
    if (!galaxy.used.has(n)) { galaxy.used.add(n); return n; }
  }
  for (let i = 0; i < 40; i++) {
    const n = pick(rng, SYL_A) + pick(rng, SYL_B) + pick(rng, SYL_C);
    if (!galaxy.used.has(n)) { galaxy.used.add(n); return n; }
  }
  const n = `Welt-${id + 1}`;
  galaxy.used.add(n);
  return n;
}

/**
 * @param {object} src Namensquelle: die Galaxie, oder beim Erzeugen die Liste
 * @param {number} h Härtegrad: 0 im Kern, nach außen wachsend
 */
function makePlanet(id, x, y, src, rng, h = 0, z = 0) {
  const name = Array.isArray(src)
    ? (src.length ? src.pop() : `Welt-${id + 1}`)
    : nextName(src, rng, id);
  const hc = Math.min(h, 2.5);
  // Temperatur: weiter aussen eher extrem; erzeugt eine Mischung aus
  // Perlen und Höllenlöchern wie im Original. Draußen wird die Mischung rauer.
  const r = rng();
  const good = 0.18 / (1 + hc * 1.2);
  const mid = good + 0.44 / (1 + hc * 0.5);
  let temp;
  if (r < good) temp = IDEAL.temp + (rng() * 2 - 1) * 35;                         // gute Welten
  else if (r < mid) temp = IDEAL.temp + (rng() * 2 - 1) * (110 * (1 + 0.4 * hc)); // mittel
  else temp = TEMP_RANGE.min + rng() * (TEMP_RANGE.max - TEMP_RANGE.min);
  temp = clamp(Math.round(temp), TEMP_RANGE.min, TEMP_RANGE.max);

  const g = rng();
  let grav;
  if (g < 0.22 / (1 + hc * 1.2)) grav = IDEAL.grav + (rng() * 2 - 1) * 0.25;
  else grav = GRAV_RANGE.min + rng() * (GRAV_RANGE.max - GRAV_RANGE.min);
  grav = clamp(Math.round(grav * 20) / 20, GRAV_RANGE.min, GRAV_RANGE.max);

  // Entschädigung für die Unwirtlichkeit: draußen liegt mehr Erz
  const richness = Math.round((0.15 + Math.pow(rng(), 1.6) * 1.35) * (1 + 0.45 * hc) * 100) / 100;
  const reserve = Math.round((180 + rng() * 900) * richness * (1 + 0.2 * hc));

  return {
    id, name, x: Math.round(x), y: Math.round(y), z: Math.round(z),
    temp, grav,
    metalRichness: richness,
    metalReserve: reserve,
    metalInitial: reserve,
    sizeFactor: Math.round((0.25 + rng() * 0.75) * 100) / 100,
    ringSeed: Math.floor(rng() * 1e6),
    owner: null,
    pop: 0,
    terraBudget: 0
  };
}

// So weit kommt das Siedlerschiff, mit dem jedes Reich startet.
const START_REACH = shipStats('colony', {}).range;
// Wie viele Welten von jeder Heimat aus mit dem Startschiff erreichbar sind,
// und dass mindestens eine davon taugt. Der Puffer hält sie sicher in
// Reichweite, auch wenn der Weg ums schwarze Loch ein Stück länger wird.
const START_NEIGHBOURS = 3;
const NEIGHBOUR_REACH = START_REACH * 0.88;
const START_HAB = 0.45;

function neighboursOf(planets, home, zone, reach = NEIGHBOUR_REACH) {
  return planets.filter(q => q !== home && !q.isHomeworld && dist(home, q) <= reach
    && travelDistance(home, q, zone) <= reach);
}

/**
 * Wählt möglichst weit auseinanderliegende Heimatwelten (Farthest-Point-
 * Sampling). Welten ohne Nachbarn zählen dabei weniger - sonst landet das
 * Verfahren zielsicher bei den Ausreißern am Rand. Ganz verboten sind sie
 * nicht, damit die Reiche weit auseinander bleiben; was dann noch fehlt,
 * ergänzt ensureNeighbours.
 */
function chooseHomeworlds(planets, playerCount, rng, zone) {
  const weight = planets.map(p =>
    0.6 + 0.4 * Math.min(START_NEIGHBOURS, neighboursOf(planets, p, zone).length) / START_NEIGHBOURS);
  const chosen = [];
  const pool = planets.map((_, i) => i).filter(i => weight[i] >= 1);
  chosen.push(pool.length ? pool[Math.floor(rng() * pool.length)] : Math.floor(rng() * planets.length));
  while (chosen.length < playerCount) {
    let best = -1, bestD = -1;
    for (let i = 0; i < planets.length; i++) {
      if (chosen.includes(i)) continue;
      let d = Infinity;
      for (const c of chosen) d = Math.min(d, dist(planets[i], planets[c]));
      d *= weight[i];
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best < 0) break;
    chosen.push(best);
  }
  // Heimatwelten sind ideale Welten mit soliden Metallvorräten - faire Startbedingungen.
  for (const i of chosen) {
    const p = planets[i];
    p.temp = IDEAL.temp;
    p.grav = IDEAL.grav;
    p.sizeFactor = 0.7;
    p.metalRichness = 0.9;
    p.metalReserve = p.metalInitial = 900;
    p.isHomeworld = true;
  }
  return chosen;
}

/**
 * Sorgt dafür, dass das Startschiff etwas zu tun hat: fehlen um eine Heimat
 * Welten in Reichweite, entstehen dort welche, und ist keine davon bewohnbar,
 * wird die nächste ein wenig milder.
 */
function ensureNeighbours(planets, home, names, rng, zone, b, minGap) {
  let near = neighboursOf(planets, home, zone);
  for (let guard = 0; near.length < START_NEIGHBOURS && guard < 600; guard++) {
    const d = minGap * 1.15 + rng() * (NEIGHBOUR_REACH - minGap * 1.15);
    const a = rng() * Math.PI * 2;
    // Im Raum auch nach oben oder unten, aber flach - die Linse ist dünn.
    const tilt = b.halfDepth ? (rng() * 2 - 1) * 0.5 : 0;
    const p = {
      x: home.x + Math.cos(a) * Math.cos(tilt) * d,
      y: home.y + Math.sin(a) * Math.cos(tilt) * d,
      z: b.halfDepth ? clamp((home.z || 0) + Math.sin(tilt) * d, -b.halfDepth, b.halfDepth) : 0
    };
    if (p.x < b.x0 || p.y < b.y0 || p.x > b.x1 || p.y > b.y1) continue;
    if (zone && dist(p, zone) < zone.r / HOLE_BLOCK * 2.5) continue;
    if (planets.some(q => dist(p, q) < minGap)) continue;
    if (travelDistance(home, p, zone) > NEIGHBOUR_REACH) continue;
    const np = makePlanet(planets.length, p.x, p.y, names, rng, 0, p.z);
    planets.push(np);
    near.push(np);
  }
  if (near.length && !near.some(q => habitability(q) >= START_HAB)) {
    const q = near.reduce((m, x) => dist(home, x) < dist(home, m) ? x : m);
    // Mittelmäßig, kein Paradies: nur so weit Richtung Ideal, dass es sich lohnt.
    q.temp = IDEAL.temp + Math.sign(q.temp - IDEAL.temp || 1) * Math.round(15 + rng() * 20);
    q.grav = clamp(Math.round((IDEAL.grav + (rng() * 2 - 1) * 0.2) * 20) / 20, GRAV_RANGE.min, GRAV_RANGE.max);
  }
}
