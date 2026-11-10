// The research presets on this side (shared/presets.js): with an account
// they come from the server and every change goes back there - the other
// devices of the account get the new list too. Without an account the
// browser keeps them in localStorage.
import { cleanPresets } from '../shared/presets.js';

const KEY = 'ho-research-presets';
let list = [];
let send = null;            // null: no account, the browser keeps them
const listeners = new Set();

function local() {
  try { return cleanPresets(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; }
}

/** From the hello: the account's list, or null without an account. */
export function initPresets(fromServer, sendFn) {
  send = fromServer ? sendFn : null;
  list = fromServer ? cleanPresets(fromServer) : local();
  for (const fn of listeners) fn(list);
}

/** A new list from the server - changed on this or another device. */
export function presetsFromServer(presets) {
  list = cleanPresets(presets);
  for (const fn of listeners) fn(list);
}

export const getPresets = () => list;
export const onPresets = (fn) => listeners.add(fn);

/** Replace the whole list: saved right away, shown right away. */
export function setPresets(next) {
  list = cleanPresets(next);
  if (send) send({ t: 'presets', presets: list });
  else { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private window */ } }
  for (const fn of listeners) fn(list);
}

/** The preset that goes into every new game on its own, if any. */
export const autoPreset = () => list.find(p => p.auto) || null;
