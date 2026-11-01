// The personalities of the AI empires.


/*
 * The personalities. The numbers are inclinations, not laws - endgame
 * pressure pushes all of them towards attack over the course of the game.
 *
 *   research    share of the treasury for research, early / late (percent)
 *   weights     research priorities, early / late
 *   build       share of the rest that goes into ships
 *   terra       share of the rest for terraforming
 *   settlers    colony ships allowed to be under way at the same time
 *   fleet       how fast the fleet may grow with the turns
 *   fighters    fighters per turn
 *   satellites  appetite for satellites at threatened worlds
 *   capital     one destroyer per this many fighters once unlocked (0 = none -
 *               too slow for a raider)
 *   campaign    'always' | 'retaliation' (only whoever strikes gets it back)
 *               | 'pressure' (only once it has got stuck)
 *   from        campaigns no earlier than this turn
 *   margin      how much superiority must be assembled before striking
 *   solo        what a fleet attacks on its own: 'prey' (anything it can
 *               crack), 'near' (only at its own border),
 *               'carrion' (only the weakened), 'never'
 *   vengeance   how resentful
 *   vsLeader    how much it wants to keep the front-runner small
 *   garrison    stays home when threatened (from 0.3)
 *   wormholes   curious enough to send ships through wormholes
 */
export const PERSONAS = {
  // Picks a neighbor as rival and rolls it up world by world.
  conqueror: {
    research: [32, 25],
    weights: [{ range: 3, speed: 2, weapons: 3, shields: 2, mini: 2, radical: 1, recycling: 0 },
              { range: 2, speed: 2, weapons: 4, shields: 3, mini: 2, radical: 1, recycling: 0 }],
    build: 0.72, terra: 0.25, settlers: 3, fleet: 1.5, fighters: 6, satellites: 2, capital: 8,
    campaign: 'always', from: 15, margin: 1.15, solo: 'prey',
    vengeance: 1.5, vsLeader: 0.4, garrison: 0
  },
  // Spreads out, terraforms and defends itself - war only as an answer.
  settler: {
    research: [36, 32],
    weights: [{ range: 4, speed: 2, weapons: 1, shields: 1, mini: 2, radical: 4, recycling: 0 },
              { range: 3, speed: 2, weapons: 2, shields: 3, mini: 2, radical: 3, recycling: 1 }],
    build: 0.6, terra: 0.45, settlers: 5, fleet: 0.8, fighters: 3, satellites: 2, capital: 12,
    campaign: 'retaliation', from: 45, margin: 1.4, solo: 'near',
    vengeance: 0.8, vsLeader: 0.3, garrison: 0.4, wormholes: true
  },
  // Researches a lot, builds little, refits - and then strikes with quality.
  technocrat: {
    research: [50, 40],
    weights: [{ range: 2, speed: 2, weapons: 3, shields: 3, mini: 3, radical: 2, recycling: 0 },
              { range: 2, speed: 2, weapons: 4, shields: 4, mini: 3, radical: 1, recycling: 1 }],
    build: 0.65, terra: 0.3, settlers: 3, fleet: 0.8, fighters: 4, satellites: 1, capital: 8,
    campaign: 'always', from: 70, margin: 1.3, solo: 'never',
    vengeance: 1.0, vsLeader: 1.0, garrison: 0.2, refits: true
  },
  // Fast packs that raid weakly defended colonies all over the map. It avoids
  // big worlds until there is nothing else left.
  raider: {
    research: [30, 26],
    weights: [{ range: 3, speed: 4, weapons: 2, shields: 1, mini: 2, radical: 1, recycling: 0 },
              { range: 3, speed: 4, weapons: 3, shields: 2, mini: 2, radical: 1, recycling: 0 }],
    build: 0.75, terra: 0.2, settlers: 2, fleet: 1.4, fighters: 5, satellites: 0, capital: 0,
    campaign: 'pressure', from: 8, margin: 1.0, solo: 'prey',
    vengeance: 1.2, vsLeader: 1.0, garrison: 0, packs: true, scouts: 5, wormholes: true
  },
  // Satellites at every border. But not an eternal hedgehog: once the wall
  // is tight, it breaks out with a big fleet.
  bulwark: {
    research: [38, 32],
    weights: [{ range: 2, speed: 1, weapons: 2, shields: 4, mini: 2, radical: 3, recycling: 0 },
              { range: 2, speed: 2, weapons: 3, shields: 4, mini: 2, radical: 2, recycling: 1 }],
    build: 0.6, terra: 0.45, settlers: 3, fleet: 0.9, fighters: 3, satellites: 3, capital: 6,
    campaign: 'always', from: 100, margin: 1.25, solo: 'near',
    vengeance: 1.0, vsLeader: 0.5, garrison: 0.5, refits: true
  },
  // Waits until others tear each other apart and takes what is left:
  // freshly conquered worlds, broken batteries, empires on the ground.
  vulture: {
    research: [32, 28],
    weights: [{ range: 3, speed: 3, weapons: 2, shields: 2, mini: 2, radical: 2, recycling: 0 },
              { range: 3, speed: 3, weapons: 3, shields: 2, mini: 2, radical: 1, recycling: 2 }],
    build: 0.7, terra: 0.3, settlers: 2, fleet: 1.2, fighters: 4, satellites: 1, capital: 10,
    campaign: 'always', from: 25, margin: 1.0, solo: 'carrion',
    vengeance: 0.5, vsLeader: 0.8, garrison: 0.1, carrion: true, scouts: 5, wormholes: true
  }
};
