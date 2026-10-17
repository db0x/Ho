// Startbildschirm und Lobby.
import { loadName, saveName } from '../net.js';
import { syncSelects } from './select.js';
import { t, n as num } from '../i18n.js';

const $ = s => document.querySelector(s);

export class Lobby {
  constructor(net, onStart) {
    this.net = net;
    this.onStart = onStart;
    this.lobby = null;
    this.isHost = false;
    this.settings = null;
    this.bind();
    this.menuStars();
  }

  bind() {
    $('#in-name').value = loadName();
    $('#btn-create').onclick = () => {
      const name = this.name();
      this.net.forget();
      this.net.send({ t: 'create', name, settings: { ...(this.settings || {}), mode: this.mode(), shape: this.shape() } });
    };
    $('#btn-join').onclick = () => {
      const code = $('#in-code').value.trim().toUpperCase();
      if (code.length !== 4) return this.error('#menu-error', t('menu.needCode'));
      this.net.forget();
      this.net.send({ t: 'join', code, name: this.name() });
    };
    $('#btn-solo').onclick = () => this.quickStart(5);
    $('#btn-watch').onclick = () => {
      this.net.forget();
      this.net.send({ t: 'watch', bots: +$('#in-watchbots').value || 6, settings: { mode: this.mode(), shape: this.shape() } });
    };
    $('#in-code').onkeydown = e => { if (e.key === 'Enter') $('#btn-join').click(); };
    $('#in-name').onchange = () => saveName(this.name());
    $('#link-help').onclick = (e) => { e.preventDefault(); $('#help').classList.remove('hidden'); };
    $('#help-close').onclick = () => $('#help').classList.add('hidden');

    $('#btn-addbot').onclick = () => this.net.send({ t: 'addBot' });
    $('#btn-fill').onclick = () => {
      const free = 16 - (this.lobby?.players.length || 0);
      for (let i = 0; i < free; i++) this.net.send({ t: 'addBot' });
    };
    $('#btn-start').onclick = () => this.net.send({ t: 'start' });
    $('#btn-leave').onclick = () => { this.net.forget(); location.reload(); };

    const sliders = {
      '#s-ppp': ['planetsPerPlayer', v => t('word.worlds', { n: v }), '#v-ppp'],
      '#s-money': ['startMoney', v => `${num(+v)} ${t('unit.cr')}`, '#v-money'],
      '#s-metal': ['startMetal', v => `${num(+v)} ${t('unit.ore')}`, '#v-metal'],
      '#s-timer': ['turnTimer', v => +v === 0 ? t('lobby.noLimit') : t('unit.seconds', { n: v }), '#v-timer']
    };
    for (const [sel, [key, fmt, out]] of Object.entries(sliders)) {
      $(sel).oninput = () => {
        $(out).textContent = fmt($(sel).value);
        if (this.isHost) this.net.send({ t: 'settings', settings: { [key]: +$(sel).value } });
      };
    }
    $('#s-shape').onchange = () => {
      if (this.isHost) this.net.send({ t: 'settings', settings: { shape: $('#s-shape').value } });
    };
    $('#s-mode').onchange = () => {
      if (this.isHost) this.net.send({ t: 'settings', settings: { mode: $('#s-mode').value } });
    };
    $('#s-expand').onchange = () => {
      if (this.isHost) this.net.send({ t: 'settings', settings: { expanding: $('#s-expand').checked } });
    };
    this.sliders = sliders;
  }

  /** Spielfeld aus dem Startbildschirm. */
  mode() { return $('#in-mode')?.value === 'space' ? 'space' : 'classic'; }

  /** Form der Galaxie aus dem Startbildschirm. */
  shape() { return $('#in-shape')?.value === 'spiral' ? 'spiral' : 'scatter'; }

  /** Eröffnet eine Partie, füllt sie mit KI und startet sofort. */
  quickStart(bots) {
    this.pendingQuickStart = bots;
    this.net.forget();
    this.net.send({ t: 'create', name: this.name(), settings: { planetsPerPlayer: 7, mode: this.mode(), shape: this.shape() } });
  }

  name() {
    const n = $('#in-name').value.trim() || 'Captain';
    saveName(n);
    return n;
  }

  error(sel, msg) { $(sel).textContent = msg; setTimeout(() => { $(sel).textContent = ''; }, 5000); }

