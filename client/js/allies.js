// What the view tells about alliances - as far as this empire knows them:
// its own, public ones and secret ones it has seen through. For the panels,
// the map and the range of the fleets (allied worlds supply them too).

/** Is this empire one of my allies (this turn - under notice it still is)? */
export function isAlly(v, id) {
  return !!id && !!v?.me?.allies?.includes(id);
}

/** Do my fleets get supply from this owner's worlds - own or allied? */
export function suppliesMe(v, owner) {
  return !!owner && (owner === v.you || isAlly(v, owner));
}

/** The known alliance of two empires, or null. */
export function allianceOf(v, a, b) {
  return v?.diplomacy?.alliances?.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a)) || null;
}

/** Known allies of an empire, with the alliance each. */
export function alliesOf(v, id) {
  return (v?.diplomacy?.alliances || []).filter(x => x.a === id || x.b === id)
    .map(x => ({ id: x.a === id ? x.b : x.a, alliance: x }));
}
