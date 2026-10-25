// Emojis on the comms (shared/emoji.js): classic smileys turn into emojis
// when they stand on their own, short codes between colons anywhere. Links,
// times and unknown codes stay as they are. While typing, a smiley at the
// very end waits - it could still become a word.
import { emojify, SMILEYS, CODES } from '../shared/emoji.js';

let errors = 0;
const expect = (input, want, o) => {
  const got = emojify(input, o);
  if (got !== want) { console.error(`ERROR: ${JSON.stringify(input)}${o?.typing ? ' (typing)' : ''} -> ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`); errors++; }
};

expect('hi :)', 'hi 🙂');
expect(':( schade', '🙁 schade');
expect('lol :D :D', 'lol 😄 😄');
expect('super :)!', 'super 🙂!');
expect("oh :'(", 'oh 😢');
expect('ich <3 dich', 'ich ❤️ dich');
expect('das ist :sad: und :rocket:!', 'das ist 😢 und 🚀!');
expect('mitten:sad:drin', 'mitten😢drin');
expect(':+1: :THUMBSUP: :lol:', '👍 👍 😆');
// Stays as it is
expect('siehe https://example.org/a', 'siehe https://example.org/a');
expect('um 3:00 Uhr, 12:30:45', 'um 3:00 Uhr, 12:30:45');
expect('ok;) a:)', 'ok;) a:)');
expect(':Dinge', ':Dinge');
expect(':unbekannt: bleibt', ':unbekannt: bleibt');
expect('Liste: 1) 2) 8)', 'Liste: 1) 2) 8)');
// While typing
expect('hey :D', 'hey :D', { typing: true });
expect('hey :D ', 'hey 😄 ', { typing: true });
expect('na :sad:', 'na 😢', { typing: true });
// Every smiley and code really is replaced
for (const [s, e] of Object.entries(SMILEYS)) expect(`a ${s} b`, `a ${e} b`);
for (const [c, e] of Object.entries(CODES)) expect(`:${c}:`, e);

if (errors) { console.error(`${errors} error(s)`); process.exit(1); }
console.log(`${Object.keys(SMILEYS).length} smileys and ${Object.keys(CODES).length} codes; links, times and unknown codes stay as they are.`);
console.log('All emoji checks passed.');
