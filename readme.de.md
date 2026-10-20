# Ho!!

*[English](readme.md) · **Deutsch***

[![CI](https://github.com/db0x/Ho/actions/workflows/ci.yml/badge.svg)](https://github.com/db0x/Ho/actions/workflows/ci.yml)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-brightgreen.svg)](package.json)

Ein Weltraum-Strategiespiel im Geist von **Spaceward Ho!** – im Browser, für bis zu
16 Spieler gleichzeitig.

![Klassische Sternkarte mit zwölf KI-Reichen](doc/screenshots/map-classic-de.webp)

*Zwölf KI-Reiche in Runde 45. Die Farbe einer Welt zeigt ihre Temperatur, die
Größe ihre Schwerkraft; besiedelte Welten färben ihre Umgebung in der Farbe ihres
Reiches.*

- **Gleichzeitige Züge** für bis zu 16 Spieler – Freunde per vierstelligem Code,
  freie Plätze mit KI.
- **KI mit Charakter:** Eroberer, Siedler, Technokrat, Pirat, Bollwerk, Aasgeier.
- **Flach oder im Raum,** als Streufeld oder Spiralgalaxie mit schwarzem Loch – und
  eine Karte, die mit der Erkundung wächst.
- **Ein Haushalt, der aufgeht:** die Kopfleiste zeigt vor dem Zugende, wohin das
  Geld fließt.
- **Kein Build-Schritt, keine Assets:** Grafik wird im Code gezeichnet, Klänge im
  Browser synthetisiert; einzige Abhängigkeit ist `ws`.

## Schnellstart

```
npm install
npm run users -- add captain   # Zugang anlegen, Passwort wird ausgegeben
npm start                      # http://localhost:8080
```

Oder mit Docker: `mkdir -p data && docker compose up -d --build`.
Lokal ohne Anmeldung: `HO_AUTH=off npm start`.

Dann *Sofort gegen 5 KI spielen* – oder *Neue Partie eröffnen* und den Code
weitergeben.

## Dokumentation

| | |
|---|---|
| **[Spielen](doc/playing.de.md)** | Regeln, Geld und Haushalt, Kampf, Galaxieformen, KI, Zusehen, Steuerung, Telefon |
| **[Betrieb](doc/hosting.de.md)** | Node und Docker, Konten, Sicherheit, Reverse-Proxy, Einstellungen, Daten |
| **[Entwicklung](doc/development.de.md)** | Aufbau, Grundsätze, Sprachen, Ton, Grafik, Tests, offene Punkte |

## Lizenz

MIT – siehe [LICENSE](LICENSE). Alles in diesem Verzeichnis ist Quelltext, bis auf
die Bildschirmfotos unter `doc/screenshots/`, die unter derselben Lizenz stehen.

**Ho!!** ist eine eigenständige Neuimplementierung und steht in keiner Verbindung
zu Delta Tao Software, ist von dort weder unterstützt noch lizenziert. *Spaceward
Ho!* ist deren Marke; dieses Projekt übernimmt Idee und Spielgefühl, nicht Code,
Grafiken oder Texte.
