// Announcements from an admin (e.g. upcoming downtime). Deliberately not a
// toast: a banner at the top of the screen that stays until the player
// acknowledges it, above every window - nobody should miss it or mistake it
// for an ordinary game event.
import { t, localeTag } from '../i18n.js';

let host = null;

/** @param {{from: string, text: string, at: number}} m */
export function showAnnouncement(m) {
  if (!host) {
    host = document.createElement('div');
    host.id = 'announcements';
    host.setAttribute('role', 'alert');
    document.body.appendChild(host);
  }
  const card = document.createElement('div');
  card.className = 'announcement';
  card.innerHTML = `
    <div class="an-head"><span class="an-icon">📢</span><b class="an-title"></b></div>
    <p class="an-text"></p>
    <div class="an-foot"><span class="an-from"></span><button type="button" class="primary tiny an-ok"></button></div>`;
  // The admin's own words: always as text, never as markup.
  card.querySelector('.an-title').textContent = t('announce.title');
  card.querySelector('.an-text').textContent = m.text;
  card.querySelector('.an-from').textContent = t('announce.from', {
    admin: m.from || 'Admin',
    time: new Date(m.at || Date.now()).toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' })
  });
  const ok = card.querySelector('.an-ok');
  ok.textContent = t('announce.ok');
  ok.onclick = () => card.remove();
  host.appendChild(card);
  ok.focus({ preventScroll: true });
}
