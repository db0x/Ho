// Star map: camera, background, planets, fleets, course lines.
import { drawPlanet, planetRadius, planetThumb, planetLabels, label, orbitScale } from './planets.js';
import { drawShip, drawTrail } from './ships.js';
import { dist, tempColor, rgb, holeZone, route, routeLength, reachOutline } from '../../shared/rules.js';
import { t } from '../i18n.js';
import { glowSprite, drawBlackHole, drawHoleZone, HOLE_SCALE, HOLE_MIN_PX, STAR_ALPHA, drawHexShield, SHIELD_MIN } from './fx.js';
import { BattleFx } from './battlefx.js';

const ORBIT_R = 20;

// The sky is built in tiles instead of once for a fixed galaxy size - that
// way it grows along with the map. At low zoom a coarser level is used so
// there are always about the same number of stars on screen.
const SKY_TILE = 900;
// Three star layers instead of one cloud: many small ones far back, few big
// ones in front. Each drifts past at its own pace - together that gives the
// calm depth a static star field lacks.
const SKY_LAYERS = [
  { p: 0.45, n: 20, r: 1 },
  { p: 0.70, n: 8, r: 2 },
  { p: 1.00, n: 4, r: 3 }
];
const DRIFT_PX = 7;        // pixels per second on the frontmost layer

