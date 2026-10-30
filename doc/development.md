# Development

***English** · [Deutsch](development.de.md)* · [← Overview](../readme.md)

- [Structure](#structure)
- [Principles](#principles)
- [Languages](#languages)
- [Sound](#sound)
- [Graphics](#graphics)
- [Tests](#tests)
- [Still missing](#still-missing)

## Structure

No build step, no framework dependencies – just `ws` on the server. Client and
server share the rules and the budget calculation.

```
shared/
  rules.js           Game rules, cost and combat formulas (server + browser)
  budget.js          A turn's budget: forecast in the client, check on the server
  i18n.js            Translation core (browser + Node)
server/
  index.js           HTTP + WebSocket, lobby, game management, spectator pace
  game.js            Game state, turn resolution, views (player and spectator)
  galaxy.js          Star map: scatter or spiral, expansion (deterministic via a secret seed)
  wormholes.js       Wormholes: opening, sight, jump, collapse, dev-mode aids
  shipnames.js       Names for the destroyers: historical ships and a few from films and series
  bot.js             AI opponents with personalities; play by the same rules
  auth.js            Access: sessions, sign-in, password change, gate
  userstore.js       Accounts on disk: name, scrypt hash, profile, message key (wrapped) – written atomically
  profile.js         Display names and profile pictures: check, store, serve
  invites.js         One-time invite links: create, check, use up, expire (hashes only)
  friends.js         Friendships and direct messages between accounts (friends.json)
  users.js           Tool for the host: add, del, passwd, name, admin, list
client/
  index.html         Start screen, lobby, game screen
  login.html         Sign-in and first password change
  img/               logo.svg (wordmark), mark.svg (tab icon)
  i18n/              de.json, en.json, uk.json – text catalogues
  js/main.js         Wiring, game loop, turn changes
  js/net.js          WebSocket with automatic reconnect
  js/e2e.js          End-to-end encryption of friend messages: one key per account, wrapped with the password
  js/render/         planets.js, ships.js (map), shipshd.js (data sheet, battle),
                     map.js (flat), space.js (spatial), courses.js (course lines, orbit slots), fx.js, battlefx.js
  js/ui/             lobby.js, hud.js (all panels incl. the budget), select.js (select lists),
                     dialog.js (windows), avatar.js, battle.js, shipinfo.js, split.js (splitting a fleet), viewport.js,
                     admin.js (admin panel on the start screen), friends.js (friends next to the start menu), announce.js (admin banners), password.js (change password), delete.js (delete your own account),
                     scene.js (starry sky and fade between sign-in and start menu)
  js/audio/sfx.js    Sound effects, synthesised at runtime
test/                see Tests
```

## Principles

**The server computes, the client displays.** Every player gets their own filtered
view: unexplored worlds are positions only, worlds visited once show the last known
state, and of foreign fleets only the ship count is visible – never tech level or
hull.

**Nothing to gain from a manipulated client.** The browser only sends orders; the
server checks each one (ownership, range, affordability, limits) and computes every
result itself. On top of that:
- The map seed is a 128-bit secret rolled by the server – players can neither set
  nor see it – and map and combat use a cryptographic generator (HMAC-SHA256,
  `makeRng` in `server/galaxy.js`). With a small 32-bit generator the seed could be
  brute-forced from the world positions everyone sees, and with it every hidden world
  and every future combat roll.
- One seat per account and game; an admin cannot watch a game without fog of war
  while playing in it.
- System messages carry a flag of their own, names like “System” or “Admin” are
  reserved.
- Each connection has a message budget (burst 40, 20 per second); flooding gets the
  connection closed. Messages are limited to 256 KB.

**Reconnaissance reaches as far as the course.** A foreign fleet is detected when it
sits at a visible world, closer than 300 ly to one of your worlds or closer than
240 ly to one of your fleets. You then also see where it is heading and when it
arrives – what it flies with stays hidden.

**One calculation for display and rule.** Whatever the client predicts, it computes
with the same functions as the server: range and paths around the black hole
(`holeZone`, `route`, `travelDistance`, `reachOutline` in `shared/rules.js`) and the
budget (`forecast` in `shared/budget.js`). The server uses the same calculation to
accept affordable orders only; `test/budget.js` holds forecast and actual charges
against each other, item by item.

**Drawing costs, so it is rationed.** While idle the map draws at 20 frames per
second (`IDLE_FPS` in `client/js/main.js`), and returns to full rate on input and
on a new view. Background, nebula and territory colours live in an intermediate
canvas; planets and ships are pre-drawn once as images – at the screen's resolution –
and then only copied. A hidden tab draws nothing.

## Languages

The interface speaks **English and German**; switching works mid-game without
reloading. There is no human-readable sentence in the code – only keys
(`log.arrive`, `ledger.title`); the sentences live in the catalogues:

```
shared/i18n.js       Core: t(), placeholders {name}, plurals (#one/#other), numbers
client/js/i18n.js    Detect and remember the language, fill data-i18n markup
client/i18n/*.json   one catalogue per language
```

The server sends keys with values instead of sentences
(`{ key: 'log.built', params: { planet: 'Sirrah', count: 3, ship: 'fighter' } }`) –
so every player sees the same event in their own language. In the markup, text is
tagged rather than typed:

```html
<button data-i18n="top.endTurn"></button>
<input data-i18n-attr="placeholder:chat.placeholder">
<p data-i18n-html="help.goal.p"></p>
```

Another language needs a file in `client/i18n/`, one line in `client/js/i18n.js`
and, if necessary, a plural rule in `shared/i18n.js`.

**Change notes.** A release is the first two places of the version (`0.6`); bug-fix
versions in the third place pass silently. For a new release, put a few bullet
points into `client/news/<release>.json` – kept apart from the game's catalogues,
one list per language: `{ "de": ["…", "…"], "en": ["…", "…"] }`. Whoever skipped releases gets the notes of all of them since their last visit, newest first; whoever has never seen any only gets the current ones. Every account sees them once after signing in
(the server keeps the release seen as `news` in `users.json`; without sign-in the
browser remembers it), and *What's new* next to the version in the start menu opens
them again. New accounts start at the current release. `test/news.js` fails if the
release in `package.json` has no notes.

## Sound

The effects are **synthesised** in the browser – no audio files, no dependency.
Every sound is made from oscillators and filtered noise; the recipe table in
`client/js/audio/sfx.js` sets pitches, envelopes and filters. Events tied to a
planet sound from where the world sits on screen. Many simultaneous events are
staggered, sorted by importance and capped. After 20 seconds of silence the audio
context suspends itself.

## Graphics

There are no assets in the usual sense. Planets, ships and effects are canvas
drawing commands; the ships exist twice – compact for the map (`ships.js`) and
detailed for the data sheet and battles (`shipshd.js`), with the same silhouettes.
The **logo** is hand-drawn SVG with no font (everything is paths) and scales from the
start screen down to a 16-point tab icon.

## Tests

```
npm test               # all test runs
npm run test:i18n      # catalogues: same keys, same placeholders, server keys covered
npm run test:engine    # 120 turns with 16 AI, balance and state invariants
npm run test:hole      # spiral game: the no-go zone around the black hole holds
npm run test:wormhole  # wormholes: placement, sight, jump, supply through it, collapse
npm run test:destroyer # destroyers: price, unlock, names, guns and fire, repairs, lobby option
node test/intercept.js # interception when leaving a contested orbit
npm run test:budget    # budget: forecast = charges, no order fails
npm run test:net       # real server, 16 clients, simultaneous turns, colours, disconnect, chat
npm run test:auth      # access: hashes, accounts, profile, sign-in, rate limit
npm run test:ai        # hard AI learns from failed strikes
npm run test:colonies  # hard AI: colony ships from the nearest yard, one per world
npm run test:midflight # splitting in flight, hard AI sorties and ambushes
npm run test:news      # change notes: once per account, notes for the current release
npm run test:idle      # zombie games: discarded after the idle limit, active ones stay
```

`test:budget` runs bot games with random, partly nonsensical orders; `HO_SEED=…`
picks a different run.

## Still missing

- Diplomacy and alliances
- Persistent storage of running games (currently in server memory only)
- Ambient sound (effects only so far, no atmosphere and no music)
- A cornered AI just digs in: it piles ships up on its last world instead of
  breaking out
