// Räumliche Sternkarte. Dieselbe Partie wie in der Klassik-Ansicht, nur mit
// Höhe: die Welten liegen in einer Linse, die Kamera kreist frei darum.
//
// Projiziert wird von Hand auf dasselbe 2D-Canvas - keine Bibliothek, kein
// Build-Schritt. Welten und Schiffe bleiben die gewohnten Sprites und zeigen
// immer zur Kamera; lesbar wird der Raum durch drei Hilfen:
//   - ein Gitter in der Mittelebene der Galaxie,
//   - ein Lot von jeder Welt auf diese Ebene (zeigt die Höhe),
//   - Größe und Helligkeit nach Entfernung.
import { drawPlanet, planetRadius, planetThumb, planetLabels, label, orbitScale } from './planets.js';
import { drawShip, drawTrail } from './ships.js';
import { dist, holeZone, route, reachOutline } from '/shared/rules.js';
import { t } from '../i18n.js';
import {
  glowSprite, drawHoleCore, swirlPoint, swirlStroke, SWIRL,
  HOLE_SCALE, HOLE_MIN_PX, STAR_ALPHA, drawHexShield, SHIELD_MIN
} from './fx.js';
import { BattleFx } from './battlefx.js';

const FOV = 50 * Math.PI / 180;
const NEAR = 2;
const PITCH_MAX = 1.5;           // knapp 86°, sonst kippt die Basis um
const ORBIT_R = 20;
// Drei Sterngrößen wie in der flachen Karte. Statt zu driften dreht sich der
// Himmel langsam - je größer (also näher gedacht), desto schneller.
const SKY_CLASSES = [
  { r: 1, dreh: 0.0045 },
  { r: 2, dreh: 0.007 },
  { r: 3, dreh: 0.01 }
];

