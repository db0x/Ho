// "Quick Game": a custom turn limit below the presets (20-99), picked
// through a small dialog instead of the dropdown. The dropdown option itself
// never changes - only the "remember" checkbox decides whether the number
// pre-fills this dialog's field again next time. Cancelling (Escape, the
// backdrop or the cancel button) leaves the previous choice untouched - the
// caller decides what that means (usually: fall back to the previous
// selection in the dropdown).
import { t } from '../i18n.js';
import { loadQuickTurns, saveQuickTurns, clearQuickTurns } from '../net.js';

const $ = selector => document.querySelector(selector);
export const MINIMUM_TURNS = 20, MAXIMUM_TURNS = 99, DEFAULT_TURNS = 50;

let onPick = null, onCancel = null;

/**
 * @param {(n: number) => void} pick     called with the chosen round count
 * @param {() => void} [cancel]          called when the dialog is dismissed without a pick
 */
export function openQuickTurns(pick, cancel) {
  onPick = pick;
  onCancel = cancel || null;
  const modal = $('#quickturns');
  if (!modal) return;
  const remembered = loadQuickTurns();
  $('#quickturns-turns').value = String(remembered || DEFAULT_TURNS);
  $('#quickturns-remember').checked = !!remembered;
  $('#quickturns-error').textContent = '';
  modal.classList.remove('hidden');
  $('#quickturns-turns').focus();
  $('#quickturns-turns').select();
}

function close(cancelled) {
  $('#quickturns')?.classList.add('hidden');
  const cancel = onCancel;
  onPick = onCancel = null;
  if (cancelled) cancel?.();
}

export function bindQuickTurns() {
  const modal = $('#quickturns');
  if (!modal) return;
  modal.addEventListener('click', (event) => { if (event.target === modal) close(true); });
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) { event.stopPropagation(); close(true); }
  }, true);
  // The value is always meant to be replaced, not edited in place - so every
  // click selects it all, not just the focus that opens the dialog.
  const input = $('#quickturns-turns');
  input.addEventListener('focus', () => input.select());
  input.addEventListener('mouseup', (event) => { event.preventDefault(); input.select(); });
  $('#quickturns-cancel').onclick = () => close(true);
  $('#quickturns-form').onsubmit = (event) => {
    event.preventDefault();
    const turns = Math.round(Number($('#quickturns-turns').value));
    if (!Number.isFinite(turns) || turns < MINIMUM_TURNS || turns > MAXIMUM_TURNS) {
      $('#quickturns-error').textContent = t('lobby.quickGameRange', { min: MINIMUM_TURNS, max: MAXIMUM_TURNS });
      $('#quickturns-turns').focus();
      return;
    }
    if ($('#quickturns-remember').checked) saveQuickTurns(turns); else clearQuickTurns();
    const pick = onPick;
    modal.classList.add('hidden');
    onPick = onCancel = null;
    pick?.(turns);
  };
}
