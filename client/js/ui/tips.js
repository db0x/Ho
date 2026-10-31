// Tooltips in the game's own look instead of the browser's. Every element
// with a title keeps working as before - wherever the title comes from
// (markup, i18n, set in code) - but on hover the title moves into a data
// attribute, so the system tooltip stays away, and our box shows the text.
// Icon-only buttons keep their accessible name through aria-label.
// Only for a mouse: on touch screens there is no hover, and a long press
// belongs to the game.

const DELAY = 350;               // like the system tooltip, a short moment

let tip = null, timer = 0, target = null;

export function bindTips() {
  tip = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'hovertip simple', role: 'tooltip' }));
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    // Inside a [data-tip] the panel's own rich tooltip speaks - and the
    // plain one of an element around it (a row's title) has to go.
    if (e.target.closest?.('[data-tip]')) return hide();
    const el = e.target.closest?.('[title], [data-title]');
    if (!el || el === target) return;
    adopt(el);
    hide();
    target = el;
    timer = setTimeout(() => show(el), DELAY);
  });
  document.addEventListener('pointerout', (e) => {
    if (!target || (e.relatedTarget && target.contains(e.relatedTarget))) return;
    hide();
  });
  // A click, a key or a scroll ends the hint - like the system tooltip.
  for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, hide, { capture: true, passive: true });
  // Code that sets a new title while the mouse rests on the element (the
  // microphone button changes it with the channel): take it over at once,
  // otherwise the system tooltip would come back after all.
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.target !== target || !target.hasAttribute('title')) continue;
      adopt(target);
      if (tip.classList.contains('on')) tip.textContent = target.dataset.title;
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['title'] });
}

/** Takes over a (possibly new) title from the element. */
function adopt(el) {
  const title = el.getAttribute('title');
  if (title == null) return;
  el.dataset.title = title;
  el.removeAttribute('title');
  if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', title);
}

function show(el) {
  adopt(el);                                   // the text may have changed meanwhile
  const text = el.dataset.title;
  if (!text || !el.isConnected) return;
  tip.textContent = text;
  tip.classList.add('on');
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  // Below the element, centered; above it if there is no room. Never off screen.
  let y = r.bottom + 8;
  if (y + h > innerHeight - 8) y = r.top - h - 8;
  const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  tip.style.left = x + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}

function hide() {
  clearTimeout(timer);
  target = null;
  tip?.classList.remove('on');
}
