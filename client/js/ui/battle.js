// Schlachtfenster: die Wiederholung einer Raumschlacht mit den grossen
// Schiffsbildern. Die Seiten stehen sich gegenueber, die Welt liegt unten im
// Bild, und Runde fuer Runde fliegen die Schuesse, die der Server gewuerfelt
// hat. Vor- und Zurueckspulen geht jederzeit: der Zustand zu jedem Zeitpunkt
// ergibt sich aus dem Zeitplan, nichts wird fortgeschrieben.
import { drawShipHD } from '../render/shipshd.js';
import { planetSprite } from '../render/planets.js';
import { hexRgb, drawHexShield, drawShieldHit } from '../render/fx.js';
import { timeline, hpAt, seeded, drawBolt, drawImpact, drawExplosion, shieldOf, shieldStrength, underShield, fleeing } from '../render/battlefx.js';
import { sfx } from '../audio/sfx.js';
import { t, onLocaleChange } from '../i18n.js';

const TAU = Math.PI * 2;
const RD = 1.3;                       // Sekunden je Kampfrunde bei Tempo 1
const SPEEDS = [1, 2, 4];
// Vorn kaempft, wer austeilt; hinten stehen die, die beschuetzt werden.
const FRONT = ['fighter', 'satellite', 'scout', 'tanker', 'colony'];

let modal = null, frame = 0, st = null;

