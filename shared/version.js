// Versions. Only a change in the first or second place counts as a new
// version for the players (0.5.x -> 0.6.0) - that is when the change notes
// appear once. Bug-fix releases in the third place pass silently.

/** The part of a version that names a release: '0.6.3' -> '0.6'. */
export function releaseOf(version) {
  return String(version ?? '').split('.').slice(0, 2).join('.');
}

/** Order of two releases by number, not by text: '0.10' comes after '0.9'. */
export function compareRelease(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Which change notes are due, newest first. Whoever skipped releases gets
 * everything since their last visit. Whoever has never seen any (an account
 * from before the change notes, a fresh browser) only gets the current one -
 * not the whole history.
 * @param {string[]} available  releases that have notes
 * @param {string} current      release that runs
 * @param {string|null} seen    last release seen, null: none yet
 */
export function dueReleases(available, current, seen) {
  const upTo = available.filter(r => compareRelease(r, current) <= 0);
  const due = seen ? upTo.filter(r => compareRelease(r, seen) > 0) : upTo.filter(r => r === current);
  return due.sort((a, b) => compareRelease(b, a));
}
