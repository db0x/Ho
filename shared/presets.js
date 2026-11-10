// Research presets: a name, the share of the treasury and the weights per
// field - set up once, applied with a tap, one of them on its own at the
// start of every game. With sign-in they belong to the account (users.json,
// the same on every device), without it to the browser. Server and client
// clean them up with the same rules.
import { TECH_FIELDS } from './rules.js';

export const PRESET_MAX = 8;
export const PRESET_NAME_MAX = 24;

const int = (v, lo, hi, dflt) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt;

/** One preset as it may be stored, or null if there is nothing usable in it. */
export function cleanPreset(p) {
  if (!p || typeof p !== 'object') return null;
  // Plain text only: it ends up in the client via innerHTML.
  const name = String(p.name ?? '').replace(/[\u0000-\u001f\u007f<>&"\\]/g, '').replace(/\s+/g, ' ').trim()
    .slice(0, PRESET_NAME_MAX).trim();
  if (!name) return null;
  const weights = {};
  for (const f of TECH_FIELDS) weights[f] = int(p.weights?.[f], 0, 10, 0);
  return {
    id: typeof p.id === 'string' && /^[a-z0-9]{1,12}$/.test(p.id) ? p.id : Math.random().toString(36).slice(2, 10),
    name,
    budgetPct: Math.round(int(p.budgetPct, 0, 100, 0) / 5) * 5,
    weights,
    ...(p.auto ? { auto: true } : {})
  };
}

/** A whole list: at most PRESET_MAX, unique ids, at most one applied at the start. */
export function cleanPresets(list) {
  const out = [];
  const ids = new Set();
  let auto = false;
  for (const raw of Array.isArray(list) ? list : []) {
    const p = cleanPreset(raw);
    if (!p || ids.has(p.id)) continue;
    if (p.auto) { if (auto) delete p.auto; auto = true; }
    ids.add(p.id);
    out.push(p);
    if (out.length >= PRESET_MAX) break;
  }
  return out;
}

/** Do the current research settings match this preset exactly? */
export function presetMatches(p, research) {
  return p.budgetPct === research.budgetPct && TECH_FIELDS.every(f => p.weights[f] === research.weights[f]);
}
