// Sliders: the track fills up to the thumb. The stylesheet draws the filled
// part from a custom property (--p, the position in percent) - a native
// range input cannot tell CSS where its thumb is, so this module does.
//
// It follows every slider on the page, whenever it appears: moved by hand
// (input event), set from code (the value setter is wrapped per element,
// because assigning .value fires no event) or given new limits.

const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

function paint(el) {
  const min = +el.min || 0, max = el.max === '' ? 100 : +el.max;
  const p = max > min ? (desc.get.call(el) - min) / (max - min) * 100 : 0;
  el.style.setProperty('--p', Math.max(0, Math.min(100, p)).toFixed(2) + '%');
}

function adopt(el) {
  if (el._filled) { paint(el); return; }
  el._filled = true;
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); paint(this); }
  });
  paint(el);
}

const sliders = root => root.querySelectorAll?.('input[type=range]') || [];

/** Start following the sliders of this page; call once. */
export function fillSliders() {
  for (const el of sliders(document)) adopt(el);
  document.addEventListener('input', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'range') adopt(e.target);
  }, true);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'attributes') { if (m.target.type === 'range') adopt(m.target); continue; }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches?.('input[type=range]')) adopt(n);
        for (const el of sliders(n)) adopt(el);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['min', 'max', 'value'] });
}
