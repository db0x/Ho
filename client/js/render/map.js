// Sternkarte: Kamera, Hintergrund, Planeten, Flotten, Kurslinien.
import { drawPlanet, planetRadius, planetThumb, planetLabels, label, orbitScale } from './planets.js';
import { drawShip, drawTrail } from './ships.js';
import { dist, tempColor, rgb, holeZone, route, routeLength, reachOutline } from '../../shared/rules.js';
import { t } from '../i18n.js';
import { glowSprite, drawBlackHole, drawHoleZone, HOLE_SCALE, HOLE_MIN_PX, STAR_ALPHA, drawHexShield, SHIELD_MIN } from './fx.js';
import { BattleFx } from './battlefx.js';

const ORBIT_R = 20;

// Der Himmel entsteht in Kacheln statt einmalig für eine feste Galaxiengröße -
// so wächst er mit der Karte mit. Bei kleinem Zoom wird eine gröbere Stufe
// genommen, damit immer ähnlich viele Sterne auf dem Schirm stehen.
const SKY_TILE = 900;
// Drei Sternenebenen statt einer Wolke: viele kleine weit hinten, wenige große
// vorn. Jede zieht in ihrem eigenen Tempo vorbei - zusammen ergibt das die
// ruhige Tiefe, die ein stehendes Sternfeld nicht hat.
const SKY_LAYERS = [
  { p: 0.45, n: 20, r: 1 },
  { p: 0.70, n: 8, r: 2 },
  { p: 1.00, n: 4, r: 3 }
];
const DRIFT_PX = 7;        // Bildpunkte je Sekunde auf der vordersten Ebene

