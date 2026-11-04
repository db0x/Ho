// Who a fleet belongs to: an empire of the game - or the aliens, who are no
// empire and have no place in the list of players, but still need a name
// and a color wherever a fleet or a battle shows its owner.
import { ALIEN_ID, ALIEN_COLOR } from '../../shared/rules.js';
import { t } from './i18n.js';

/** The empire with this id, the aliens, or null. */
export function ownerOf(view, id) {
  if (id === ALIEN_ID) return { id, name: t('alien.name'), color: ALIEN_COLOR, alien: true };
  return view?.players?.find(p => p.id === id) || null;
}

/** Color of an owner - grey if it is unknown. */
export function ownerColor(view, id, fallback = '#889') {
  return ownerOf(view, id)?.color || fallback;
}
