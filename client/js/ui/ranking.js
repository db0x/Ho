// The ranking of this instance: the top of it in the friends panel next to
// the start menu, the whole list in a dialog. Filled by the server
// ('ranking') - see server/stats.js for how the rating comes about. The
// handle comes along only for friends and oneself.
import { t, onLocaleChange } from '../i18n.js';
import { avatarHtml } from './avatar.js';

const TOP = 5;                    // that many in the panel, the rest in the dialog
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let modal = null;
let ask = null;
let enabled = false;
let last = null;                  // the last answer of the server

function build() {
  modal = document.createElement('div');
  modal.id = 'ranking';
  modal.className = 'modal hidden';
  modal.innerHTML = `<div class="modal-box ranking-box" role="dialog" aria-modal="true">
    <h2 class="rk-title"></h2>
    <div class="rk-body"></div>
    <p class="rk-note muted small"></p>
    <button type="button" class="primary rk-ok"></button>
  </div>`;
  document.body.appendChild(modal);
  const close = () => modal.classList.add('hidden');
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('.rk-ok').onclick = close;
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) { e.stopPropagation(); close(); }
  }, true);
}

/** Only with sign-in is there a ranking; it is asked for once the start menu shows. */
export function bindRanking(on, send) {
  ask = send;
  enabled = on;
  const box = document.getElementById('ranking-box');
  box.classList.toggle('hidden', !on);
  box.onclick = (e) => { if (e.target.closest('[data-rk-all]')) openRanking(); };
}

/** Fresh numbers - back in the start menu after a game, say. */
export function refreshRanking() {
  if (enabled) ask?.({ t: 'ranking' });
}

export function openRanking() {
  if (!modal) build();
  modal.querySelector('.rk-title').textContent = t('ranking.title');
  modal.querySelector('.rk-ok').textContent = t('nav.close');
  modal.classList.remove('hidden');
  if (last) renderDialog(last);
  else modal.querySelector('.rk-body').textContent = t('ranking.loading');
  refreshRanking();
}

/** The answer of the server: into the panel, and into the dialog if it is open. */
export function showRanking(m) {
  last = m;
  renderBox(m);
  if (modal && !modal.classList.contains('hidden')) renderDialog(m);
}

onLocaleChange(() => { if (last) showRanking(last); });

/** Name, and the handle where the server sent it along. */
function who(x) {
  return `<b>${esc(x.name)}</b>${x.handle ? ` <span class="rk-handle">#${esc(x.handle)}</span>` : ''}`;
}

function rowHtml(x) {
  return `<div class="fr-row rk-row${x.me ? ' me' : ''}">
      <span class="rk-rank${x.rank && x.rank <= 3 ? ' top' : ''}">${x.rank ?? '–'}</span>
      <span class="fr-avatar">${avatarHtml({ name: x.name, avatar: x.avatar }, 30)}</span>
      <span class="fr-who"><span class="rk-name">${who(x)}</span><small class="muted">${t('ranking.record', { count: x.games, n: x.games, wins: x.wins })}</small></span>
      <span class="rk-rating">${x.rating}</span>
    </div>`;
}

/** The pane in the friends panel: the top, and the own line below it. */
function renderBox(m) {
  const box = document.getElementById('ranking-box');
  const top = m.list.slice(0, TOP);
  let html = `<h3>${t('ranking.title')}</h3>`;
  if (!m.list.length) html += `<p class="muted small">${t('ranking.empty', { n: m.minGames })}</p>`;
  html += top.map(x => rowHtml(x)).join('');
  const mine = m.list.find(x => x.me);
  if (m.me && !top.some(x => x.me)) {
    if (top.length) html += '<div class="rk-gap">⋯</div>';
    html += rowHtml({ ...(mine || m.me), me: true });
  }
  if (m.me?.unlisted) html += `<p class="rk-me small">${t('ranking.hidden')}</p>`;
  else if (m.me && m.me.rank == null) {
    html += `<p class="rk-me small">${t('ranking.unranked', { rating: m.me.rating, games: m.me.games, left: m.minGames - m.me.games })}</p>`;
  }
  html += `<button type="button" class="tiny rk-all" data-rk-all>${t(m.list.length > TOP ? 'ranking.all' : 'ranking.about')}</button>`;
  box.innerHTML = html;
}

/** The whole list as a table. */
function renderDialog(m) {
  const body = modal.querySelector('.rk-body');
  if (!m.list.length) {
    body.innerHTML = `<p class="muted">${t('ranking.empty', { n: m.minGames })}</p>`;
  } else {
    body.innerHTML = `<table class="rk-table">
      <thead><tr>
        <th class="num">${t('ranking.rank')}</th><th>${t('ranking.player')}</th>
        <th class="num">${t('ranking.rating')}</th><th class="num">${t('ranking.games')}</th><th class="num">${t('ranking.wins')}</th>
      </tr></thead>
      <tbody>${m.list.map(x => `<tr${x.me ? ' class="me"' : ''}>
        <td class="num">${x.rank}</td>
        <td class="who"><span class="rk-cell">${avatarHtml({ name: x.name, avatar: x.avatar }, 26)}<span>${who(x)}</span></span></td>
        <td class="num">${x.rating}</td><td class="num">${x.games}</td><td class="num">${x.wins}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
  if (m.me?.unlisted || (m.me && m.me.rank == null)) {
    body.insertAdjacentHTML('beforeend', `<p class="rk-me">${m.me.unlisted ? t('ranking.hidden')
      : t('ranking.unranked', { rating: m.me.rating, games: m.me.games, left: m.minGames - m.me.games })}</p>`);
  }
  modal.querySelector('.rk-note').textContent = t('ranking.note', { n: m.minGames, turns: m.minTurns });
}
