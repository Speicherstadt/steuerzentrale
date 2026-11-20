# Design

Wie die Oberfläche der Steuerzentrale aussieht und sich bedient, für Menschen und Agenten. Vorbild
ist das Mockup in [`design/mockup/`](design/mockup/README.md) und der Look von Kennwort und Soll:
ruhig, dicht, Zinc-Grautöne, Geist. `packages/ui` übernimmt die Komponenten von Kennwort. Bei
Widerspruch gilt diese Datei; eine neue Regel kommt im selben Pull Request hierher.

## Grundsätze

- **Nur für Betreiber**: keine Ansicht für Kunden; was Kunden sehen, zeigt das Portal.
- **Was Aufmerksamkeit braucht, steht oben**: die Übersicht sortiert nach Schwere (Störung, Warnung,
  Hinweis); jeder Eintrag führt zu seiner Ursache.
- **Zustand mit Grund**: Grün, Gelb, Rot, Unbekannt immer mit einem Satz, warum („Backup älter als
  26 h: Platte zu 91 % voll“). Grün heißt geprüft und in Ordnung, sonst nichts.
- **Nur, was das Manifest anbietet**: eine Aktion, die eine App nicht kann, fehlt; sie ist nicht
  ausgegraut. Auf der Seite „Apps“ steht sie als „nicht unterstützt“ mit dem Issue.
- **Jede schreibende Aktion fragt nach dem Grund** und nennt ihr Ziel; der Grund steht im Audit-Log.
- **Keine App fest eingebaut**: Formulare, Prüfungen und Texte kommen aus dem Manifest.
- **Eine Hauptaktion je Ansicht**, dunkel gefüllt; alles andere umrandet oder im Menü.
- **Ruhig und dicht**: keine Verläufe außer der leichten Tönung der Kennzahlen, Schatten nur bei
  schwebenden Elementen (Menüs, Dialoge).

## Farben

Tailwind 4, alle Werte als CSS-Variablen in hell und dunkel wie in Kennwort (shadcn Zinc), dazu drei
Zustandsfarben: `--ok` (grün), `--warn` (orange), `--destructive` (rot), `--info` (blau, nur für
„läuft“). Farbe trägt nie allein eine Bedeutung: immer mit Symbol und Text.

## Bausteine

| Baustein | Wofür |
| --- | --- |
| Seitenleiste | Gruppen Betrieb, Kunden, System; Zähler nur, wenn es etwas zu tun gibt; unten Sperrzeiten und das eigene Konto |
| Kennzahl | vier oben in der Übersicht, mit Badge und zwei Zeilen Erklärung |
| Tabelle | Kopf in `muted`, Zeile hover; Server-Gruppierung als graue Zwischenzeile |
| Zustands-Badge | umrandet, Symbol in Zustandsfarbe, Text grau |
| Dialog | Titel, ein Satz, was passiert; Felder; Grund; Abbrechen und Hauptaktion |
| Prüfzeile | Symbol, Name, Detail, OK oder Prüfen |

## Sprache

Deutsch in der Oberfläche, Englisch über Paraglide; kurze Sätze, Zahlen mit Einheit, Daten als
TT.MM.JJJJ, Zeiten in `Europe/Berlin`.
