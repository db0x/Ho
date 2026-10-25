// Emojis in the comms input: smileys and short codes turn into emojis while
// typing (shared/emoji.js), and a small palette next to the field shows what
// there is - a tap inserts the emoji, hovering names its short code.
import { emojify, CODES } from '../../shared/emoji.js';
import { t } from '../i18n.js';

/**
 * @param {HTMLInputElement} input
 * @param {HTMLButtonElement} button  opens and closes the palette
 */
export function bindEmoji(input, button) {
  // While typing: everything before the cursor that is complete.
  input.addEventListener('input', () => {
    const pos = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, pos);
    const done = emojify(before, { typing: true });
    if (done === before) return;
    input.value = done + input.value.slice(pos);
    input.setSelectionRange(done.length, done.length);
  });

  const palette = document.createElement('div');
  palette.className = 'emoji-palette hidden';
  palette.setAttribute('role', 'listbox');
  for (const [code, emoji] of Object.entries(CODES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = emoji;
    b.title = `:${code}:`;
    // Keep the focus (and the cursor) in the input field.
    b.onpointerdown = (e) => e.preventDefault();
    b.onclick = () => insert(input, emoji);
    palette.appendChild(b);
  }
  // On the page itself, not in the log window - that one cuts off whatever
  // reaches beyond its edge. Placed above the button, kept on screen.
  document.body.appendChild(palette);
  const place = () => {
    const r = button.getBoundingClientRect();
    palette.style.left = '0px'; palette.style.top = '0px';
    const w = palette.offsetWidth, h = palette.offsetHeight;
    palette.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
    palette.style.top = (r.top - h - 6 >= 8 ? r.top - h - 6 : Math.min(r.bottom + 6, innerHeight - h - 8)) + 'px';
  };
  button.onpointerdown = (e) => e.preventDefault();
  button.onclick = () => {
    palette.classList.toggle('hidden');
    if (!palette.classList.contains('hidden')) place();
  };
  addEventListener('resize', () => palette.classList.add('hidden'));
  const label = () => { button.title = t('chat.emoji'); button.setAttribute('aria-label', t('chat.emoji')); };
  label();
  addEventListener('pointerdown', (e) => {
    if (!palette.contains(e.target) && e.target !== button) palette.classList.add('hidden');
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') palette.classList.add('hidden'); });
  return { relabel: label };
}

function insert(input, emoji) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const text = input.value.slice(0, start) + emoji + input.value.slice(end);
  if (text.length > input.maxLength && input.maxLength > 0) return;
  input.value = text;
  const pos = start + emoji.length;
  input.setSelectionRange(pos, pos);
  input.focus();
}
