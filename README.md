# Redesign the Last Mile

Serious Game für den Kurs «Design und Management von globalen Supply Chains» (Universität St.Gallen, HS 2026).
Teams bauen das Paketnetz eines Zustelldienstes für Stadt, Agglo und Land um und werden an vier KPIs gemessen:
Kosten pro Paket, Pünktlichkeit, CO₂ pro Paket und Fehlzustellungen.

## Spielen

- **Online (2–5 Teams, je ein Gerät):** Startseite → «Neues Online-Spiel» → Code an die anderen Teams geben → «Spiel beitreten».
- **Auf einem Gerät (1–5 Teams):** «Spiel auf einem Gerät», die Teams wechseln sich ab. Läuft auch ohne Internet.
- **Ablauf:** 4 Runden (wählbar 4–6), pro Runde 2 Aktionen. Sobald alle abgegeben haben, wird die Runde berechnet; Überraschungen werden erst dann aufgedeckt.
- **Gewinnen:** nur wer alle Mindeststandards erfüllt (Pünktlichkeit landesweit ≥ 90 %, jede Zone ≥ 80 %, Kosten ≤ Tarif); dann zählen die Rangpunkte.
- **Planen mit Prognose:** Rechts zeigt das Spiel die Kennzahlen der laufenden Runde mit eurem Plan, die Mindeststandards, wer in jeder Zone zustellt und einen Ausblick auf die nächste Runde. Gerechnet wird mit dem echten Rechenkern, aber nur mit Angekündigtem: Überraschungen bleiben verborgen.
- **Optionen vergleichen:** Links stehen alle Aktionen mit Kosten pro Paket (voll ausgelastet), Kapazität und CO₂, umschaltbar nach Zone, plus eine Vergleichstabelle. Vor dem Hinzufügen zeigt der Konfigurator die Wirkung auf die Prognose.
- **Ausprobieren:** `…/Serious_Game_Post/#demo` startet sofort ein lokales Probespiel mit zwei Teams.
- Zwei Durchgänge und Debriefing macht die Moderation ausserhalb des Spiels: einfach ein neues Spiel starten.

## Zahlen ändern (Balancing)

1. `docs/Balancing.xlsx` öffnen, im Blatt «Parameter» nur die gelben Zellen ändern und die Regelversion erhöhen.
2. Mappe an Claude geben – oder selbst: `python3 tools/excel_to_params.py docs/Balancing.xlsx`.
3. Prüfen: `npm test` und `npm run simulate`. Excel neu erzeugen: siehe Kopf von `tools/build_excel.py`.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `index.html`, `css/`, `js/ui/` | Oberfläche (ohne Build-Schritt, läuft direkt im Browser) |
| `js/engine.js` | Rechenkern: deterministisch, gleiche Eingaben ergeben überall dasselbe Ergebnis |
| `js/forecast.js` | Prognose, Ausblick und Kennzahlen pro Option (ohne verborgene Ereignisse) |
| `fonts/` | Schrift Geist (SIL Open Font License), lokal, damit das Spiel auch offline gleich aussieht |
| `js/map.js` | Sechseckkarte (7 Stadt-, 11 Agglo-, 15 Landfelder) |
| `config/params.json` | alle Spielzahlen |
| `js/backend-online.js`, `supabase/` | Online-Modus über Supabase (Tabellen, Zugriffsregeln, Funktionen) |
| `js/backend-local.js` | Spiele auf einem Gerät (Browser-Speicher) |
| `tests/` | automatische Tests des Rechenkerns |
| `tools/` | Teststrategien, Simulation, Sensitivität, Excel-Export und -Import |
| `docs/` | Balancing-Excel und Simulationsdaten |

## Technik

- Statische Webseite auf GitHub Pages; jede Änderung auf `main` wird getestet und automatisch veröffentlicht.
- Supabase speichert nur Spiele, Teams und Aktionen. Jedes Gerät rechnet den Spielstand selbst nach.
  Geschrieben wird ausschliesslich über geprüfte Datenbankfunktionen; Aktionen anderer Teams sind erst nach Rundenende lesbar.
- Spielende brauchen kein Konto (anonyme Anmeldung). In Supabase muss «Allow anonymous sign-ins» eingeschaltet sein.
- Gratisprojekte bei Supabase pausieren nach einer Woche ohne Nutzung: vor einem Playtest das Dashboard einmal öffnen.
- Lokal testen: `npm run serve` und http://localhost:8080 öffnen.
