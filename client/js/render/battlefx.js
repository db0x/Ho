// Raumschlachten sichtbar machen. Der Server schickt die Mitschrift der
// juengsten Runde mit: jede Einheit einmal, jeder Schuss als [Schuetze, Ziel,
// Schaden]. Hier wird daraus ein Zeitplan - wann ein Schuss faellt, wann er
// einschlaegt, wann eine Einheit vergeht - und den nutzen beide: das kurze
// Aufblitzen auf der Karte und das Schlachtfenster mit der Wiederholung.
import { drawShip } from './ships.js';
import { hexRgb, drawHexShield, drawShieldHit, SHIELD_MIN } from './fx.js';
import { INTERCEPT_ROUNDS } from '../../shared/rules.js';

const TAU = Math.PI * 2;

/** Kleiner fester Zufall: dieselbe Schlacht sieht bei jedem Abspielen gleich aus. */
export function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Zeitplan einer Schlacht. Eine Runde dauert `rd` Sekunden: die Schuesse
 * fallen in den ersten 60 %, fliegen gut ein Fuenftel, und wer danach keine
 * Huelle mehr hat, vergeht zum Rundenende. Der Server rechnet genauso - alle
 * Schuesse einer Runde zaehlen, auch die eines Schiffs, das darin vergeht.
 */
export function timeline(battle, rd = 1.3) {
  const { units, rounds, scuttled = [] } = battle;
  const rnd = seeded(units.length * 7919 + rounds.length * 104729 + (rounds[0]?.length || 0));
  const hp = units.map(u => u[2]);
  const death = units.map(() => Infinity);
  const shots = [];
  rounds.forEach((round, r) => {
    const t0 = r * rd;
    for (const [from, to, dmg] of round) {
      const tf = t0 + rnd() * rd * 0.6;
      shots.push({ from, to, dmg, tf, th: tf + rd * 0.22 });
    }
    // Genau wie der Server: nach jedem Treffer auf Zehntel
    for (const [, to, dmg] of round) hp[to] = Math.round((hp[to] - dmg) * 10) / 10;
    for (let i = 0; i < units.length; i++) {
      if (hp[i] <= 0 && death[i] === Infinity) death[i] = t0 + rd * 0.9;
    }
  });
  const fight = rounds.length * rd;
  // Wehrlose, die nach der Schlacht aufgegeben werden, gehen zuletzt.
  scuttled.forEach((i, k) => { if (death[i] === Infinity) death[i] = fight + 0.15 + k * 0.08; });
  shots.sort((a, b) => a.tf - b.tf);
  const lastDeath = Math.max(0, ...death.filter(Number.isFinite));
  // Abgefangene, die ueberleben, drehen nach ihren Pflichtrunden ab und sind fort.
  const fled = new Set((battle.fled || []).filter(i => death[i] === Infinity));
  const flee = { at: Math.min(rounds.length, INTERCEPT_ROUNDS) * rd, dur: Math.max(0.6, rd * 1.6), ids: fled };
  const fleeEnd = fled.size ? flee.at + flee.dur : 0;
  return { shots, death, rd, flee, rounds: rounds.length, end: Math.max(fight, lastDeath, fleeEnd) + 0.9 };
}

/**
 * Die Seite, deren Satelliten einen Schild um die Welt bilden - wie auf der
 * Karte ab SHIELD_MIN. Gibt es mehrere (selten), gilt die groesste.
 */
export function shieldOf(battle) {
  const je = new Map();
  battle.units.forEach((u, i) => {
    if (u[1] !== 'satellite') return;
    if (!je.has(u[0])) je.set(u[0], []);
    je.get(u[0]).push(i);
  });
  let best = null;
  for (const [k, ids] of je) {
    if (ids.length >= SHIELD_MIN && (!best || ids.length > best.ids.length)) best = { k, ids };
  }
  return best;
}

/**
 * Staerke des Schilds zum Zeitpunkt T, 0..1. Jeder Satellit traegt seinen
 * Teil und verglimmt, wenn er vergeht; faellt der letzte, bricht der Schild
 * zusammen.
 */
