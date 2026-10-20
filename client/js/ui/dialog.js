// Verschiebbare Fenster: das Protokoll und das Dock oben links. Bewusst
// allgemein gehalten: Leiste zum Ziehen, Griff unten rechts zum Aufziehen, Lage und
// Groesse ueberdauern als localStorage-Eintrag den naechsten Start.

import { klein } from './viewport.js';

const TOP = 64;          // unter der Topbar bleiben
const RAND = 8;          // Mindestabstand zum Bildschirmrand
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Reihenfolge der Fenster von hinten nach vorn. Die z-Werte bleiben in einem
// festen Band (ab UNTEN) - ein Zaehler, der bei jedem Klick waechst, schob ein
// Fenster sonst irgendwann ueber die Kopfleiste samt Haushalt und zuletzt
// sogar ueber die Rueckfragen (.modal).
const stapel = [];
const UNTEN = 5;

function nachVorn(el) {
  stapel.splice(stapel.indexOf(el), 1);
  stapel.push(el);
  stapel.forEach((w, i) => { w.style.zIndex = String(UNTEN + i); });
}

/**
 * @param {HTMLElement} el     das Fenster selbst
 * @param {object} o           { handle, grip, key, x, y, w, h, minW, minH }
 *   x/y: Startlage ohne gemerkte Geometrie; ohne y sitzt das Fenster unten
 * @returns {{refresh: () => void}}
 */
export function makeDialog(el, o) {
  const schmal = klein;
  const minW = o.minW || 320, minH = o.minH || 150;
  const geo = Object.assign({ x: o.x ?? 12, y: o.y ?? null, w: o.w || 460, h: o.h || 240 }, load(o.key));
  // Auf kleinen Geraeten ist das Fenster ein Blatt: Lage und Groesse macht
  // dort das Stylesheet, nicht dieses Modul. Die gemerkte Geometrie bleibt
  // erhalten und gilt wieder, sobald wieder Platz ist.

  function apply() {
    if (schmal.matches) {
      for (const eig of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
        el.style.removeProperty(eig);
      }
      return;
    }
    const zu = el.classList.contains('collapsed');
    geo.w = clamp(geo.w, minW, Math.max(minW, innerWidth - 2 * RAND));
    geo.h = clamp(geo.h, minH, Math.max(minH, innerHeight - TOP - RAND));
    // Ohne gespeicherte Lage und ohne Vorgabe unten links starten, wo das
    // Protokoll immer sass.
    if (geo.y == null) geo.y = innerHeight - geo.h - 12;
    geo.x = clamp(geo.x, RAND, Math.max(RAND, innerWidth - geo.w - RAND));
    // Eingeklappt ist nur die Leiste da - dann darf das Fenster tiefer stehen.
    const hoch = zu ? (el.offsetHeight || 44) : geo.h;
    geo.y = clamp(geo.y, TOP, Math.max(TOP, innerHeight - hoch - RAND));
    el.style.left = geo.x + 'px';
    el.style.top = geo.y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.width = geo.w + 'px';
    el.style.height = zu ? '' : geo.h + 'px';
  }

  // Ziehen und Aufziehen laufen gleich ab, nur die Zuordnung unterscheidet sich.
  function fassen(ziel, feld) {
    if (!ziel) return;
    ziel.addEventListener('pointerdown', (e) => {
      if (schmal.matches) return;          // Blatt: nichts zu schieben
      if (e.button !== 0 || e.target.closest('button, input')) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      const s = { x: geo.x, y: geo.y, w: geo.w, h: geo.h };
      ziel.setPointerCapture(e.pointerId);
      el.classList.add('dlg-busy');
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (feld === 'move') { geo.x = s.x + dx; geo.y = s.y + dy; }
        else { geo.w = s.w + dx; geo.h = s.h + dy; }
        apply();
      };
      const up = () => {
        ziel.removeEventListener('pointermove', move);
        ziel.removeEventListener('pointerup', up);
        ziel.removeEventListener('pointercancel', up);
        el.classList.remove('dlg-busy');
        save(o.key, geo);
      };
      ziel.addEventListener('pointermove', move);
      ziel.addEventListener('pointerup', up);
      ziel.addEventListener('pointercancel', up);
    });
  }

  // Wer angefasst wird, kommt nach vorn - sonst verschwände ein Fenster, das
  // man über ein anderes zieht, darunter.
  // Auf dem Telefon sind es Blaetter mit eigener Ordnung (CSS) - dort nichts setzen.
  stapel.push(el);
  el.addEventListener('pointerdown', () => {
    if (schmal.matches) el.style.zIndex = '';
    else nachVorn(el);
  }, true);

  fassen(o.handle, 'move');
  fassen(o.grip, 'size');
  addEventListener('resize', apply);
  schmal.addEventListener('change', apply);
  apply();
  return { refresh: apply };
}

function load(key) {
  try {
    const g = JSON.parse(localStorage.getItem(key) || 'null');
    return g && typeof g.w === 'number' ? g : null;
  } catch { return null; }
}

function save(key, geo) {
  try { localStorage.setItem(key, JSON.stringify(geo)); } catch {}
}
