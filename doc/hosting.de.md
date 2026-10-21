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

Voraussetzung ist Node 20 oder neuer.

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
```

Ohne Docker genauso, nur kürzer: `npm run users -- add captain`.

- `add` gibt das erste Passwort **einmal** aus – der einzige Moment, in dem es im
  Klartext existiert. Es gilt nur für die erste Anmeldung; danach wählt der Spieler
  ein eigenes, bevor er in die Lobby kommt. Nach `passwd` genauso.
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
| `HO_USERS_FILE` | `data/users.json` | wo die Konten liegen; Profilbilder liegen daneben in `avatars/` |
| `HO_SESSION_DAYS` | `30` | wie lange eine Sitzung gilt |
| `HO_SECURE_COOKIES` | automatisch | `1`/`0` erzwingt oder verbietet das `Secure`-Flag |
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
mit ihnen die offenen Sitzungen.