/** Randomness that depends only on the tile - the same sky on every visit. */
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
/** Nebula once per hue into a small canvas; blitting it scaled is cheaper
 *  than a large gradient per frame. */
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

  // ------------------------------------------------------------- Camera
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Cached, because every access to clientWidth forces a layout
    // recalculation - and w2s() asks for it hundreds of times per frame.
    this._w = this.cv.clientWidth;
    this._h = this.cv.clientHeight;
    this.cv.width = Math.round(this._w * dpr);
    this.cv.height = Math.round(this._h * dpr);
    this.dpr = dpr;
    this._bg = null;
  }

  get w() { return this._w; }
  get h() { return this._h; }

  /** Request the full frame rate - input, new view, moving camera. */
  poke(ms = 700) { this._activeUntil = performance.now() + ms; }
  get busy() { return performance.now() < this._activeUntil; }

  /** Let the battles of the last turn flash at their worlds. */
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
    // Bounds instead of dimensions: the map grows, coordinates can become negative.
    const x0 = g.minX ?? 0, y0 = g.minY ?? 0;
    const x1 = g.maxX ?? g.width, y1 = g.maxY ?? g.height;
    const zx = (this.w - padding * 2) / Math.max(1, x1 - x0);
    const zy = (this.h - padding * 2 - 90) / Math.max(1, y1 - y0);
    this.cam.zoom = Math.max(0.04, Math.min(zx, zy));
    this.cam.x = (x0 + x1) / 2;
    this.cam.y = (y0 + y1) / 2;
    this.poke();
  }

  /** Point of view on a world or fleet - in the plane z does not count. */
  /**
   * Bring a world into view. `free` is the visible rectangle {w, h}: if a
   * sheet lies over the map, the world should land in the center of the
   * *free* part and not behind it.
   */
  focus(p, free) {
    if (!p) return;
    this.centerOn(p.x, p.y);
    const w = free?.w ?? this.w, h = free?.h ?? this.h;
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
      // Spectators have no homeworld - for them the overall view stays.
      const home = view.me ? view.planets.find(p => p.id === view.me.homeworld) : null;
      if (home) this.centerOn(home.x, home.y, Math.max(0.95, Math.min(1.4, this.cam.zoom * 3)));
    }
  }

  /** Tile level: the further zoomed out, the larger the tiles. */
  skyLevel() {
    return Math.max(0, Math.min(9, Math.round(Math.log2(0.9 / Math.max(0.01, this.cam.zoom)))));
  }

  /** Stars of a tile on one of the three layers. */
  skyTile(level, li, tx, ty) {
    const key = `s${level}|${li}|${tx}|${ty}`;
    const hit = this._tiles.get(key);
    if (hit) return hit;
    const size = SKY_TILE * (1 << level);
    const rnd = tileRng(level, li + 1, tx, ty);
    const L = SKY_LAYERS[li];
    const stars = [];
    // Keep twice as many: the zoom decides how many of them are drawn (see
    // drawStars) - that keeps the density the same across all tile levels.
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

  /** Nebulae are fixed in the map and do not drift along. */
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

  /** Calls fn for every visible tile (without parallax). */
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
   * Starry sky: three layers drifting past evenly. The shift happens in world
   * coordinates so the tiles move along - on screen that gives each layer a
   * different pace, faster in front than at the back.
   */
  drawStars(ctx) {
    const level = this.skyLevel();
    const size = SKY_TILE * (1 << level);
    const z = this.cam.zoom;
    const cx = this.w / 2, cy = this.h / 2;
    const drift = (this.phase * DRIFT_PX) / Math.max(0.02, z);
    // The tile level jumps in steps of two, so the number of visible tiles
    // jumps in steps of four. This share compensates for that.
    const q = ((1 << level) * z) / 0.9;
    const share = Math.max(0.1, Math.min(1, (q * q) / 2));
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
          const tile = this.skyTile(level, li, tx, ty);
          const take = Math.max(1, Math.round(tile.length * share));
          for (let i = 0; i < take; i++) {
            const s = tile[i];
            const px = (s.x - this.cam.x) * zl + cx;
            const py = (s.y - camY) * zl + cy;
            if (px < 0 || py < 0 || px > this.w || py > this.h) continue;
            const tw = 0.8 + 0.2 * Math.sin(this.phase * 1.4 + s.tw);
            // Whole pixels: without subpixels there is no smoothing, and the
            // dots are as sharp as in the original.
            buckets[Math.max(0, Math.min(11, Math.floor(s.a * tw * 12)))]
              .push(px | 0, py | 0, s.r);
          }
        }
      }
    }
    // One path per brightness level instead of one call per star - that saves
    // the rasterizer hundreds of individual shapes per frame.
    for (let k = 0; k < 12; k++) {
      const arr = buckets[k];
      if (!arr.length) continue;
      ctx.fillStyle = STAR_ALPHA[k];
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 3) ctx.rect(arr[i], arr[i + 1], arr[i + 2], arr[i + 2]);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------- Drawing
  draw(dt) {
    this.phase += dt;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.view) {
      ctx.fillStyle = '#04060f';
      ctx.fillRect(0, 0, this.w, this.h);
      return;
    }
    // Opaque sky - clears the image, so a clearRect is unnecessary.
    this.drawBackdrop();
    this.hit = [];

    const v = this.view;
    const colorOf = id => (v.players.find(p => p.id === id) || {}).color || '#889';

    // Range circles for the selected fleet
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
        // Outline instead of a circle: at the black hole the fleet reaches less
        // far because it has to go around. A full circle would show worlds as
        // reachable that the server then rejects.
        const outline = this.reachArea(p, range);
        const g2 = ctx.createRadialGradient(sx, sy, rr * 0.75, sx, sy, rr);
        g2.addColorStop(0, 'rgba(60,110,190,0.02)');
        g2.addColorStop(0.92, 'rgba(90,150,230,0.07)');
        g2.addColorStop(1, 'rgba(120,190,255,0)');
        ctx.fillStyle = g2;
        ctx.beginPath();
        outline.forEach((q, i) => {
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

    // Course lines - around the black hole, the way it is flown
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
      // Target marker
      ctx.save();
      ctx.strokeStyle = 'rgba(255,216,119,.6)'; ctx.lineWidth = 1.2;
      const tr = planetRadius(target) * this.cam.zoom + 15;
      ctx.beginPath(); ctx.arc(bx, by, tr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Planets
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

      // Orbital defense: a few satellites circle individually, from
      // SHIELD_MIN on they close ranks into a shield around the world.
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

    // Fleets
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
        // Spread several fleets around the same planet
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
          // First path segment that is long enough - on the arc around the
          // black hole the fleet flies at an angle to the target.
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

    // Labels last, so ships in orbit do not cover them
    for (const l of labels) label(ctx, l.text, l.x, l.y, l.color, z, l.size);
    const bh = v.galaxy.blackHole;
    if (bh && this.showNames) {
      const [bx, by] = this.w2s(bh.x, bh.y);
      const br = Math.max(HOLE_MIN_PX, bh.r * z * HOLE_SCALE);
      label(ctx, bh.name, bx, by + br * 1.5 + 11, '#9ec8f5', z, 12.5);
    }

    // Course preview for the selected fleet
    if (selFleet?.mine && this.hover?.type === 'planet') {
      const target = this.view.planets[this.hover.id];
      const src = selFleet.at != null ? this.view.planets[selFleet.at] : selFleet;
      if (target && src && target.id !== selFleet.at) {
        const [ax, ay] = this.w2s(src.x, src.y);
        const path = route(src, target, holeZone(this.view.galaxy));
        const speed = selFleet.stats.speed || 1;
        const turns = Math.max(1, Math.ceil(routeLength(src, path) / speed));
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(ax, ay);
        for (const w of path) { const [wx, wy] = this.w2s(w.x, w.y); ctx.lineTo(wx, wy); }
        ctx.stroke();
        ctx.setLineDash([]);
        // Badge at the middle of the path, not at the middle of the straight line
        const mid = path[Math.floor(path.length / 2)];
        const [mx, my] = path.length > 1 ? this.w2s(mid.x, mid.y)
          : [(ax + this.w2s(target.x, target.y)[0]) / 2, (ay + this.w2s(target.x, target.y)[1]) / 2];
        this.badge(ctx, mx, my, t('word.turns', { n: turns, count: turns }), '#ffd877', true);
        ctx.restore();
      }
    }

    if (this.hover?.type === 'planet') this.tooltip(ctx, this.view.planets[this.hover.id]);
  }

  /**
   * The sky only changes when the camera moves - so it is drawn into its own
   * canvas and otherwise only copied. The twinkling of the stars gets four
   * steps per second; real stars do not twinkle evenly either.
   */
  /**
   * Background in three layers: gradient, nebulae and territories live in an
   * intermediate canvas and are only rebuilt when the camera moves; above that
   * the drifting stars and finally the black hole - it should cover the stars,
   * not the other way round.
   *
   * The order matters for speed: one opaque blit plus a few hundred star dots
   * costs half as much as a full-screen fill plus a transparent overlay,
   * because the image is only written completely once.
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
   * Subtle tinting of territories: a soft blob in its empire's color per
   * settled world. Neighboring worlds merge into one area, so you can see at
   * a glance who owns which corner.
   */
  drawTerritory(ctx) {
    if (!this.showTerritory || !this.view) return;
    const v = this.view, z = this.cam.zoom;
    const colors = new Map(v.players.map(p => [p.id, p.color]));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of v.planets) {
      if (!p.owner) continue;
      // Generous radius so that at low zoom areas form and not just halos
      // around individual worlds
      const r = (230 + Math.min(45, p.pop || 0) * 4.5) * z;
      const [sx, sy] = this.w2s(p.x, p.y);
      if (sx + r < 0 || sy + r < 0 || sx - r > this.w || sy - r > this.h) continue;
      // Only remembered worlds paler - the ownership there may be outdated
      ctx.globalAlpha = p.known === 'memory' ? 0.45 : 1;
      ctx.drawImage(glowSprite(colors.get(p.owner) || '#8899aa'), sx - r, sy - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  /**
   * Outline of the reachable area, cached per base and range - the bisection
   * search behind it should not run again every frame.
   */
  reachArea(base, range) {
    const zone = holeZone(this.view.galaxy);
    const key = `${base.id}|${Math.round(range)}|${zone ? 1 : 0}`;
    this._reach = this._reach || new Map();
    let u = this._reach.get(key);
    if (!u) {
      u = reachOutline(base, range, zone);
      if (this._reach.size > 64) this._reach.clear();
      this._reach.set(key, u);
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

  // ---------------------------------------------------------------- Input
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
    // Multi-touch: two fingers zoom (distance) and pan (midpoint).
    // Stored per pointer, so mouse and fingers take the same path.
    const pointers = new Map();
    let pinch = null;

    const midpoint = () => {
      const p = [...zeiger.values()];
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2,
        d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
    };

    cv.addEventListener('pointerdown', (e) => {
      this.poke();
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 2) { pinch = midpoint(); moved = true; dragging = false; return; }
      dragging = true; moved = false;
      last = { x: e.offsetX, y: e.offsetY };
    });

    cv.addEventListener('pointermove', (e) => {
      this.poke();
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size >= 2 && pinch) {
        const now = midpoint();
        if (pinch.d > 0 && now.d > 0) this.zoomBy(now.d / pinch.d, now.x, now.y);
        this.cam.x -= (now.x - pinch.x) / this.cam.zoom;
        this.cam.y -= (now.y - pinch.y) / this.cam.zoom;
        pinch = now;
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
      // With a finger there is no hover - the tap selects right away.
      if (e.pointerType === 'touch') return;
      const h = this.pick(e.offsetX, e.offsetY);
      const changed = JSON.stringify(h) !== JSON.stringify(this.hover);
      this.hover = h;
      if (changed) this.onHoverChange(h);
      cv.style.cursor = h ? 'pointer' : 'grab';
    });

    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        const p = [...zeiger.values()][0];
        last = { x: p.x, y: p.y };
        dragging = true;
      }
    };
    cv.addEventListener('pointercancel', (e) => { release(e); dragging = false; moved = true; });

    cv.addEventListener('pointerup', (e) => {
      this.poke();
      const wasMulti = pointers.size > 1;
      release(e);
      if (wasMulti) { dragging = false; return; }
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
