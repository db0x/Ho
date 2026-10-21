// Admin panel next to the start menu: every game on this instance and every
// account. Only shown when the server says so in 'hello' - and the server
// checks the flag again on every request, so a hidden panel is no security
// boundary, just a view.
import { t, n as num, localeTag, onLocaleChange } from '../i18n.js';
import { avatarHtml } from './avatar.js';

const $ = s => document.querySelector(s);
const POLL_MS = 5000;

export class AdminPanel {
  constructor(net) {
    this.net = net;
    this.enabled = false;
    this.data = null;
    this.timer = null;
    $('#admin-refresh').onclick = () => this.request();
    // One delegated handler - the list is rebuilt on every poll.
    $('#admin-games').addEventListener('click', (e) => {
      const end = e.target.closest('[data-end]');
      if (end) this.end(end);
      const msg = e.target.closest('[data-msg]');
      if (msg) this.compose(msg.dataset.msg);
      const watch = e.target.closest('[data-watch]');
      if (watch) this.watch(watch.dataset.watch);
    });
    // The composer sits outside the list on purpose: the list is rebuilt on
    // every poll and would throw away a half-written message.
    $('#admin-compose-cancel').onclick = () => this.compose(null);
    $('#admin-compose-send').onclick = () => this.sendMessage();
    $('#admin-compose-text').onkeydown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.sendMessage(); }
      if (e.key === 'Escape') this.compose(null);
    };
    onLocaleChange(() => this.render());
  }

  /** Switches the panel on or off - after 'hello', i.e. on every (re)connect. */
  setEnabled(on) {
    this.enabled = !!on;
    $('#admin-panel').classList.toggle('hidden', !this.enabled);
    $('#screen-menu').classList.toggle('with-admin', this.enabled);
    clearInterval(this.timer);
    this.timer = null;
    if (!this.enabled) return;
    this.request();
    // Poll only while the start menu is visible - in a game nobody looks at it.
    this.timer = setInterval(() => {
      if (!$('#screen-menu').classList.contains('hidden') && !document.hidden) this.request();
    }, POLL_MS);
  }

  request() {
    if (this.enabled) this.net.send({ t: 'admin' });
  }

  /**
   * Ending a game takes two clicks: the first arms the button, the second
   * (within a few seconds) sends it. No browser dialog - it would block
   * the page, and the poll keeps rebuilding the list anyway.
   */
  end(button) {
    const code = button.dataset.end;
    if (this.armed?.code === code && Date.now() < this.armed.until) {
      this.armed = null;
      this.net.send({ t: 'adminEnd', code });
      return;
    }
    this.armed = { code, until: Date.now() + 4000 };
    this.render();
    clearTimeout(this.disarm);
    this.disarm = setTimeout(() => { this.armed = null; this.render(); }, 4000);
  }

  /** Watch a game as a spectator - without fog, and without touching its pace. */
  watch(code) {
    this.net.forget();
    this.net.send({ t: 'adminWatch', code });
  }

  /** Opens the message composer for a game, or closes it with null. */
  compose(code) {
    this.composing = code;
    $('#admin-compose').classList.toggle('hidden', !code);
    $('#admin-compose-status').textContent = '';
    if (!code) return;
    $('#admin-compose-to').textContent = t('admin.msgTo', { code });
    const box = $('#admin-compose-text');
    box.focus();
    box.scrollIntoView({ block: 'nearest' });
  }

  sendMessage() {
    const text = $('#admin-compose-text').value.trim();
    if (!this.composing || !text) return;
    this.net.send({ t: 'adminMsg', code: this.composing, text });
  }

  /** The server confirms delivery: clear the text, say how many it reached. */
  messageSent(m) {
    if (m.code !== this.composing) return;
    $('#admin-compose-text').value = '';
    $('#admin-compose-status').textContent = t('admin.msgSent', { n: m.delivered, count: m.delivered });
  }

  update(data) {
    this.data = data;
    this.render();
  }

  render() {
    const d = this.data;
    if (!this.enabled || !d) return;
    // Ages are measured against the server's clock, not the browser's.
    this.ago = (ts) => ts ? relative(ts - d.now) : '–';
    $('#admin-updated').textContent = t('admin.updated', {
      time: new Date().toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
    $('#admin-games-count').textContent = d.games.length;
    $('#admin-accounts-count').textContent = d.accounts.length;
    $('#admin-games').innerHTML = d.games.length
      ? d.games.map(g => this.gameCard(g)).join('')
      : `<p class="muted small">${t('admin.noGames')}</p>`;
    $('#admin-accounts').innerHTML = d.accounts.length
      ? d.accounts.map(a => this.accountRow(a)).join('')
      : `<p class="muted small">${t('admin.noAccounts')}</p>`;
  }

  gameCard(g) {
    const turn = g.state === 'lobby' ? ''
      : (g.maxTurns ? t('admin.turnOf', { turn: g.turn, max: g.maxTurns }) : t('admin.turn', { turn: g.turn }));
    const when = [
      g.startedAt ? t('admin.started', { ago: this.ago(g.startedAt) }) : t('admin.opened', { ago: this.ago(g.created) }),
      g.lastTurnAt ? t('admin.lastTurn', { ago: this.ago(g.lastTurnAt) }) : null
    ].filter(Boolean).join(' · ');
    const winner = g.winner ? g.players.find(p => p.id === g.winner) : null;
    const facts = [
      t(`admin.mode.${g.mode}`), t(`admin.shape.${g.shape}`),
      g.host ? t('admin.host', { host: esc(g.host) }) : null,
      g.spectators ? t('admin.spectators', { n: g.spectators, count: g.spectators }) : null,
      winner ? t('admin.winner', { player: esc(winner.name) }) : null
    ].filter(Boolean).join(' · ');
    return `<div class="admin-game">
      <div class="ag-head">
        <b class="ag-code">${esc(g.id)}</b>
        <span class="ag-state" data-state="${g.state}">${t(`admin.state.${g.state}`)}</span>
        <span class="ag-turn">${turn}</span>
        ${this.actions(g)}
      </div>
      <div class="muted small">${when}</div>
      <div class="muted small">${facts}</div>
      <ul class="ag-players">${g.players.map(p => this.playerRow(g, p)).join('')}</ul>
    </div>`;
  }

  /** Watch, message and end - the admin's actions for one game. */
  actions(g) {
    const armed = this.armed?.code === g.id && Date.now() < this.armed.until;
    const id = esc(g.id);
    // A lobby has no map yet - there is nothing to watch.
    const watch = g.state === 'lobby' ? ''
      : `<button type="button" class="tiny" data-watch="${id}" title="${t('admin.watchTitle')}">${t('admin.watch')}</button>`;
    return `<span class="ag-actions">${watch}
      <button type="button" class="tiny" data-msg="${id}" title="${t('admin.messageTitle')}">${t('admin.message')}</button>
      <button type="button" class="tiny ag-end${armed ? ' armed' : ''}" data-end="${id}"
        title="${t('admin.endTitle')}">${t(armed ? 'admin.endConfirm' : 'admin.end')}</button></span>`;
  }

  playerRow(g, p) {
    const tags = [
      p.isBot ? t('word.ai') + (p.persona ? ' · ' + t(`persona.${p.persona}`) : '') : null,
      p.account ? '@' + esc(p.account) : null,
      !p.isBot && !p.connected ? t('word.offline') : null,
      g.state !== 'lobby' && !p.alive ? t('admin.out') : null
    ].filter(Boolean).join(' · ');
    const stats = g.state === 'lobby' ? t('admin.joined', { ago: this.ago(p.joinedAt) })
      : `${t('word.worlds', { n: p.stats.planets, count: p.stats.planets })} · ${t('word.pop', { n: num(p.stats.pop, 1) })}`
        + ` · ${t('word.ships', { n: p.stats.ships, count: p.stats.ships })}`;
    return `<li class="${p.alive ? '' : 'dead'}">
      ${avatarHtml(p, 20)}
      <span class="ag-name"><span class="nm">${esc(p.name)}</span>${tags ? ` <small class="muted">${tags}</small>` : ''}</span>
      <span class="muted small ag-stats">${stats}</span>
    </li>`;
  }

  accountRow(a) {
    const name = esc(a.display) + (a.nick && a.nick !== a.display ? ` <small class="muted">${t('admin.nick', { nick: esc(a.nick) })}</small>` : '');
    const status = a.online
      ? t('admin.online', { ago: this.ago(a.onlineSince) })
        + (a.games.length ? ' · ' + t('admin.inGame', { code: a.games.map(esc).join(', ') }) : '')
      : t('word.offline');
    const created = a.created
      ? t('admin.created', { date: new Date(a.created).toLocaleDateString(localeTag()) }) : '';
    // The online dot sits on the image, like a status light.
    return `<div class="admin-account">
      <span class="aa-avatar">${avatarHtml({ name: a.display, avatar: a.avatar }, 30)}<span class="dot ${a.online ? 'on' : ''}"></span></span>
      <span class="aa-name">${name}
        ${a.admin ? `<span class="tag-host">${t('admin.isAdmin')}</span>` : ''}
        ${a.mustChange ? `<span class="tagbot">${t('admin.mustChange')}</span>` : ''}</span>
      <span class="muted small aa-status">${status}</span>
      <span class="muted small aa-created">${created}</span>
    </div>`;
  }
}

/** "5 minutes ago" in the chosen language, with the largest fitting unit. */
function relative(deltaMs) {
  const rtf = new Intl.RelativeTimeFormat(localeTag(), { numeric: 'auto', style: 'short' });
  const s = Math.round(deltaMs / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
