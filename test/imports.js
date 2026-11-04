// Every import in the browser code must resolve to a file the server serves -
// also when the game runs under a sub-path (https://host/ho/). Locally at the
// root a "../" too many goes unnoticed: the browser drops it above the root.
// Under a sub-path it leaves the game's folder and the module is missing.
// The server serves /shared/* from shared/, everything else from client/.
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CLIENT = path.join(ROOT, 'client');
const BASE = 'http://host/sub/path/';

let errors = 0, checked = 0;
const fail = (msg) => { console.error('ERROR: ' + msg); errors++; };

const files = (await readdir(path.join(CLIENT, 'js'), { recursive: true }))
  .filter(n => n.endsWith('.js')).map(n => path.join(CLIENT, 'js', n));
const IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

for (const file of files) {
  const src = await readFile(file, 'utf8');
  const page = new URL(path.relative(CLIENT, file).split(path.sep).join('/'), BASE);
  for (const m of src.matchAll(IMPORT)) {
    const spec = m[1] || m[2];
    if (!spec.startsWith('.')) continue;
    checked++;
    const where = `${path.relative(ROOT, file)}: '${spec}'`;
    const url = new URL(spec, page).href;
    if (!url.startsWith(BASE)) { fail(`${where} leaves the game's folder under a sub-path (${url})`); continue; }
    const rel = url.slice(BASE.length);
    const target = rel.startsWith('shared/') ? path.join(ROOT, rel) : path.join(CLIENT, rel);
    try { await access(target); } catch { fail(`${where} points to a missing file (${path.relative(ROOT, target)})`); }
  }
}

console.log(`${checked} imports in ${files.length} files checked.`);
if (errors) { console.error(`\n${errors} import checks failed.`); process.exit(1); }
console.log('All imports resolve - at the root and under a sub-path.');