export class SpaceView {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    // Blickpunkt, Blickrichtung und Abstand - mehr braucht die Kamera nicht.
    this.cam = { tx: 0, ty: 0, tz: 0, yaw: -0.9, pitch: 0.62, dist: 2600 };
    this.view = null;
    this.hit = [];
    this.hover = null;
    this.selection = null;
    this.showNames = true;
    this.showRange = false;
    this.showTerritory = true;
    this.showStars = true;
    this.phase = 0;
    this._activeUntil = 0;
    this.onSelect = () => {};
    this.onOrder = () => {};
    this.onHoverChange = () => {};
    this.stars = makeStars(4000);
    this.battleFx = new BattleFx();
    this._bind();
    this.resize();
  }

  // --------------------------------------------------------------- Kamera
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this._w = this.cv.clientWidth;
    this._h = this.cv.clientHeight;
    this.cv.width = Math.round(this._w * dpr);
    this.cv.height = Math.round(this._h * dpr);
    this.dpr = dpr;
  }

  get w() { return this._w; }
  get h() { return this._h; }

  poke(ms = 700) { this._activeUntil = performance.now() + ms; }
  get busy() { return performance.now() < this._activeUntil; }

  /** Schlachten der letzten Runde an ihren Welten aufblitzen lassen. */
  playBattles(list, you) {
    this.battleFx.start(list, you);
    this.poke(this.battleFx.remaining() + 100);
  }

  /** Rechtshändige Basis aus Blickrichtung, Rechts und Oben. */
  basis() {
    const cp = Math.cos(this.cam.pitch), sp = Math.sin(this.cam.pitch);
    const f = [cp * Math.cos(this.cam.yaw), cp * Math.sin(this.cam.yaw), -sp];
    const r = unit(cross(f, [0, 0, 1]));
    const u = cross(r, f);
    return { f, r, u };
  }

  eye(b = this.basis()) {
    const c = this.cam;
    return [c.tx - b.f[0] * c.dist, c.ty - b.f[1] * c.dist, c.tz - b.f[2] * c.dist];
  }

  /** Weltpunkt in Kamerakoordinaten: [rechts, oben, vorwärts]. */
  toCam(x, y, z) {
    const b = this._b, e = this._eye;
    const dx = x - e[0], dy = y - e[1], dz = (z || 0) - e[2];
    return [
      dx * b.r[0] + dy * b.r[1] + dz * b.r[2],
      dx * b.u[0] + dy * b.u[1] + dz * b.u[2],
      dx * b.f[0] + dy * b.f[1] + dz * b.f[2]
    ];
  }

  /** Bildpunkt samt Maßstab, oder null hinter der Kamera. */
  project(x, y, z) {
    const c = this.toCam(x, y, z);
    if (c[2] <= NEAR) return null;
    const s = this.focal / c[2];
    return { x: this.w / 2 + c[0] * s, y: this.h / 2 - c[1] * s, s, depth: c[2] };
  }

  /** Für die Tonortung: nur die Bildposition. */
  w2s(x, y, z) {
    this._prep();
    const p = this.project(x, y, z);
    return p ? [p.x, p.y] : [this.w / 2, this.h / 2];
  }

  /**
   * Abstand so wählen, dass der Quader aller Welten gerade ins Bild passt -
   * eine Kugel würde bei der flachen Linse viel Luft verschenken.
   */
  fit(margin = 0.88) {
    if (!this.view?.planets?.length) return;
    const b = bounds(this.view.planets);
    const tx = (b.x0 + b.x1) / 2, ty = (b.y0 + b.y1) / 2, tz = (b.z0 + b.z1) / 2;
    this.cam.tx = tx; this.cam.ty = ty; this.cam.tz = tz;
    const focal = (this.h / 2) / Math.tan(FOV / 2);
    const bas = this.basis();
    const halfW = this.w / 2 * margin, halfH = this.h / 2 * margin;
    let need = 150;
    for (const cx of [b.x0, b.x1]) for (const cy of [b.y0, b.y1]) for (const cz of [b.z0, b.z1]) {
      const d = [cx - tx, cy - ty, cz - tz];
      const px = dot(d, bas.r), py = dot(d, bas.u), pz = dot(d, bas.f);
      need = Math.max(need, focal * Math.abs(px) / halfW - pz, focal * Math.abs(py) / halfH - pz);
    }
    this.cam.dist = need;
    this.poke();
  }

  /** Blickpunkt auf eine Welt oder Flotte setzen, Blickwinkel behalten. */
  /**
   * Welt ins Bild holen. `frei` ist das sichtbare Rechteck {w, h} - liegt ein
   * Blatt über der Karte, wird der Blickpunkt so weit versetzt, dass die Welt
   * im freien Teil steht.
   */
  focus(p, frei) {
    if (!p) return;
    this.cam.tx = p.x; this.cam.ty = p.y; this.cam.tz = p.z || 0;
    this.cam.dist = Math.min(this.cam.dist, 1400);
    this._prep();
    const w = frei?.w ?? this.w, h = frei?.h ?? this.h;
    if (w < this.w || h < this.h) this.schiebe((this.w - w) / 2, -(this.h - h) / 2);
    this.poke();
  }

  centerOn(x, y) { this.focus({ x, y, z: 0 }); }

  zoomBy(f) {
    this.cam.dist = Math.max(120, Math.min(90000, this.cam.dist / f));
    this.poke();
  }

  /** Draufsicht - entspricht der Klassik-Ansicht. */
  topView() { this.cam.pitch = PITCH_MAX; this.cam.yaw = -Math.PI / 2; this.poke(); }

  setView(view) {
    const first = !this.view;
    this.view = view;
    this.poke(900);
    if (first) {
      this.fit();
      const home = view.me ? view.planets.find(p => p.id === view.me.homeworld) : null;
      if (home) { this.focus(home); this.cam.dist = 1500; }
    }
  }

  // ------------------------------------------------------------ Zeichnen
  _prep() {
    this.focal = (this.h / 2) / Math.tan(FOV / 2);
    this._b = this.basis();
    this._eye = this.eye(this._b);
  }

  draw(dt) {
    this.phase += dt;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.view) {
      ctx.fillStyle = '#04060f';
      ctx.fillRect(0, 0, this.w, this.h);
      return;
    }
    this._prep();
    this.hit = [];

    const v = this.view;
    const colorOf = id => (v.players.find(p => p.id === id) || {}).color || '#889';

    this.drawBackdrop(ctx, colorOf);
    this.drawCourses(ctx);
    if (this.showRange) this.drawRange(ctx);

    // Alles Räumliche von hinten nach vorn - der Maler-Algorithmus ersetzt
    // den Tiefenpuffer, den ein 2D-Canvas nicht hat.
    const items = [];
    for (const p of v.planets) {
      const pr = this.project(p.x, p.y, p.z);
      if (!pr) continue;
      if (pr.x < -120 || pr.y < -120 || pr.x > this.w + 120 || pr.y > this.h + 120) continue;
      items.push({ depth: pr.depth, kind: 'planet', p, pr });
    }
    for (const f of v.fleets) {
      const anchor = f.at != null ? v.planets[f.at] : f;
      if (!anchor) continue;
      const pr = this.project(anchor.x, anchor.y, anchor.z);
      if (!pr) continue;
      items.push({ depth: pr.depth - 1, kind: 'fleet', f, pr, anchor });
    }
    const bh = v.galaxy.blackHole;
    if (bh) {
      const pr = this.project(bh.x, bh.y, bh.z || 0);
      if (pr) items.push({ depth: pr.depth, kind: 'hole', bh, pr });
    }
    items.sort((a, b) => b.depth - a.depth);

    // Namen gehören in dieselbe Reihenfolge wie ihre Welt: gesammelt und zum
    // Schluss gezeichnet, läge der Name einer fernen Welt über allem, was
    // davor steht.
    for (const it of items) {
      const labels = [];
      if (it.kind === 'planet') this.drawWorld(ctx, it, colorOf, labels);
      else if (it.kind === 'hole') this.drawHole(ctx, it, labels);
      else this.drawFleet(ctx, it, colorOf);
      for (const l of labels) label(ctx, l.text, l.x, l.y, l.color, 1, l.size);
    }
    // Schlachten obenauf - sie sollen auffallen, auch hinter einer nahen Welt.
    this.battleFx.draw(ctx, performance.now(), (id) => {
      const p = v.planets[id];
      const pr = p && this.project(p.x, p.y, p.z);
      if (!pr) return null;
      return { x: pr.x, y: pr.y, r: planetRadius(p) * pr.s,
        s: Math.max(0.55, Math.min(1.8, 0.7 + pr.s * 0.45)), alpha: depthFade(pr.depth, this.cam.dist),
        shieldR: planetRadius(p) * pr.s * 1.14 + 20 * orbitScale(pr.s), shielded: p.defenses >= SHIELD_MIN };
    }, colorOf);
    if (this.hover?.type === 'planet') this.tooltip(ctx, v.planets[this.hover.id]);
  }

  /**
   * Sterne, Gitter und Gebietsfarben ändern sich nur, wenn sich die Kamera
   * bewegt oder eine Runde vergeht - also einmal in ein Zwischencanvas und
   * danach nur noch kopieren.
   */
  drawBackdrop(ctx, colorOf) {
    const c = this.cam;
    const key = `${c.tx.toFixed(1)}|${c.ty.toFixed(1)}|${c.tz.toFixed(1)}`
      + `|${c.yaw.toFixed(4)}|${c.pitch.toFixed(4)}|${c.dist.toFixed(1)}`
      + `|${this.w}|${this.h}|${this.view.turn}|${this.showTerritory ? 1 : 0}`;
    if (this._skyKey !== key) {
      this._skyKey = key;
      this.renderBackdrop(colorOf);
    }
    ctx.drawImage(this._sky, 0, 0, this.w, this.h);
    if (this.showStars) this.drawSky(ctx);    // live, dreht sich ständig weiter
  }

  renderBackdrop(colorOf) {
    if (!this._sky) this._sky = document.createElement('canvas');
    const cv = this._sky;
    const W = Math.max(1, Math.round(this.w * this.dpr)), H = Math.max(1, Math.round(this.h * this.dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; this._skyCtx = null; }
    const ctx = this._skyCtx || (this._skyCtx = cv.getContext('2d'));
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawGrid(ctx);
    if (this.showTerritory) this.drawTerritory(ctx, colorOf);
  }

  /** Sterne liegen weit weg: nur die Drehung zählt - und die ist je
   *  Größenklasse etwas anders, das gibt dem Himmel Tiefe. */
  drawSky(ctx) {
    const b = this._b;
    const dreh = SKY_CLASSES.map(c => {
      const a = this.phase * c.dreh;
      return [Math.cos(a), Math.sin(a)];
    });
    const buckets = this._buckets || (this._buckets = Array.from({ length: 12 }, () => []));
    for (const bk of buckets) bk.length = 0;
    for (const s of this.stars) {
      const [co, si] = dreh[s.li];
      const vx = s.v[0] * co - s.v[1] * si;
      const vy = s.v[0] * si + s.v[1] * co;
      const vz = s.v[2];
      const pz = vx * b.f[0] + vy * b.f[1] + vz * b.f[2];
      if (pz <= 0.2) continue;
      const k = this.focal / pz;
      const sx = this.w / 2 + (vx * b.r[0] + vy * b.r[1] + vz * b.r[2]) * k;
      const sy = this.h / 2 - (vx * b.u[0] + vy * b.u[1] + vz * b.u[2]) * k;
      if (sx < 0 || sy < 0 || sx > this.w || sy > this.h) continue;
      const tw = 0.8 + 0.2 * Math.sin(this.phase * 1.4 + s.tw);
      buckets[Math.max(0, Math.min(11, Math.floor(s.a * tw * 12)))].push(sx | 0, sy | 0, s.r);
    }
    // Ein Pfad je Helligkeitsstufe statt ein Aufruf je Stern - das spart dem
    // Rasterer hunderte Einzelflächen pro Bild.
    for (let k = 0; k < 12; k++) {
      const arr = buckets[k];
      if (!arr.length) continue;
      ctx.fillStyle = STAR_ALPHA[k];
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 3) ctx.rect(arr[i], arr[i + 1], arr[i + 2], arr[i + 2]);
      ctx.fill();
    }
  }

  /** Gitter in der Mittelebene - ohne Boden schwebt alles im Nichts. */
  drawGrid(ctx) {
    const g = this.view.galaxy;
    const x0 = g.minX ?? 0, y0 = g.minY ?? 0;
    const x1 = g.maxX ?? g.width, y1 = g.maxY ?? g.height;
    const step = niceStep(Math.max(x1 - x0, y1 - y0) / 12);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120,160,220,0.11)';
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) this.seg(ctx, [x, y0, 0], [x, y1, 0]);
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) this.seg(ctx, [x0, y, 0], [x1, y, 0]);
    ctx.stroke();
    // Rand der Karte etwas kräftiger
    ctx.strokeStyle = 'rgba(140,180,240,0.22)';
    ctx.beginPath();
    this.seg(ctx, [x0, y0, 0], [x1, y0, 0]);
    this.seg(ctx, [x1, y0, 0], [x1, y1, 0]);
    this.seg(ctx, [x1, y1, 0], [x0, y1, 0]);
    this.seg(ctx, [x0, y1, 0], [x0, y0, 0]);
    ctx.stroke();
    ctx.restore();
  }

  /** Eine Strecke im Raum, am vorderen Rand abgeschnitten. */
  seg(ctx, a, b) {
    let A = this.toCam(a[0], a[1], a[2]);
    let B = this.toCam(b[0], b[1], b[2]);
    if (A[2] <= NEAR && B[2] <= NEAR) return;
    if (A[2] <= NEAR) A = clipNear(A, B);
    else if (B[2] <= NEAR) B = clipNear(B, A);
    const p = this.toScreen(A), q = this.toScreen(B);
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }

  toScreen(c) {
    const s = this.focal / c[2];
    return [this.w / 2 + c[0] * s, this.h / 2 - c[1] * s];
  }

  drawTerritory(ctx, colorOf) {
    const v = this.view;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of v.planets) {
      if (!p.owner) continue;
      const pr = this.project(p.x, p.y, p.z);
      if (!pr) continue;
      // Nah an der Welt deckelt die Obergrenze die Füllfläche - sonst malt
      // eine einzige Welt den halben Bildschirm aus.
      const r = Math.min(480, (230 + Math.min(45, p.pop || 0) * 4.5) * pr.s);
      if (pr.x + r < 0 || pr.y + r < 0 || pr.x - r > this.w || pr.y - r > this.h) continue;
      ctx.globalAlpha = p.known === 'memory' ? 0.45 : 1;
      ctx.drawImage(glowSprite(colorOf(p.owner)), pr.x - r, pr.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  drawCourses(ctx) {
    const v = this.view;
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -this.phase * 22;
    // Der Kurs folgt dem Weg um das schwarze Loch, nicht der Luftlinie.
    const zone = holeZone(v.galaxy);
    for (const f of v.fleets) {
      if (f.dest == null) continue;
      const t = v.planets[f.dest];
      if (!t) continue;
      ctx.strokeStyle = f.mine ? 'rgba(255,216,119,.7)' : 'rgba(255,120,120,.5)';
      ctx.beginPath();
      let prev = [f.x, f.y, f.z || 0];
      for (const w of route(f, t, zone)) {
        const p = [w.x, w.y, w.z || 0];
        this.seg(ctx, prev, p);
        prev = p;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Reichweite als Kreis in der Höhe der Welt - eine Kugel wäre unlesbar. */
  drawRange(ctx) {
    const v = this.view;
    const sel = this.selection?.type === 'fleet' ? v.fleets.find(f => f.id === this.selection.id) : null;
    const range = sel?.mine ? (sel.stats.range || 0) : 0;
    if (!range) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(120,180,255,.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    const zone = holeZone(v.galaxy);
    this._reich = this._reich || new Map();
    for (const p of v.planets) {
      if (p.owner !== v.you || !(p.pop > 0.5)) continue;
      // Kein Kreis, sondern der wirklich erreichbare Umriss - am schwarzen
      // Loch hat er eine Delle (siehe reachOutline in shared/rules.js).
      const key = `${p.id}|${Math.round(range)}|${zone ? 1 : 0}`;
      let u = this._reich.get(key);
      if (!u) {
        u = reachOutline(p, range, zone, 48);
        if (this._reich.size > 64) this._reich.clear();
        this._reich.set(key, u);
      }
      ctx.beginPath();
      for (let i = 0; i < u.length; i++) {
        const a = u[i], b = u[(i + 1) % u.length];
        this.seg(ctx, [a.x, a.y, a.z], [b.x, b.y, b.z]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawWorld(ctx, it, colorOf, labels) {
    const { p, pr } = it;
    const ctxAlpha = depthFade(pr.depth, this.cam.dist);
    // Lot auf die Mittelebene: erst daran sieht man, wie hoch die Welt liegt
    if (Math.abs(p.z || 0) > 1) {
      const foot = this.project(p.x, p.y, 0);
      ctx.save();
      // Unerforschte Welten treten zurück, sonst ist das Bild ein Nadelwald
      ctx.globalAlpha = (p.known === 'unknown' ? 0.15 : 0.33) * ctxAlpha;
      ctx.strokeStyle = p.owner ? colorOf(p.owner) : '#7d8aa5';
      ctx.lineWidth = 1;
      ctx.beginPath();
      this.seg(ctx, [p.x, p.y, p.z], [p.x, p.y, 0]);
      ctx.stroke();
      if (foot) {
        ctx.fillStyle = p.owner ? colorOf(p.owner) : '#7d8aa5';
        ctx.fillRect(foot.x - 1.5, foot.y - 1.5, 3, 3);
      }
      ctx.restore();
    }

    // focal/Tiefe ist genau das, was in der flachen Karte der Zoom ist:
    // ein Weltmaß mal diesem Faktor ergibt Bildpunkte.
    const scale = pr.s;
    ctx.save();
    ctx.globalAlpha = ctxAlpha;
    drawPlanet(ctx, p, pr.x, pr.y, scale, {
      scale,
      ownerColor: p.owner ? colorOf(p.owner) : null,
      selected: this.selection?.type === 'planet' && this.selection.id === p.id,
      hovered: this.hover?.type === 'planet' && this.hover.id === p.id,
      showName: false
    });
    ctx.restore();
    const r = planetRadius(p) * scale;

    // Orbitale Verteidigung: dieselbe Kreisbahn wie in der flachen Karte, nur
    // mit der projizierten Größe. Die Satelliten bleiben immer zuhause, also
    // gehören sie zur Welt und nicht zu den Flotten.
    if (p.defenses >= SHIELD_MIN) {
      ctx.save();
      ctx.globalAlpha = ctxAlpha;
      drawHexShield(ctx, pr.x, pr.y, r * 1.14 + 20 * orbitScale(scale), this.phase + p.id);
      this.badge(ctx, pr.x + r + 16, pr.y - r - 10, '×' + p.defenses, colorOf(p.owner));
      ctx.restore();
    } else if (p.defenses > 0) {
      const n = p.defenses;
      const sc = orbitScale(scale);
      ctx.save();
      ctx.globalAlpha = ctxAlpha;
      for (let i = 0; i < n; i++) {
        const a = this.phase * 0.25 + i * (Math.PI * 2 / n);
        const orr = r * 1.14 + 20 * sc;
        drawShip(ctx, {
          type: 'satellite', x: pr.x + Math.cos(a) * orr, y: pr.y + Math.sin(a) * orr,
          angle: a + Math.PI / 2, len: 19 * sc,
          color: colorOf(p.owner), phase: this.phase + i
        });
      }
      ctx.restore();
    }

    // Namen blenden sich mit der Größe aus wie in der flachen Karte - in der
    // Tiefe heißt das: nahe Welten sind beschriftet, ferne nicht.
    if (this.showNames) labels.push(...planetLabels(p, pr.x, pr.y, scale, r));
    this.hit.push({ type: 'planet', id: p.id, x: pr.x, y: pr.y, r: Math.max(10, r + 5) });
  }

  /**
   * Richtung, in die das Schiffssymbol zeigt - auf dem Bildschirm, nicht in
   * der Welt: im Raum kippt die Kamera, eine Weltrichtung waere hier falsch.
   * Genommen wird das erste Stueck des Wegs (auf dem Bogen um das schwarze
   * Loch fliegt die Flotte quer zum Ziel), und zwar das erste, das projiziert
   * lang genug ist - sonst zittert die Nase bei fast erreichten Wegpunkten.
   */
  kurswinkel(f, x, y) {
    const v = this.view;
    const ziel = f.dest != null ? v.planets[f.dest] : null;
    if (!ziel) return null;
    for (const w of route(f, ziel, holeZone(v.galaxy))) {
      const t = this.project(w.x, w.y, w.z || 0);
      if (!t) continue;
      const dx = t.x - x, dy = t.y - y;
      if (dx * dx + dy * dy > 1) return Math.atan2(dy, dx);
    }
    return null;
  }

  drawFleet(ctx, it, colorOf) {
    const { f, pr } = it;
    const v = this.view;
    const col = colorOf(f.owner);
    const lead = leadType(f);
    const scale = Math.max(0.55, Math.min(1.8, 0.7 + pr.s * 0.45));
    ctx.save();
    ctx.globalAlpha = depthFade(pr.depth, this.cam.dist);
    let x = pr.x, y = pr.y;
    if (f.at != null) {
      const idx = v.fleets.filter(g => g.at === f.at).indexOf(f);
      const a = -Math.PI / 2 + idx * 0.85 + (f.owner === v.you ? 0 : Math.PI);
      const rr = planetRadius(v.planets[f.at]) * pr.s + ORBIT_R * scale;
      x += Math.cos(a) * rr;
      y += Math.sin(a) * rr;
      drawShip(ctx, { type: lead, x, y, angle: a + Math.PI / 2, len: 24 * scale, color: col, phase: this.phase + idx });
    } else {
      const ang = this.kurswinkel(f, x, y) ?? 0;
      drawTrail(ctx, x, y, ang, 46 * scale, col);
      drawShip(ctx, { type: lead, x, y, angle: ang, len: 26 * scale, color: col, phase: this.phase });
    }
    const n = f.ships ? f.ships.length : f.count;
    if (n > 1) this.badge(ctx, x + 13 * scale, y - 11 * scale, '×' + n, col);
    if (this.selection?.type === 'fleet' && this.selection.id === f.id) this.ringAt(ctx, x, y, 16 * scale);
    ctx.restore();
    this.hit.push({ type: 'fleet', id: f.id, x, y, r: 14 * scale });
  }

  /**
   * Schwarzes Loch mit Strudel. Die Arme liegen in der Galaxienebene, nicht
   * auf einer der Kamera zugewandten Scheibe - deshalb stimmt die Perspektive,
   * und die hintere Hälfte verschwindet hinter dem Schlund.
   */
  drawHole(ctx, it, labels) {
    const { bh, pr } = it;
    const r = Math.max(HOLE_MIN_PX, bh.r * pr.s * HOLE_SCALE);
    const R = bh.r * HOLE_SCALE;                 // Weltmaß für die Arme
    const z = bh.z || 0;
    const stuecke = Math.max(6, Math.min(18, Math.round(r / 5)));

    const hinten = [], vorn = [];
    for (let k = 0; k < SWIRL.arme; k++) {
      let prev = null;
      for (let i = 0; i <= stuecke; i++) {
        const t = i / stuecke;
        const [dx, dy] = swirlPoint(R, this.phase, k, t);
        const p = [bh.x + dx, bh.y + dy, z];
        if (prev) {
          const mitte = this.toCam((prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2, z);
          (mitte[2] > pr.depth ? hinten : vorn).push([prev, p, t]);
        }
        prev = p;
      }
    }
    const malen = (liste) => {
      for (const [a, b, t] of liste) {
        swirlStroke(ctx, r, t);
        ctx.beginPath();
        this.seg(ctx, a, b);
        ctx.stroke();
      }
    };
    ctx.save();
    malen(hinten);
    drawHoleCore(ctx, pr.x, pr.y, r);
    malen(vorn);
    // Grenze der Sperrzone, in der Galaxienebene - sonst sieht der Umweg der
    // Flotten wie ein Fehler aus.
    const zr = holeZone(this.view.galaxy).r;
    ctx.strokeStyle = 'rgba(150,190,255,.26)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = this.phase * 9;
    ctx.beginPath();
    const N = 48;
    for (let i = 0; i < N; i++) {
      const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
      this.seg(ctx, [bh.x + Math.cos(a0) * zr, bh.y + Math.sin(a0) * zr, z],
                    [bh.x + Math.cos(a1) * zr, bh.y + Math.sin(a1) * zr, z]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    if (this.showNames) {
      labels.push({ text: bh.name, x: pr.x, y: pr.y + r * 1.5 + 11, color: '#9ec8f5', size: 12.5 });
    }
  }

  badge(ctx, x, y, text, color, center = false) {
    ctx.save();
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 12;
    const bx = center ? x - w / 2 : x;
    ctx.fillStyle = 'rgba(6,10,20,.88)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, y - 9, w, 18, 9);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + w / 2, y + 0.5);
    ctx.restore();
  }

  ringAt(ctx, x, y, r) {
    ctx.save();
    ctx.strokeStyle = '#ffd877';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -this.phase * 14;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  tooltip(ctx, p) {
    if (!p) return;
    const pr = this.project(p.x, p.y, p.z);
    if (!pr) return;
    const lines = [];
    if (p.known === 'unknown') {
      lines.push([t('map.tooltipUnknown'), '#9aa8c4']);
    } else {
      const owner = p.owner ? (this.view.players.find(q => q.id === p.owner) || {}) : null;
      lines.push([t('map.tooltipTemp', { temp: Math.round(p.temp), grav: (+p.grav).toFixed(2) }), '#d6deef']);
      lines.push([t('map.tooltipPop', { pop: (+p.pop).toFixed(1), ore: Math.round(p.metalReserve) }), '#9aa8c4']);
      if (owner) lines.push([owner.name, owner.color || '#fff']);
    }
    lines.push([t('map.tooltipHeight', { z: ((p.z || 0) > 0 ? '+' : '') + Math.round(p.z || 0) }), '#67738c']);
    ctx.save();
    ctx.font = '13px Inter, system-ui, sans-serif';
    const w = Math.max(...lines.map(l => ctx.measureText(l[0]).width), ctx.measureText(p.name).width) + 18;
    const h = lines.length * 16 + 28;
    let x = pr.x + 18, y = pr.y - h / 2;
    if (x + w > this.w - 8) x = pr.x - 18 - w;
    y = Math.max(4, Math.min(this.h - h - 4, y));
    ctx.fillStyle = 'rgba(8,11,22,.93)';
    ctx.strokeStyle = 'rgba(150,175,215,.28)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let yy = y + 14;
    ctx.font = '600 13.5px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(p.name, x + 9, yy);
    ctx.font = '13px Inter, system-ui, sans-serif';
    for (const [t, c] of lines) {
      yy += 16;
      ctx.fillStyle = c;
      ctx.fillText(t, x + 9, yy);
    }
    ctx.restore();
  }

  // --------------------------------------------------------------- Eingabe
  pick(sx, sy) {
    for (let i = this.hit.length - 1; i >= 0; i--) {
      const h = this.hit[i];
      const dx = sx - h.x, dy = sy - h.y;
      if (dx * dx + dy * dy <= h.r * h.r) return h;
    }
    return null;
  }

  /** Blickpunkt in der Bildebene schieben - Schrittweite nach Abstand. */
  schiebe(dx, dy) {
    const k = this.cam.dist / this.focal;
    const b = this._b || this.basis();
    this.cam.tx -= (b.r[0] * dx - b.u[0] * dy) * k;
    this.cam.ty -= (b.r[1] * dx - b.u[1] * dy) * k;
    this.cam.tz -= (b.r[2] * dx - b.u[2] * dy) * k;
  }

  _bind() {
    const cv = this.cv;
    let dragging = false, moved = false, panning = false, last = null;
    // Zwei Finger: Abstand zoomt, Mittelpunkt schiebt den Blickpunkt. Drehen
    // bleibt der einzelne Finger - sonst wäre im Raum kein Kurs zu halten.
    const zeiger = new Map();
    let pinch = null;

    const mitte = () => {
      const p = [...zeiger.values()];
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2,
        d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
    };

    cv.addEventListener('pointerdown', (e) => {
      this.poke();
      cv.setPointerCapture(e.pointerId);
      zeiger.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (zeiger.size === 2) { pinch = mitte(); moved = true; dragging = false; return; }
      dragging = true; moved = false;
      panning = e.shiftKey || e.button === 1;
      last = { x: e.offsetX, y: e.offsetY };
    });

    cv.addEventListener('pointermove', (e) => {
      this.poke();
      if (zeiger.has(e.pointerId)) zeiger.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (zeiger.size >= 2 && pinch) {
        const jetzt = mitte();
        if (pinch.d > 0 && jetzt.d > 0) this.zoomBy(jetzt.d / pinch.d);
        this.schiebe(jetzt.x - pinch.x, jetzt.y - pinch.y);
        pinch = jetzt;
        return;
      }
      if (dragging) {
        const dx = e.offsetX - last.x, dy = e.offsetY - last.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        if (moved) {
          if (panning) {
            this.schiebe(dx, dy);
          } else {
            this.cam.yaw -= dx * 0.006;
            this.cam.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, this.cam.pitch + dy * 0.006));
          }
          cv.classList.add('dragging');
        }
        last = { x: e.offsetX, y: e.offsetY };
        return;
      }
      // Beim Finger gibt es kein Schweben - der Tipp wählt gleich aus.
      if (e.pointerType === 'touch') return;
      const h = this.pick(e.offsetX, e.offsetY);
      const changed = JSON.stringify(h) !== JSON.stringify(this.hover);
      this.hover = h;
      if (changed) this.onHoverChange(h);
      cv.style.cursor = h ? 'pointer' : 'grab';
    });

    const los = (e) => {
      zeiger.delete(e.pointerId);
      if (zeiger.size < 2) pinch = null;
      if (zeiger.size === 1) {
        const p = [...zeiger.values()][0];
        last = { x: p.x, y: p.y };
        dragging = true;
      }
    };
    cv.addEventListener('pointercancel', (e) => { los(e); dragging = false; moved = true; });

    cv.addEventListener('pointerup', (e) => {
      const warMehr = zeiger.size > 1;
      los(e);
      if (warMehr) { dragging = false; return; }
      dragging = false;
      cv.classList.remove('dragging');
      if (moved) return;
      const h = this.pick(e.offsetX, e.offsetY);
      if (e.button === 2) { this.onOrder(h); return; }
      if (e.shiftKey) { this.onOrder(h); return; }
      this.onSelect(h);
    });

    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onOrder(this.pick(e.offsetX, e.offsetY));
    });

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.poke();
      this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    window.addEventListener('resize', () => this.resize());
  }
}

// ------------------------------------------------------------- Werkzeug
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function unit(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function clipNear(a, b) {
  const t = (NEAR - a[2]) / (b[2] - a[2]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR];
}
function bounds(planets) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of planets) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    const z = p.z || 0;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, y0, z0, x1, y1, z1 };
}
/** Weit entfernte Welten treten zurück - sonst ist vorn und hinten gleich laut. */
/**
 * Tiefenwirkung: Was hinter dem Blickpunkt liegt, tritt zurueck - alles davor
 * bleibt deckend. Die alte Kurve verblasste schon den Vordergrund (in der
 * eingepassten Ansicht war keine Welt mehr volldeckend): Sterne und Gitter
 * schienen durch die Planeten, und der Maler-Algorithmus verlor genau die
 * Verdeckung, fuer die er da ist.
 */
function depthFade(depth, camDist) {
  const t = depth / Math.max(1, camDist);
  return Math.max(0.5, Math.min(1, 1 - (t - 1.05) * 0.5));
}
function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}
function makeStars(n) {
  let seed = 90210;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const stars = [];
  for (let i = 0; i < n; i++) {
    // gleichmäßig auf der Kugel
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const w = rnd();
    const li = w < 0.72 ? 0 : w < 0.93 ? 1 : 2;     // viele kleine, wenige große
    stars.push({
      v: [s * Math.cos(a), s * Math.sin(a), u],
      li,
      r: Math.max(1, Math.round(SKY_CLASSES[li].r)),
      a: 0.3 + rnd() * 0.65,
      tw: rnd() * Math.PI * 2
    });
  }
  return stars;
}
function leadType(f) {
  const order = ['fighter', 'colony', 'tanker', 'scout', 'satellite'];
  const types = new Set((f.ships || []).map(s => s.type));
  for (const t of order) if (types.has(t)) return t;
  return 'fighter';
}

export { planetThumb, planetRadius };
