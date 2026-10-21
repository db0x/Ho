# Entwicklung

*[English](development.md) · **Deutsch*** · [← Übersicht](../readme.de.md)

- [Aufbau](#aufbau)
- [Grundsätze](#grundsätze)
- [Sprachen](#sprachen)
- [Ton](#ton)
- [Grafik](#grafik)
- [Tests](#tests)
- [Was noch fehlt](#was-noch-fehlt)

## Aufbau

Kein Build-Schritt, keine Framework-Abhängigkeiten – nur `ws` auf dem Server.
Client und Server teilen sich Regeln und Haushaltsrechnung.

```
shared/
  rules.js           Spielregeln, Kosten- und Kampfformeln (Server + Browser)
  budget.js          Haushalt einer Runde: Vorschau im Client, Prüfung im Server
  i18n.js            Übersetzungskern (Browser + Node)
server/
  index.js           HTTP + WebSocket, Lobby, Partieverwaltung, Zuschauertakt
  game.js            Spielzustand, Zugauflösung, Sichten (Spieler und Zuschauer)
  galaxy.js          Sternkarte: Streufeld oder Spirale, Ausdehnung (deterministisch über einen Seed)
  bot.js             KI-Gegner mit Charakteren; spielt nach denselben Regeln
  auth.js            Zugang: Sitzungen, Anmeldung, Passwortwechsel, Torwächter
  userstore.js       Konten auf der Platte: Name, scrypt-Hash, Profil – atomar geschrieben
  profile.js         Anzeigenamen und Profilbilder: prüfen, speichern, ausliefern
  users.js           Werkzeug für den Host: add, del, passwd, name, admin, list
client/
  index.html         Startbildschirm, Lobby, Spielbildschirm
  login.html         Anmeldung und erster Passwortwechsel
  img/               logo.svg (Wortmarke), mark.svg (Tab-Symbol)
  i18n/              de.json, en.json – Textkataloge
  js/main.js         Verdrahtung, Spielschleife, Rundenwechsel
  js/net.js          WebSocket mit automatischem Wiederverbinden
  js/render/         planets.js, ships.js (Karte), shipshd.js (Steckbrief, Schlacht),
                     map.js (flach), space.js (räumlich), fx.js, battlefx.js
  js/ui/             lobby.js, hud.js (alle Panels samt Haushalt), select.js (Auswahllisten),
                     dialog.js (Fenster), avatar.js, battle.js, shipinfo.js, viewport.js,
                     admin.js (Admin-Panel im Startbildschirm)
  js/audio/sfx.js    Klangeffekte, zur Laufzeit synthetisiert
test/                siehe Tests
```

## Grundsätze

**Der Server rechnet, der Client zeigt an.** Jeder Spieler bekommt eine eigene,
gefilterte Sicht: unerforschte Welten sind nur Positionen, einmal besuchte zeigen
den letzten bekannten Stand, und von fremden Flotten ist nur die Schiffszahl
sichtbar – nie Technikstand oder Hülle.

**Aufklärung reicht bis zum Kurs.** Eine fremde Flotte wird geortet, wenn sie bei
einer sichtbaren Welt steht, näher als 300 Lj an einer eigenen Welt oder näher als
240 Lj an einer eigenen Flotte. Dann sieht man auch, wohin sie fliegt und wann sie
ankommt – womit sie fliegt, bleibt verdeckt.

**Eine Rechnung für Anzeige und Regel.** Was der Client vorhersagt, rechnet er mit
denselben Funktionen wie der Server: Reichweite und Wege um das schwarze Loch
(`holeZone`, `route`, `travelDistance`, `reachOutline` in `shared/rules.js`) und
den Haushalt (`forecast` in `shared/budget.js`). Der Server nimmt mit derselben
Rechnung nur bezahlbare Aufträge an; `test/budget.js` hält Vorschau und
tatsächliche Abbuchung Posten für Posten gegeneinander.

**Zeichnen kostet, also wird gespart.** Im Leerlauf zeichnet die Karte mit 20
Bildern pro Sekunde (`IDLE_FPS` in `client/js/main.js`), bei Eingabe und neuer
Sicht sofort wieder mit voller Rate. Hintergrund, Nebel und Gebietsfarben liegen in
einem Zwischencanvas; Planeten und Schiffe werden einmal als Bild vorgezeichnet –
in der Auflösung des Bildschirms – und danach nur kopiert. Ein versteckter Tab
zeichnet nichts.

## Sprachen

Die Oberfläche spricht **Deutsch und Englisch**; umschalten geht mitten in der
Partie, ohne Neuladen. Im Code steht kein Satz, den ein Mensch liest – nur
Schlüssel (`log.arrive`, `ledger.title`); die Sätze stehen in den Katalogen:

```
shared/i18n.js       Kern: t(), Platzhalter {name}, Mehrzahl (#one/#other), Zahlen
client/js/i18n.js    Sprache erkennen und merken, Markup mit data-i18n füllen
client/i18n/*.json   ein Katalog je Sprache
```

Auch der Server schickt Schlüssel samt Werten statt Sätzen
(`{ key: 'log.built', params: { planet: 'Sirrah', count: 3, ship: 'fighter' } }`) –
so sieht jeder Spieler dasselbe Ereignis in seiner Sprache. Im Markup werden Texte
ausgezeichnet statt eingetragen:

```html
<button data-i18n="top.endTurn"></button>
<input data-i18n-attr="placeholder:chat.placeholder">
<p data-i18n-html="help.goal.p"></p>
```

Eine weitere Sprache braucht eine Datei in `client/i18n/`, eine Zeile in
`client/js/i18n.js` und gegebenenfalls eine Mehrzahlregel in `shared/i18n.js`.

## Ton

Die Effekte werden im Browser **synthetisiert** – keine Audiodateien, keine
Abhängigkeit. Jeder Klang entsteht aus Oszillatoren und gefiltertem Rauschen; die
Rezepttabelle in `client/js/audio/sfx.js` legt Tonhöhen, Hüllkurven und Filter
fest. Ereignisse mit Planetenbezug klingen dort, wo die Welt auf dem Bildschirm
liegt. Viele gleichzeitige Ereignisse werden gestaffelt, nach Wichtigkeit sortiert
und begrenzt. Nach 20 Sekunden Stille hält sich der Audiokontext an.

## Grafik

Es gibt keine Assets im üblichen Sinn. Planeten, Schiffe und Effekte sind
Canvas-Zeichenbefehle; die Schiffe gibt es zweimal – kompakt für die Karte
(`ships.js`) und ausführlich für Steckbrief und Schlacht (`shipshd.js`), mit
denselben Silhouetten. Das **Logo** ist handgezeichnetes SVG ohne Schriftart (alles
Pfade) und skaliert vom Startbildschirm bis zum 16-Punkte-Tabsymbol.

## Tests

```
npm test               # alle Testläufe
npm run test:i18n      # Kataloge: gleiche Schlüssel, gleiche Platzhalter, Serverschlüssel
npm run test:engine    # 120 Runden mit 16 KI, Bilanz- und Zustandsinvarianten
npm run test:hole      # Spiralpartie: Sperrzone um das schwarze Loch hält
node test/intercept.js # Abfangen beim Abflug aus einem umkämpften Orbit
npm run test:budget    # Haushalt: Vorschau = Abbuchung, kein Auftrag fällt aus
npm run test:net       # echter Server, 16 Clients, Simultanzug, Farbwahl, Trennung, Chat
npm run test:auth      # Zugang: Hashes, Konten, Profil, Anmeldung, Rateschutz
```

`test:budget` lässt Bot-Partien mit zufälligen, auch unsinnigen Aufträgen laufen;
mit `HO_SEED=…` lässt sich ein anderer Verlauf wählen.

## Was noch fehlt

- Diplomatie und Bündnisse
- Dauerhafte Speicherung laufender Partien (derzeit nur im Serverspeicher)
- Hintergrundklang (bisher nur Effekte, keine Atmosphäre und keine Musik)
- Eine in die Enge getriebene KI igelt sich nur ein: sie häuft Schiffe auf ihrer
  letzten Welt an, statt auszubrechen
