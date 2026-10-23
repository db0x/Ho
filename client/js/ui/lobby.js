// Start screen and lobby.
import { loadName, saveName, loadAvatar, saveAvatar } from '../net.js';
import { syncSelects } from './select.js';
import { pickAvatar, avatarHtml } from './avatar.js';
import { startStars } from './scene.js';
import { PLAYER_COLORS, AI_LEVELS } from '../../shared/rules.js';
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
    // The sky only moves while the start menu is visible.
    startStars($('#menu-canvas'), () => !$('#screen-menu').classList.contains('hidden'));
  }

  bind() {
    $('#in-name').value = loadName();
    $('#btn-create').onclick = () => {
      const name = this.name();
      this.net.forget();
      this.net.send({ t: 'create', name, settings: { ...(this.settings || {}), mode: this.mode(), shape: this.shape(), maxTurns: this.maxTurns() } });
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
      this.net.send({ t: 'watch', bots: +$('#in-watchbots').value || 6, settings: { mode: this.mode(), shape: this.shape(), maxTurns: this.maxTurns() } });
    };
    $('#in-code').onkeydown = e => { if (e.key === 'Enter') $('#btn-join').click(); };
    $('#in-name').onchange = () => this.rename($('#in-name').value);
    $('#btn-avatar').onclick = () => this.chooseAvatar();
    $('#link-avatar-off').onclick = (e) => {
      e.preventDefault();
      if (!this.profile?.account) saveAvatar(null);
      this.net.send({ t: 'profile', avatar: null });
    };
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
      '#s-metal': ['startMetal', v => `${num(+v)} ${t('unit.metal')}`, '#v-metal'],
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
    $('#s-turns').onchange = () => {
      if (this.isHost) this.net.send({ t: 'settings', settings: { maxTurns: +$('#s-turns').value } });
    };
    $('#s-expand').onchange = () => {
      if (this.isHost) this.net.send({ t: 'settings', settings: { expanding: $('#s-expand').checked } });
    };
    this.sliders = sliders;
  }

  /** Board from the start screen. */
  mode() { return $('#in-mode')?.value === 'space' ? 'space' : 'classic'; }

  /** Shape of the galaxy from the start screen. */
  shape() { return $('#in-shape')?.value === 'spiral' ? 'spiral' : 'scatter'; }

  /** Turn limit from the start screen; 0 = unlimited. */
  maxTurns() {
    const v = Number($('#in-turns')?.value);
    return Number.isFinite(v) ? v : 300;
  }

  /** Opens a game, fills it with AI and starts right away. */
  quickStart(bots) {
    this.pendingQuickStart = bots;
    this.net.forget();
    this.net.send({ t: 'create', name: this.name(), settings: { planetsPerPlayer: 7, mode: this.mode(), shape: this.shape(), maxTurns: this.maxTurns() } });
  }

  name() {
    const n = $('#in-name').value.trim() || 'Captain';
    if (!this.profile?.account) saveName(n);
    return n;
  }

  // ------------------------------------------------------------- Profile

  /**
   * State of the profile from the server (after 'hello' and every change).
   * With an account it is authoritative; without an account the browser
   * hands in what it remembered the first time.
   */
  setProfile(profile, firstTime = false) {
    if (firstTime && !profile.account) {
      const image = loadAvatar();
      const name = loadName();
      if (image || name) {
        this.net.send({ t: 'profile', ...(name ? { name } : {}), ...(image ? { avatar: image } : {}) });
      }
    }
    this.profile = profile;
    if (profile.account && profile.name) $('#in-name').value = profile.name;
    const btn = $('#btn-avatar');
    btn.innerHTML = profile.avatar ? `<img src="${profile.avatar}" alt="">` : '<span class="plus">+</span>';
    btn.classList.toggle('has', !!profile.avatar);
    $('#link-avatar-off').classList.toggle('hidden', !profile.avatar);
    this.profileHint();
  }

  profileHint() {
    const a = this.profile?.account;
    $('#profile-account').textContent = a ? t('profile.account', { account: a }) : '';
  }

  rename(value) {
    const name = String(value || '').trim();
    if (!name || name === this.profile?.name) return;
    if (!this.profile?.account) saveName(name);
    $('#in-name').value = name;
    this.net.send({ t: 'profile', name });
  }

  async chooseAvatar() {
    const image = await pickAvatar();
    if (!image) return;
    if (!this.profile?.account) saveAvatar(image);
    this.net.send({ t: 'profile', avatar: image });
  }

  // -------------------------------------------------------------- Colors

  /** Palette below the clicked color swatch. */
  colorMenu(anchor, playerId) {
    this.closeColorMenu();
    const players = this.lobby.players;
    const target = players.find(p => p.id === playerId);
    if (!target) return;
    const pop = document.createElement('div');
    pop.className = 'color-pop';
    pop.setAttribute('role', 'listbox');
    pop.innerHTML = PLAYER_COLORS.map(c => {
      const wearer = players.find(p => p.color === c);
      // Only the host takes a fellow player's color - then they swap.
      const locked = wearer && wearer !== target && !wearer.isBot && !this.isHost;
      const title = !wearer ? '' : wearer === target ? t('lobby.colorCurrent')
        : t(locked ? 'lobby.colorTakenBy' : 'lobby.colorSwap', { player: wearer.name });
      return `<button type="button" data-c="${c}" style="--c:${c}" title="${title}"
        class="${wearer === target ? 'cur' : wearer ? 'taken' : ''}" ${locked ? 'disabled' : ''}></button>`;
    }).join('');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
    for (const b of pop.querySelectorAll('button:not([disabled])')) {
      b.onclick = () => {
        this.net.send({ t: 'color', color: b.dataset.c, ...(playerId !== this.youId ? { playerId } : {}) });
        this.closeColorMenu();
      };
    }
    this.colorPop = pop;
    setTimeout(() => {
      this._colorAway = (e) => { if (!pop.contains(e.target)) this.closeColorMenu(); };
      addEventListener('pointerdown', this._colorAway);
    });
  }

  closeColorMenu() {
    this.colorPop?.remove();
    this.colorPop = null;
    if (this._colorAway) removeEventListener('pointerdown', this._colorAway);
    this._colorAway = null;
  }

  error(sel, msg) { $(sel).textContent = msg; setTimeout(() => { $(sel).textContent = ''; }, 5000); }

  showOpenGames(list) {
    this.openGames = list;
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

  /** @param {boolean} reveal false: only relabel, do not switch the screen */
  update(msg, reveal = true) {
    if (this.pendingQuickStart && msg.host) {
      const n = this.pendingQuickStart;
      this.pendingQuickStart = 0;
      // The quick game rolls each opponent's level.
      for (let i = 0; i < n; i++) this.net.send({ t: 'addBot', level: 'random' });
      setTimeout(() => this.net.send({ t: 'start' }), 120);
    }
    this.lobby = msg.lobby;
    this.isHost = msg.host;
    this.youId = msg.you;
    this.settings = msg.lobby.settings;
    if (reveal) this.show('lobby');
    $('#lobby-code').textContent = msg.lobby.id;
    $('#lobby-count').textContent = `${msg.lobby.players.length}/16`;
    // If the own name is being edited right now, the rebuild must not pull
    // it away from under your fingers.
    const field = document.activeElement?.classList?.contains('name-edit') ? document.activeElement : null;
    const draft = field ? { value: field.value, a: field.selectionStart, b: field.selectionEnd } : null;
    const host = msg.lobby.players[0];
    $('#lobby-players').innerHTML = msg.lobby.players.map(p => {
      const self = p.id === msg.you;
      const canColor = self || (this.isHost && p.isBot);
      return `
      <li class="${self ? 'me' : ''}">
        <button type="button" class="swatch" style="--c:${p.color}" data-color="${p.id}"
          ${canColor ? `title="${t('lobby.pickColor')}"` : 'disabled'}></button>
        ${self ? `<button type="button" class="avatar-btn" data-avatar title="${t('profile.pick')}">${avatarHtml(p, 30)}</button>`
          : avatarHtml(p, 30)}
        <span class="pname">
          ${self ? `<input class="name-edit" value="${p.name}" maxlength="18" title="${t('lobby.renameTitle')}" aria-label="${t('menu.name')}">`
            : `<span class="nm">${p.name}</span>`}
          ${self ? `<span class="muted small">${t('word.you')}</span>` : ''}
          ${p.account ? `<span class="muted small" title="${t('lobby.accountTitle')}">@${p.account}</span>` : ''}
          ${p.id === host?.id ? `<span class="tag-host">${t('lobby.host')}</span>` : ''}
        </span>
        ${p.isBot ? `<span class="tagbot"${p.persona ? ` title="${t(`persona.${p.persona}.desc`)}"` : ''}>${t('word.ai')}${p.persona ? ' · ' + t(`persona.${p.persona}`) : ''}</span>`
          : (p.connected ? '' : `<span class="tagbot">${t('word.offline')}</span>`)}
        ${p.isBot ? this.levelTag(p) : ''}
        ${this.isHost && !self ? `<button class="tiny" data-kick="${p.id}" title="${t('lobby.kick')}">×</button>` : ''}
      </li>`;
    }).join('');
    // The host switches an AI's level with a tap - in turn through all levels.
    for (const b of $('#lobby-players').querySelectorAll('[data-level]')) {
      b.onclick = () => {
        const next = AI_LEVELS[(AI_LEVELS.indexOf(b.dataset.current) + 1) % AI_LEVELS.length];
        this.net.send({ t: 'level', playerId: b.dataset.level, level: next });
      };
    }
    for (const b of $('#lobby-players').querySelectorAll('[data-kick]')) {
      b.onclick = () => this.net.send({ t: 'kick', playerId: b.dataset.kick });
    }
    for (const b of $('#lobby-players').querySelectorAll('[data-color]:not([disabled])')) {
      b.onclick = () => (this.colorPop ? this.closeColorMenu() : this.colorMenu(b, b.dataset.color));
    }
    const ava = $('#lobby-players [data-avatar]');
    if (ava) ava.onclick = () => this.chooseAvatar();
    const edit = $('#lobby-players .name-edit');
    if (edit) {
      edit.onchange = () => this.rename(edit.value);
      edit.onkeydown = (e) => { if (e.key === 'Enter') edit.blur(); if (e.key === 'Escape') { edit.value = this.profile?.name || edit.value; edit.blur(); } };
      if (draft) { edit.value = draft.value; edit.focus(); edit.setSelectionRange(draft.a, draft.b); }
    }
    if (this.colorPop) this.closeColorMenu();

    // Guests see what applies - but nothing that looks like it can be operated.
    $('#lobby-settings').classList.toggle('readonly', !this.isHost);
    const lock = $('#settings-lock');
    lock.classList.toggle('hidden', this.isHost);
    lock.textContent = this.isHost ? '' : t('lobby.settingsLocked', { host: host?.name || '' });
    for (const el of document.querySelectorAll('#screen-lobby .host-only')) el.classList.toggle('hidden', !this.isHost);
    const s = msg.lobby.settings;
    $('#s-ppp').value = s.planetsPerPlayer; $('#v-ppp').textContent = t('word.worlds', { n: s.planetsPerPlayer });
    $('#s-money').value = s.startMoney; $('#v-money').textContent = `${num(s.startMoney)} ${t('unit.cr')}`;
    $('#s-metal').value = s.startMetal; $('#v-metal').textContent = `${num(s.startMetal)} ${t('unit.metal')}`;
    $('#s-timer').value = s.turnTimer;
    $('#v-timer').textContent = s.turnTimer === 0 ? t('lobby.noLimit') : t('unit.seconds', { n: s.turnTimer });
    $('#s-mode').value = s.mode === 'space' ? 'space' : 'classic';
    $('#s-mode').disabled = !this.isHost;
    $('#s-shape').value = s.shape === 'spiral' ? 'spiral' : 'scatter';
    $('#s-shape').disabled = !this.isHost;
    // Values that do not exist in the selection land on the next larger one.
    const limits = [100, 200, 300, 500];
    $('#s-turns').value = s.maxTurns ? String(limits.find(n => n >= s.maxTurns) || 500) : '0';
    $('#s-turns').disabled = !this.isHost;
    $('#s-expand').checked = s.expanding !== false;
    $('#v-expand').textContent = t(s.expanding !== false ? 'word.yes' : 'word.no');
    $('#s-expand').disabled = !this.isHost;
    for (const sel of Object.keys(this.sliders)) $(sel).disabled = !this.isHost;
    syncSelects();            // align the buttons with the values just set
    $('#btn-start').disabled = !this.isHost;
    $('#btn-addbot').disabled = !this.isHost || msg.lobby.players.length >= 16;
    $('#btn-fill').disabled = !this.isHost || msg.lobby.players.length >= 16;
    $('#btn-start').textContent = this.isHost ? t('lobby.start') : t('lobby.waitHost');
  }

  /** How well an AI plays: a button for the host, otherwise just a label. */
  levelTag(p) {
    const level = p.level || 'normal';
    const title = `${t('ai.levelTitle')} – ${t(`ai.${level}.desc`)}`;
    return this.isHost
      ? `<button type="button" class="tiny level ${level}" data-level="${p.id}" data-current="${level}" title="${title}">${t(`ai.${level}`)}</button>`
      : `<span class="tagbot level ${level}" title="${title}">${t(`ai.${level}`)}</span>`;
  }

  /** After a language change: rewrite everything that is set here. */
  relabel() {
    // Only relabel: if the game is already running, the change must not throw
    // you back into the lobby.
    if (this.lobby) this.update({ lobby: this.lobby, host: this.isHost, you: this.youId }, false);
    if (this.openGames) this.showOpenGames(this.openGames);
    this.profileHint();
  }

}
