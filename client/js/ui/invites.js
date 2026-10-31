// Invites below the friends, for accounts with the inviter role: create a
// one-time link for a new player, see your own open ones and revoke them.
// Admins have the same in their panel (admin.js), with everyone's invites.
// The server checks the role on every request - a hidden box is no
// security boundary, just a view.
import { t, relative, onLocaleChange } from '../i18n.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Used invites disappear by themselves - a slow look now and then is enough.
const POLL_MS = 30000;

/**
 * The link for a fresh token. Built from this page's own address, so it
 * also works behind a proxy under a subpath.
 */
export function inviteUrl(token) {
  return new URL(`login.html?invite=${encodeURIComponent(token)}`, location.href).href;
}

/** Copies what is in a text field. */
export async function copyField(field) {
  try {
    await navigator.clipboard.writeText(field.value);
  } catch {
    // No clipboard API without https (e.g. on a LAN address): fall back to
    // the selection, which the old copy command can still handle.
    field.select();
    document.execCommand('copy');
  }
}

export class InvitePanel {
  constructor(net) {
    this.net = net;
    this.enabled = false;
    this.data = null;
    this.timer = null;
    $('#invite-create').onclick = () => this.net.send({ t: 'inviteCreate', note: $('#invite-note').value });
    $('#invite-note').onkeydown = (e) => { if (e.key === 'Enter') $('#invite-create').click(); };
    $('#invite-copy').onclick = async () => {
      await copyField($('#invite-url'));
      $('#invite-copy').textContent = t('admin.copied');
    };
    $('#invite-close').onclick = () => this.hideLink();
    // One delegated handler - the list is rebuilt on every update.
    $('#invite-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-revoke]');
      if (b) this.net.send({ t: 'inviteRevoke', id: b.dataset.revoke });
    });
    onLocaleChange(() => this.render());
  }

  /** After 'hello', and whenever an admin grants or takes away the role. */
  setEnabled(on) {
    this.enabled = !!on;
    $('#invite-box').classList.toggle('hidden', !this.enabled);
    clearInterval(this.timer);
    this.timer = null;
    if (!this.enabled) {
      this.data = null;
      return this.hideLink();
    }
    this.request();
    this.timer = setInterval(() => {
      if (!$('#screen-menu').classList.contains('hidden') && !document.hidden) this.request();
    }, POLL_MS);
  }

  request() {
    if (this.enabled) this.net.send({ t: 'invites' });
  }

  /** A fresh invite: the server sends the token once. */
  created(m) {
    $('#invite-url').value = inviteUrl(m.token);
    $('#invite-link').classList.remove('hidden');
    $('#invite-note').value = '';
    $('#invite-copy').textContent = t('admin.copy');
    $('#invite-url').select();
  }

  hideLink() {
    $('#invite-link').classList.add('hidden');
    $('#invite-url').value = '';
  }

  update(data) {
    this.data = data;
    this.render();
  }

  render() {
    const d = this.data;
    if (!this.enabled || !d) return;
    $('#invite-count').textContent = d.invites.length;
    $('#invite-list').innerHTML = d.invites.length
      ? d.invites.map(i => this.row(i, d.now)).join('')
      : `<p class="muted small">${t('invite.none')}</p>`;
  }

  /** Ages are measured against the server's clock, not the browser's. */
  row(i, now) {
    const facts = [
      t('admin.inviteCreated', { ago: relative(i.created - now) }),
      t('admin.inviteExpires', { ago: relative(i.expires - now) })
    ].join(' · ');
    return `<div class="admin-invite">
      <span class="ai-note">${i.note ? esc(i.note) : `<span class="muted">${t('admin.inviteNoNote')}</span>`}</span>
      <button type="button" class="tiny" data-revoke="${esc(i.id)}">${t('admin.revoke')}</button>
      <span class="muted small ai-facts">${facts}</span>
    </div>`;
  }
}