export function shieldStrength(shield, tl, T) {
  if (!shield) return 0;
  let s = 0;
  for (const i of shield.ids) {
    const d = tl.death[i];
    s += T < d ? 1 : Math.max(0, 1 - (T - d) / 0.6);
  }
  return Math.pow(s / shield.ids.length, 0.6);
}

/** Wird diese Einheit vom Schild gedeckt? Satelliten tragen ihn, die Abwehr sitzt darunter. */
export function underShield(shield, battle, i) {
  return !!shield && battle.units[i][0] === shield.k && ['satellite', 'battery'].includes(battle.units[i][1]);
}

/** Wie weit eine abgefangene Einheit schon davongeflogen ist: 0 = noch da, 1 = fort. */
export function fleeing(tl, i, T) {
  if (!tl.flee.ids.has(i) || T <= tl.flee.at) return 0;
  return Math.min(1, (T - tl.flee.at) / tl.flee.dur);
}

/** Huelle jeder Einheit zum Zeitpunkt T - nur Einschlaege bis dahin zaehlen. */
export function hpAt(battle, tl, T) {
  const hp = battle.units.map(u => u[2]);
  for (const s of tl.shots) if (s.th <= T) hp[s.to] = Math.round((hp[s.to] - s.dmg) * 10) / 10;
  return hp;
}

/** Heller als die Reichsfarbe: Schuesse sollen leuchten, nicht nur farbig sein. */
export function beamColor(hex, a = 1) {
  const [r, g, b] = hexRgb(hex);
  const m = (c) => Math.round(c + (255 - c) * 0.45);
  return `rgba(${m(r)},${m(g)},${m(b)},${a})`;
}

