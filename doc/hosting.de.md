# Betrieb

*[English](hosting.md) · **Deutsch*** · [← Übersicht](../readme.de.md)

- [Mit Node starten](#mit-node-starten)
- [Mit Docker](#mit-docker)
- [Zugang und Konten](#zugang-und-konten)
- [Was die Anmeldung aushält](#was-die-anmeldung-aushält)
- [Hinter einem Reverse-Proxy](#hinter-einem-reverse-proxy)
- [Einstellungen](#einstellungen)
- [Daten](#daten)

## Mit Node starten

Voraussetzung ist Node 22 oder neuer (empfohlen: 26).

```
npm install
npm run users -- add captain   # Zugang anlegen, Passwort wird ausgegeben
npm start                      # http://localhost:8080
```

Zum Entwickeln, wo nur du spielst, nimmt `HO_AUTH=off npm start` die Anmeldung
weg; `npm run dev` startet den Server bei jeder Änderung neu. Der Port lässt sich
über `PORT` setzen (`PORT=3000 npm start`).

## Mit Docker

```
mkdir -p data                      # vorher anlegen, sonst gehört es root
docker compose up -d --build       # http://localhost:8080
docker compose logs -f             # Serverausgabe
docker compose down                # stoppen
```

Der Host-Port lässt sich über `HOST_PORT` verschieben
(`HOST_PORT=3000 docker compose up -d`); im Container hört der Server weiter auf
8080. Die Tests laufen im selben Image:

```
docker compose --profile test run --rm test
```

Im Container ist die Anmeldung an. Lokal schaltest du sie mit einer `.env` neben
der `docker-compose.yml` ab (Vorlage: `.env.example`):

```
HO_AUTH=off
```

Auf einem Server gehört diese Zeile nicht hin – ohne sie bleibt die Anmeldung an.
Ob sie läuft, sagt das Protokoll beim Start (`docker compose logs ho | grep Zugang`).

### Der Sprachdienst

`docker compose up` startet einen zweiten Container, `tts`: Er spricht die
[Funksprüche](playing.de.md#funksprüche) mit den Kokoro-Stimmen – lokal, ohne
Konto, ohne Kosten. Nur der Spielserver erreicht ihn; er öffnet keinen Port. Er
braucht etwa 1 GB RAM und einen CPU-Kern, solange er spricht (ein Satz dauert etwa
eine Sekunde); der erste Build lädt das Stimmmodell (~350 MB, gegen eine Prüfsumme
geprüft).

Beim Start lässt der Spielserver alle festen Sprüche einmal im Hintergrund
sprechen (die Antworten der Crew zuerst; etwa acht Minuten, einmalig) und legt sie
in `data/tts-cache/` ab – sie überstehen Neustarts und neue Images. Auch der
Sprachdienst behält sie, im Docker-Volume `tts-cache`: Ein frischer Spiel-Container
hat sie in Sekunden zurück. Sprüche mit Namen (*„Kepler Prime is mine
now, Olena.“*) werden gesprochen, wenn sie gebraucht werden, und landen ebenfalls
dort (höchstens 3000, die ältesten gehen).

Ohne den Dienst – `HO_TTS=` leer in der `.env`, schlicht `npm start` oder der
Container ist aus – läuft das Spiel wie immer, nur der Funk bleibt stumm. Der
Spielserver schaut alle 30 Sekunden, ob er wieder da ist. Admins sehen den Zustand
in der Lobby unter dem Schalter *Funksprüche*: nicht eingerichtet, nicht
erreichbar oder wie weit die Vorbereitung ist.

Die Sprüche selbst stehen in `server/radio/lines.json`; um neue anzuhören, bevor
sie live gehen, spricht `tools/radio/preview.py` sie in einen Ordner.

## Zugang und Konten

Vor der Lobby steht eine Anmeldung mit Benutzername und Passwort. Ohne gültige
Sitzung gibt der Server weder den Spielclient noch die WebSocket heraus – das Spiel
läuft über die WebSocket, eine Anmeldung nur vor der Seite wäre also keine.

Konten entstehen und verschwinden auf dem Host, nicht im Browser:

```
docker exec ho node server/users.js add captain                # gewürfeltes Passwort
docker exec ho node server/users.js add captain geheim-genug   # oder ein eigenes
docker exec ho node server/users.js list                       # wer darf mitspielen
docker exec ho node server/users.js passwd captain             # Passwort zurücksetzen
docker exec ho node server/users.js name captain Captain       # Schreibweise des Kontonamens
docker exec ho node server/users.js del captain                # Konto löschen
docker exec ho node server/users.js admin captain              # zum Admin machen (… admin captain off)
docker exec ho node server/users.js inviter captain            # Einladerecht geben (… inviter captain off)
docker exec ho node server/users.js block captain              # Konto sperren (… block captain off)
```

Ohne Docker genauso, nur kürzer: `npm run users -- add captain`.

- `add` gibt das erste Passwort **einmal** aus – der einzige Moment, in dem es im
  Klartext existiert. Es gilt nur für die erste Anmeldung; danach wählt der Spieler
  ein eigenes, bevor er in die Lobby kommt. Nach `passwd` genauso.
- Ihr Passwort ändern Spieler jederzeit selbst: *Passwort ändern* neben *Abmelden*
  im Startmenü. Das bisherige Passwort wird noch einmal abgefragt; alle anderen
  Sitzungen des Kontos enden, der benutzte Browser bleibt angemeldet.
- Ihr Konto löschen Spieler ebenfalls selbst (Recht auf Löschung): *Konto löschen*
  im Startmenü, nach zweifacher Nachfrage und mit ihrem Passwort. Gelöscht werden
  Konto und Profilbild, alle Sitzungen enden. Admins können sich nicht selbst
  löschen – ihnen nimmt man vorher das Admin-Recht oder entfernt sie mit `del`.
- `del` wirkt sofort, auch mitten in einer Partie: HTTP-Anfragen werden ab der
  nächsten abgewiesen, eine offene WebSocket binnen einer Sekunde getrennt. Das
  Profilbild des Kontos wird mit gelöscht. Ein zurückgesetztes Passwort beendet
  ebenso alle Sitzungen.
- `admin` macht ein Konto zum **Admin** der Instanz. Admins spielen wie alle
  anderen, bekommen im Startbildschirm aber ein zusätzliches Panel: alle Partien auf
  dem Server (Stand, Runde, seit wann, wer mit welchem Konto spielt) und alle Konten
  (online oder nicht, in welcher Partie). Dort kann ein Admin jeder laufenden
  Partie **zusehen** – ohne Nebel und ohne ins Tempo einzugreifen; Partien mit
  Menschen warten weiter auf ihre Spieler –, allen in einer
  Partie eine **Nachricht** schicken – etwa um eine Downtime anzukündigen; sie
  erscheint als Banner, das bestätigt werden muss – und jede Partie **beenden**
  (zwei Klicks); alle Beteiligten landen mit einem Hinweis wieder im
  Startbildschirm. Der Server prüft das Flag bei jeder
  Anfrage – `admin … off` wirkt also ohne Abmelden. Ohne Anmeldung (`HO_AUTH=off`)
  gibt es keine Admins.
- Admins können über dieses Panel auch Spieler **einladen**: „Einladungslink
  erzeugen“ erstellt einen Einmal-Link (mit optionaler Notiz wie „für Max“). Der neue
  Spieler öffnet ihn, wählt Benutzernamen und Passwort und ist sofort angemeldet –
  kein erstes Passwort zum Weitergeben, kein Passwortwechsel. Jeder Link funktioniert
  **einmal** und verfällt nach **24 Stunden**; offene Einladungen stehen dort und
  lassen sich widerrufen. Der Link wird nur beim Erzeugen angezeigt: `invites.json`
  neben `users.json` enthält nur einen Hash davon, wer die Datei liest, bekommt also
  keinen gültigen Link.
- Dazwischen gibt es die Rolle **Einlader**: ein normaler Spieler, der zusätzlich
  Einladungslinks erzeugen darf. Ein Admin vergibt und entzieht sie im Admin-Panel
  im Aktionsmenü „⋯“ am Konto („Einladen erlauben“ / „Einladen entziehen“) oder auf dem
  Host mit `inviter`. Einlader sehen unter ihren Freunden einen Bereich
  *Einladungen*: Link erzeugen, die eigenen offenen Einladungen sehen und
  widerrufen – nicht die anderer und sonst nichts vom Admin-Panel. Wird die Rolle
  entzogen (oder das Konto gelöscht), verfallen ihre offenen Links sofort; ein
  offener Tab erfährt es ohne Neuladen.
- Im selben Menü kann ein Admin ein Konto **sperren** und **löschen**. Ein
  gesperrtes Konto kann sich noch anmelden, bekommt aber nur einen Dialog, dass es
  gesperrt ist, und ein Feld, um den Admins zu schreiben – alles andere weist der
  Server ab, offene Verbindungen werden beim Sperren getrennt (ein Platz in einer
  Partie gilt dann als verlassen). Das gilt auch für `block` auf dem Host. Über
  HTTP bleiben nur An- und Abmelden; Passwort ändern geht nur, wenn ein erstes
  Passwort ersetzt werden muss, und auch das eigene Konto löschen geht nicht – das
  läuft dann über die Admins. Mehr als fünf Nachrichten am Stück nimmt der Server
  erst nach einer Antwort wieder an. Die Admins lesen und beantworten die Nachrichten
  im Menü unter *Nachrichten*; sie liegen im Klartext in `appeals.json` neben
  `users.json`. *Nutzer löschen* braucht zwei Klicks und nimmt wie die eigene
  Löschung Profilbild, Freundschaften und Nachrichten mit. Admins lassen sich
  weder sperren noch löschen.
- Den **Anzeigenamen** im Spiel wählt jeder Spieler selbst (siehe
  [Spielen › Profil](playing.de.md#eine-partie-beginnen)); `name` ändert nur die
  Schreibweise des Kontonamens, etwa für die Zeile „Angemeldet als …“.

Auf dem Host steht je Konto nur der Name, ein **scrypt-Hash** des Passworts
(gesalzen, Parameter im Hash), gegebenenfalls der Anzeigename und die Version des
Profilbilds. Kein Klartext, keine Mailadresse, keine Sitzungsschlüssel: die liegen
allein im Serverspeicher und sind nach einem Neustart weg.

## Was die Anmeldung aushält

- **Rateversuche werden gebremst.** Ab dem fünften Fehlversuch wird gesperrt, und
  zwar immer länger (30 s, 1 min, 2 min … bis 15 min) – gezählt nach Konto *und*
  nach Herkunft.
- **Der Sitzungskeks** ist `HttpOnly` und `SameSite=Lax`, hinter HTTPS zusätzlich
  `Secure`. Die Endpunkte nehmen nur echtes JSON an – ein Formular von einer
  fremden Seite kommt nicht durch.
- **Ein unbekannter Name braucht genauso lange wie ein bekannter.** Die
  Antwortzeit verrät nicht, welche Konten es gibt.
- **Vor dem ersten Passwortwechsel** gibt es eine Sitzung, aber kein Spiel.
- **Ohne Sitzung** kommt nur die Anmeldeseite heraus, dazu Stylesheet, Wortmarke
  und Sprachkataloge. Weder `client/js/`, noch `shared/rules.js`, noch Profilbilder,
  noch ein Pfad mit kodierten Trennern (`/css/..%2f..%2f…`) führt daran vorbei.
- **Anzeigenamen** dürfen nicht wie ein anderes Konto heißen; Markup-Zeichen
  entfernt der Server. **Profilbilder** prüft er auf echtes PNG, JPEG oder WebP
  (höchstens 64 kB) und liefert sie mit `nosniff` aus.

## Hinter einem Reverse-Proxy

Der Server spricht HTTP und kennt kein TLS – das macht der Proxy davor. Zwei Dinge
braucht er unbedingt:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # sonst kommt keine WebSocket zustande
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;  # sonst fehlt dem Keks das Secure-Flag
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

Unter einem Unterpfad wie `/ho/` geht es genauso. Wichtig ist der Schrägstrich am
Ende von `proxy_pass`: erst er schneidet `/ho` ab, bevor die Anfrage beim Server
ankommt.

```nginx
location = /ho { return 301 /ho/; }
location /ho/ {
    proxy_pass http://127.0.0.1:8080/;
    # … dieselben proxy_set_header-Zeilen wie oben
}
```

Der Port gehört dann nur an den Proxy, nicht ans offene Netz:

```
HOST_BIND=127.0.0.1 docker compose up -d
```

## Einstellungen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` | `8080` | Port des Servers |
| `HO_AUTH` | an | `off` schaltet die Anmeldung ab – nur zum Entwickeln |
| `HO_DEV` | aus | `on` schaltet den Entwicklungsmodus ein: Admins bekommen den Debug-Dialog (Strg+Umschalt+D): Testkampf, Sounds und in der laufenden Partie Wurmlöcher öffnen und schließen sowie sofort einen Träger; ohne Anmeldung bekommt ihn jeder – nur zum Entwickeln |
| `HO_USERS_FILE` | `data/users.json` | wo die Konten liegen; Profilbilder liegen daneben in `avatars/` |
| `HO_SESSION_DAYS` | `30` | wie lange eine Sitzung gilt |
| `HO_SECURE_COOKIES` | automatisch | `1`/`0` erzwingt oder verbietet das `Secure`-Flag |
| `HO_IDLE_HOURS` | `4` | eine Partie, in der sich so lange niemand bewegt hat (Befehle, Zug beenden, Chat …), wird verworfen – auch wenn noch ein Tab offen ist; ist niemand verbunden, schon nach der halben Zeit |
| `HO_TTS` | Docker: `http://tts:5005`, sonst leer | Adresse des Sprachdienstes für die Funksprüche; leer = der Funk bleibt stumm |
| `HO_TTS_CACHE` | Docker: `/data/tts-cache`, sonst ein Temp-Ordner | wo die gesprochenen Sprüche liegen |
| `HO_LANG` | aus der Umgebung | Sprache des Werkzeugs `users.js` |
| `HOST_PORT`, `HOST_BIND` | `8080`, `0.0.0.0` | nur Docker: Port und Adresse auf dem Host |

Was eine Partie ausmacht (Spielfeld, Rundenlimit, Startkapital …), stellt der
Host in der Lobby ein – siehe [Spielen](playing.de.md#eine-partie-beginnen).

## Daten

Konten und Profilbilder liegen in `data/` (im Container `/data`, eingebunden aus
`./data` neben der `docker-compose.yml`). Sie überleben jedes neue Image; ein
Backup ist eine Kopie des Verzeichnisses. Die Kontendatei hat Rechte 0600 und wird
erst daneben geschrieben und dann umgeschoben, damit ein Abbruch nicht den ganzen
Bestand verliert.

**Laufende Partien** liegen nur im Serverspeicher – ein Neustart beendet sie, und
mit ihnen die offenen Sitzungen. Eine solche Partie wird nicht gespeichert.

**Spielstatistik** landet in `stats.json` neben der `users.json`: ein Eintrag pro
Partie, die über *Neue Partie eröffnen* gestartet wurde (nicht das Sofortspiel gegen
die KI), geschrieben, sobald die Partie zum ersten Mal entschieden ist oder alle sie
verlassen haben oder sie wegen Untätigkeit verworfen wurde. Pro Kolonie: Konto,
Name, KI-Stufe und -Charakter, Platz, wie es endete (Sieger, ausgeschieden in Runde
…, verlassen in Runde …) und die Endwerte (Planeten, Bevölkerung, Schiffe,
Abschüsse, Verluste, Höchstwerte, Techstufen). Die **Rangliste** im Startmenü wird
daraus berechnet – eine Elo-Wertung, KI-Kolonien fest mit 1000 (normal) bzw. 1200
(schwer), Partien ab 10 Runden, gelistet ab 3 Partien. Wird ein Konto gelöscht,
verschwinden sein Name und Konto aus allen Einträgen; die Partien selbst bleiben.

**Privatsphäre-Schalter** unter den Freunden: Jedes Konto kann sich aus der
Rangliste austragen (nur es selbst sieht dann noch seine Wertung; seine Partien
zählen für die anderen weiter) und seinen Online-Status verbergen (Freunde sehen
es dann immer offline). Beides steht in der `users.json` (`unlisted`, `invisible`),
und nur solange es ausgeschaltet ist.
