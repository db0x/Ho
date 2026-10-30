// Names for the big ships (destroyers): historical ships from many seas and
// centuries - warships, explorers, record breakers - and a few from the Alien
// films and from Star Trek. Every name only once per game; when the list runs
// out, the names come back with a number, as navies do it too ("Victory II").
// The player can rename a ship at any time.

export const SHIP_NAMES = [
  'Victory', 'Enterprise', 'Hood', 'Dreadnought', 'Mikasa', 'Vasa',
  'Mary Rose', 'Santa María', 'Endeavour', 'Beagle', 'Bounty', 'Constitution', 'Missouri',
  'Warspite', 'Potemkin', 'Varyag', 'Emden', 'Nautilus',
  'Golden Hind', 'Mayflower', 'Cutty Sark', 'Fram', 'Gjøa', 'Discovery', 'Resolution',
  'Erebus', 'Terror', 'Endurance', 'Belgica', 'Kon-Tiki', 'Argo', 'Pinta', 'Niña',
  'Hetman Sahaidachny', 'Zaporizhzhia',
  'Richelieu', 'Jean Bart', 'Redoutable', 'Bucentaure', 'Santísima Trinidad', 'Kronan',
  'Gustav Vasa', 'Niels Juel', 'Peder Skram',
  'Re d’Italia', 'Lexington', 'Yorktown', 'Hornet', 'Monitor', 'Merrimack', 'Olympia',
  'Iowa', 'Texas', 'Arizona', 'Nelson', 'Rodney', 'Ark Royal', 'Repulse', 'Renown',
  'Invincible', 'Indomitable', 'Thunderer', 'Temeraire', 'Bellerophon', 'Agamemnon',
  'Seydlitz', 'Derfflinger', 'Moltke', 'Hindenburg',
  'Gorch Fock', 'Passat', 'Pamir', 'Statsraad Lehmkuhl',
  'Esmeralda', 'Almirante Latorre', 'Minas Geraes', 'Rivadavia', 'Huáscar', 'Belgrano',
  'Sovereign of the Seas', 'Great Michael', 'Henri Grâce à Dieu', 'Mars', 'Elefanten',
  'Batavia', 'Zeven Provinciën', 'De Ruyter', 'Halve Maen', 'Duyfken', 'São Gabriel',
  'Flor de la Mar', 'Victoria', 'Trinidad', 'Hjejlen', 'Jylland', 'Averof', 'Olympias',
  // From the Alien films
  'Nostromo', 'Narcissus', 'Sulaco', 'Auriga', 'Betty', 'Prometheus', 'Covenant', 'Corbelan',
  // From Star Trek (Enterprise and Discovery are already there)
  'Defiant', 'Voyager', 'Excelsior', 'Reliant', 'Stargazer', 'Cerritos', 'Titan', 'Constellation',
  'Equinox', 'Kelvin', 'Shenzhou', 'Protostar', 'Sutherland', 'Thunderchild', 'Rotarran',
  'Shangri-La', 'Prince of Darkness', 'Titanic', 'Yamato', 'Shinano',
  // The battlestars of Battlestar Galactica, old series and new
  // (Prometheus is already there)
  'Galactica', 'Pegasus', 'Atlantia', 'Acropolis', 'Columbia', 'Pacifica', 'Triton',
  'Rycon', 'Solaria', 'Valkyrie', 'Night Flight', 'Erasmus', 'Yashuman',
  // Perry Rhodan and Wing Commander
  'Sol', 'Crest', 'Tiger’s Claw'
];

/** A name for a new big ship that nobody in this game carries yet. */
export function pickShipName(game) {
  const used = game.usedShipNames || (game.usedShipNames = {});
  const free = SHIP_NAMES.filter(n => !used[n]);
  // Random from the game's own generator: the same seed, the same names.
  const pool = free.length ? free : SHIP_NAMES;
  const base = pool[Math.floor(game.rng() * pool.length)];
  used[base] = (used[base] || 0) + 1;
  return used[base] > 1 ? `${base} ${roman(used[base])}` : base;
}

function roman(n) {
  const r = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of r) while (n >= v) { out += s; n -= v; }
  return out;
}
