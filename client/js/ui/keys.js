// Overview of keys and mouse in a game - opened with ?, from the menu or
// from the help. Built anew on every opening: what applies depends on the
// game (space view, CB radio, dev mode) and on the language.
import { t } from '../i18n.js';

let modal = null;
let context = () => ({});

/**
 * Rows by group. Each row: keys (catalog keys under keys.k.* or plain
 * characters), what it does (keys.do.*), and whether it applies right now.
 */
function rows(c) {
  return [
    ['map', [
      [['k.drag'], c.space ? 'do.rotate' : 'do.pan'],
      [['k.shiftDrag'], 'do.pan', c.space],
      [['k.wheel', '+', '−'], 'do.zoom'],
      [['F'], 'do.fit'],
      [['T'], 'do.top', c.space],
      [['E'], 'do.mine', !c.spectator]
    ]],
    ['fleets', [
      [['k.click'], 'do.select'],
      [['k.rightClick', 'k.shiftClick'], 'do.course', !c.spectator],
      [['S'], 'do.split', !c.spectator],
      [['Esc'], 'do.deselect']
    ]],
    ['turn', [
      [['k.space'], c.spectator ? 'do.pace' : 'do.endTurn'],
      [['P'], 'do.pause', !c.spectator]
    ]],
    ['more', [
      [['H'], 'do.help'],
      [['?'], 'do.keys'],
      [[c.voiceKey], 'do.talk', !!c.voiceKey],
      [['k.enter'], 'do.chat', !c.spectator],
      [['k.debug'], 'do.debug', !!c.dev]
    ]]
  ];
}

const kbd = (k) => `<kbd>${k.startsWith('k.') ? t('keys.' + k) : k}</kbd>`;

function render() {
  const c = context();
  modal.innerHTML = `<div class="modal-box keys-box">
    <h2>${t('keys.title')}</h2>
    <div class="keys-cols">${rows(c).map(([group, list]) => `
      <section>
        <h4>${t('keys.g.' + group)}</h4>
        <table class="keys-table">${list.filter(r => r[2] !== false).map(([keys, what]) => `
          <tr><th>${keys.map(kbd).join(' ')}</th><td>${t('keys.' + what)}</td></tr>`).join('')}
        </table>
      </section>`).join('')}
    </div>
    <div class="sel-actions" style="margin-top:16px">
      <button type="button" class="primary" data-close>${t('help.close')}</button>
    </div>
  </div>`;
}

/** What the overview needs to know about the game - asked on every opening. */
export function bindKeys(ctx) {
  context = ctx;
  // Capture phase: while the overview is open, keys only close it - the
  // space bar must not end the turn behind it.
  addEventListener('keydown', (e) => {
    if (!modal || modal.classList.contains('hidden')) return;
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape' || e.key === '?') toggleKeys(false);
  }, true);
}

export function toggleKeys(show) {
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'keys';
    modal.className = 'modal hidden';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close]')) toggleKeys(false);
    });
  }
  const open = show ?? modal.classList.contains('hidden');
  if (open) render();
  modal.classList.toggle('hidden', !open);
}
