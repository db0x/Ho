// A throwaway data directory for tests that start a real server: whatever
// the server writes (statistics, accounts) must never land in the real data/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Path of an account file in a fresh temporary directory. */
export function scratchUsers(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `ho-${name}-`)), 'users.json');
}
