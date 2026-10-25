// Emojis on the comms. Classic smileys (:) :( :D ...) turn into emojis when
// they stand on their own - between spaces or at the start and end - so a
// link (https://) or a time (3:00) stays as it is. Short codes between colons
// (:sad:, :rocket:) work anywhere. The codes are English, as in most chat
// programs; the emojis themselves need no translation.

/** Classic smileys. */
export const SMILEYS = {
  ':)': '🙂', ':-)': '🙂', ':(': '🙁', ':-(': '🙁',
  ':D': '😄', ':-D': '😄', 'xD': '😆', 'XD': '😆',
  ';)': '😉', ';-)': '😉', ':P': '😛', ':p': '😛', ':-P': '😛', ':-p': '😛',
  ':O': '😮', ':o': '😮', ':-O': '😮', ":'(": '😢', ':|': '😐', ':-|': '😐',
  ':/': '😕', ':-/': '😕', ':*': '😘', ':-*': '😘', '^^': '😊',
  '<3': '❤️', '</3': '💔'
};

/** Short codes - the order is the order of the palette. */
export const CODES = {
  smile: '🙂', grin: '😄', laugh: '😆', joy: '😂', rofl: '🤣', wink: '😉', blush: '😊',
  cool: '😎', love: '😍', kiss: '😘', tongue: '😛', think: '🤔', neutral: '😐',
  confused: '😕', sad: '😢', cry: '😭', angry: '😠', rage: '😡', shock: '😱',
  surprised: '😮', sweat: '😅', sleep: '😴', angel: '😇', devil: '😈', clown: '🤡',
  party: '🥳', facepalm: '🤦', shrug: '🤷', eyes: '👀', skull: '💀',
  thumbsup: '👍', thumbsdown: '👎', clap: '👏', wave: '👋', pray: '🙏', muscle: '💪',
  ok: '👌', peace: '✌️', handshake: '🤝', heart: '❤️', broken: '💔',
  fire: '🔥', boom: '💥', star: '⭐', sparkles: '✨', tada: '🎉', trophy: '🏆', crown: '👑',
  rocket: '🚀', ufo: '🛸', alien: '👽', robot: '🤖', planet: '🪐', earth: '🌍',
  moon: '🌙', sun: '☀️', comet: '☄️', bomb: '💣', swords: '⚔️', shield: '🛡️',
  flag: '🏳️', money: '💰', gift: '🎁', beer: '🍺', coffee: '☕', popcorn: '🍿',
  check: '✅', x: '❌', warning: '⚠️', question: '❓', zzz: '💤', hundred: '💯'
};
// Aliases that are common elsewhere - not in the palette.
const ALIASES = { '+1': 'thumbsup', '-1': 'thumbsdown', '100': 'hundred', smiley: 'smile', heart_eyes: 'love', lol: 'laugh' };

const escape = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const alternation = Object.keys(SMILEYS).sort((a, b) => b.length - a.length).map(escape).join('|');
// Before: start or white space. After: white space, a punctuation mark or -
// except while typing - the end of the text.
const FINAL = new RegExp(`(^|\\s)(${alternation})(?=[\\s.,!?]|$)`, 'g');
const TYPING = new RegExp(`(^|\\s)(${alternation})(?=[\\s.,!?])`, 'g');
const CODE = /:([a-z0-9_+-]+):/gi;

/**
 * Turns smileys and short codes into emojis.
 * @param {string} text
 * @param {{typing?: boolean}} [o]  typing: the text is still being written -
 *   a smiley at the very end could still become something else (:Do...)
 */
export function emojify(text, o = {}) {
  return String(text ?? '')
    .replace(CODE, (whole, name) => {
      const key = name.toLowerCase();
      return CODES[key] || CODES[ALIASES[key]] || whole;
    })
    .replace(o.typing ? TYPING : FINAL, (whole, before, smiley) => before + SMILEYS[smiley]);
}
