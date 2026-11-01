// Release notes: which version runs here, which releases have notes, and
// which ones an account has seen.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { compareRelease, releaseOf } from '../../shared/version.js';
import { setNewsSeen } from '../userstore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// The version lives only in package.json; it is inserted into the pages when
// they are served instead of being maintained in a second place.
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
// Releases with change notes (client/news/<release>.json) up to the one that
// runs - the browser cannot list the folder, so 'hello' names them.
export const RELEASES = (() => {
  let names = [];
  try { names = fs.readdirSync(path.join(ROOT, 'client', 'news')); } catch { /* no notes */ }
  return names.map(n => n.match(/^(\d+\.\d+)\.json$/)?.[1]).filter(Boolean)
    .filter(r => compareRelease(r, releaseOf(VERSION)) <= 0).sort(compareRelease);
})();

export const newsHandlers = {
  newsSeen({ c }) {
    // Always the release that runs here - not what the client claims.
    if (c.accountKey) {
      try { setNewsSeen(c.accountKey, releaseOf(VERSION)); } catch { /* account file unreadable */ }
    }
  }
};
