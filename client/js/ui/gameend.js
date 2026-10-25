// When a game ends: ask whether to keep playing. Three steps in one dialog -
// "ask" (weiterspielen?), the turn-count form ("ja"), and "leave" (either
// back to the start screen, or just closing the dialog). Closing it any other
// way - Escape, the backdrop, or either step's own cancel button - counts as
// the same "never mind" as the "leave" step's cancel: the caller (main.js)
// then shows "Weiter" instead of the disabled end-turn button, which reopens
// this dialog at the first step.
import { t } from '../i18n.js';

const $ = selector => document.querySelector(selector);
const MINIMUM_TURNS = 1, MAXIMUM_TURNS = 500, DEFAULT_TURNS = 50;

let onContinue = null, onLeave = null, onDismiss = null;

function steps(name) {
  for (const [id, step] of [['gameend-ask', 'ask'], ['gameend-turns-form', 'turns'], ['gameend-leave', 'leave']]) {
    $(`#${id}`).classList.toggle('hidden', step !== name);
  }
}

/**
 * @param {string} winnerText    "{player} herrscht ..." or the no-winner text
 * @param {boolean} isHost       only the host may extend the game - others
 *   only get the option to leave or to dismiss the dialog
 * @param {(turns: number) => void} continueCallback   called with the chosen round count
 * @param {() => void} leaveCallback                   called to actually go back to the start screen
 * @param {() => void} dismissCallback                 called on every other way out
 */
export function openGameEnd(winnerText, isHost, continueCallback, leaveCallback, dismissCallback) {
  onContinue = continueCallback; onLeave = leaveCallback; onDismiss = dismissCallback;
  $('#gameend-winner').textContent = winnerText;
  steps(isHost ? 'ask' : 'leave');
  $('#gameend').classList.remove('hidden');
}

function close(dismissed) {
  $('#gameend')?.classList.add('hidden');
  const dismissCallback = onDismiss;
  onContinue = onLeave = onDismiss = null;
  if (dismissed) dismissCallback?.();
}

export function bindGameEnd() {
  const modal = $('#gameend');
  if (!modal) return;
  modal.addEventListener('click', (event) => { if (event.target === modal) close(true); });
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) { event.stopPropagation(); close(true); }
  }, true);

  $('#gameend-yes').onclick = () => {
    $('#gameend-turns').value = String(DEFAULT_TURNS);
    $('#gameend-turns-error').textContent = '';
    steps('turns');
    $('#gameend-turns').focus();
    $('#gameend-turns').select();
  };
  $('#gameend-no').onclick = () => steps('leave');

  const input = $('#gameend-turns');
  input.addEventListener('focus', () => input.select());
  input.addEventListener('mouseup', (event) => { event.preventDefault(); input.select(); });
  $('#gameend-turns-cancel').onclick = () => close(true);
  $('#gameend-turns-form').onsubmit = (event) => {
    event.preventDefault();
    const turns = Math.round(Number(input.value));
    if (!Number.isFinite(turns) || turns < MINIMUM_TURNS || turns > MAXIMUM_TURNS) {
      $('#gameend-turns-error').textContent = t('lobby.quickGameRange', { min: MINIMUM_TURNS, max: MAXIMUM_TURNS });
      input.focus();
      return;
    }
    const continueCallback = onContinue;
    modal.classList.add('hidden');
    onContinue = onLeave = onDismiss = null;
    continueCallback?.(turns);
  };

  $('#gameend-leave-cancel').onclick = () => close(true);
  $('#gameend-leave-yes').onclick = () => {
    const leaveCallback = onLeave;
    modal.classList.add('hidden');
    onContinue = onLeave = onDismiss = null;
    leaveCallback?.();
  };
}
