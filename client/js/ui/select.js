// Eigene Auswahlliste.
//
// Das aufgeklappte Menü eines <select> zeichnet das Betriebssystem - daran
// kommt kein CSS. Deshalb bleibt das <select> als Zustandsträger bestehen
// (value, change, disabled funktionieren unverändert), wird nur unsichtbar
// gemacht, und darüber liegt eine eigene Liste im Stil der Oberfläche.
// Ohne JavaScript bliebe das native Feld sichtbar und bedienbar.

const offene = new Set();

/** Rüstet alle noch nicht umgebauten Auswahlfelder um. */
export function enhanceSelects(root = document) {
  for (const sel of root.querySelectorAll('select:not([data-ui])')) baue(sel);
  if (enhanceSelects._bereit) return;
  enhanceSelects._bereit = true;
  addEventListener('pointerdown', (e) => {
    for (const w of [...offene]) if (!w.contains(e.target)) zu(w);
  }, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') for (const w of [...offene]) zu(w);
  });
}

/** Knopfbeschriftung und Sperre an den Stand des <select> angleichen. */
export function syncSelects(root = document) {
  for (const w of root.querySelectorAll('.sel')) { relabel(w); sync(w); }
}

/**
 * Die eigene Liste zeigt Kopien der Optionstexte. Nach einem Sprachwechsel
 * stehen im <select> neue Texte - die Kopien werden hier nachgezogen.
 */
function relabel(wrap) {
  const sel = wrap.querySelector('select');
  const opts = [...sel.options];
  for (const o of wrap.querySelectorAll('.sel-opt')) {
    const passend = opts.find(x => x.value === o.dataset.value);
    if (passend) o.textContent = passend.textContent;
  }
}

function baue(sel) {
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

  const liste = document.createElement('div');
  liste.className = 'sel-list';
  liste.setAttribute('role', 'listbox');
  wrap.appendChild(liste);

  for (const opt of sel.options) {
    const o = document.createElement('div');
    o.className = 'sel-opt';
    o.setAttribute('role', 'option');
    o.textContent = opt.textContent;
    o.dataset.value = opt.value;
    o.onclick = () => {
      if (sel.disabled) return;
      waehle(wrap, opt.value);
      zu(wrap);
      btn.focus();
    };
    liste.appendChild(o);
  }

  btn.onclick = () => (wrap.classList.contains('auf') ? zu(wrap) : auf(wrap));
  btn.onkeydown = (e) => {
    const opts = [...sel.options];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = opts.findIndex(o => o.value === sel.value);
      const n = Math.max(0, Math.min(opts.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (n !== i) waehle(wrap, opts[n].value);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      wrap.classList.contains('auf') ? zu(wrap) : auf(wrap);
    }
  };
  sync(wrap);
}

function waehle(wrap, wert) {
  const sel = wrap.querySelector('select');
  if (sel.value === wert) return;
  sel.value = wert;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  sync(wrap);
}

function auf(wrap) {
  const sel = wrap.querySelector('select');
  if (sel.disabled) return;
  for (const w of [...offene]) if (w !== wrap) zu(w);
  wrap.classList.add('auf');
  wrap.querySelector('.sel-btn').setAttribute('aria-expanded', 'true');
  offene.add(wrap);
  platziere(wrap);
  wrap.querySelector('.sel-opt[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

const ABSTAND = 5, RAND = 8, MAX_HOEHE = 260;

/**
 * Was vom Feld aus nach oben und unten sichtbar ist: das Fenster, enger
 * gefasst von jedem Vorfahren, der Ueberstehendes abschneidet (Docks,
 * scrollende Panels). Dort wuerde die Liste sonst im Nichts verschwinden.
 */
function sichtbar(el) {
  let oben = 0, unten = innerHeight;
  for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
    const st = getComputedStyle(e);
    if (/(hidden|auto|scroll|clip)/.test(st.overflowY)) {
      const r = e.getBoundingClientRect();
      oben = Math.max(oben, r.top); unten = Math.min(unten, r.bottom);
    }
  }
  return { oben, unten };
}

/** Nach unten, wenn es dort passt, sonst dorthin, wo mehr Platz ist - und nie hoeher als der Platz. */
function platziere(wrap) {
  const liste = wrap.querySelector('.sel-list');
  liste.style.maxHeight = '';
  wrap.classList.remove('hoch');
  const r = wrap.getBoundingClientRect();
  const { oben, unten } = sichtbar(wrap);
  const darunter = unten - r.bottom - ABSTAND - RAND;
  const darueber = r.top - oben - ABSTAND - RAND;
  const braucht = Math.min(MAX_HOEHE, liste.scrollHeight);
  const hoch = darunter < braucht && darueber > darunter;
  wrap.classList.toggle('hoch', hoch);
  liste.style.maxHeight = Math.max(72, Math.min(MAX_HOEHE, hoch ? darueber : darunter)) + 'px';
}

// Aendert sich der Platz (Fenstergroesse, Scrollen), neu einpassen.
addEventListener('resize', () => { for (const w of offene) platziere(w); });
addEventListener('scroll', (e) => {
  // Scrollen in der Liste selbst aendert ihren Platz nicht.
  if (e.target?.classList?.contains('sel-list')) return;
  for (const w of offene) platziere(w);
}, true);

function zu(wrap) {
  wrap.classList.remove('auf');
  wrap.querySelector('.sel-btn').setAttribute('aria-expanded', 'false');
  offene.delete(wrap);
}

function sync(wrap) {
  const sel = wrap.querySelector('select');
  const btn = wrap.querySelector('.sel-btn');
  btn.textContent = sel.options[sel.selectedIndex]?.textContent ?? '';
  btn.disabled = sel.disabled;
  if (sel.disabled) zu(wrap);
  for (const o of wrap.querySelectorAll('.sel-opt')) {
    o.setAttribute('aria-selected', String(o.dataset.value === sel.value));
  }
}
