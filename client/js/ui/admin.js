// Admin panel next to the start menu: every game on this instance and every
// account. Only shown when the server says so in 'hello' - and the server
// checks the flag again on every request, so a hidden panel is no security
// boundary, just a view.
import { t, n as num, localeTag, relative, onLocaleChange } from '../i18n.js';
import { avatarHtml } from './avatar.js';
import { inviteUrl, copyField } from './invites.js';
import { appealLogHtml } from './blocked.js';

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
    $('#admin-invite-create').onclick = () => {
      this.net.send({ t: 'adminInvite', note: $('#admin-invite-note').value });
    };
    $('#admin-invite-note').onkeydown = (e) => { if (e.key === 'Enter') $('#admin-invite-create').click(); };
    $('#admin-invite-copy').onclick = () => this.copyInvite();
    $('#admin-invite-close').onclick = () => {
      $('#admin-invite-link').classList.add('hidden');
      $('#admin-invite-url').value = '';
    };
    $('#admin-invites').addEventListener('click', (e) => {
      const b = e.target.closest('[data-revoke]');
      if (b) this.net.send({ t: 'adminRevokeInvite', id: b.dataset.revoke });
    });
    // Each account has a menu of actions. Which one is open is kept here,
    // so the poll rebuilds it open instead of closing it under the mouse.
    // The list itself hangs on the body: inside the scrolling panel it would
    // be cut off at its edge (and a transform there rules out position:fixed).
    this.pop = document.createElement('div');
    this.pop.className = 'aa-list hidden';
    this.pop.setAttribute('role', 'menu');
    document.body.appendChild(this.pop);
    this.pop.addEventListener('click', (e) => this.menuAction(e));
    $('#admin-accounts').addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-menu]');
      if (toggle) this.openMenu(this.menuFor === toggle.dataset.menu ? null : toggle.dataset.menu);
    });
    // The path as it was at the click: the list may have been rebuilt since
    // (the first click on delete), and the clicked item is no longer in it.
    document.addEventListener('click', (e) => {
      if (this.menuFor && !e.composedPath().some(el => el === this.pop || el.classList?.contains('aa-menu'))) this.openMenu(null);
    });
    document.addEventListener('keydown', (e) => {
      if (this.menuFor && e.key === 'Escape') this.openMenu(null);
    });
    // Fixed to the window, the list would stay put while its button moves
    // away - so scrolling closes it. Only scrolling that moves the button: a
    // conversation log scrolling to its newest message does not.
    addEventListener('scroll', (e) => {
      const box = e.target === document ? document.documentElement : e.target;
      if (this.menuFor && box.contains?.(this.menuButton)) this.openMenu(null);
    }, true);
    addEventListener('resize', () => { if (this.menuFor) this.openMenu(null); });
    $('#admin-appeal-close').onclick = () => this.openAppeal(null);
    $('#admin-appeal-send').onclick = () => this.sendAppeal();
    $('#admin-appeal-text').onkeydown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.sendAppeal(); }
      if (e.key === 'Escape') this.openAppeal(null);
    };
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
    if (!this.enabled) {
      this.menuFor = null;
      return this.pop.classList.add('hidden');
    }
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

  /** A fresh invite: the server sends the token once. */
  inviteCreated(m) {
    $('#admin-invite-url').value = inviteUrl(m.token);
    $('#admin-invite-link').classList.remove('hidden');
    $('#admin-invite-note').value = '';
    $('#admin-invite-copy').textContent = t('admin.copy');
    $('#admin-invite-url').select();
  }

  async copyInvite() {
    await copyField($('#admin-invite-url'));
    $('#admin-invite-copy').textContent = t('admin.copied');
  }

  /** Opens the action menu of an account, or closes it with null. */
  openMenu(name) {
    this.menuFor = name;
    this.render();
  }

  menuAction(e) {
    const b = e.target.closest('.aa-item');
    if (!b) return;
    const { name } = b.dataset;
    switch (b.dataset.act) {
      case 'inviter': this.net.send({ t: 'adminInviter', name, on: b.dataset.on === '1' }); break;
      case 'block': this.net.send({ t: 'adminBlock', name, on: b.dataset.on === '1' }); break;
      case 'appeal': this.openAppeal(name); break;
      // Two clicks, like ending a game - the menu stays open in between.
      case 'delete': return this.deleteAccount(name);
    }
    this.openMenu(null);
  }

  /**
   * Fills the list for the open menu and puts it under its button - above
   * it when there is no room below. Gone with its button (account deleted,
   * start menu left), the menu closes.
   */
  placeMenu() {
    const a = this.menuFor && this.data?.accounts.find(x => x.name === this.menuFor);
    const toggle = a && [...document.querySelectorAll('#admin-accounts [data-menu]')].find(b => b.dataset.menu === a.name);
    this.menuButton = toggle;
    if (!toggle?.offsetParent) {
      this.menuFor = null;
      this.pop.classList.add('hidden');
      return;
    }
    this.pop.innerHTML = this.menuItems(a).join('');
    this.pop.classList.remove('hidden');
    const GAP = 5, MARGIN = 8;
    const r = toggle.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = this.pop;
    const below = r.bottom + GAP + h <= innerHeight - MARGIN || r.top - GAP - h < MARGIN;
    this.pop.style.top = `${below ? r.bottom + GAP : r.top - GAP - h}px`;
    this.pop.style.left = `${Math.max(MARGIN, Math.min(r.right - w, innerWidth - w - MARGIN))}px`;
  }

  /**
   * Deleting an account takes two clicks within a few seconds, like ending
   * a game: the first arms the item, the second sends it.
   */
  deleteAccount(name) {
    if (this.armedDelete?.name === name && Date.now() < this.armedDelete.until) {
      this.armedDelete = null;
      this.net.send({ t: 'adminDelete', name });
      if (this.appealFor === name) this.openAppeal(null);
      return this.openMenu(null);
    }
    this.armedDelete = { name, until: Date.now() + 4000 };
    this.render();
    clearTimeout(this.disarmDelete);
    this.disarmDelete = setTimeout(() => { this.armedDelete = null; this.render(); }, 4000);
  }

  /** Opens the conversation with a blocked account, or closes it with null. */
  openAppeal(name) {
    this.appealFor = name;
    $('#admin-appeal').classList.toggle('hidden', !name);
    if (!name) return;
    this.renderAppeal();
    const box = $('#admin-appeal-text');
    box.focus();
    box.scrollIntoView({ block: 'nearest' });
  }

  /** The thread comes along with every poll - an answer from the player shows up by itself. */
  renderAppeal() {
    const a = this.data?.accounts.find(x => x.name === this.appealFor);
    if (!a) return;
    $('#admin-appeal-to').textContent = t('admin.appealTo', { user: a.display });
    const log = $('#admin-appeal-log');
    const html = appealLogHtml(a.appeal.map(m => ({ mine: m.from === 'admin', who: m.by, text: m.text, at: m.at })),
      t('admin.appealEmpty'));
    // Only touched when something changed, so reading back is not interrupted.
    if (log.dataset.html === html) return;
    log.innerHTML = log.dataset.html = html;
    log.scrollTop = log.scrollHeight;
  }

  sendAppeal() {
    const text = $('#admin-appeal-text').value.trim();
    if (!this.appealFor || !text) return;
    this.net.send({ t: 'adminAppeal', name: this.appealFor, text });
    $('#admin-appeal-text').value = '';
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
    $('#admin-invites-count').textContent = d.invites.length;
    $('#admin-invites').innerHTML = d.invites.map(i => this.inviteRow(i)).join('');
    $('#admin-games').innerHTML = d.games.length
      ? d.games.map(g => this.gameCard(g)).join('')
      : `<p class="muted small">${t('admin.noGames')}</p>`;
    $('#admin-accounts').innerHTML = d.accounts.length
      ? d.accounts.map(a => this.accountRow(a)).join('')
      : `<p class="muted small">${t('admin.noAccounts')}</p>`;
    this.placeMenu();
    // The account is gone (deleted elsewhere): its conversation closes too.
    if (this.appealFor && !d.accounts.some(a => a.name === this.appealFor)) this.openAppeal(null);
    else if (this.appealFor) this.renderAppeal();
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

  inviteRow(i) {
    const facts = [
      t('admin.inviteBy', { admin: esc(i.by) }),
      t('admin.inviteCreated', { ago: this.ago(i.created) }),
      t('admin.inviteExpires', { ago: this.ago(i.expires) })
    ].join(' · ');
    return `<div class="admin-invite">
      <span class="ai-note">${i.note ? esc(i.note) : `<span class="muted">${t('admin.inviteNoNote')}</span>`}</span>
      <button type="button" class="tiny" data-revoke="${esc(i.id)}">${t('admin.revoke')}</button>
      <span class="muted small ai-facts">${facts}</span>
    </div>`;
  }

  accountRow(a) {
    const name = esc(a.display) + (a.handle ? ` <small class="muted">#${esc(a.handle)}</small>` : '') + (a.nick && a.nick !== a.display ? ` <small class="muted">${t('admin.nick', { nick: esc(a.nick) })}</small>` : '')
      + (a.invitedBy ? ` <small class="muted">${t('admin.invitedBy', { admin: esc(a.invitedBy) })}</small>` : '');
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
        ${a.inviter && !a.admin ? `<span class="tag-host">${t('admin.isInviter')}</span>` : ''}
        ${a.blocked ? `<span class="tag-blocked">${t('admin.isBlocked')}</span>` : ''}
        ${a.appeal.at(-1)?.from === 'user' ? `<span class="tag-waiting">✉ ${t('admin.appealWaiting')}</span>` : ''}
        ${a.mustChange ? `<span class="tagbot">${t('admin.mustChange')}</span>` : ''}</span>
      <span class="muted small aa-status">${status}</span>
      <span class="aa-side"><span class="muted small">${created}</span>${this.accountMenu(a)}</span>
    </div>`;
  }

  /**
   * The "⋯" button of an account; its list is placeMenu's. Admin accounts
   * have none - they may invite anyway, and the server refuses to block or
   * delete them.
   */
  accountMenu(a) {
    if (a.admin) return '';
    const open = this.menuFor === a.name;
    return `<span class="aa-menu${open ? ' open' : ''}">
      <button type="button" class="tiny aa-toggle" data-menu="${esc(a.name)}" aria-haspopup="menu" aria-expanded="${open}"
        title="${t('admin.accountMenu')}" aria-label="${t('admin.accountMenu')}">⋯</button>
    </span>`;
  }

  /** The actions in an account's menu. */
  menuItems(a) {
    const name = esc(a.name);
    // `on` says which way a switch goes: 1 grants, 0 takes back.
    const item = (act, label, title, { on, cls = '' } = {}) =>
      `<button type="button" class="aa-item${cls}" role="menuitem" data-act="${act}" data-name="${name}"
        ${on === undefined ? '' : `data-on="${on}"`} title="${t(title)}">${t(label)}</button>`;
    const armed = this.armedDelete?.name === a.name && Date.now() < this.armedDelete.until;
    return [
      item('inviter', a.inviter ? 'admin.inviterRevoke' : 'admin.inviterGrant',
        a.inviter ? 'admin.inviterRevokeTitle' : 'admin.inviterGrantTitle', { on: a.inviter ? 0 : 1 }),
      item('block', a.blocked ? 'admin.unblock' : 'admin.block',
        a.blocked ? 'admin.unblockTitle' : 'admin.blockTitle', { on: a.blocked ? 0 : 1 }),
      // The conversation: while blocked, or as long as there is one to read.
      a.blocked || a.appeal.length ? item('appeal', 'admin.appeal', 'admin.appealTitle') : null,
      item('delete', armed ? 'admin.deleteConfirm' : 'admin.delete', 'admin.deleteTitle',
        { cls: armed ? ' danger armed' : ' danger' })
    ].filter(Boolean);
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
