// How numbers and names appear in the panels. Numbers follow the chosen
// language: 1.600 or 1,600.
import { localeTag, t } from '../../i18n.js';

export const fmt = n => Math.round(n).toLocaleString(localeTag());
export const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString(localeTag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** "3 worlds · 16.9 M · 5 ships" - every piece in its plural form. */
export function statsText(worlds, pop, ships) {
  return t('top.myStats', {
    worlds: t('word.worlds', { n: worlds, count: worlds }),
    pop: t('word.pop', { n: fmt1(pop) }),
    ships: t('word.ships', { n: ships, count: ships })
  });
}
