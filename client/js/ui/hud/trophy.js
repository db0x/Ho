// Kill marks for alien carriers shot down (server/spoils.js): beside the
// name of a destroyer that did it, and beside the name of its empire in the
// ranking - for everyone to see. One alien carrier per kill, the number
// beyond TROPHY_MARKS.
import { ALIEN_COLOR } from '../../../shared/rules.js';
import { t } from '../../i18n.js';
import { shipIcon } from '../../render/ships.js';
import { escapeHtml } from './format.js';

const TROPHY_MARKS = 3;

/** The place for the marks - filled in by fillTrophies once the HTML is in the page. */
export function trophyHtml(n, key = 'fleet.trophies') {
  return n > 0 ? `<span class="trophy" data-n="${n}" title="${escapeHtml(t(key, { n }))}"></span>` : '';
}

export function fillTrophies(box) {
  for (const el of box.querySelectorAll('.trophy[data-n]')) {
    if (el.childNodes.length) continue;
    const n = +el.dataset.n;
    for (let i = 0; i < Math.min(n, TROPHY_MARKS); i++) el.appendChild(shipIcon('alienCarrier', 20, ALIEN_COLOR));
    if (n > TROPHY_MARKS) el.append('×' + n);
  }
}
