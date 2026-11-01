// The empires of a game: taking a seat, leaving it, colors and emblems, and
// what sets an AI empire apart - its name, personality and level.
import {
  AI_PERSONAS, PLAYER_COLORS, PLAYER_EMBLEMS, AI_LEVELS, TECH_FIELDS, TECH_START_LEVEL
} from '../../shared/rules.js';

// Names for AI empires - rather silly than numbered.
const BOT_NAMES = [
  'Admiral Wobblebeard', 'Captain Cupholder', 'Baroness Breadbox', 'Admiral Grumbleguts',
  'Dr. Thrustworthy', 'Colonel Fearnaught', 'Emperor Kerfuffle', 'Consul Shortcircuit',
  'Matron Moondust', 'Overlord Nevermind', 'Warden Vacuum', 'Lady Solderpot',
  'Senator Hiccup', 'General Goosebump', 'Czarina Candyfloss', 'Doge Thunderplate',
  'Caliph Crackercrumb', 'Tribune Tomfoolery', 'Duke Hailstone', 'Admiral Anchortoss',
  'Marshal Marmot', 'Navigator Nightcrow', 'Commodore Coffeepot', 'Baron Fumblefinger',
  'Reeve Lightyear', 'Despot Deepfreeze', 'Duchess Shimmerglow', 'Primarch Somersault',
  'Chancellor Pebble', 'Warlord Fibberstone', 'Steward Stumble', 'Commandant Button',
  'Doctor Tincan', 'Vizier Charcoal', 'Hetman Heatblanket', 'Viceroy Wobbletooth',
  'Count Plasmaboost', 'Praetor Nonsuch', 'Captain Casserole', 'Prefect Pillowfort',
  'Squire Sprocket', 'Bishop Bellyflop'
];

/** A nickname still free; once all are taken, the number counts. */
function botName(game) {
  const used = new Set(game.players.map(p => p.name));
  const free = BOT_NAMES.filter(n => !used.has(n));
  return free.length
    ? free[Math.floor(Math.random() * free.length)]
    : 'AI ' + (game.players.length + 1);
}

/**
 * Personality for a new AI empire: the one that is still rarest in the
 * game - that way every round gets a colorful mix.
 */
function botPersona(game) {
  const count = Object.fromEntries(AI_PERSONAS.map(k => [k, 0]));
  for (const p of game.players) if (p.isBot && p.persona in count) count[p.persona]++;
  const fewest = Math.min(...Object.values(count));
  const free = AI_PERSONAS.filter(k => count[k] === fewest);
  return free[Math.floor(Math.random() * free.length)];
}

/** The first color of the palette that nobody wears yet. */
function freeColor(game) {
  const taken = new Set(game.players.map(p => p.color));
  return PLAYER_COLORS.find(c => !taken.has(c)) || PLAYER_COLORS[game.players.length % PLAYER_COLORS.length];
}

/**
 * Pick a color. Every color exists only once; if someone already wears it,
 * the two swap - so every color stays selectable even with 16 empires.
 */
export function setPlayerColor(game, player, color) {
  if (game.state !== 'lobby' || !PLAYER_COLORS.includes(color)) return false;
  const other = game.players.find(p => p !== player && p.color === color);
  if (other) other.color = player.color;
  player.color = color;
  return true;
}

export function addPlayer(game, { name, isBot = false, connId = null, persona = null, level = null, avatar = null, account = null, accountKey = null }) {
  if (game.players.length >= 16) return null;
  const slot = game.players.length;
  // Ids stay unique even if someone left in between.
  let num = slot + 1;
  while (game.players.some(p => p.id === 'p' + num)) num++;
  const p = {
    id: 'p' + num,
    slot,
    name: name || (isBot ? botName(game) : 'Player ' + (slot + 1)),
    color: freeColor(game),
    avatar,
    account,
    accountKey,             // normalized account name: one seat per account and game
    emblem: PLAYER_EMBLEMS[slot],
    isBot,
    persona: isBot ? (AI_PERSONAS.includes(persona) ? persona : botPersona(game)) : null,
    level: isBot ? (AI_LEVELS.includes(level) ? level : 'normal') : null,
    connId,
    joinedAt: Date.now(),
    connected: !isBot,
    alive: true,
    ready: false,
    money: 0,
    metal: 0,
    income: 0,
    tech: Object.fromEntries(TECH_FIELDS.map(f => [f, TECH_START_LEVEL])),
    researchPoints: Object.fromEntries(TECH_FIELDS.map(f => [f, 0])),
    research: {
      budgetPct: 40,
      weights: Object.fromEntries(TECH_FIELDS.map(f => [f, 1]))
    },
    explored: new Set(),
    knowledge: {},            // planetId -> last known state
    seenMouths: new Set(),    // wormhole mouths in sight once
    knownHoles: new Set(),    // wormholes jumped through: both ends known
    orders: { builds: {}, moves: {}, unload: {}, refit: {} },
    stats: { planets: 0, pop: 0, ships: 0, kills: 0, losses: 0 }
  };
  game.players.push(p);
  return p;
}

export function removePlayer(game, playerId) {
  const i = game.players.findIndex(p => p.id === playerId);
  if (i < 0) return;
  game.players.splice(i, 1);
  // The color stays as chosen; only the slots move up.
  game.players.forEach((p, idx) => {
    p.slot = idx;
    p.emblem = PLAYER_EMBLEMS[idx];
  });
}

/** The host sets how well an AI empire plays - only in the lobby. */
export function setBotLevel(game, player, level) {
  if (game.state !== 'lobby' || !player?.isBot || !AI_LEVELS.includes(level)) return false;
  player.level = level;
  return true;
}
