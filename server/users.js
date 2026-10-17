// Konten verwalten - gedacht fuer den Host, nicht fuer den Browser:
//
//   docker exec ho node server/users.js add captain
//   docker exec ho node server/users.js list
//   docker exec ho node server/users.js del captain
//   docker exec ho node server/users.js passwd captain
//
// Mehr kann es nicht, und mehr soll es nicht koennen. Angelegte Konten haben
// ein gewuerfeltes erstes Passwort, das beim ersten Anmelden gewechselt werden
// muss - danach kennt es nur der Spieler.
import {
  addUser, deleteUser, listUsers, resetPassword, setPassword, userFile,
  checkPassword, MIN_PASSWORD
} from './userstore.js';
import { registerLocale, setLocale, t } from '../shared/i18n.js';
import de from '../client/i18n/de.js';
import en from '../client/i18n/en.js';

registerLocale('de', de);
registerLocale('en', en);
// Sprache der Umgebung, in der das Werkzeug laeuft - HO_LANG schlaegt sie.
setLocale(String(process.env.HO_LANG || process.env.LC_ALL || process.env.LANG || 'en')
  .slice(0, 2).toLowerCase());

const [befehl, name, passwort] = process.argv.slice(2);

try {
  await los(befehl, name, passwort);
} catch (e) {
  // Beanstandungen reisen als Schluessel; alles andere ist ein echter Fehler.
  const text = /^[a-z]+\.[A-Za-z.]+$/.test(e.message)
    ? t(e.message, { user: name, n: MIN_PASSWORD })
    : e.message;
  console.error(text);
  process.exit(1);
}

async function los(befehl, name, passwort) {
  switch (befehl) {
    case 'add': {
      verlangeNamen(name);
      const r = await addUser(name, passwort);
      console.log(t('auth.cli.added', { user: r.name }));
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
      verlangeNamen(name);
      if (!deleteUser(name)) throw new Error('auth.cli.unknown');
      console.log(t('auth.cli.deleted', { user: name.toLowerCase() }));
      console.log(t('auth.cli.deletedHint'));
      break;
    }
    case 'passwd':
    case 'reset': {
      verlangeNamen(name);
      if (passwort) {
        const rüge = checkPassword(passwort, name);
        if (rüge) throw new Error(rüge);
        await setPassword(name, passwort, { mustChange: true });
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
    case 'list':
    case 'ls': {
      const users = listUsers();
      if (!users.length) { console.log(t('auth.cli.none')); break; }
      console.log(t('auth.cli.listHead', { count: users.length, file: userFile() }));
      const breite = Math.max(...users.map(u => u.name.length));
      for (const u of users) {
        const marke = u.mustChange ? t('auth.cli.mustChange') : '';
        console.log(`  ${u.name.padEnd(breite)}  ${(u.created || '').slice(0, 10)}  ${marke}`);
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
      console.error(t('auth.cli.badCommand', { cmd: befehl }));
      console.error(t('auth.cli.usage', { file: userFile(), n: MIN_PASSWORD }));
      process.exit(1);
  }
}

function verlangeNamen(name) {
  if (!name) throw new Error('auth.cli.needName');
}
