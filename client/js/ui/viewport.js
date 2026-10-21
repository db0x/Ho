// One breakpoint for everyone who needs it. "Compact" means: too narrow for
// docks side by side (phone in portrait) or too low for them (phone in
// landscape, split window). In both cases the sheet bar applies.
//
// Must match the media query in client/css/style.css - if one changes, the
// other changes with it.
export const COMPACT = '(max-width: 760px), (max-height: 560px)';
export const compact = matchMedia(COMPACT);
