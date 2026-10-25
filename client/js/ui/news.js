// Change notes: what is new, as a few bullet points per release. Shown once
// per player after signing in at a new release (first or second place of the
// version changed) - whoever skipped releases gets all of them since their
// last visit, newest first. The start menu opens the current one again.
// The points live apart from the game's catalogs, one file per release:
// client/news/<release>.json = { "de": [...], "en": [...] }. Shown in the
// player's language, otherwise in English.
import { t, getLocale, FALLBACK } from '../../shared/i18n.js';
import { releaseOf, dueReleases } from '../../shared/version.js';

const SEEN_KEY = 'ho-news';      // without an account the browser remembers it

let modal = null;
const files = new Map();         // release -> promise of its file (null: none)

function load(release) {
  if (!files.has(release)) {
    files.set(release, fetch(`news/${release}.json`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return files.get(release);
}

/** The points of a release in the current language - empty without a file. */
async function points(release) {
  const file = await load(release);
  if (!file) return [];
  const items = file[getLocale()] || file[FALLBACK] || [];
  return Array.isArray(items) ? items : [];
}

/** Are there change notes for this version at all? */
export async function hasNews(version) {
  return (await points(releaseOf(version))).length > 0;
}

function build() {
  modal = document.createElement('div');
  modal.id = 'news';
  modal.className = 'modal hidden';
  modal.innerHTML = `<div class="modal-box narrow news-box" role="dialog" aria-modal="true">
    <h2 class="nw-title"></h2>
    <div class="nw-body"></div>
    <button type="button" class="primary nw-ok"></button>
  </div>`;
  document.body.appendChild(modal);
  const close = () => modal.classList.add('hidden');
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('.nw-ok').onclick = close;
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) { e.stopPropagation(); close(); }
  }, true);
}

/**
 * Opens the notes of these releases, newest first.
 * @param {string[]} releases
 * @param {string|null} since  the last release seen - names the dialog when several are due
 */
export async function openNews(releases, since = null) {
  const sections = [];
  for (const release of releases) {
    const items = await points(release);
    if (items.length) sections.push({ release, items });
  }
  if (!sections.length) return;
  if (!modal) build();
  const several = sections.length > 1;
  modal.querySelector('.nw-title').textContent = several && since
    ? t('news.titleSince', { release: since })
    : t('news.title', { release: sections[0].release });
  const body = modal.querySelector('.nw-body');
  body.innerHTML = '';
  for (const s of sections) {
    if (several) {
      const h = document.createElement('h3');
      h.className = 'nw-release';
      h.textContent = t('news.version', { release: s.release });
      body.appendChild(h);
    }
    const list = document.createElement('ul');
    list.className = 'nw-list';
    for (const text of s.items) {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    }
    body.appendChild(list);
  }
  modal.querySelector('.nw-ok').textContent = t('news.ok');
  modal.classList.remove('hidden');
  modal.querySelector('.nw-ok').focus({ preventScroll: true });
}

/**
 * After 'hello': show what this player has not seen yet. With an account the
 * server knows (newsSeen), otherwise the browser. Marked as seen right away -
 * once means once, even with a second tab open.
 * @param {{version: string, releases?: string[], newsSeen?: string|null}} hello
 * @param {(msg: object) => void} send
 */
export async function newsOnHello(hello, send) {
  const current = releaseOf(hello.version);
  const byAccount = hello.newsSeen !== undefined;
  let seen = hello.newsSeen;
  if (!byAccount) { try { seen = localStorage.getItem(SEEN_KEY); } catch { seen = current; } }
  const due = dueReleases(hello.releases || [], current, seen);
  if (!due.length) return;
  if (byAccount) send({ t: 'newsSeen' });
  else { try { localStorage.setItem(SEEN_KEY, current); } catch {} }
  openNews(due, seen);
}
