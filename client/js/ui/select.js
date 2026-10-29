// Custom select list.
//
// The dropdown menu of a <select> is drawn by the operating system - CSS cannot
// reach it. That is why the <select> stays as the holder of state (value,
// change, disabled work unchanged), is only made invisible, and a custom list
// in the style of the UI sits on top of it.
// Without JavaScript the native field would stay visible and usable.

const openLists = new Set();

/** Converts all select fields that have not been converted yet. */
export function enhanceSelects(root = document) {
  for (const sel of root.querySelectorAll('select:not([data-ui])')) build(sel);
  if (enhanceSelects._ready) return;
  enhanceSelects._ready = true;
  addEventListener('pointerdown', (e) => {
    for (const w of [...openLists]) if (!w.contains(e.target)) close(w);
  }, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') for (const w of [...openLists]) close(w);
  });
}

/** Bring the button label and the disabled state in line with the <select>. */
export function syncSelects(root = document) {
  for (const w of root.querySelectorAll('.sel')) { relabel(w); sync(w); }
}

/**
 * The custom list shows copies of the option texts. After a language change
 * the <select> holds new texts - the copies are updated here.
 */
function relabel(wrap) {
  const sel = wrap.querySelector('select');
  const opts = [...sel.options];
  for (const o of wrap.querySelectorAll('.sel-opt')) {
    const match = opts.find(x => x.value === o.dataset.value);
    if (match) o.textContent = match.textContent;
  }
}

function build(sel) {
  sel.dataset.ui = '1';
  const wrap = document.createElement('div');
  wrap.className = 'sel';
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sel-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  wrap.appendChild(btn);

  const list = document.createElement('div');
  list.className = 'sel-list';
  list.setAttribute('role', 'listbox');
  wrap.appendChild(list);

  for (const opt of sel.options) {
    const o = document.createElement('div');
    o.className = 'sel-opt';
    o.setAttribute('role', 'option');
    o.textContent = opt.textContent;
    o.dataset.value = opt.value;
    o.onclick = () => {
      if (sel.disabled) return;
      choose(wrap, opt.value);
      close(wrap);
      btn.focus();
    };
    list.appendChild(o);
  }

  btn.onclick = () => (wrap.classList.contains('open') ? close(wrap) : open(wrap));
  btn.onkeydown = (e) => {
    const opts = [...sel.options];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = opts.findIndex(o => o.value === sel.value);
      const n = Math.max(0, Math.min(opts.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (n !== i) choose(wrap, opts[n].value);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      wrap.classList.contains('open') ? close(wrap) : open(wrap);
    }
  };
  sync(wrap);
}

function choose(wrap, value) {
  const sel = wrap.querySelector('select');
  if (sel.value === value) return;
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  sync(wrap);
}

function open(wrap) {
  const sel = wrap.querySelector('select');
  if (sel.disabled) return;
  for (const w of [...openLists]) if (w !== wrap) close(w);
  wrap.classList.add('open');
  wrap.querySelector('.sel-btn').setAttribute('aria-expanded', 'true');
  openLists.add(wrap);
  place(wrap);
  wrap.querySelector('.sel-opt[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

const GAP = 5, MARGIN = 8, MAX_HEIGHT = 260;

/**
 * What is visible upwards and downwards from the field: the window, narrowed
 * by every ancestor that clips overflowing content (docks, scrolling panels).
 * Otherwise the list would disappear into nothing there.
 */
function visibleRange(el) {
  let top = 0, bottom = innerHeight;
  for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
    const st = getComputedStyle(e);
    if (/(hidden|auto|scroll|clip)/.test(st.overflowY)) {
      const r = e.getBoundingClientRect();
      top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom);
    }
  }
  return { top, bottom };
}

/** Downwards if it fits there, otherwise where there is more room - and never taller than the room. */
function place(wrap) {
  const list = wrap.querySelector('.sel-list');
  list.style.maxHeight = '';
  wrap.classList.remove('above');
  const r = wrap.getBoundingClientRect();
  const { top, bottom } = visibleRange(wrap);
  const below = bottom - r.bottom - GAP - MARGIN;
  const aboveRoom = r.top - top - GAP - MARGIN;
  const needed = Math.min(MAX_HEIGHT, list.scrollHeight);
  const above = below < needed && aboveRoom > below;
  wrap.classList.toggle('above', above);
  wrap.classList.toggle('end', r.left + list.offsetWidth > innerWidth - MARGIN);
  list.style.maxHeight = Math.max(72, Math.min(MAX_HEIGHT, above ? aboveRoom : below)) + 'px';
}

// When the room changes (window size, scrolling), fit it again.
addEventListener('resize', () => { for (const w of openLists) place(w); });
addEventListener('scroll', (e) => {
  // Scrolling inside the list itself does not change its room.
  if (e.target?.classList?.contains('sel-list')) return;
  for (const w of openLists) place(w);
}, true);

function close(wrap) {
  wrap.classList.remove('open');
  wrap.querySelector('.sel-btn').setAttribute('aria-expanded', 'false');
  openLists.delete(wrap);
}

function sync(wrap) {
  const sel = wrap.querySelector('select');
  const btn = wrap.querySelector('.sel-btn');
  btn.textContent = sel.options[sel.selectedIndex]?.textContent ?? '';
  btn.disabled = sel.disabled;
  if (sel.disabled) close(wrap);
  for (const o of wrap.querySelectorAll('.sel-opt')) {
    o.setAttribute('aria-selected', String(o.dataset.value === sel.value));
  }
}
