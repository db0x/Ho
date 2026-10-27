# Playing

***English** · [Deutsch](playing.de.md)* · [← Overview](../readme.md)

- [Starting a game](#starting-a-game)
- [How it plays](#how-it-plays)
- [The ship classes](#the-ship-classes)
- [Money, metal and the budget](#money-metal-and-the-budget)
- [Combat and conquest](#combat-and-conquest)
- [Galaxy shape: scatter or spiral](#galaxy-shape-scatter-or-spiral)
- [Two playing fields: classic and space](#two-playing-fields-classic-and-space)
- [A galaxy without an edge](#a-galaxy-without-an-edge)
- [The AI empires](#the-ai-empires)
- [Watching](#watching)
- [Ranking and victory](#ranking-and-victory)
- [Controls](#controls)
- [On a phone or tablet](#on-a-phone-or-tablet)
- [The look](#the-look)

## Starting a game

- **Quick:** *Play 5 AI right away* – creates a game, fills it and starts.
- **With friends:** *Host a new game*, pass on the four-letter code, fill the
  empty seats with AI and start. On a LAN the others reach the server at
  `http://<your-ip>:8080`.
- **Watch:** *Watch a game* starts an all-AI game that runs by itself (see
  [Watching](#watching)).

![Lobby with the game code and the list of empires](screenshots/lobby-en.webp)

**Profile.** The start screen shows your display name and picture. Click the
circle next to the name to upload a picture; the browser crops and shrinks it.
With an account, name and picture belong to the account and follow you to every
device; without one, the browser remembers them. The name is free to choose but
may not match *another* account; within a game every name is unique (numbered if
necessary), and when the name differs from the account, the account name is shown
next to it. In the lobby you can change name and picture in your own row.

**Colours.** Click your colour swatch to open the palette. Each colour exists
once; taken ones have a clipped corner. Only the host can take another player's
colour – the two then swap. The host also colours the AI empires.

**Settings** are up to the host; everyone else sees them read-only, with a note
saying who can change them:

| Setting | Meaning |
|---|---|
| Playing field | *Classic* (flat) or *Space* (three-dimensional) |
| Galaxy shape | *Scatter* or *Spiral* with a black hole |
| Turn limit | 100, 200, 300, 500, unlimited, or *Quick game* for a custom number from 20 to 99 |
| Worlds per player | 3–14 |
| Starting capital, starting metal | Treasury at the start |
| Turn timer | 0 = the game waits until everyone is done |
| Galaxy grows | see [A galaxy without an edge](#a-galaxy-without-an-edge); off gives a fixed map |

**Connection.** A disconnected player does not block the turn – they are skipped
and can return at any time (the seat is stored in the browser). With sign-in a game can also be continued on
another device: the start menu lists it under *Your games on another device*,
*Continue here* brings the seat over and the first device returns to the start
menu. The other players do not notice. Anyone who exits
via *Leave* gives the seat up for good: the empire stays on the map and is
skipped. Games without connected players are cleaned up after two hours.

## How it plays

Everyone moves **at the same time**. Each player issues their orders and clicks
*End turn*; once everyone is done (or the turn timer runs out) the server resolves
the turn – research, building, refits, terraforming, movement, combat,
colonisation, economy.

| Term | Meaning |
|---|---|
| **Ideal** | 20 °C and 1.0 g. The closer a world is to it, the more people live there and the more money it brings in. |
| **Terraforming** | Costs the set budget every turn and pushes temperature and gravity towards the ideal. Extreme worlds need a higher level of **radical tech** first. |
| **Metal** | Mined on your own worlds, pooled and consumed when building ships. A planet's reserve runs out; after that, deep mining still yields a tenth. |
| **Range** | Distance from your nearest *inhabited own* planet. New colonies are therefore stepping stones; tankers widen the radius. |
| **Tech level** | Ships are built with the level of their build year and keep it. Higher levels make ships better *and more expensive* – **miniaturisation** brings the cost back down. Outdated ships can be **refitted** at a shipyard. |
| **Defence battery** | Every inhabited world defends itself, in proportion to its population. |
| **Orbital defence** | Cheap satellites that stay in orbit. They cannot fly themselves, but a **transporter** carries up to five of them to another world of yours. From five upwards they raise a shield. |
| **Recycling** | A research field of its own. From level 2 on, ships and satellites at one of your shipyards can be taken apart right away: that costs money and brings back part of the metal of their build price. Level 2 returns 25% of the metal for 50% of the money; every level improves that until level 16 reaches the limit – 80% of the metal for 5% of the money. The fleet goes as a whole (split it first), satellites by count, the oldest first. |

## The ship classes

Six classes, each with a job of its own. Ships are built at the shipyard of one of
your worlds; clicking a ship there – or *Browse ship types* in the help (`H`) –
opens its data sheet with the current values.

| | |
|---|---|
| <img src="screenshots/ships/scout.webp" width="120" alt="Scout"> | **Scout** – the fastest class, with a long range. Only a scout reveals a world's temperature, gravity and metal reserve. Unarmed and fragile: better steer clear of enemy fleets. |
| <img src="screenshots/ships/fighter.webp" width="120" alt="Fighter"> | **Fighter** – the backbone of every fleet, with weapons and shields. Whoever holds the orbit and breaks the defence battery and the orbital defence takes the world. Short range – send a tanker along for strikes deep in enemy space. |
| <img src="screenshots/ships/satellite.webp" width="120" alt="Orbital defence"> | **Orbital defence** – a satellite placed straight into orbit of the world that builds it, where it stays. Cheap, tough and well armed; from five upwards they raise a shield. A world with satellites does not fall without a fight. |
| <img src="screenshots/ships/colony.webp" width="120" alt="Colony ship"> | **Colony ship** – lands 8M settlers on a free world and is used up in the process. Over a world of yours that is not yet full, *Drop settlers here* tops up the population. Slow and defenceless – an escort pays off. |
| <img src="screenshots/ships/tanker.webp" width="120" alt="Tanker"> | **Tanker** – does not fight, but gives the whole fleet its range, more than twice that of a fighter. Every further tanker in the same fleet adds +15%. |
| <img src="screenshots/ships/transport.webp" width="120" alt="Transporter"> | **Transporter** – takes up to five satellites aboard in orbit of a world of yours and sets them down above another one, so the defence moves to wherever danger looms. Satellites aboard do not fight and are lost with the transporter. Does not extend the fleet's range. |

Base values at tech level 1 – research improves them, and new ships are built at
the current level:

| Class | Cost | Attack | Hull | Speed | Range |
|---|---|---|---|---|---|
| Scout | 8 cr · 3 metal | – | 10 | 71 ly/t | 323 ly |
| Fighter | 14 cr · 7 metal | 5 | 22 | 42 ly/t | 170 ly |
| Orbital defence | 10 cr · 5 metal | 6 | 34 | – | – |
| Colony ship | 30 cr · 12 metal | – | 16 | 34 ly/t | 221 ly |
| Tanker | 18 cr · 6 metal | – | 20 | 38 ly/t | 442 ly |
| Transporter | 20 cr · 8 metal | – | 26 | 38 ly/t | 442 ly |

A fleet flies as fast as its slowest ship and as far as its best one (plus
tankers). Every ship wears the colour of its empire – on the fighter, for example,
the stripes along the fuselage.

## Money, metal and the budget

At the end of the turn charges happen in a fixed order: **research, shipbuilding,
refits, terraforming** – **income arrives last** and only pays for the next turn.
So what is available for building is *money minus the research share*, across all
shipyards together. A breakthrough in the same turn makes ships more expensive,
because they are built at the new level.

So that nobody has to work this out in their head:

- The top bar shows **now → next turn**, e.g. `Money 1,600 → 811`.
- Clicking (or hovering over) money or metal opens the **budget**: balance, every
  charge in booking order, income and mining, and the result underneath. The
  forecast uses exactly the server's rules; only battles and conquests in the same
  turn can still change the income.
- **Only affordable orders are accepted.** When the money runs out, `+` in the
  shipyard is disabled and the server rejects the order with a notice. Raising the
  research share afterwards stops at the highest value at which the orders still
  add up – **orders come first**. A build that fails for lack of money at the end
  of the turn therefore does not happen.

## Combat and conquest

When hostile fleets meet in an orbit, they fight – those who deal damage at the
front, those who need protecting behind. A fleet that leaves while an armed enemy
holds the orbit is **intercepted** and has to survive three more rounds of combat.
Every battle can be replayed afterwards: click its notice to open the recording.

A world falls when an attacker holds the orbit and neither orbital defence nor
defence battery survived. The population drops in the process, the rest changes
hands.

## Galaxy shape: scatter or spiral

*Scatter* spreads the worlds evenly. *Spiral* builds a galaxy the way you picture
one: two or three logarithmic arms around a dense core, and at the centre a
**black hole** with a name such as *Charybdis* or *Nyx*.

The hole is terrain, not a backdrop. Around the maw lies a **no-go zone** (dashed
ring): no world forms there and no fleet flies into it. A fleet heading for a target
behind it is **routed around automatically**. The path gets longer and costs turns;
**range** also measures the flyable path rather than the straight line – worlds
behind the hole are further away in play than they look. The range outline on the
map therefore has a dent towards the hole, and *Fleet here* is disabled from the
start for unreachable worlds.

A spiral grows outwards: push to the tips of the arms and the arms reach further,
with new worlds forming along them.

## Two playing fields: classic and space

*Classic* is the flat star map. *Space* spreads the same game across three
dimensions: the worlds lie in a **lens**, thicker in the middle, thinner towards the
rim. Distances, range and scanners then compute in three dimensions.

![The same game in the space view, worlds in a lens above the grid](screenshots/map-space-en.webp)

Three reading aids keep space legible: a **grid** in the mid-plane, a **plumb
line** from every world down to it (that is how you read its height) and a grading
of size and brightness by distance. For the controls see [Controls](#controls).

## A galaxy without an edge

When a fleet or settled world comes closer than 200 ly to the border, the map
pushes out there and a new strip of worlds appears – at most one per turn. The
further out, the harsher the worlds (more extreme temperature and gravity), but with
more and better metal. Settling out there pays off, but costs terraforming and
radical tech. With 16 AI the map grows from 96 to around 390 worlds in 120 turns.
It can be switched off in the lobby.

## The AI empires

AI empires enter under names of their own – from *Admiral Wobblebeard* to *Czarina
Candyfloss* – and each with a personality of its own:

| Personality | Play style |
|---|---|
| **Conqueror** | picks a rival and rolls it up world by world |
| **Settler** | spreads out and only fights back |
| **Technocrat** | strikes late, with better technology |
| **Raider** | sends fast packs after weak colonies |
| **Bulwark** | walls itself in with satellites until it breaks out |
| **Vulture** | takes whatever the others leave behind |

They remember who attacked them, quietly gang up on a runaway leader and lose
patience as the game drags on.

They only attack when the fleet can break the defence in **one turn** – the defence
battery regrows from the population every turn, so a siege achieves nothing. When an
empire falls back to three known worlds it becomes the **war target**: the fleets
gather and only strike once there is enough for the killing blow.

### Difficulty

Every AI empire plays at one of two levels. In the lobby the host switches it with a
tap on the button next to the AI; *Play 5 AI right away* rolls it for each opponent.

| Level | What it does |
|---|---|
| **Normal** | plays its personality as described above |
| **Hard** | grows faster and learns from its mistakes |

A hard empire builds every colony ship at the shipyard right next to the free world
it is meant for and sends it there on the short way – one ship per world, a good
world nearby before a slightly better one far away – instead of sending them all
across the empire from the capital. It terraforms where
a credit buys the most people. It also keeps a war diary. A strike that failed is not repeated with the same
force – that world needs clearly more next time, and its owner is reckoned stronger
everywhere; successes make it bolder again. It counts enemy fleets that can come to
the rescue within two turns, calls back a strike whose target has grown too strong
in the meantime, and avoids worlds where its colony ships were shot down.

It also splits fleets in flight. A strike fleet with firepower to spare peels off a
detachment against a second, weaker world it reaches in the same turn – so there is
no turn left to react. And a small foreign fleet heading for a free world (most
likely a colony ship) may find a few of its fighters waiting there. It only sees
what you would see: course, arrival and number of ships, not what they are.

## Watching

*Watch a game* sets up a game with 4 to 16 AI empires. There is no empire of your
own; in exchange everything is open: every world, every fleet including its
composition, the full log and a table of all empires.

At the top right sit **Pause**, **Step** and the speeds ½× to 4× (1× is one turn
every 1.5 seconds); the space bar pauses. The game code at the top left lets more
spectators join via *Join*. Watching only works for all-AI games – otherwise a
spectator would see everyone's cards.

## Ranking and victory

The ranking orders the empires by **population**, ties broken by worlds, then by
ships. That is also how the game is decided: whoever has the most people at the
turn limit wins. Without a turn limit, the last empire standing wins.

When a game ends, who won stays up on the screen for everyone. *Weiter* opens
a dialog about what happens next: only the host can extend the game by more
turns instead of ending it there; everyone else only chooses between
returning to the start screen and staying as they are.

## Controls

| Action | Input |
|---|---|
| Move / zoom the map | Drag, mouse wheel, `+` / `−`, buttons at the top right |
| Select | Left click on a world or fleet |
| Set course | Pick a fleet, then **right-click** (or shift-click) the target world – or click the target world and use *Fleet here* in the panel |
| See where fleets go | Each course line starts at its fleet – fleets in orbit wait on the side facing their target – and ends in an arrowhead. Select a fleet or point at it: its line stands out with the turns until arrival |
| Split a fleet | Select the fleet, *Split fleet …*, then drag ships from one column to the other – a tap moves a single ship. *Each ship as a fleet of its own* turns the right column into single-ship fleets; *All single* breaks up the whole fleet at once (e.g. colony ships for several worlds). This works in flight too: both parts fly on to the same target until you give the new fleet a course of its own |
| End turn | Button in the middle of the top bar or `space` |
| Show the budget | Click or hover over money or metal in the top bar |
| Fit the map | `F` |
| Bring only your own forward | Hold `E` – everything that is not yours fades far back. Or the flag button at the top right: a tap toggles it (the way on a phone), holding shows it only while held |
| Clear selection | `Esc` |
| Help | `H` |
| Move / resize windows | Drag the title bar to move; drag any edge or corner to resize |
| Minimize windows | **−** in the title bar or double-click it: the window becomes an icon in the top bar (★ research/empire/rankings, ☰ events/comms – with the count of unread comms). A click on the icon brings it back where it was. Position, size and state are remembered |
| Comms (chat) | *Comms* tab in the log window. Messages you have not seen pop up and are counted on the tab – tap the message to reply. Smileys like `:)` `:(` `:D` `;)` `<3` turn into emojis, so do codes like `:sad:` `:rocket:` `:thumbsup:`; the 🙂 button next to the field shows them all |
| Menu: display, sound, leaving | Gear at the top right, next to fit and zoom |
| Pause for everyone | Host only, in games with a turn timer: pause button next to *End turn* or `P` – the timer stops and no turn resolves until the host resumes; orders and chat keep working |
| Leave the game | *Leave the game* in the menu (gear at the top right) |

Additionally on the **space** field:

| Action | Input |
|---|---|
| Rotate camera | Drag |
| Pan the focus | **Shift**+drag (or middle button) |
| Top-down view | `T` |

## On a phone or tablet

When the window is **narrower than 900** or **shorter than 560 points**, the
interface rearranges itself – phones in both orientations and tablets such as
the iPad in portrait:

- Instead of the floating windows there is a **bar along the bottom**
  (Map · Empire · Selection · Log · More); only one **sheet** is open at a time.
- In portrait the sheet sits at the bottom, in landscape on the right.
- Tapping a world opens its sheet and moves it into the free part of the map;
  tapping empty space closes it.
- The top bar becomes a single row; *Leave the game* lives under *More*.

<p align="center"><img src="screenshots/phone-en.webp" width="640" alt="Ho!! on a phone: the map with fleets and courses on the left, the home world's sheet on the right"></p>

| Gesture | Classic | Space |
|---|---|---|
| Drag one finger | pan the map | rotate the camera |
| Spread / pinch two fingers | zoom | zoom |
| Drag two fingers | pan the map | pan the focus |
| Tap | select | select |

Setting a course needs no right click: tap the fleet, tap the target world, use
*Fleet here* in the sheet.

A tablet in landscape keeps the floating windows; on any touch screen buttons,
tabs and grips grow to fingertip size.

## The look

The planets deliberately follow the style of the original: glossy, richly coloured
spheres where **colour shows temperature** (blue = icy to red = scorching) and
**size shows gravity**. The more habitable a world becomes, the more Earth-like it
looks – oceans, continents with ragged coastlines, clouds and polar caps. So
terraforming is visible right on the map.

Settled worlds tint their surroundings in the colour of their empire; neighbouring
worlds merge into one area, so a glance tells you who owns which corner. The ships
are drawn by hand – each class with its own silhouette, engine glow, panel lines,
navigation lights and player colour; the colony ship is recognisable by its three
habitat domes.
