// Messages between a blocked account and the admins. A blocked player can
// still sign in, but all they get is a dialog saying so - and this one
// conversation, so they can ask why or clear up a mistake.
//
// One thread per account, shared by all admins. Plain text, not end-to-end
// encrypted like the friends' messages: whoever runs the instance reads it
// anyway. It lives next to the account file, so it survives a restart and
// an admin who is offline right now can still answer later.
import fs from 'node:fs';
import path from 'node:path';
import { userFile, normalizeName } from './userstore.js';

export const APPEAL_MAX = 500;
const THREAD_MAX = 100;          // the oldest messages go beyond this
// How many messages a blocked player may send in a row before an admin
// answers - a line to the admins, not a way to flood them.
export const APPEAL_UNANSWERED = 5;

export function appealFile() {
  return path.join(path.dirname(userFile()), 'appeals.json');
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(appealFile(), 'utf8'));
    return raw?.threads && typeof raw.threads === 'object' ? raw.threads : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`appeals.json is unreadable (${appealFile()}): ${e.message}`);
  }
}

/** Writes next to it first and then renames - an abort leaves the old file in place. */
function save(threads) {
  const file = appealFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, threads }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** The trimmed text, or null if it is empty or too long. */
export function cleanAppeal(text) {
  const s = String(text ?? '').trim();
  return s && s.length <= APPEAL_MAX ? s : null;
}

/**
 * Adds a message to an account's thread. `from` is 'user' or 'admin', `by`
 * the name shown for it. Returns the whole thread.
 */
export function addAppeal(name, from, by, text) {
  const key = normalizeName(name);
  const threads = load();
  const thread = (threads[key] || []).concat({ from, by, text, at: Date.now() }).slice(-THREAD_MAX);
  threads[key] = thread;
  save(threads);
  return thread;
}

export function appealsOf(name) {
  return load()[normalizeName(name)] || [];
}

/** The player's messages since the last answer from an admin. */
export function unanswered(name) {
  const thread = appealsOf(name);
  let n = 0;
  for (let i = thread.length - 1; i >= 0 && thread[i].from === 'user'; i--) n++;
  return n;
}

/** Every thread, for the admin panel. */
export function allAppeals() {
  return load();
}

/** The thread goes with the account. */
export function forgetAppeals(name) {
  const threads = load();
  const key = normalizeName(name);
  if (!threads[key]) return;
  delete threads[key];
  save(threads);
}
