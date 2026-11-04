// Every import in the browser code must resolve to a file the server serves -
// also when the game runs under a sub-path (https://host/ho/). Locally at the
// root a "../" too many goes unnoticed: the browser drops it above the root.
// Under a sub-path it leaves the game's folder and the module is missing.
// The server serves /shared/* from shared/, everything else from client/.
//
// And the sign-in page has to work without a session: everything it loads -
// its own files and the whole import tree of login.js - must be on the
// server's list of what goes out without sign-in (server/auth.js). A new
// import there would otherwise be answered with a redirect, not the file.
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { isPublic } from '../server/auth.js';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CLIENT = path.join(ROOT, 'client');
const BASE = 'http://host/sub/path/';

let errors = 0, checked = 0;
const fail = (msg) => { console.error('ERROR: ' + msg); errors++; };

const files = (await readdir(path.join(CLIENT, 'js'), { recursive: true }))
  .filter(n => n.endsWith('.js')).map(n => path.join(CLIENT, 'js', n));
// import … from '…', export … from '…', import('…') and the bare import '…'
const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;])import\s*['"]([^'"]+)['"]/g;
/** Relative imports of a module, as URL paths from the server's root. */
const graph = new Map();

for (const file of files) {
  const src = await readFile(file, 'utf8');
  const page = new URL(path.relative(CLIENT, file).split(path.sep).join('/'), BASE);
  for (const m of src.matchAll(IMPORT)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec.startsWith('.')) continue;
    checked++;
    const where = `${path.relative(ROOT, file)}: '${spec}'`;
    const url = new URL(spec, page).href;
    if (!url.startsWith(BASE)) { fail(`${where} leaves the game's folder under a sub-path (${url})`); continue; }
    const rel = url.slice(BASE.length);
    const target = rel.startsWith('shared/') ? path.join(ROOT, rel) : path.join(CLIENT, rel);
    try { await access(target); } catch { fail(`${where} points to a missing file (${path.relative(ROOT, target)})`); }
    const from = '/' + path.relative(CLIENT, file).split(path.sep).join('/');
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push('/' + rel);
  }
}
console.log(`${checked} imports in ${files.length} files checked.`);

// The sign-in page without a session: its own files, then every module
// login.js pulls in - directly or further down.
const shared = new Map();      // shared modules import each other too
for (const name of await readdir(path.join(ROOT, 'shared'))) {
  if (!name.endsWith('.js')) continue;
  const src = await readFile(path.join(ROOT, 'shared', name), 'utf8');
  const from = '/shared/' + name;
  for (const m of src.matchAll(IMPORT)) {
    const spec = m[1] || m[2] || m[3];
    if (spec.startsWith('.')) (shared.get(from) || shared.set(from, []).get(from)).push(new URL(spec, 'http://x' + from).pathname);
  }
}
const html = await readFile(path.join(CLIENT, 'login.html'), 'utf8');
const needed = new Set(['/login.html']);
for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) needed.add(new URL(m[1], 'http://x/').pathname);
const queue = [...needed].filter(p => p.endsWith('.js'));
while (queue.length) {
  const p = queue.shift();
  for (const dep of graph.get(p) || shared.get(p) || []) if (!needed.has(dep)) { needed.add(dep); queue.push(dep); }
}
for (const p of needed) if (!isPublic(p)) fail(`the sign-in page needs ${p}, but the server only hands it out after sign-in (server/auth.js PUBLIC_EXACT)`);
console.log(`Sign-in page: ${needed.size} files, all free without sign-in: ${[...needed].join(' ')}`);

if (errors) { console.error(`\n${errors} import checks failed.`); process.exit(1); }
console.log('All imports resolve - at the root and under a sub-path; the sign-in page loads without a session.');
