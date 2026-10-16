# Ho!!

***English** · [Deutsch](readme.de.md)*

[![CI](https://github.com/db0x/Ho/actions/workflows/ci.yml/badge.svg)](https://github.com/db0x/Ho/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-brightgreen.svg)](package.json)

A space strategy game in the spirit of **Spaceward Ho!** – in the browser, for up to
16 players at once.

![Classic star map with twelve AI empires](doc/screenshots/map-classic-en.webp)

*The flat star map, watched: twelve AI empires at turn 45. Settled worlds tint
their surroundings in the colour of their empire.*

The planets deliberately follow the style of the original: glossy, richly coloured
spheres where **colour shows temperature** (blue = icy to red = scorching) and
**size shows gravity**. The more habitable a world becomes, the more Earth-like it
looks: **oceans** spread across the sphere, joined by **continents with ragged
coastlines, islands, wisps of cloud and polar caps**. The temperature colour moves
onto the continents in the process – so an ice world stays distinguishable, because
its blue is bare. Terraforming is therefore visible right on the map: a pale marble
turns into a blue world, step by step. The starfield lies in three layers – many small points far
back, a few large ones up front – drifting past at different speeds; in the space
view it turns slowly along with the camera. Settled worlds tint their surroundings
in the colour of their empire – neighbouring worlds merge into one area, so a glance
tells you who owns which corner of the galaxy. The ships are drawn from scratch –
each class has its own silhouette with engine glow, panelling and player colour.

```
npm install
npm start          # http://localhost:8080
```

AI empires enter under names of their own – from *Admiral Wobblebeard* to
*Czarina Candyfloss*.

For a quick game: *Play 5 AI right away*. For a round with friends, *Host a new
game*, pass on the four-letter code, fill the empty seats with AI and start. On a
LAN the others reach the server at `http://<your-ip>:8080`. If you would rather
watch: *Watch a game* sets up an all-AI game that runs by itself.

![Lobby with the game code and the list of empires](doc/screenshots/lobby-en.webp)

*The lobby: the four-letter code at the top, empty seats filled with AI, playing
field and rules on the right.*

The **logo** is hand-drawn SVG and follows the same visual language: brass for
the lettering and an Earth-like world as the *o* – with ragged coastlines,
highlands, desert, inland lakes, island chains, clouds, polar caps and a night
side. It needs no font (everything is paths) and scales from the start screen
down to a 16-point tab icon (`client/img/logo.svg` and `client/img/mark.svg`).

## How it plays

Everyone moves **at the same time**. Each player issues their orders and clicks
*End turn*; once everyone is done (or the turn timer runs out) the server resolves
the turn – research, building, terraforming, movement, combat, economy.

| Term | Meaning |
|---|---|
| **Ideal** | 20 °C and 1.0 g. The closer a world is to it, the more people live there and the more money it brings in. |
| **Terraforming** | Costs money and pushes temperature and gravity towards the ideal. Extreme worlds need a higher level of **radical tech** first. |
| **Metal** | Mined on your own worlds, pooled globally and consumed when building ships. A planet's reserves run out. |
| **Range** | Distance from your nearest *inhabited own* planet. New colonies are therefore stepping stones; tankers widen the radius. |
| **Tech level** | Ships are built with the level of their build year and keep it. Higher levels make ships better *and more expensive* – **miniaturisation** brings the cost back down. |
| **Defence batteries** | Every inhabited world defends itself, in proportion to its population. A developed world costs the attacker a real fleet. |
| **Satellites** | Cheap, immobile defenders that stay in orbit for good. |
| **Expansion** | The galaxy has no fixed edge. Push outwards and you find new worlds beyond – harsher, but richer in ore. In a spiral the arms reach further out instead. |

**The budget is tighter than your balance suggests.** Charges happen in this order:
research first, then shipbuilding – income arrives last. So what is available for
building is *money minus the research share*, and that across all shipyards
together. On top of that, a breakthrough in the same turn makes ships more
expensive, because they are built at the new level. The interface works this out
before you end the turn – the top bar shows, behind money and metal, what is
already committed (red when it is not enough), the shipyard names the shortfall,
and clicking *End turn* raises one last notice if needed.

A world falls when an attacker holds the orbit and neither satellites nor the
defence battery survived. The population drops in the process, the rest changes
hands.

### Galaxy shape: scatter or spiral

Independently of the playing field you can choose the **shape**. *Scatter* spreads
the worlds evenly – the original behaviour. *Spiral* builds a galaxy the way you
picture one: two or three logarithmic arms around a dense core bulge, and at the
centre a **black hole** (it carries a name such as *Charybdis* or *Nyx*): a softly
fading maw with a photon arc, around which matter turns inwards in seven arms. In
the space view these arms lie in the galactic plane, so the far half disappears
behind the maw.

The hole is not a backdrop, it is terrain: around the maw lies a **no-go zone**
(1.8 times its radius, a dashed ring on the map). No world forms there, and no
fleet flies into it. Anyone heading for a target behind it is **routed around
automatically** – two tangents and an arc along the boundary, computed in the plane
through start, target and hole, so it works the same flat as in space. The path
gets longer and costs turns; the same goes for supply, because **range** now
measures the flyable path rather than the straight line. Worlds behind the hole are
therefore further away in play than they look. The AI reckons the same way and
prefers targets it can actually reach quickly (`shared/rules.js`: `holeZone`,
`route`, `travelDistance`; verified by `test/blackhole.js`).

The interface computes with the **same functions** as the server. The range
outline is therefore no longer a circle but carries a **dent** towards the hole
(`reachOutline`) – a circle would have shown worlds as reachable that the server
then refused. And when a world is out of range, *Fleet here* is disabled from the
start and names the reason, instead of rejecting the order after the click.

A spiral grows differently: not in strips at the map edge, but **outwards**. Push
to the tips of the arms and the arms reach further, with worlds forming in the new
ring – along the arms, not evenly spread. Measured on a finished game, over 95 % of
the worlds outside the core really do sit in an arm.

Both shapes come flat and in space; the spatial spiral is a lens with arms, the
flat one looks like a galaxy seen from above.

### Two playing fields: classic and space

On the start screen and in the lobby you can choose the **playing field**.
*Classic* is the flat star map as before and stays unchanged. *Space* spreads the
same game across three dimensions: the worlds lie in a **lens**, wide across and
about 40 % of that in height – thicker in the middle, thinner towards the rim, like
a real galaxy. Distances, range and scanners then compute in three dimensions.

![The same game in the space view, worlds in a lens above the grid](doc/screenshots/map-space-en.webp)

*The space view: the grid lies in the mid-plane of the galaxy, and a plumb line
runs from every world down to it – that is how you read its height.*

| Action | Input |
|---|---|
| Rotate camera | Drag |
| Pan the focus | **Shift**+drag (or middle button) |
| Zoom | Mouse wheel, `+` / `−` |
| Top-down view (like classic) | `T` |
| Fit the whole galaxy | `F` |
| Select / set course | Left click / right click – as in classic |

So that space does not turn into guesswork there are three reading aids: a **grid**
in the mid-plane of the galaxy, a **plumb line** from every world down to that grid
(that is how you see its height) and a grading of size and brightness by distance –
only what lies behind the focus point is dimmed; everything in front stays opaque,
otherwise the grid shows through the worlds. Everything is drawn by hand onto the
same canvas – no 3D library, no build step; the worlds remain the same sprites and
turn to face the camera.

### How the AI fights

The AI only attacks a world when its fleet can break the defence in **one turn** –
the defence battery is rebuilt from the population every round, so a siege achieves
nothing. To that end it estimates up front what a world costs (battery, satellites,
fleets in orbit), and otherwise keeps massing.

When an empire falls back to three known worlds it becomes the **war target**:
instead of nibbling at fringe colonies, the fleets gather at the nearest own world
and only strike once there is enough for the killing blow – even against a
homeworld. Measured across three games of 300 turns with 16 AI, 10 to 13 empires
survive as a result; before, none was ever eliminated.

### Watching

*Watch a game* on the start screen sets up a game with 4 to 16 AI empires and
starts it immediately. There is no empire of your own – in exchange everything is
open: every world, every fleet including its composition, the full event log and a
table of all empires with tech levels, treasury and ore.

The server sets the pace, because nobody here presses *End turn*: at the top right
sit **Pause**, **Step** (one turn ahead while paused) and the speeds ½× to 4× – 1×
is one turn every 1.5 seconds. The space bar pauses and resumes.

*Leave* at the top right returns you to the start screen at any time.

The game code is shown at the top left. Enter it on the start screen under *Join*
and you watch the same game – the pace then applies to all spectators together.
When the last spectator leaves, the game is cleaned up.

Watching only works for all-AI games. In a game with human players there would
otherwise be a spectator who sees everyone's cards.

### A galaxy without an edge

The star map is not finished when the game begins. When a fleet or a settled world
comes closer than 200 ly to the border, the map pushes out there and a new strip of
worlds appears – at most one per turn, in the most pressing direction. The new
worlds keep their distance from the new edge: to trigger the next strip somebody
really has to fly further. If everyone stays put, nothing grows.

The further a world lies from the starting area, the more inhospitable it is – more
extreme temperatures, more extreme gravity, fewer direct hits. In exchange there is
more ore there, and of better grade. Settling out there pays off, but it costs
terraforming and **radical tech**.

In a game with 16 AI the map grows from 96 to around 390 worlds in 120 turns and to
roughly 1,000 by the turn limit – with pauses when the empires are only
consolidating. It can be switched off in the lobby.

### On a phone

Ho!! runs on a phone as well – tested on a narrow 21:9 device (412 × 960 CSS
points, portrait and landscape). When the window is **narrower than 760** or
**shorter than 560 points**, the interface rearranges itself:

- Instead of the three floating docks there is a **bar along the bottom**
  (Map · Empire · Selection · Log · More). Only one **sheet** is open at a time,
  and the map keeps the rest.
- In **portrait** the sheet sits at the bottom, in **landscape** at the right –
  landscape has no room below, but plenty to the side.
- Tapping a world opens its sheet, and the world moves into the part of the map
  the sheet leaves free. Tapping empty space closes it again.
- The top bar becomes a single row: crest, money, metal, turn, *End turn*.
  *Leave the game* lives under *More*, together with display and sound.
- Switches, sliders and the shipyard's `+`/`−` buttons are sized for a thumb;
  the bar keeps clear of the system bar (`safe-area-inset`).

Gestures on the map:

| Gesture | Classic | Space |
|---|---|---|
| Drag one finger | pan the map | rotate the camera |
| Spread / pinch two fingers | zoom | zoom |
| Drag two fingers | pan the map | pan the focus |
| Tap | select | select |

Setting a course needs no right click: tap the fleet, then tap the target world
and use *Fleet here* in the sheet. The map captures swipe and zoom gestures
itself (`touch-action: none`), so panning does not drag the page along.

### Controls

| Action | Input |
|---|---|
| Move / zoom the map | Drag, mouse wheel, `+` / `−` |
| Select | Left click on a world or fleet |
| Set course | Pick a fleet, then **right-click** (or shift-click) the target world – or click the target world and use *Fleet here* in the panel. Works for every world, including your own (defence, stepping stone for range). |
| End turn | Button at the top right or `space` |
| Fit the map | `F` |
| Clear selection | `Esc` |
| Help | `H` |
| Leave the game | *Leave* button at the top right |
| Move / resize the log | Drag the title bar, or the grip at the bottom right; double-clicking the bar collapses it |
| Top-down view (space mode only) | `T` |
| Watching: pause / resume | `space` |
| Display and sound (names, range, territory, stars, volume) | Gear at the bottom right; it unfolds the switches, `Esc` or a click beside it closes them again |
| On a phone | Bar at the bottom instead of docks, gestures on the map – see *On a phone* |

## Structure

No build step, no framework dependencies – just `ws` on the server. Client and
server share the same rules file.

```
shared/rules.js      Game rules, cost and combat formulas (server + browser)
shared/i18n.js       Translation core (browser + Node)
server/
  index.js           HTTP (static files) + WebSocket, lobby, game management, spectator pace
  game.js            Game state, turn resolution, views (player and spectator)
  galaxy.js          Star map: scatter or spiral, expansion (deterministic via a seed)
  bot.js             AI opponent; plays by the same rules with its own reconnaissance,
                     estimates the defence before attacking and finishes off the weakened
client/
  index.html         Start screen, lobby, game screen
  img/logo.svg       Wordmark (H, a world as the o, two exclamation marks)
  img/mark.svg       The same mark on its own - tab icon and launch image
  js/main.js         Wiring, game loop
  js/net.js          WebSocket with automatic reconnect
  js/i18n.js         Detect and remember the language, fill the markup
  i18n/de.js, en.js  Text catalogues
  js/render/         planets.js (planet style), ships.js (ships),
                     map.js (flat star map), space.js (spatial star map)
  js/ui/             lobby.js, hud.js (all panels), select.js (custom select lists),
                     dialog.js (movable windows, e.g. the log),
                     viewport.js (one breakpoint for small devices)
  js/audio/sfx.js    Sound effects, synthesised at runtime
test/
  i18n.js            Catalogues: same keys, same placeholders, server keys covered
  smoke.js           Plays a full game with 16 AI and checks the invariants
  blackhole.js       Spiral game: no fleet inside the no-go zone, courses route around
  multiplayer.js     Starts the real server and has 16 WebSocket clients play
```

**Drawing costs, so it is rationed.** A turn-based game does not need to rasterise
the star map 60 times a second. While idle the map draws at 20 frames per second
(`IDLE_FPS` in `client/js/main.js`); on input, camera movement and a new view it
returns to full rate immediately. Background gradient, nebula and territory colours
live in an intermediate canvas and are only rebuilt when the camera moves; the
drifting stars go on top. A hidden tab draws nothing at all, and the audio context
suspends itself after 20 seconds of silence.

**The server computes, the client displays.** Every player gets their own filtered
view: unexplored worlds are positions only, worlds visited once show the last known
state (drawn dimmed), and of foreign fleets only the ship count is visible – never
their tech level or hull.

**Reconnaissance reaches as far as the course.** A foreign fleet is detected when it
sits at a visible world, closer than 300 ly to one of your worlds or closer than
240 ly to one of your fleets. Once you have it in your own space like that, you also
see **where** it is heading and **in how many turns** it arrives – as a course line
on the map and in the panel. What it flies with stays hidden: composition, tech
level and hull are still not sent by the server.

## Languages

The interface speaks **English and German**. On first start the browser's language
decides, after that the choice at the bottom of the start screen; it is remembered
in the browser. Switching works **mid-game** – without reloading.

There is no human-readable sentence in the code. It only knows keys (`log.arrive`,
`yard.notEnough`); the sentences live in the catalogues:

```
shared/i18n.js       Core: t(), placeholders {name}, plurals (#one/#other), numbers
client/js/i18n.js    Detect and remember the language, fill data-i18n markup
client/i18n/de.js    German catalogue
client/i18n/en.js    English catalogue
```

The **server** no longer sends finished sentences either, but keys together with
values (`{ key: 'log.built', params: { planet: 'Sirrah', count: 3, ship: 'fighter' } }`).
Only the client assembles a sentence from them – which is why every player sees the
same event in **their** language, even in the same game.

Another language needs a file in `client/i18n/`, one line in `client/js/i18n.js`
and, if necessary, a plural rule in `shared/i18n.js` (English and German share the
same one). `npm run test:i18n` checks that the catalogues carry the same keys and
the same placeholders, and that every key the server sends is translated.

In the markup, text is tagged rather than typed:

```html
<button data-i18n="top.endTurn"></button>
<input data-i18n-attr="placeholder:chat.placeholder">
<p data-i18n-html="help.goal.p"></p>
```

## Sound

The effects are **synthesised** in the browser – there are no audio files and no
extra dependency. Every sound is made from oscillators and filtered noise
(`client/js/audio/sfx.js`); the recipe table there sets pitches, envelopes and
filters.

You hear clicks and selection, courses being set, the turn gong and the events of
the resolved turn: space battle, invasion, colony, shipbuilding, research level,
terraforming, arrival, warnings, loss of a world, elimination and victory. Events
tied to a planet sound **from where the world sits on screen** – a battle at the
left edge of the map comes from the left.

Many things can happen at once in a turn. To keep that from turning into noise,
identical effects are staggered and capped, the events are sorted by importance
(victory and loss before arrival and warning) and played one after another; a
limiter keeps the sum in check.

The switch and volume sit at the bottom right behind the gear, and the setting is
remembered in the browser. Browsers only allow sound after the first user action –
the first click wakes the output. After 20 seconds without a sound the audio
context suspends itself (it would otherwise cost CPU time permanently) and wakes up
again by itself with the next sound.

## Tests

```
npm test             # all test runs
npm run test:i18n    # catalogues: same keys, same placeholders, server keys covered
npm run test:engine  # 120 turns with 16 AI, checks balance and state invariants
npm run test:hole    # spiral game: the no-go zone around the black hole holds
npm run test:net     # lobby, 16 clients, simultaneous-turn logic, disconnect, chat
```

## Docker

Alternatively, without a local Node:

```
docker compose up -d --build       # http://localhost:8080
docker compose logs -f             # server output
docker compose down                # stop
```

The host port can be moved with `HOST_PORT` (`HOST_PORT=3000 docker compose up -d`);
inside the container the server still listens on 8080. The tests run in the same
image:

```
docker compose --profile test run --rm test
```

Running games live in server memory only – restarting the container ends them.

## Settings

Adjustable in the lobby: worlds per player (3–14), starting capital, starting metal,
turn timer (0 = the game waits until everyone is done) and whether the galaxy grows
as you explore (see *A galaxy without an edge*; off gives the old, fixed map). The
port can be set via the `PORT` environment variable:

```
PORT=3000 npm start
```

A disconnected player does not block the turn – they are skipped and can return at
any time (the seat is stored in the browser). Anyone who exits via *Leave* gives the
seat up for good: the empire stays on the map and is skipped, the game continues for
the others. If that was the last human, the game is cleaned up. Games without
connected players are cleaned up after two hours.

## Still missing

- Diplomacy and alliances
- Persistent storage of running games (currently in server memory only)
- Ambient sound (effects only so far, no atmosphere and no music)
- A cornered AI just digs in: it piles ships up on its last world instead of
  breaking out

## License

The code is under the **MIT license** – use it, change it, pass it on, build
something commercial on it; keep the copyright notice and the licence text with it.
The full wording is in [LICENSE](LICENSE). There are no separate asset licences to
observe, because there are no assets in the usual sense: the graphics are
hand-written SVG and canvas drawing commands, the sounds are synthesised in the
browser at playback time, and the only dependency is `ws` (MIT as well). Everything
in this repository is source code, apart from the screenshots under
`doc/screenshots/`; they show the game itself and fall under the same licence.

**Ho!!** is an independent reimplementation and not connected with, endorsed by or
licensed from Delta Tao Software. *Spaceward Ho!* is their trademark, and the
original game remains theirs – this project borrows the idea and the feel of it, not
its code, its graphics or its texts. The planet style follows the original in
spirit; every line of it was drawn from scratch here.
