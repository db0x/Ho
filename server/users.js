// Manage accounts - meant for the host, not for the browser:
//
//   docker exec ho node server/users.js add captain
//   docker exec ho node server/users.js list
//   docker exec ho node server/users.js del captain
//   docker exec ho node server/users.js passwd captain
//   docker exec ho node server/users.js name captain Captain
//
// It cannot do more, and it is not supposed to. New accounts get a random
// first password that has to be changed on the first sign-in - after that
// only the player knows it.
import {
  addUser, deleteUser, listUsers, resetPassword, setPassword, setDisplay, userFile,
  checkPassword, MIN_PASSWORD
} from './userstore.js';
import { readFileSync } from 'node:fs';
import { registerLocale, setLocale, t } from '../shared/i18n.js';

for (const code of ['de', 'en']) {
  registerLocale(code, JSON.parse(readFileSync(new URL(`../client/i18n/${code}.json`, import.meta.url), 'utf8')));
}
// Language of the environment the tool runs in - HO_LANG overrides it.
setLocale(String(process.env.HO_LANG || process.env.LC_ALL || process.env.LANG || 'en')
  .slice(0, 2).toLowerCase());

const [command, name, password] = process.argv.slice(2);

try {
  await run(command, name, password);
} catch (e) {
  // Complaints travel as keys; anything else is a real error.
  const text = /^[a-z]+\.[A-Za-z.]+$/.test(e.message)
    ? t(e.message, { user: name, n: MIN_PASSWORD })
    : e.message;
  console.error(text);
  process.exit(1);
}

async function run(command, name, password) {
  switch (command) {
    case 'add': {
      requireName(name);
      const r = await addUser(name, password);
      console.log(t('auth.cli.added', { user: r.display }));
      if (r.generated) {
        console.log(t('auth.cli.password', { password: r.password }));
        console.log(t('auth.cli.passwordHint'));
      } else {
        console.log(t('auth.cli.mustChangeHint'));
      }
      break;
    }
    case 'del':
    case 'delete':
    case 'rm': {
      requireName(name);
      if (!deleteUser(name)) throw new Error('auth.cli.unknown');
      console.log(t('auth.cli.deleted', { user: name.toLowerCase() }));
      console.log(t('auth.cli.deletedHint'));
      break;
    }
    case 'passwd':
    case 'reset': {
      requireName(name);
      if (password) {
        const problem = checkPassword(password, name);
        if (problem) throw new Error(problem);
        await setPassword(name, password, { mustChange: true });
        console.log(t('auth.cli.reset', { user: name.toLowerCase() }));
        console.log(t('auth.cli.mustChangeHint'));
      } else {
        const r = await resetPassword(name);
        console.log(t('auth.cli.reset', { user: r.name }));
        console.log(t('auth.cli.password', { password: r.password }));
        console.log(t('auth.cli.passwordHint'));
      }
      break;
    }
    case 'name': {
      requireName(name);
      // Here the third value is the spelling, not a password.
      const r = setDisplay(name, password);
      console.log(t('auth.cli.renamed', { user: r.name, display: r.display }));
      break;
    }
    case 'list':
    case 'ls': {
      const users = listUsers();
      if (!users.length) { console.log(t('auth.cli.none')); break; }
      console.log(t('auth.cli.listHead', { count: users.length, file: userFile() }));
      const width = Math.max(...users.map(u => u.display.length));
      for (const u of users) {
        const mark = u.mustChange ? t('auth.cli.mustChange') : '';
        console.log(`  ${u.display.padEnd(width)}  ${(u.created || '').slice(0, 10)}  ${mark}`);
      }
      break;
    }
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(t('auth.cli.usage', { file: userFile(), n: MIN_PASSWORD }));
      break;
    default:
      console.error(t('auth.cli.badCommand', { cmd: command }));
      console.error(t('auth.cli.usage', { file: userFile(), n: MIN_PASSWORD }));
      process.exit(1);
  }
}

function requireName(name) {
  if (!name) throw new Error('auth.cli.needName');
}