/** Feuerball mit Truemmern; k = 0..1 durch die Explosion. */
export function drawExplosion(ctx, x, y, size, k, seed) {
  if (k < 0 || k > 1) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const r = size * (0.35 + 0.9 * Math.sqrt(k));
  const a = 1 - k;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,250,230,${(a * 0.95).toFixed(3)})`);
  g.addColorStop(0.3, `rgba(255,190,90,${(a * 0.8).toFixed(3)})`);
  g.addColorStop(0.7, `rgba(240,90,40,${(a * 0.35).toFixed(3)})`);
  g.addColorStop(1, 'rgba(200,40,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  // Druckwelle
  ctx.strokeStyle = `rgba(255,210,150,${(a * 0.5).toFixed(3)})`;
  ctx.lineWidth = Math.max(0.6, size * 0.06 * a);
  ctx.beginPath(); ctx.arc(x, y, size * (0.3 + 1.5 * k), 0, TAU); ctx.stroke();
  // Truemmer fliegen gerade hinaus und verglühen
  const rnd = seeded(seed * 2654435761);
  ctx.strokeStyle = `rgba(255,200,120,${a.toFixed(3)})`;
  ctx.lineWidth = Math.max(0.6, size * 0.05);
  ctx.beginPath();
  for (let i = 0; i < 9; i++) {
    const ang = rnd() * TAU, v = size * (0.6 + rnd() * 1.1);
    const d0 = v * k, d1 = v * Math.max(0, k - 0.12);
    ctx.moveTo(x + Math.cos(ang) * d1, y + Math.sin(ang) * d1);
    ctx.lineTo(x + Math.cos(ang) * d0, y + Math.sin(ang) * d0);
  }
  ctx.stroke();
  ctx.restore();
}

/** Ein Schuss unterwegs: heller Kern in einem breiten, farbigen Schein. */
export function drawBolt(ctx, ax, ay, bx, by, p, len, color, width) {
  const dx = bx - ax, dy = by - ay;
  const d = Math.hypot(dx, dy) || 1;
  const tail = Math.min(1, len / d);
  const p0 = Math.max(0, p - tail);
  const x0 = ax + dx * p0, y0 = ay + dy * p0, x1 = ax + dx * p, y1 = ay + dy * p;
  ctx.lineCap = 'round';
  ctx.strokeStyle = beamColor(color, 0.35);
  ctx.lineWidth = width * 3;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

/** Einschlag: kurzer heller Funke, der schrumpft. */
export function drawImpact(ctx, x, y, r, k, color) {
  if (k < 0 || k > 1) return;
  const a = 1 - k;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
  g.addColorStop(0.4, beamColor(color, a * 0.7));
  g.addColorStop(1, beamColor(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

// ------------------------------------------------------------- Auf der Karte

const MAP_SLOTS = 14;      // so viele Einheiten je Seite stehen auf der Karte

/**
 * Die Schlachten der letzten Runde blitzen nach dem Rundenwechsel ein paar
 * Sekunden lang an ihren Welten auf: kleine Schiffe im Orbit, Schuesse in den
 * Reichsfarben, Explosionen dort, wo wirklich etwas vergangen ist. Beide
 * Ansichten zeichnen dasselbe - sie liefern nur Ort und Massstab der Welt.
 */
export class BattleFx {
  constructor() { this.items = []; }

  /** @param {{planetId:number, battle:object}[]} list  @param {string|null} you */
  start(list, you, now = performance.now()) {
    this.items = list.slice(0, 8).map((b, i) => {
      // Kurz halten: die ganze Schlacht passt in drei, vier Sekunden.
      const rd = Math.max(0.22, Math.min(0.55, 3.2 / Math.max(1, b.battle.rounds.length)));
      const shield = shieldOf(b.battle);
      return { ...b, tl: timeline(b.battle, rd), t0: now / 1000 + i * 0.35, shield, layout: mapLayout(b.battle, you, shield) };
    });
  }

  /** Millisekunden, bis der letzte Effekt verklungen ist. */
  remaining(now = performance.now()) {
    let ende = 0;
    for (const it of this.items) ende = Math.max(ende, (it.t0 + it.tl.end) * 1000 - now);
    return Math.max(0, ende);
  }

  /**
   * @param place (planetId) => {x, y, r, s, alpha} | null - Bildort der Welt,
   *   ihr Radius in Bildpunkten und der Massstab fuer Schiffe
   */
  draw(ctx, now, place, colorOf) {
    if (!this.items.length) return;
    const sec = now / 1000;
    this.items = this.items.filter(it => sec < it.t0 + it.tl.end);
    for (const it of this.items) {
      const T = sec - it.t0;
      if (T < 0) continue;
      const pl = place(it.planetId);
      if (!pl) continue;
      drawMapBattle(ctx, it, T, pl, colorOf);
    }
  }
}

function mapLayout(battle, you, shield) {
  const n = battle.sides.length;
  const mine = battle.sides.indexOf(you);
  // Eigene Seite oben - dort stehen auch die eigenen Flotten im Orbit.
  const base = battle.sides.map((_, k) => -Math.PI / 2 + ((k - Math.max(0, mine) + n) % n) * TAU / n);
  const slots = battle.units.map(() => null);
  const count = battle.sides.map(() => 0);
  battle.units.forEach((u, i) => {
    const k = u[0];
    if (u[1] === 'battery') { slots[i] = { battery: true, a: base[k] }; return; }
    // Schildsatelliten verteilen sich rundum auf der Schildkugel
    if (shield && shield.k === k && u[1] === 'satellite') {
      slots[i] = { ring: true, a: shield.ids.indexOf(i) * TAU / shield.ids.length };
      return;
    }
    const j = count[k]++;
    if (j < MAP_SLOTS) slots[i] = { j };
    else slots[i] = { j: j % MAP_SLOTS, hidden: true };
  });
  // Facher je Seite: wenige Schiffe stehen dicht, viele weiter verteilt.
  const shown = count.map(c => Math.min(MAP_SLOTS, c));
  const fan = Math.min(1.5, TAU / n * 0.7);
  battle.units.forEach((u, i) => {
    const s = slots[i];
    if (s.battery || s.ring) return;
    const m = shown[u[0]];
    const breite = fan * Math.min(1, m / 5);
    s.a = base[u[0]] + (m > 1 ? (s.j / (m - 1) - 0.5) * breite : 0);
    s.rr = 1 + ((s.j * 5) % 3) * 0.32;
  });
  return { slots };
}

function drawMapBattle(ctx, it, T, pl, colorOf) {
  const { battle, tl, layout, shield } = it;
  const { x, y, r, s } = pl;
  const orbit = 22 * s;
  const color = k => colorOf(battle.sides[k]);
  const pos = (i) => {
    const sl = layout.slots[i];
    if (sl.battery) return [x + Math.cos(sl.a) * r * 0.8, y + Math.sin(sl.a) * r * 0.8];
    if (sl.ring) return [x + Math.cos(sl.a) * pl.shieldR, y + Math.sin(sl.a) * pl.shieldR];
    const d = r + orbit * sl.rr;
    return [x + Math.cos(sl.a) * d, y + Math.sin(sl.a) * d];
  };
  const fadeIn = Math.min(1, T / 0.3);
  const fadeOut = Math.min(1, (tl.end - T) / 0.5);
  ctx.save();
  ctx.globalAlpha = (pl.alpha ?? 1) * Math.max(0, Math.min(fadeIn, fadeOut));

  // Unruhiger Schein um die umkaempfte Welt
  const puls = 0.5 + 0.5 * Math.sin(T * 9);
  ctx.strokeStyle = `rgba(255,96,70,${(0.25 + 0.25 * puls).toFixed(3)})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 5]);
  ctx.lineDashOffset = -T * 30;
  ctx.beginPath(); ctx.arc(x, y, r + orbit * 2.1, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);

  // Der Schild: steht er nach der Runde noch, zeichnet ihn die Karte selbst -
  // sonst hier, schwindend mit seinen Satelliten.
  const staerke = shieldStrength(shield, tl, T);
  if (shield && !pl.shielded) drawHexShield(ctx, x, y, pl.shieldR, T + it.planetId, staerke);

  // Schiffe, solange sie leben - je Platz nur das erste, das ihn belegt
  battle.units.forEach((u, i) => {
    const sl = layout.slots[i];
    if (sl.battery || sl.ring || sl.hidden || T >= tl.death[i]) return;
    const weg = fleeing(tl, i, T);
    if (weg >= 1) return;
    let [sx, sy] = pos(i);
    // Abgefangene drehen ab und fliegen beschleunigt nach aussen davon
    sx += Math.cos(sl.a) * orbit * 4 * weg * weg;
    sy += Math.sin(sl.a) * orbit * 4 * weg * weg;
    ctx.save();
    ctx.globalAlpha *= 1 - weg;
    drawShip(ctx, { type: u[1], x: sx, y: sy, angle: weg > 0 ? sl.a : sl.a + Math.PI, len: 15 * s, color: color(u[0]), phase: T + i });
    ctx.restore();
  });

  ctx.globalCompositeOperation = 'lighter';
  for (const sh of tl.shots) {
    if (sh.tf > T) break;
    if (T > sh.th + 0.15) continue;
    const [ax, ay] = pos(sh.from);
    let [bx, by] = pos(sh.to);
    const col = color(battle.units[sh.from][0]);
    // Der Schild faengt den Treffer: der Schuss endet auf der Kugel, dort,
    // wo er von aussen ankommt, und die leuchtet gruen auf.
    const amSchild = underShield(shield, battle, sh.to) && shieldStrength(shield, tl, sh.th) > 0.05;
    if (amSchild) {
      const w = Math.atan2(ay - y, ax - x);
      bx = x + Math.cos(w) * pl.shieldR; by = y + Math.sin(w) * pl.shieldR;
    }
    if (T <= sh.th) drawBolt(ctx, ax, ay, bx, by, (T - sh.tf) / (sh.th - sh.tf), 10 * s, col, 1.1 * s);
    else if (amSchild) drawShieldHit(ctx, bx, by, 7 * s, (T - sh.th) / 0.15);
    else drawImpact(ctx, bx, by, 5 * s, (T - sh.th) / 0.15, col);
  }
  ctx.globalCompositeOperation = 'source-over';
  battle.units.forEach((u, i) => {
    const d = tl.death[i];
    if (!(T >= d && T < d + 0.8)) return;
    const [ex, ey] = pos(i);
    drawExplosion(ctx, ex, ey, (u[1] === 'battery' ? 22 : 13) * s, (T - d) / 0.8, i + 1);
  });
  ctx.restore();
}