  showOpenGames(list) {
    this.offeneSpiele = list;
    const host = $('#open-games');
    if (!list?.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="small muted">${t('menu.openGames')}</div>` + list.map(g =>
      `<div class="og"><b>${g.id}</b><span class="muted">${t('menu.openGamePlayers', { host: g.host, n: g.players })}</span>
       <span class="spacer" style="flex:1"></span><button class="tiny" data-code="${g.id}">${t('menu.join')}</button></div>`).join('');
    for (const b of host.querySelectorAll('[data-code]')) {
      b.onclick = () => {
        this.net.forget();
        this.net.send({ t: 'join', code: b.dataset.code, name: this.name() });
      };
    }
  }

  show(which) {
    for (const s of ['menu', 'lobby', 'game']) {
      document.querySelector('#screen-' + s).classList.toggle('hidden', s !== which);
    }
  }

  /** @param {boolean} zeigen false: nur neu beschriften, den Bildschirm nicht wechseln */
  update(msg, zeigen = true) {
    if (this.pendingQuickStart && msg.host) {
      const n = this.pendingQuickStart;
      this.pendingQuickStart = 0;
      for (let i = 0; i < n; i++) this.net.send({ t: 'addBot' });
      setTimeout(() => this.net.send({ t: 'start' }), 120);
    }
    this.lobby = msg.lobby;
    this.isHost = msg.host;
    this.youId = msg.you;
    this.settings = msg.lobby.settings;
    if (zeigen) this.show('lobby');
    $('#lobby-code').textContent = msg.lobby.id;
    $('#lobby-count').textContent = `${msg.lobby.players.length}/16`;
    $('#lobby-players').innerHTML = msg.lobby.players.map(p => `
      <li>
        <span class="swatch" style="background:${p.color};color:${p.color}"></span>
        <span style="flex:1">${p.name}${p.id === msg.you ? ` <span class="muted small">${t('word.you')}</span>` : ''}</span>
        ${p.isBot ? `<span class="tagbot">${t('word.ai')}</span>`
          : (p.connected ? '' : `<span class="tagbot">${t('word.offline')}</span>`)}
        ${this.isHost && p.id !== msg.you ? `<button class="tiny" data-kick="${p.id}">×</button>` : ''}
      </li>`).join('');
    for (const b of $('#lobby-players').querySelectorAll('[data-kick]')) {
      b.onclick = () => this.net.send({ t: 'kick', playerId: b.dataset.kick });
    }
    const s = msg.lobby.settings;
    $('#s-ppp').value = s.planetsPerPlayer; $('#v-ppp').textContent = t('word.worlds', { n: s.planetsPerPlayer });
    $('#s-money').value = s.startMoney; $('#v-money').textContent = `${num(s.startMoney)} ${t('unit.cr')}`;
    $('#s-metal').value = s.startMetal; $('#v-metal').textContent = `${num(s.startMetal)} ${t('unit.ore')}`;
    $('#s-timer').value = s.turnTimer;
    $('#v-timer').textContent = s.turnTimer === 0 ? t('lobby.noLimit') : t('unit.seconds', { n: s.turnTimer });
    $('#s-mode').value = s.mode === 'space' ? 'space' : 'classic';
    $('#s-mode').disabled = !this.isHost;
    $('#s-shape').value = s.shape === 'spiral' ? 'spiral' : 'scatter';
    $('#s-shape').disabled = !this.isHost;
    $('#s-expand').checked = s.expanding !== false;
    $('#s-expand').disabled = !this.isHost;
    for (const sel of Object.keys(this.sliders)) $(sel).disabled = !this.isHost;
    syncSelects();            // Knöpfe an die eben gesetzten Werte angleichen
    $('#btn-start').disabled = !this.isHost;
    $('#btn-addbot').disabled = !this.isHost || msg.lobby.players.length >= 16;
    $('#btn-fill').disabled = !this.isHost || msg.lobby.players.length >= 16;
    $('#btn-start').textContent = this.isHost ? t('lobby.start') : t('lobby.waitHost');
  }

  /** Nach einem Sprachwechsel: alles neu schreiben, was hier gesetzt wird. */
  relabel() {
    // Nur beschriften: läuft die Partie schon, darf der Wechsel nicht in die
    // Lobby zurückwerfen.
    if (this.lobby) this.update({ lobby: this.lobby, host: this.isHost, you: this.youId }, false);
    if (this.offeneSpiele) this.showOpenGames(this.offeneSpiele);
  }

  // Zarte Sternanimation hinter dem Startmenü
  menuStars() {
    const cv = $('#menu-canvas');
    const ctx = cv.getContext('2d');
    let stars = [];
    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: 260 }, () => ({
        x: Math.random() * cv.clientWidth, y: Math.random() * cv.clientHeight,
        r: Math.random() * 1.6 + 0.2, s: Math.random() * 0.12 + 0.02,
        a: Math.random() * 0.7 + 0.2
      }));
    };
    resize();
    addEventListener('resize', resize);
    const tick = () => {
      if (!document.querySelector('#screen-menu').classList.contains('hidden')) {
        ctx.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
        for (const s of stars) {
          s.x += s.s;
          if (s.x > cv.clientWidth) s.x = 0;
          ctx.fillStyle = `rgba(226,236,255,${s.a})`;
          ctx.fillRect(s.x, s.y, s.r, s.r);
        }
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
}
