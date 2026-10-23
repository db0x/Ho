// Battle window: the replay of a space battle with the large ship images.
// The sides face each other, the world lies at the bottom of the picture,
// and round by round the shots fly that the server rolled. Seeking forwards
// and backwards works at any time: the state at every moment follows from
// the timeline, nothing is accumulated.
import { drawShipHD } from '../render/shipshd.js';
import { planetSprite } from '../render/planets.js';
import { hexRgb, drawHexShield, drawShieldHit } from '../render/fx.js';
import { timeline, hpAt, seeded, drawBolt, drawImpact, drawExplosion, shieldOf, shieldStrength, underShield, fleeing } from '../render/battlefx.js';
import { sfx } from '../audio/sfx.js';
import { t, onLocaleChange } from '../i18n.js';

const TAU = Math.PI * 2;
const RD = 1.3;                       // seconds per combat round at speed 1
const SPEEDS = [1, 2, 4];
// Those who deal damage fight in front; those who are protected stand at the back.
const FRONT = ['fighter', 'satellite', 'scout', 'tanker', 'transport', 'colony'];

let modal = null, frame = 0, st = null;

function build() {
  modal = document.createElement('div');
  modal.id = 'battle';
  modal.className = 'modal hidden';
  modal.innerHTML = `<div class="modal-box battle-box">
    <div class="bt-head"><h2 class="bt-title"></h2><span class="bt-round"></span></div>
    <div class="bt-stage"><canvas></canvas><div class="bt-result hidden"></div></div>
    <div class="bt-sides"></div>
    <div class="bt-ctrl">
      <button class="tiny" data-a="restart" data-sfx="none">⏮</button>
      <button class="tiny" data-a="prev" data-sfx="none">◀</button>
      <button class="tiny bt-play" data-a="play" data-sfx="none"></button>
      <button class="tiny" data-a="next" data-sfx="none">▶</button>
      <input type="range" class="bt-seek" min="0" max="1000" value="0">
      <button class="tiny bt-speed" data-a="speed"></button>
      <button class="primary bt-close" data-a="close"></button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  for (const b of modal.querySelectorAll('[data-a]')) b.onclick = () => action(b.dataset.a);
  const seek = modal.querySelector('.bt-seek');
  seek.oninput = () => { if (st) { st.T = +seek.value / 1000 * st.tl.end; st.last = st.T; } };
  // In the capture phase: space and Escape belong to the window, not to
  // ending the turn and the map selection behind it.
  addEventListener('keydown', (e) => {
    if (!st || e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    const map = { Escape: 'close', ' ': 'play', ArrowLeft: 'prev', ArrowRight: 'next', Home: 'restart' };
    if (!map[e.key]) return;
    e.preventDefault(); e.stopPropagation();
    action(map[e.key]);
  }, true);
  onLocaleChange(() => { if (st) labels(); });
}

function action(a) {
  if (!st) return;
  const { tl } = st;
  const round = Math.floor(st.T / tl.rd + 1e-6);
  if (a === 'close') return close();
  if (a === 'play') {
    if (!st.playing && st.T >= tl.end - 0.01) st.T = st.last = 0;
    st.playing = !st.playing;
  }
  if (a === 'restart') { st.T = st.last = 0; st.playing = true; }
  if (a === 'prev') { st.T = st.last = Math.max(0, (st.T % tl.rd < 0.3 ? round - 1 : round) * tl.rd); }
  if (a === 'next') { st.T = st.last = Math.min(tl.end, (round + 1) * tl.rd); }
  if (a === 'speed') st.speed = SPEEDS[(SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length];
  labels();
}

/**
 * @param {{battle:object, planet:object, players:object[], you:string|null}} o
 */
export function openBattle(o) {
  if (!o?.battle) return;
  if (!modal) build();
  const tl = timeline(o.battle, RD);
  st = { ...o, tl, T: 0, last: 0, playing: true, speed: 1, prev: performance.now(), layout: null, size: null };
  labels();
  modal.classList.remove('hidden');
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(paint);
}

function close() {
  st = null;
  cancelAnimationFrame(frame);
  modal?.classList.add('hidden');
}

const player = (id) => st.players.find(p => p.id === id) || { name: '?', color: '#9fb0c8' };

function labels() {
  const { battle } = st;
  modal.querySelector('.bt-title').textContent = t('battle.title', { planet: st.planet?.name || '?' });
  modal.querySelector('.bt-close').textContent = t('battle.close');
  modal.querySelector('.bt-speed').textContent = `${st.speed}×`;
  modal.querySelector('.bt-speed').title = t('battle.speed');
  const play = modal.querySelector('.bt-play');
  play.textContent = st.playing ? '⏸' : '⏵';
  play.title = t(st.playing ? 'battle.pause' : 'battle.play');
  modal.querySelector('[data-a=restart]').title = t('battle.restart');
  modal.querySelector('[data-a=prev]').title = t('battle.prev');
  modal.querySelector('[data-a=next]').title = t('battle.next');
  // Build the side panel once; paint() refreshes the numbers and bars.
  const box = modal.querySelector('.bt-sides');
  box.innerHTML = battle.sides.map((id, k) => {
    const p = player(id);
    const you = id === st.you ? ` ${t('word.you')}` : '';
    return `<div class="bt-side" data-k="${k}">
      <span class="bt-dot" style="background:${p.color}"></span>
      <span class="bt-name">${escapeHtml(p.name)}${you}</span>
      <span class="bt-count"></span>
      <div class="bt-bar"><div style="background:${p.color}"></div></div>
    </div>`;
  }).join('');
  st.sideEls = [...box.children];
  st.roundKey = null;
  st.resultShown = null;
}

// ------------------------------------------------------------------ Layout

/**
 * Where every unit stands. Two sides face each other left and right, more
 * are spread around a circle. Every side is a grid pointing to the center:
 * fighters in front, colony ships at the back.
 */
function arrange(W, H) {
  const { battle } = st;
  const n = battle.sides.length;
  const mine = Math.max(0, battle.sides.indexOf(st.you));
  const R = H * 0.5;                                   // world at the bottom of the picture
  const planet = { x: W / 2, y: H + R * 0.32, R };
  const cx = W / 2, cy = H * 0.4;
  // From SHIELD_MIN satellites on, a shield surrounds the world - the
  // satellites then do not stand in the formation but carry it along its arc.
  const shield = shieldOf(battle);
  const pos = battle.units.map(() => null);
  const len = battle.units.map(() => 0);
  const facing = battle.units.map(() => 0);
  battle.sides.forEach((_, k) => {
    // Your own side on the left; the others in turn around the circle.
    const a = Math.PI + ((k - mine + n) % n) * TAU / n;
    const ccx = cx + Math.cos(a) * W * (n === 2 ? 0.3 : 0.32);
    const ccy = cy + Math.sin(a) * H * 0.26;
    const dir = [cx - ccx, cy - ccy];
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    dir[0] /= dl; dir[1] /= dl;
    const perp = [-dir[1], dir[0]];
    const ids = battle.units.map((u, i) => i)
      .filter(i => battle.units[i][0] === k && battle.units[i][1] !== 'battery' && !shield?.ids.includes(i))
      .sort((x, y) => FRONT.indexOf(battle.units[x][1]) - FRONT.indexOf(battle.units[y][1]));
    const m = ids.length;
    if (!m) return;
    // Room for the side: wide across the facing direction, shallow towards the back
    const across = H * (n === 2 ? 0.62 : 0.4), depth = W * (n === 2 ? 0.24 : 0.16);
    const cols = Math.max(1, Math.ceil(Math.sqrt(m * across / depth)));
    const rows = Math.ceil(m / cols);
    const cell = Math.min(across / cols, depth / rows, 74);
    const rnd = seeded(k * 977 + m);
    ids.forEach((i, j) => {
      const row = Math.floor(j / cols), col = j % cols;
      const inRow = row === rows - 1 ? m - row * cols : cols;
      const off = (col - (inRow - 1) / 2) * cell;
      const back = (row - (rows - 1) / 2) * cell * 0.95;
      const jx = (rnd() - 0.5) * cell * 0.25, jy = (rnd() - 0.5) * cell * 0.25;
      pos[i] = [ccx + perp[0] * off - dir[0] * back + jx, ccy + perp[1] * off - dir[1] * back + jy];
      len[i] = cell * 0.78;
      facing[i] = Math.atan2(dir[1], dir[0]);
    });
  });
  // The planetary defense sits on the world, on its owner's side.
  battle.units.forEach((u, i) => {
    if (u[1] !== 'battery') return;
    const k = u[0];
    const side = Math.cos(Math.PI + ((k - mine + n) % n) * TAU / n) < 0 ? -1 : 1;
    const a = -Math.PI / 2 + side * 0.42;
    pos[i] = [planet.x + Math.cos(a) * R, planet.y + Math.sin(a) * R];
    len[i] = Math.min(46, H * 0.09);
    facing[i] = -Math.PI / 2;
  });
  if (shield) {
    shield.R = R * 1.16;
    const m = shield.ids.length;
    shield.ids.forEach((i, j) => {
      const a = -Math.PI + 0.5 + (m > 1 ? j / (m - 1) : 0.5) * (Math.PI - 1);
      pos[i] = [planet.x + Math.cos(a) * shield.R, planet.y + Math.sin(a) * shield.R];
      len[i] = Math.min(40, H * 0.08);
      facing[i] = a;
    });
  }
  const rnd = seeded(battle.units.length + 17);
  const stars = Array.from({ length: Math.round(W * H / 2600) }, () =>
    [rnd() * W, rnd() * H, rnd() * 1.3 + 0.2, rnd()]);
  return { pos, len, facing, planet, stars, shield };
}

// ----------------------------------------------------------------- Drawing

function paint(ms) {
  if (!st) return;
  frame = requestAnimationFrame(paint);
  const dt = Math.min(0.1, (ms - st.prev) / 1000);
  st.prev = ms;
  const { battle, tl } = st;
  if (st.playing) {
    st.T = Math.min(tl.end, st.T + dt * st.speed);
    if (st.T >= tl.end) { st.playing = false; labels(); }
  }

  const cv = modal.querySelector('.bt-stage canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  if (!st.layout || st.size !== `${W}x${H}`) { st.layout = arrange(W, H); st.size = `${W}x${H}`; }
  const L = st.layout;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const T = st.T;
  const hp = hpAt(battle, tl, T);
  const color = (i) => player(battle.sides[battle.units[i][0]]).color;

  // Sky and world
  const bg = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.35, Math.max(W, H) * 0.75);
  bg.addColorStop(0, '#121a33'); bg.addColorStop(1, '#04060e');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, tw] of L.stars) {
    ctx.fillStyle = `rgba(226,236,255,${(0.35 + 0.4 * Math.abs(Math.sin(ms / 900 + tw * 9))).toFixed(2)})`;
    ctx.fillRect(x, y, r, r);
  }
  drawWorld(ctx, L.planet);
  if (L.shield) {
    // Large in the picture, the full shield would otherwise cover the world.
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawHexShield(ctx, L.planet.x, L.planet.y, L.shield.R, ms / 1000, shieldStrength(L.shield, tl, T));
    ctx.restore();
  }

  // Ships. The planetary defense has no image of its own - it fires from
  // the surface of the world.
  battle.units.forEach((u, i) => {
    const d = tl.death[i];
    if (T >= d || !L.pos[i] || u[1] === 'battery') return;
    const gone = fleeing(tl, i, T);
    if (gone >= 1) return;
    let [x, y] = L.pos[i];
    // Intercepted ships turn away and fly out of the picture, accelerating
    const heading = gone > 0 ? L.facing[i] + Math.PI : L.facing[i];
    x += Math.cos(heading) * W * 0.6 * gone * gone;
    y += Math.sin(heading) * W * 0.6 * gone * gone;
    const bob = Math.sin(ms / 700 + i * 1.3) * L.len[i] * 0.04;
    ctx.save();
    ctx.globalAlpha = 1 - gone * gone;
    drawShipHD(ctx, {
      type: u[1], x, y: y + bob, len: L.len[i], color: color(i), phase: ms / 1000 + i,
      angle: u[1] === 'satellite' ? ms / 4000 + i : heading
    });
    ctx.restore();
    // Shortly before the end the hull flickers red
    if (T > d - 0.25 && Number.isFinite(d)) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,80,40,${(0.5 * (1 - (d - T) / 0.25)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y + bob, L.len[i] * 0.4, 0, TAU); ctx.fill();
      ctx.restore();
    }
    const max = u[3] || u[2] || 1;
    if (hp[i] < max - 1e-6) drawHull(ctx, x, y + L.len[i] * 0.55, L.len[i], Math.max(0, hp[i]) / max);
  });

  // Shots, impacts, explosions
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of tl.shots) {
    if (s.tf > T) break;
    if (T > s.th + 0.3) continue;
    const defense = battle.units[s.from][1] === 'battery';
    const a = defense ? onWorld(L.planet, s.tf * 1000) : L.pos[s.from];
    const b = battle.units[s.to][1] === 'battery' ? onWorld(L.planet, s.tf * 777) : L.pos[s.to];
    if (!a || !b) continue;
    const lf = L.len[s.from];
    const nose = defense ? a
      : [a[0] + Math.cos(L.facing[s.from]) * lf * 0.45, a[1] + Math.sin(L.facing[s.from]) * lf * 0.45];
    if (T - s.tf < (defense ? 0.14 : 0.07)) {
      drawImpact(ctx, nose[0], nose[1], lf * (defense ? 0.5 : 0.22), (T - s.tf) / (defense ? 0.14 : 0.07), color(s.from));
    }
    // If the shield is still up, the shot ends on it and makes it light up.
    const shieldHit = underShield(L.shield, battle, s.to) && shieldStrength(L.shield, tl, s.th) > 0.05
      ? onShield(nose, b, L.planet, L.shield.R) : null;
    const target = shieldHit || b;
    if (T <= s.th) drawBolt(ctx, nose[0], nose[1], target[0], target[1], (T - s.tf) / (s.th - s.tf), Math.max(16, lf * 0.7), color(s.from), Math.max(1.2, lf * 0.04));
    else if (shieldHit) drawShieldHit(ctx, shieldHit[0], shieldHit[1], Math.max(14, L.shield.R * 0.1), (T - s.th) / 0.3);
    else drawImpact(ctx, b[0] + Math.sin(s.tf * 99) * L.len[s.to] * 0.15, b[1] + Math.cos(s.tf * 77) * L.len[s.to] * 0.15,
      Math.max(6, L.len[s.to] * 0.3), (T - s.th) / 0.2, color(s.from));
  }
  ctx.restore();
  battle.units.forEach((u, i) => {
    const d = tl.death[i];
    if (L.pos[i] && T >= d && T < d + 1) drawExplosion(ctx, L.pos[i][0], L.pos[i][1], L.len[i] * 0.9, T - d, i + 1);
  });

  soundtrack(T, W);
  status(T, hp);
  st.last = T;
}

/**
 * A point on the visible edge of the world - that is where the planetary
 * defense flashes or a shot hits it. Every shot in a different place, but
 * always the same one when seeking.
 */
function onWorld(pl, seed) {
  const z = Math.sin(seed * 12.9898) * 43758.5453;
  const a = -Math.PI / 2 + (z - Math.floor(z) - 0.5) * 1.5;
  return [pl.x + Math.cos(a) * pl.R * 0.99, pl.y + Math.sin(a) * pl.R * 0.99];
}

/** Where the segment a->b hits the shield from outside; null if it does not at all. */
function onShield(a, b, c, R) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const fx = a[0] - c.x, fy = a[1] - c.y;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - R * R;
  const disk = B * B - 4 * A * C;
  if (C < 0 || disk < 0 || !A) return null;          // shooter already inside
  const t = (-B - Math.sqrt(disk)) / (2 * A);
  return t >= 0 && t <= 1 ? [a[0] + dx * t, a[1] + dy * t] : null;
}

function drawWorld(ctx, pl) {
  const p = st.planet;
  if (!p) return;
  if (!st.sprite || st.spriteR !== Math.round(pl.R)) {
    st.sprite = planetSprite({ ...p, known: 'live' }, Math.round(pl.R));
    st.spriteR = Math.round(pl.R);
  }
  const sp = st.sprite;
  ctx.save();
  // Glowing rim in the owner's color - like the ownership ring on the map.
  // Free worlds shimmer a neutral blue. The view only knows the world after
  // the turn - a world conquered then already carries the conqueror's color.
  // Whoever provides the defense held it during the battle.
  const defense = st.battle.units.find(u => u[1] === 'battery');
  const owner = defense ? st.battle.sides[defense[0]] : p.owner;
  const [r, gr, b] = owner ? hexRgb(player(owner).color) : [120, 170, 255];
  const g = ctx.createRadialGradient(pl.x, pl.y, pl.R * 0.95, pl.x, pl.y, pl.R * 1.18);
  g.addColorStop(0, `rgba(${r},${gr},${b},${owner ? 0.4 : 0.25})`); g.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.R * 1.18, 0, TAU); ctx.fill();
  ctx.drawImage(sp.canvas, pl.x - sp.cx, pl.y - sp.cy);
  ctx.restore();
}

function drawHull(ctx, x, y, len, k) {
  const w = Math.max(14, len * 0.7), h = Math.max(2, len * 0.05);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = k > 0.5 ? '#52d98a' : k > 0.25 ? '#f0b429' : '#ff5f5f';
  ctx.fillRect(x - w / 2, y, w * k, h);
}

/** Sound only during playback - when seeking it would otherwise crackle. */
function soundtrack(T, W) {
  if (!st.playing || T <= st.last || T - st.last > 0.2) return;
  const { tl, layout: L } = st;
  const pan = (i) => L.pos[i] ? (L.pos[i][0] / W * 2 - 1) * 0.7 : 0;
  for (const s of tl.shots) {
    if (s.tf > T) break;
    if (s.tf > st.last) sfx.play('laser', { pan: pan(s.from), gain: 0.6 });
  }
  tl.death.forEach((d, i) => {
    if (d > st.last && d <= T) sfx.play('boom', { pan: pan(i) });
  });
}

/** Round, strength of each side and at the end the result. */
function status(T, hp) {
  const { battle, tl } = st;
  const round = Math.min(tl.rounds, Math.floor(T / tl.rd) + 1);
  const done = T >= tl.end - 0.01;
  const key = done ? 'done' : round;
  if (st.roundKey !== key) {
    st.roundKey = key;
    modal.querySelector('.bt-round').textContent = done
      ? t('battle.result') : t('battle.round', { n: round, total: tl.rounds });
  }
  const seek = modal.querySelector('.bt-seek');
  if (document.activeElement !== seek) seek.value = Math.round(T / tl.end * 1000);

  battle.sides.forEach((_, k) => {
    let before = 0, now = 0, escaped = 0, hpNow = 0, hpMax = 0;
    battle.units.forEach((u, i) => {
      if (u[0] !== k) return;
      hpMax += u[3] || u[2];
      if (T < tl.death[i]) hpNow += Math.max(0, hp[i]);
      if (u[1] === 'battery') return;
      before++;
      if (fleeing(tl, i, T) >= 1) escaped++;
      else if (T < tl.death[i]) now++;
    });
    const el = st.sideEls[k];
    if (!el) return;
    const count = el.querySelector('.bt-count');
    count.textContent = `${now}/${before}` + (escaped ? ` · ↗ ${escaped}` : '');
    count.title = escaped ? t('battle.fled', { n: escaped }) : '';
    el.querySelector('.bt-bar > div').style.width = `${hpMax ? (hpNow / hpMax * 100).toFixed(1) : 0}%`;
    el.classList.toggle('out', now === 0 && !battle.units.some((u, i) =>
      u[0] === k && T < tl.death[i] && fleeing(tl, i, T) < 1));
  });

  const res = modal.querySelector('.bt-result');
  if (done !== st.resultShown) {
    st.resultShown = done;
    res.classList.toggle('hidden', !done);
    if (done) {
      const remaining = battle.sides.filter((_, k) =>
        battle.units.some((u, i) => u[0] === k && !Number.isFinite(tl.death[i]) && !tl.flee.ids.has(i)));
      res.textContent = remaining.length === 1
        ? t('battle.winner', { player: player(remaining[0]).name })
        : t('battle.draw');
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
