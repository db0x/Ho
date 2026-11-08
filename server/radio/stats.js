// How often each radio line went out to a player - for the admins' overview
// (Admin panel → speech service → lines). Counted when a line is delivered,
// spoken or as text; kept next to the accounts (data/radio-stats.json) and
// written at most every half minute. Losing the last few counts in a crash
// is fine - this is a statistic, not a ledger.
//
// Keys: speaker/event/n for a fixed line (n = its place in lines.json,
// from 0), speaker/event/tn for a template with names. The crew answers in
// the browser and is not counted here.
import fs from 'node:fs';
import path from 'node:path';
import { userFile } from '../userstore.js';

const SAVE_MS = 30000;
const file = () => process.env.HO_RADIO_STATS || path.join(path.dirname(userFile()), 'radio-stats.json');

let stats = null, timer = null;

function load() {
  if (stats) return stats;
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    stats = { since: data.since || Date.now(), lines: data.lines && typeof data.lines === 'object' ? data.lines : {} };
  } catch {
    stats = { since: Date.now(), lines: {} };
  }
  return stats;
}

/** One more delivery of this line. */
export function countLine(key) {
  if (!key) return;
  const s = load();
  s.lines[key] = (s.lines[key] || 0) + 1;
  if (!timer) {
    timer = setTimeout(save, SAVE_MS);
    timer.unref?.();
  }
}

/** All counts: {since, lines: {key: n}}. */
export function lineStats() {
  const s = load();
  return { since: s.since, lines: { ...s.lines } };
}

export function save() {
  clearTimeout(timer);
  timer = null;
  if (!stats) return;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(stats));
    fs.renameSync(tmp, file());
  } catch (e) {
    console.warn('Radio statistics not saved:', e.message);
  }
}