/** Zufall, der nur von der Kachel abhängt - derselbe Himmel bei jedem Besuch. */
function tileRng(level, layer, tx, ty) {
  let h = Math.imul(tx | 0, 0x27d4eb2d) ^ Math.imul(ty | 0, 0x165667b1)
    ^ Math.imul(level + 1, 0x9e3779b1) ^ Math.imul(Math.round(layer * 100), 0x85ebca6b);
  h = (h ^ (h >>> 15)) >>> 0;
  return () => {
    h = (h + 0x6D2B79F5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const nebCache = new Map();
/** Nebel einmal je Farbton in ein kleines Canvas; skaliert blitten ist billiger
 *  als ein großer Verlauf pro Bild. */
function nebulaSprite(hue) {
  let cv = nebCache.get(hue);
  if (cv) return cv;
  const S = 256;
  cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, `hsla(${hue},70%,55%,0.075)`);
  grad.addColorStop(0.5, `hsla(${hue},70%,45%,0.035)`);
  grad.addColorStop(1, 'hsla(0,0%,0%,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  nebCache.set(hue, cv);
  return cv;
}

export class MapView {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.view = null;
    this.hit = [];
    this.hover = null;
    this.selection = null;     // {type:'planet'|'fleet', id}
    this.showNames = true;
    this.showRange = false;
    this.showTerritory = true;
    this.showStars = true;
    this.phase = 0;
    this.onSelect = () => {};
    this.onOrder = () => {};
    this.onHoverChange = () => {};
    this._activeUntil = 0;
    this._tiles = new Map();
    this.battleFx = new BattleFx();
    this._bind();
    this.resize();
  }

  // ------------------------------------------------------------- Kamera
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Gemerkt, weil jeder Zugriff auf clientWidth das Layout neu berechnen
    // lässt - und w2s() fragt pro Bild hundertfach danach.
    this._w = this.cv.clientWidth;
    this._h = this.cv.clientHeight;
    this.cv.width = Math.round(this._w * dpr);
    this.cv.height = Math.round(this._h * dpr);
    this.dpr = dpr;
    this._bg = null;
  }

  get w() { return this._w; }
  get h() { return this._h; }

  /** Volle Bildrate anfordern - Eingabe, neue Sicht, bewegte Kamera. */
  poke(ms = 700) { this._activeUntil = performance.now() + ms; }
  get busy() { return performance.now() < this._activeUntil; }

  /** Schlachten der letzten Runde an ihren Welten aufblitzen lassen. */
  playBattles(list, you) {
    this.battleFx.start(list, you);
    this.poke(this.battleFx.remaining() + 100);
  }

  w2s(x, y) {
    return [(x - this.cam.x) * this.cam.zoom + this.w / 2, (y - this.cam.y) * this.cam.zoom + this.h / 2];
  }
  s2w(sx, sy) {
    return [(sx - this.w / 2) / this.cam.zoom + this.cam.x, (sy - this.h / 2) / this.cam.zoom + this.cam.y];
  }

  fit(padding = 90) {
    if (!this.view) return;
    const g = this.view.galaxy;
    // Grenzen statt Maße: die Karte wächst, Koordinaten können negativ werden.
    const x0 = g.minX ?? 0, y0 = g.minY ?? 0;
    const x1 = g.maxX ?? g.width, y1 = g.maxY ?? g.height;
    const zx = (this.w - padding * 2) / Math.max(1, x1 - x0);
    const zy = (this.h - padding * 2 - 90) / Math.max(1, y1 - y0);
    this.cam.zoom = Math.max(0.04, Math.min(zx, zy));
    this.cam.x = (x0 + x1) / 2;
    this.cam.y = (y0 + y1) / 2;
    this.poke();
  }

  /** Blickpunkt auf eine Welt oder Flotte - in der Ebene zählt z nicht. */
  /**
   * Welt ins Bild holen. `frei` ist das sichtbare Rechteck {w, h}: liegt ein
   * Blatt über der Karte, soll die Welt in der Mitte des *freien* Teils
   * landen und nicht dahinter.
   */
  focus(p, frei) {
    if (!p) return;
    this.centerOn(p.x, p.y);
    const w = frei?.w ?? this.w, h = frei?.h ?? this.h;
    this.cam.x += (this.w - w) / 2 / this.cam.zoom;
    this.cam.y += (this.h - h) / 2 / this.cam.zoom;
    this.poke();
  }

  centerOn(x, y, zoom) {
    this.cam.x = x; this.cam.y = y;
    if (zoom) this.cam.zoom = zoom;
    this.poke();
  }

  zoomBy(f, sx = this.w / 2, sy = this.h / 2) {
    const [wx, wy] = this.s2w(sx, sy);
    this.cam.zoom = Math.max(0.04, Math.min(3.2, this.cam.zoom * f));
    const [nx, ny] = this.s2w(sx, sy);
    this.cam.x += wx - nx;
    this.cam.y += wy - ny;
    this.poke();
  }

  setView(view) {
    const first = !this.view;
    this.view = view;
    this.poke(900);
    if (first) {
      this.fit();
      // Zuschauer haben keine Heimatwelt - für sie bleibt der Gesamtblick.
      const home = view.me ? view.planets.find(p => p.id === view.me.homeworld) : null;
      if (home) this.centerOn(home.x, home.y, Math.max(0.95, Math.min(1.4, this.cam.zoom * 3)));
    }
  }

  /** Kachelstufe: je weiter herausgezoomt, desto größer die Kacheln. */
  skyLevel() {
    return Math.max(0, Math.min(9, Math.round(Math.log2(0.9 / Math.max(0.01, this.cam.zoom)))));
  }

  /** Sterne einer Kachel auf einer der drei Ebenen. */
  skyTile(level, li, tx, ty) {
    const key = `s${level}|${li}|${tx}|${ty}`;
    const hit = this._tiles.get(key);
    if (hit) return hit;
    const size = SKY_TILE * (1 << level);
    const rnd = tileRng(level, li + 1, tx, ty);
    const L = SKY_LAYERS[li];
    const stars = [];
    // Doppelt vorhalten: wie viele davon gezeichnet werden, entscheidet der
    // Zoom (siehe drawStars) - so bleibt die Dichte über alle Kachelstufen gleich.
    for (let i = 0; i < L.n * 2; i++) {
      stars.push({
        x: (tx + rnd()) * size, y: (ty + rnd()) * size,
        r: Math.max(1, Math.round(L.r)),
        a: 0.3 + rnd() * 0.65,
        tw: rnd() * Math.PI * 2
      });
    }
    if (this._tiles.size > 1200) this._tiles.clear();
    this._tiles.set(key, stars);
    return stars;
  }

  /** Nebel liegen fest in der Karte und wandern nicht mit. */
  nebTile(level, tx, ty) {
    const key = `n${level}|${tx}|${ty}`;
    const hit = this._tiles.get(key);
    if (hit !== undefined) return hit;
    const size = SKY_TILE * (1 << level);
    const rnd = tileRng(level, 99, tx, ty);
    const neb = rnd() < 0.2
      ? {
        x: (tx + rnd()) * size, y: (ty + rnd()) * size,
        r: size * (0.35 + rnd() * 0.45),
        hue: [200, 265, 320, 180][Math.floor(rnd() * 4)]
      } : null;
    this._tiles.set(key, neb);
    return neb;
  }

  /** Ruft fn für jede sichtbare Kachel auf (ohne Parallaxe). */
  forSkyTiles(level, fn) {
    const size = SKY_TILE * (1 << level);
    const z = Math.max(0.0001, this.cam.zoom);
    const hw = (this.w / 2) / z, hh = (this.h / 2) / z;
    const x0 = Math.floor((this.cam.x - hw) / size), x1 = Math.floor((this.cam.x + hw) / size);
    const y0 = Math.floor((this.cam.y - hh) / size), y1 = Math.floor((this.cam.y + hh) / size);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) fn(this.nebTile(level, tx, ty));
    }
  }

  /**
   * Sternenhimmel: drei Ebenen, die gleichmäßig vorbeiziehen. Verschoben wird
   * in Weltkoordinaten, damit die Kacheln mitwandern - auf dem Bildschirm
   * ergibt das je Ebene ein anderes Tempo, vorn schneller als hinten.
   */
  drawStars(ctx) {
    const level = this.skyLevel();
    const size = SKY_TILE * (1 << level);
    const z = this.cam.zoom;
    const cx = this.w / 2, cy = this.h / 2;
    const drift = (this.phase * DRIFT_PX) / Math.max(0.02, z);
    // Die Kachelstufe springt in Zweierschritten, die Zahl der sichtbaren
    // Kacheln also in Viererschritten. Dieser Anteil gleicht das aus.
    const q = ((1 << level) * z) / 0.9;
    const anteil = Math.max(0.1, Math.min(1, (q * q) / 2));
    const buckets = this._buckets || (this._buckets = Array.from({ length: 12 }, () => []));
    for (const b of buckets) b.length = 0;

    for (let li = 0; li < SKY_LAYERS.length; li++) {
      const zl = z * SKY_LAYERS[li].p;
      const camY = this.cam.y + drift;
      const hw = (this.w / 2) / zl, hh = (this.h / 2) / zl;
      const x0 = Math.floor((this.cam.x - hw) / size), x1 = Math.floor((this.cam.x + hw) / size);
      const y0 = Math.floor((camY - hh) / size), y1 = Math.floor((camY + hh) / size);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const kachel = this.skyTile(level, li, tx, ty);
          const nimm = Math.max(1, Math.round(kachel.length * anteil));
          for (let i = 0; i < nimm; i++) {
            const s = kachel[i];
            const px = (s.x - this.cam.x) * zl + cx;
            const py = (s.y - camY) * zl + cy;
            if (px < 0 || py < 0 || px > this.w || py > this.h) continue;
            const tw = 0.8 + 0.2 * Math.sin(this.phase * 1.4 + s.tw);
            // Ganze Pixel: ohne Teilpixel entfällt das Glätten, und die Punkte
            // sitzen so scharf wie in der Vorlage.
            buckets[Math.max(0, Math.min(11, Math.floor(s.a * tw * 12)))]
              .push(px | 0, py | 0, s.r);
          }
        }
      }
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

  // ------------------------------------------------------------ Zeichnen
  draw(dt) {
    this.phase += dt;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.view) {
      ctx.fillStyle = '#04060f';
      ctx.fillRect(0, 0, this.w, this.h);
      return;
    }
    // Deckender Himmel - löscht das Bild, ein clearRect erübrigt sich.
    this.drawBackdrop();
    this.hit = [];

    const v = this.view;
    const colorOf = id => (v.players.find(p => p.id === id) || {}).color || '#889';

    // Reichweitenkreise für die gewählte Flotte
    const selFleet = this.selection?.type === 'fleet'
      ? v.fleets.find(f => f.id === this.selection.id) : null;
    if ((this.showRange || selFleet) && selFleet?.mine) {
      const range = selFleet.stats.range || 0;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of v.planets) {
        if (p.owner !== v.you || !(p.pop > 0.5)) continue;
        const [sx, sy] = this.w2s(p.x, p.y);
        const rr = range * this.cam.zoom;
        // Umriss statt Kreis: am schwarzen Loch reicht die Flotte weniger weit,
        // weil sie herum muss. Ein voller Kreis würde Welten als erreichbar
        // zeigen, die der Server dann ablehnt.
        const umriss = this.reichweite(p, range);
        const g2 = ctx.createRadialGradient(sx, sy, rr * 0.75, sx, sy, rr);
        g2.addColorStop(0, 'rgba(60,110,190,0.02)');
        g2.addColorStop(0.92, 'rgba(90,150,230,0.07)');
        g2.addColorStop(1, 'rgba(120,190,255,0)');
        ctx.fillStyle = g2;
        ctx.beginPath();
        umriss.forEach((q, i) => {
          const [qx, qy] = this.w2s(q.x, q.y);
          i === 0 ? ctx.moveTo(qx, qy) : ctx.lineTo(qx, qy);
        });
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(120,180,255,.22)';
        ctx.lineWidth = 1; ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Kurslinien - um das schwarze Loch herum, so wie geflogen wird
    const zone = holeZone(v.galaxy);
    for (const f of v.fleets) {
      if (f.dest == null) continue;
      const target = v.planets[f.dest];
      if (!target) continue;
      const [ax, ay] = this.w2s(f.x, f.y);
      const [bx, by] = this.w2s(target.x, target.y);
      ctx.save();
      ctx.strokeStyle = f.mine ? 'rgba(255,216,119,.7)' : 'rgba(255,120,120,.5)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -this.phase * 22;
      ctx.beginPath(); ctx.moveTo(ax, ay);
      for (const w of route(f, target, zone)) { const [wx, wy] = this.w2s(w.x, w.y); ctx.lineTo(wx, wy); }
      ctx.stroke();
      ctx.restore();
      // Zielmarkierung
      ctx.save();
      ctx.strokeStyle = 'rgba(255,216,119,.6)'; ctx.lineWidth = 1.2;
      const tr = planetRadius(target) * this.cam.zoom + 15;
      ctx.beginPath(); ctx.arc(bx, by, tr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Planeten
    const z = this.cam.zoom;
    const labels = [];
    for (const p of v.planets) {
      const [sx, sy] = this.w2s(p.x, p.y);
      const r = planetRadius(p) * z;
      if (sx < -80 || sy < -80 || sx > this.w + 80 || sy > this.h + 80) continue;
      drawPlanet(ctx, p, sx, sy, z, {
        scale: z,
        ownerColor: p.owner ? colorOf(p.owner) : null,
        selected: this.selection?.type === 'planet' && this.selection.id === p.id,
        hovered: this.hover?.type === 'planet' && this.hover.id === p.id,
        showName: false
      });
      if (this.showNames) labels.push(...planetLabels(p, sx, sy, z, planetRadius(p) * z));
      this.hit.push({ type: 'planet', id: p.id, x: sx, y: sy, r: Math.max(12, r + 6) });

      // Orbitale Verteidigung: wenige Satelliten kreisen einzeln, ab
      // SHIELD_MIN schliessen sie sich zum Schild um die Welt.
      if (p.defenses >= SHIELD_MIN) {
        drawHexShield(ctx, sx, sy, r * 1.14 + 20 * orbitScale(z), this.phase + p.id);
        this.badge(ctx, sx + r + 16, sy - r - 10, '×' + p.defenses, colorOf(p.owner));
      } else if (p.defenses > 0) {
        const n = p.defenses;
        for (let i = 0; i < n; i++) {
          const a = this.phase * 0.25 + i * (Math.PI * 2 / n);
          const sc = orbitScale(z);
          const orr = r * 1.14 + 20 * sc;
          drawShip(ctx, {
            type: 'satellite', x: sx + Math.cos(a) * orr, y: sy + Math.sin(a) * orr,
            angle: a + Math.PI / 2, len: 19 * sc,
            color: colorOf(p.owner), phase: this.phase + i
          });
        }
      }
    }

    // Flotten
    for (const f of v.fleets) {
      const inOrbit = f.at !== null && f.at !== undefined;
      const col = colorOf(f.owner);
      const lead = leadType(f);
      const scale = Math.max(0.55, Math.min(1.8, 0.7 + z * 0.45));
      if (inOrbit) {
        const p = v.planets[f.at];
        if (!p) continue;
        const [sx, sy] = this.w2s(p.x, p.y);
        const r = planetRadius(p) * z;
        // Mehrere Flotten um denselben Planeten verteilen
        const idx = v.fleets.filter(g => g.at === f.at).indexOf(f);
        const a = -Math.PI / 2 + idx * 0.85 + (f.owner === v.you ? 0 : Math.PI);
        const orr = r + ORBIT_R * scale;
        const x = sx + Math.cos(a) * orr, y = sy + Math.sin(a) * orr;
        drawShip(ctx, { type: lead, x, y, angle: a + Math.PI / 2, len: 24 * scale, color: col, phase: this.phase + idx });
        const n = f.ships ? f.ships.length : f.count;
        if (n > 1) this.badge(ctx, x + 13 * scale, y - 11 * scale, '×' + n, col);
        if (this.selection?.type === 'fleet' && this.selection.id === f.id) this.ringAt(ctx, x, y, 16 * scale);
        this.hit.push({ type: 'fleet', id: f.id, x, y, r: 14 * scale });
      } else {
        const [sx, sy] = this.w2s(f.x, f.y);
        let ang = 0;
        if (f.dest != null && v.planets[f.dest]) {
          // Erstes Wegstueck, das lang genug ist - auf dem Bogen um das
          // schwarze Loch fliegt die Flotte quer zum Ziel.
          for (const w of route(f, v.planets[f.dest], zone)) {
            const dx = w.x - f.x, dy = w.y - f.y;
            if (dx * dx + dy * dy > 1e-6) { ang = Math.atan2(dy, dx); break; }
          }
        }
        drawTrail(ctx, sx, sy, ang, 46 * scale, col);
        drawShip(ctx, { type: lead, x: sx, y: sy, angle: ang, len: 26 * scale, color: col, phase: this.phase });
        const n = f.ships ? f.ships.length : f.count;
        if (n > 1) this.badge(ctx, sx + 15 * scale, sy - 12 * scale, '×' + n, col);
        if (this.selection?.type === 'fleet' && this.selection.id === f.id) this.ringAt(ctx, sx, sy, 17 * scale);
        this.hit.push({ type: 'fleet', id: f.id, x: sx, y: sy, r: 15 * scale });
      }
    }

    this.battleFx.draw(ctx, performance.now(), (id) => {
      const p = v.planets[id];
      if (!p) return null;
      const [sx, sy] = this.w2s(p.x, p.y);
      if (sx < -200 || sy < -200 || sx > this.w + 200 || sy > this.h + 200) return null;
      return { x: sx, y: sy, r: planetRadius(p) * z, s: Math.max(0.55, Math.min(1.8, 0.7 + z * 0.45)),
        shieldR: planetRadius(p) * z * 1.14 + 20 * orbitScale(z), shielded: p.defenses >= SHIELD_MIN };
    }, colorOf);

    // Beschriftungen zuletzt, damit Schiffe im Orbit sie nicht verdecken
    for (const l of labels) label(ctx, l.text, l.x, l.y, l.color, z, l.size);
    const bh = v.galaxy.blackHole;
    if (bh && this.showNames) {
      const [bx, by] = this.w2s(bh.x, bh.y);
      const br = Math.max(HOLE_MIN_PX, bh.r * z * HOLE_SCALE);
      label(ctx, bh.name, bx, by + br * 1.5 + 11, '#9ec8f5', z, 12.5);
    }

    // Kurs-Vorschau für gewählte Flotte
    if (selFleet?.mine && this.hover?.type === 'planet') {
      const target = this.view.planets[this.hover.id];
      const src = selFleet.at != null ? this.view.planets[selFleet.at] : selFleet;
      if (target && src && target.id !== selFleet.at) {
        const [ax, ay] = this.w2s(src.x, src.y);
        const weg = route(src, target, holeZone(this.view.galaxy));
        const speed = selFleet.stats.speed || 1;
        const turns = Math.max(1, Math.ceil(routeLength(src, weg) / speed));
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(ax, ay);
        for (const w of weg) { const [wx, wy] = this.w2s(w.x, w.y); ctx.lineTo(wx, wy); }
        ctx.stroke();
        ctx.setLineDash([]);
        // Marke auf die Mitte des Wegs, nicht auf die Mitte der Luftlinie
        const mid = weg[Math.floor(weg.length / 2)];
        const [mx, my] = weg.length > 1 ? this.w2s(mid.x, mid.y)
          : [(ax + this.w2s(target.x, target.y)[0]) / 2, (ay + this.w2s(target.x, target.y)[1]) / 2];
        this.badge(ctx, mx, my, t('word.turns', { n: turns, count: turns }), '#ffd877', true);
        ctx.restore();
      }
    }

    if (this.hover?.type === 'planet') this.tooltip(ctx, this.view.planets[this.hover.id]);
  }

  /**
   * Der Himmel ändert sich nur, wenn die Kamera sich bewegt - also wird er in
   * ein eigenes Canvas gezeichnet und sonst nur kopiert. Das Funkeln der
   * Sterne bekommt dabei vier Stufen pro Sekunde; echte Sterne funkeln auch
   * nicht gleichmäßig.
   */
  /**
   * Hintergrund in drei Lagen: Verlauf, Nebel und Gebiete liegen in einem
   * Zwischencanvas und werden nur bei Kamerabewegung neu gebaut; darüber die
   * ziehenden Sterne und zuletzt das schwarze Loch - das soll die Sterne
   * verdecken, nicht umgekehrt.
   *
   * Reihenfolge wichtig fürs Tempo: ein deckender Blit plus ein paar hundert
   * Sternpunkte kostet halb so viel wie Vollbildfüllung plus durchsichtiges
   * Overlay, weil das Bild nur einmal komplett geschrieben wird.
   */
  drawBackdrop() {
    const ctx = this.ctx;
    const key = `${Math.round(this.cam.x * 2)}|${Math.round(this.cam.y * 2)}|${this.cam.zoom.toFixed(4)}`
      + `|${this.w}|${this.h}|${this.view.turn}|${this.showTerritory ? 1 : 0}`;
    if (this._skyKey !== key) {
      this._skyKey = key;
      this.renderOverlay();
    }
    ctx.drawImage(this._sky, 0, 0, this.w, this.h);
    if (this.showStars) this.drawStars(ctx);

    const bh = this.view.galaxy.blackHole;
    if (bh) {
      const [bx, by] = this.w2s(bh.x, bh.y);
      const br = Math.max(HOLE_MIN_PX, bh.r * this.cam.zoom * HOLE_SCALE);
      drawBlackHole(ctx, bx, by, br, this.phase);
      drawHoleZone(ctx, bx, by, holeZone(this.view.galaxy).r * this.cam.zoom, this.phase);
    }
  }

  renderOverlay() {
    if (!this._sky) this._sky = document.createElement('canvas');
    const cv = this._sky;
    const W = Math.max(1, Math.round(this.w * this.dpr)), H = Math.max(1, Math.round(this.h * this.dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; this._skyCtx = null; this._bg = null; }
    const ctx = this._skyCtx || (this._skyCtx = cv.getContext('2d'));
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this._bg) {
      this._bg = ctx.createLinearGradient(0, 0, 0, this.h);
      this._bg.addColorStop(0, '#060814');
      this._bg.addColorStop(1, '#03040a');
    }
    ctx.fillStyle = this._bg;
    ctx.fillRect(0, 0, this.w, this.h);
    const level = this.skyLevel();
    const z = this.cam.zoom;
    this.forSkyTiles(level, (n) => {
      if (!n) return;
      const [sx, sy] = this.w2s(n.x, n.y);
      const r = n.r * z;
      if (sx + r < 0 || sy + r < 0 || sx - r > this.w || sy - r > this.h) return;
      ctx.drawImage(nebulaSprite(n.hue), sx - r, sy - r, r * 2, r * 2);
    });
    this.drawTerritory(ctx);
  }

  /**
   * Dezente Einfärbung der Gebiete: je besiedelter Welt ein weicher Fleck in
   * der Farbe ihres Reiches. Benachbarte Welten verschmelzen zu einer Fläche,
   * sodass man auf einen Blick sieht, wem welche Ecke gehört.
   */
  drawTerritory(ctx) {
    if (!this.showTerritory || !this.view) return;
    const v = this.view, z = this.cam.zoom;
    const colors = new Map(v.players.map(p => [p.id, p.color]));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of v.planets) {
      if (!p.owner) continue;
      // Großzügiger Radius, damit bei kleinem Zoom Flächen entstehen und
      // nicht nur Höfe um einzelne Welten
      const r = (230 + Math.min(45, p.pop || 0) * 4.5) * z;
      const [sx, sy] = this.w2s(p.x, p.y);
      if (sx + r < 0 || sy + r < 0 || sx - r > this.w || sy - r > this.h) continue;
      // Nur erinnerte Welten blasser - der Besitz ist dort womöglich veraltet
      ctx.globalAlpha = p.known === 'memory' ? 0.45 : 1;
      ctx.drawImage(glowSprite(colors.get(p.owner) || '#8899aa'), sx - r, sy - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  /**
   * Umriss der erreichbaren Flaeche, gemerkt je Basis und Reichweite - die
   * Halbierungssuche dahinter soll nicht in jedem Bild neu laufen.
   */
  reichweite(basis, range) {
    const zone = holeZone(this.view.galaxy);
    const key = `${basis.id}|${Math.round(range)}|${zone ? 1 : 0}`;
    this._reich = this._reich || new Map();
    let u = this._reich.get(key);
    if (!u) {
      u = reachOutline(basis, range, zone);
      if (this._reich.size > 64) this._reich.clear();
      this._reich.set(key, u);
    }
    return u;
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
    const [sx, sy] = this.w2s(p.x, p.y);
    const lines = [];
    if (p.known === 'unknown') {
      lines.push([t('map.tooltipUnknown'), '#9aa8c4']);
    } else {
      const owner = p.owner ? (this.view.players.find(q => q.id === p.owner) || {}) : null;
      lines.push([t('map.tooltipTemp', { temp: Math.round(p.temp), grav: (+p.grav).toFixed(2) }), '#d6deef']);
      lines.push([t('map.tooltipPop', { pop: (+p.pop).toFixed(1), ore: Math.round(p.metalReserve) }), '#9aa8c4']);
      if (owner) lines.push([owner.name, owner.color || '#fff']);
      if (p.known === 'memory') lines.push([t('map.tooltipSeen', { turn: p.turn }), '#67738c']);
    }
    ctx.save();
    ctx.font = '13px Inter, system-ui, sans-serif';
    const w = Math.max(...lines.map(l => ctx.measureText(l[0]).width)) + 18;
    const h = lines.length * 16 + 14;
    let x = sx + planetRadius(p) * this.cam.zoom + 14, y = sy - h / 2;
    if (x + w > this.w - 8) x = sx - planetRadius(p) * this.cam.zoom - 14 - w;
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

  _bind() {
    const cv = this.cv;
    let dragging = false, moved = false, last = null;
    // Mehrfinger: zwei Finger zoomen (Abstand) und schieben (Mittelpunkt).
    // Gespeichert wird je Zeiger, damit Maus und Finger denselben Weg gehen.
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
      last = { x: e.offsetX, y: e.offsetY };
    });

    cv.addEventListener('pointermove', (e) => {
      this.poke();
      if (zeiger.has(e.pointerId)) zeiger.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (zeiger.size >= 2 && pinch) {
        const jetzt = mitte();
        if (pinch.d > 0 && jetzt.d > 0) this.zoomBy(jetzt.d / pinch.d, jetzt.x, jetzt.y);
        this.cam.x -= (jetzt.x - pinch.x) / this.cam.zoom;
        this.cam.y -= (jetzt.y - pinch.y) / this.cam.zoom;
        pinch = jetzt;
        return;
      }
      if (dragging) {
        const dx = e.offsetX - last.x, dy = e.offsetY - last.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        if (moved) {
          this.cam.x -= dx / this.cam.zoom;
          this.cam.y -= dy / this.cam.zoom;
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
      this.poke();
      const warMehr = zeiger.size > 1;
      los(e);
      if (warMehr) { dragging = false; return; }
      dragging = false;
      cv.classList.remove('dragging');
      if (moved) return;
      const h = this.pick(e.offsetX, e.offsetY);
      if (e.shiftKey || e.button === 2) { this.onOrder(h); return; }
      this.onSelect(h);
    });

    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const h = this.pick(e.offsetX, e.offsetY);
      this.onOrder(h);
    });

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.offsetX, e.offsetY);
    }, { passive: false });

    window.addEventListener('resize', () => this.resize());
  }
}

function leadType(f) {
  const order = ['fighter', 'colony', 'tanker', 'scout', 'satellite'];
  const types = new Set((f.ships || []).map(s => s.type));
  for (const t of order) if (types.has(t)) return t;
  return 'fighter';
}

export { planetThumb, planetRadius };
