// Ein Umschaltpunkt für alle, die ihn brauchen. "Klein" heißt: zu schmal für
// nebeneinanderliegende Docks (Telefon hochkant) oder zu niedrig dafür
// (Telefon quer, geteiltes Fenster). In beiden Fällen gilt die Blattleiste.
//
// Muss zur Medienabfrage in client/css/style.css passen - ändert sich die
// eine, ändert sich die andere mit.
export const KLEIN = '(max-width: 760px), (max-height: 560px)';
export const klein = matchMedia(KLEIN);
