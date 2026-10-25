// One breakpoint for everyone who needs it. "Compact" means: too narrow for
// docks side by side (phone or tablet in portrait - two docks of 300 and 340
// px would leave an iPad hardly any map) or too low for them (phone in
// landscape, split window). In both cases the sheet bar applies.
//
// Must match the media query in client/css/style.css - if one changes, the
// other changes with it.
export const COMPACT = '(max-width: 900px), (max-height: 560px)';
export const compact = matchMedia(COMPACT);

// Mouse and keyboard at hand (desktop, laptop): a text field may take the
// focus by itself. On a touch screen that would pop up the on-screen
// keyboard and cover half the game - there the player taps the field.
export const desktop = matchMedia('(hover: hover) and (pointer: fine)');