function bauen() {
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
  modal.addEventListener('click', (e) => { if (e.target === modal) schliessen(); });
  for (const b of modal.querySelectorAll('[data-a]')) b.onclick = () => aktion(b.dataset.a);
  const seek = modal.querySelector('.bt-seek');
  seek.oninput = () => { if (st) { st.T = +seek.value / 1000 * st.tl.end; st.last = st.T; } };
  // In der Erfassungsphase: Leertaste und Escape gehoeren dem Fenster, nicht
  // dem Zugende und der Kartenauswahl dahinter.
  addEventListener('keydown', (e) => {
    if (!st || e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    const map = { Escape: 'close', ' ': 'play', ArrowLeft: 'prev', ArrowRight: 'next', Home: 'restart' };
    if (!map[e.key]) return;
    e.preventDefault(); e.stopPropagation();
    aktion(map[e.key]);
  }, true);
  onLocaleChange(() => { if (st) texte(); });
}

function aktion(a) {
  if (!st) return;
  const { tl } = st;
  const runde = Math.floor(st.T / tl.rd + 1e-6);
  if (a === 'close') return schliessen();
  if (a === 'play') {
    if (!st.playing && st.T >= tl.end - 0.01) st.T = st.last = 0;
    st.playing = !st.playing;
  }
  if (a === 'restart') { st.T = st.last = 0; st.playing = true; }
  if (a === 'prev') { st.T = st.last = Math.max(0, (st.T % tl.rd < 0.3 ? runde - 1 : runde) * tl.rd); }
  if (a === 'next') { st.T = st.last = Math.min(tl.end, (runde + 1) * tl.rd); }
  if (a === 'speed') st.speed = SPEEDS[(SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length];
  texte();
}

/**
 * @param {{battle:object, planet:object, players:object[], you:string|null}} o
 */
export function openBattle(o) {
  if (!o?.battle) return;
  if (!modal) bauen();
  const tl = timeline(o.battle, RD);
  st = { ...o, tl, T: 0, last: 0, playing: true, speed: 1, prev: performance.now(), layout: null, size: null };
  texte();
  modal.classList.remove('hidden');
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(malen);
}

function schliessen() {
  st = null;
  cancelAnimationFrame(frame);
  modal?.classList.add('hidden');
}

const spieler = (id) => st.players.find(p => p.id === id) || { name: '?', color: '#9fb0c8' };

function texte() {
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
  // Seitenleiste einmal aufbauen; Zahlen und Balken frischt malen() auf.
  const box = modal.querySelector('.bt-sides');
  box.innerHTML = battle.sides.map((id, k) => {
    const p = spieler(id);
    const du = id === st.you ? ` ${t('word.you')}` : '';
    return `<div class="bt-side" data-k="${k}">
      <span class="bt-dot" style="background:${p.color}"></span>
      <span class="bt-name">${escapeHtml(p.name)}${du}</span>
      <span class="bt-count"></span>
      <div class="bt-bar"><div style="background:${p.color}"></div></div>
    </div>`;
  }).join('');
  st.sideEls = [...box.children];
  st.roundKey = null;
  st.resultShown = null;
}

// ------------------------------------------------------------------ Aufbau

/**
 * Wo jede Einheit steht. Zwei Seiten stehen sich links und rechts gegenueber,
 * mehr verteilen sich auf einen Kreis. Jede Seite ist ein Raster, das zur
 * Mitte zeigt: vorn die Jaeger, hinten die Kolonieschiffe.
 */
function aufstellen(W, H) {
  const { battle } = st;
  const n = battle.sides.length;
  const mine = Math.max(0, battle.sides.indexOf(st.you));
  const R = H * 0.5;                                   // Welt unten im Bild
  const planet = { x: W / 2, y: H + R * 0.32, R };
  const cx = W / 2, cy = H * 0.4;
  // Ab SHIELD_MIN Satelliten liegt ein Schild um die Welt - die Satelliten
  // stehen dann nicht in der Formation, sondern tragen ihn auf seinem Bogen.
  const shield = shieldOf(battle);
  const pos = battle.units.map(() => null);
  const len = battle.units.map(() => 0);
  const facing = battle.units.map(() => 0);
  battle.sides.forEach((_, k) => {
    // Die eigene Seite links; die uebrigen der Reihe nach im Kreis.
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
    // Platz fuer die Seite: quer zur Blickrichtung breit, nach hinten flach
    const quer = H * (n === 2 ? 0.62 : 0.4), tief = W * (n === 2 ? 0.24 : 0.16);
    const cols = Math.max(1, Math.ceil(Math.sqrt(m * quer / tief)));
    const rows = Math.ceil(m / cols);
    const cell = Math.min(quer / cols, tief / rows, 74);
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
  // Die planetare Abwehr sitzt auf der Welt, auf der Seite ihres Besitzers.
  battle.units.forEach((u, i) => {
    if (u[1] !== 'battery') return;
    const k = u[0];
    const seite = Math.cos(Math.PI + ((k - mine + n) % n) * TAU / n) < 0 ? -1 : 1;
    const a = -Math.PI / 2 + seite * 0.42;
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

// ------------------------------------------------------------------ Malen

function malen(ms) {
  if (!st) return;
  frame = requestAnimationFrame(malen);
  const dt = Math.min(0.1, (ms - st.prev) / 1000);
  st.prev = ms;
  const { battle, tl } = st;
  if (st.playing) {
    st.T = Math.min(tl.end, st.T + dt * st.speed);
    if (st.T >= tl.end) { st.playing = false; texte(); }
  }

  const cv = modal.querySelector('.bt-stage canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  if (!st.layout || st.size !== `${W}x${H}`) { st.layout = aufstellen(W, H); st.size = `${W}x${H}`; }
  const L = st.layout;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const T = st.T;
  const hp = hpAt(battle, tl, T);
  const color = (i) => spieler(battle.sides[battle.units[i][0]]).color;

  // Himmel und Welt
  const bg = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.35, Math.max(W, H) * 0.75);
  bg.addColorStop(0, '#121a33'); bg.addColorStop(1, '#04060e');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, tw] of L.stars) {
    ctx.fillStyle = `rgba(226,236,255,${(0.35 + 0.4 * Math.abs(Math.sin(ms / 900 + tw * 9))).toFixed(2)})`;
    ctx.fillRect(x, y, r, r);
  }
  zeichneWelt(ctx, L.planet);
  if (L.shield) {
    // Gross im Bild deckt der volle Schild sonst die Welt zu.
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawHexShield(ctx, L.planet.x, L.planet.y, L.shield.R, ms / 1000, shieldStrength(L.shield, tl, T));
    ctx.restore();
  }

  // Schiffe. Die planetare Abwehr hat kein eigenes Bild - sie feuert von
  // der Oberflaeche der Welt.
  battle.units.forEach((u, i) => {
    const d = tl.death[i];
    if (T >= d || !L.pos[i] || u[1] === 'battery') return;
    const weg = fleeing(tl, i, T);
    if (weg >= 1) return;
    let [x, y] = L.pos[i];
    // Abgefangene drehen ab und fliegen beschleunigt aus dem Bild
    const kurs = weg > 0 ? L.facing[i] + Math.PI : L.facing[i];
    x += Math.cos(kurs) * W * 0.6 * weg * weg;
    y += Math.sin(kurs) * W * 0.6 * weg * weg;
    const bob = Math.sin(ms / 700 + i * 1.3) * L.len[i] * 0.04;
    ctx.save();
    ctx.globalAlpha = 1 - weg * weg;
    drawShipHD(ctx, {
      type: u[1], x, y: y + bob, len: L.len[i], color: color(i), phase: ms / 1000 + i,
      angle: u[1] === 'satellite' ? ms / 4000 + i : kurs
    });
    ctx.restore();
    // Kurz vor dem Ende flackert die Huelle rot
    if (T > d - 0.25 && Number.isFinite(d)) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,80,40,${(0.5 * (1 - (d - T) / 0.25)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y + bob, L.len[i] * 0.4, 0, TAU); ctx.fill();
      ctx.restore();
    }
    const max = u[3] || u[2] || 1;
    if (hp[i] < max - 1e-6) huelle(ctx, x, y + L.len[i] * 0.55, L.len[i], Math.max(0, hp[i]) / max);
  });

  // Schuesse, Einschlaege, Explosionen
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of tl.shots) {
    if (s.tf > T) break;
    if (T > s.th + 0.3) continue;
    const abwehr = battle.units[s.from][1] === 'battery';
    const a = abwehr ? aufWelt(L.planet, s.tf * 1000) : L.pos[s.from];
    const b = battle.units[s.to][1] === 'battery' ? aufWelt(L.planet, s.tf * 777) : L.pos[s.to];
    if (!a || !b) continue;
    const lf = L.len[s.from];
    const nose = abwehr ? a
      : [a[0] + Math.cos(L.facing[s.from]) * lf * 0.45, a[1] + Math.sin(L.facing[s.from]) * lf * 0.45];
    if (T - s.tf < (abwehr ? 0.14 : 0.07)) {
      drawImpact(ctx, nose[0], nose[1], lf * (abwehr ? 0.5 : 0.22), (T - s.tf) / (abwehr ? 0.14 : 0.07), color(s.from));
    }
    // Steht der Schild noch, endet der Schuss auf ihm und laesst ihn aufleuchten.
    const schild = underShield(L.shield, battle, s.to) && shieldStrength(L.shield, tl, s.th) > 0.05
      ? aufSchild(nose, b, L.planet, L.shield.R) : null;
    const ziel = schild || b;
    if (T <= s.th) drawBolt(ctx, nose[0], nose[1], ziel[0], ziel[1], (T - s.tf) / (s.th - s.tf), Math.max(16, lf * 0.7), color(s.from), Math.max(1.2, lf * 0.04));
    else if (schild) drawShieldHit(ctx, schild[0], schild[1], Math.max(14, L.shield.R * 0.1), (T - s.th) / 0.3);
    else drawImpact(ctx, b[0] + Math.sin(s.tf * 99) * L.len[s.to] * 0.15, b[1] + Math.cos(s.tf * 77) * L.len[s.to] * 0.15,
      Math.max(6, L.len[s.to] * 0.3), (T - s.th) / 0.2, color(s.from));
  }
  ctx.restore();
  battle.units.forEach((u, i) => {
    const d = tl.death[i];
    if (L.pos[i] && T >= d && T < d + 1) drawExplosion(ctx, L.pos[i][0], L.pos[i][1], L.len[i] * 0.9, T - d, i + 1);
  });

  tonspur(T, W);
  anzeige(T, hp);
  st.last = T;
}

/**
 * Ein Punkt auf dem sichtbaren Rand der Welt - dort blitzt die planetare
 * Abwehr auf oder schlaegt ein Schuss auf sie ein. Jeder Schuss an anderer
 * Stelle, aber beim Spulen immer an derselben.
 */
function aufWelt(pl, seed) {
  const z = Math.sin(seed * 12.9898) * 43758.5453;
  const a = -Math.PI / 2 + (z - Math.floor(z) - 0.5) * 1.5;
  return [pl.x + Math.cos(a) * pl.R * 0.99, pl.y + Math.sin(a) * pl.R * 0.99];
}

/** Wo die Strecke a->b von aussen auf den Schild trifft; null, wenn gar nicht. */
function aufSchild(a, b, c, R) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const fx = a[0] - c.x, fy = a[1] - c.y;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - R * R;
  const disk = B * B - 4 * A * C;
  if (C < 0 || disk < 0 || !A) return null;          // Schuetze schon drinnen
  const t = (-B - Math.sqrt(disk)) / (2 * A);
  return t >= 0 && t <= 1 ? [a[0] + dx * t, a[1] + dy * t] : null;
}

function zeichneWelt(ctx, pl) {
  const p = st.planet;
  if (!p) return;
  if (!st.sprite || st.spriteR !== Math.round(pl.R)) {
    st.sprite = planetSprite({ ...p, known: 'live' }, Math.round(pl.R));
    st.spriteR = Math.round(pl.R);
  }
  const sp = st.sprite;
  ctx.save();
  // Leuchtender Rand in der Farbe des Besitzers - wie der Besitzring auf der
  // Karte. Freie Welten schimmern neutral blau. Die Sicht kennt die Welt erst
  // nach der Runde - eine danach eroberte Welt traegt schon die Farbe des
  // Eroberers. Wer die Abwehr stellt, hielt sie waehrend der Schlacht.
  const abwehr = st.battle.units.find(u => u[1] === 'battery');
  const owner = abwehr ? st.battle.sides[abwehr[0]] : p.owner;
  const [r, gr, b] = owner ? hexRgb(spieler(owner).color) : [120, 170, 255];
  const g = ctx.createRadialGradient(pl.x, pl.y, pl.R * 0.95, pl.x, pl.y, pl.R * 1.18);
  g.addColorStop(0, `rgba(${r},${gr},${b},${owner ? 0.4 : 0.25})`); g.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.R * 1.18, 0, TAU); ctx.fill();
  ctx.drawImage(sp.canvas, pl.x - sp.cx, pl.y - sp.cy);
  ctx.restore();
}

function huelle(ctx, x, y, len, k) {
  const w = Math.max(14, len * 0.7), h = Math.max(2, len * 0.05);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = k > 0.5 ? '#52d98a' : k > 0.25 ? '#f0b429' : '#ff5f5f';
  ctx.fillRect(x - w / 2, y, w * k, h);
}

/** Ton nur beim Abspielen - beim Spulen wuerde es sonst prasseln. */
function tonspur(T, W) {
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

/** Runde, Seitenstaerke und am Ende das Ergebnis. */
function anzeige(T, hp) {
  const { battle, tl } = st;
  const runde = Math.min(tl.rounds, Math.floor(T / tl.rd) + 1);
  const fertig = T >= tl.end - 0.01;
  const key = fertig ? 'done' : runde;
  if (st.roundKey !== key) {
    st.roundKey = key;
    modal.querySelector('.bt-round').textContent = fertig
      ? t('battle.result') : t('battle.round', { n: runde, total: tl.rounds });
  }
  const seek = modal.querySelector('.bt-seek');
  if (document.activeElement !== seek) seek.value = Math.round(T / tl.end * 1000);

  battle.sides.forEach((_, k) => {
    let vorher = 0, jetzt = 0, fort = 0, hpNow = 0, hpMax = 0;
    battle.units.forEach((u, i) => {
      if (u[0] !== k) return;
      hpMax += u[3] || u[2];
      if (T < tl.death[i]) hpNow += Math.max(0, hp[i]);
      if (u[1] === 'battery') return;
      vorher++;
      if (fleeing(tl, i, T) >= 1) fort++;
      else if (T < tl.death[i]) jetzt++;
    });
    const el = st.sideEls[k];
    if (!el) return;
    const zahl = el.querySelector('.bt-count');
    zahl.textContent = `${jetzt}/${vorher}` + (fort ? ` · ↗ ${fort}` : '');
    zahl.title = fort ? t('battle.fled', { n: fort }) : '';
    el.querySelector('.bt-bar > div').style.width = `${hpMax ? (hpNow / hpMax * 100).toFixed(1) : 0}%`;
    el.classList.toggle('out', jetzt === 0 && !battle.units.some((u, i) =>
      u[0] === k && T < tl.death[i] && fleeing(tl, i, T) < 1));
  });

  const res = modal.querySelector('.bt-result');
  if (fertig !== st.resultShown) {
    st.resultShown = fertig;
    res.classList.toggle('hidden', !fertig);
    if (fertig) {
      const uebrig = battle.sides.filter((_, k) =>
        battle.units.some((u, i) => u[0] === k && !Number.isFinite(tl.death[i]) && !tl.flee.ids.has(i)));
      res.textContent = uebrig.length === 1
        ? t('battle.winner', { player: spieler(uebrig[0]).name })
        : t('battle.draw');
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
