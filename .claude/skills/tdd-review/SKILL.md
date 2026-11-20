---
name: tdd-review
description: "Unabhängiges Review eines Pull Requests der Steuerzentrale: nur Fehler melden, die ein fehlschlagender Test belegt, Befunde im PR posten, nach Red-Green fixen, bis CI grün ist; dann mergt der Loop. Für jeden Pull Request vor dem Merge."
---

# TDD-Review

Ein unabhängiger Reviewer prüft einen Pull Request und meldet **nur Fehler, die er mit einem
fehlschlagenden Test beweisen kann**. Vorbild: der gleichnamige Skill in Speicherstadt/haben.

## 0. Wer reviewt

Unabhängig ist ein Agent, der die Entstehung nicht gesehen hat. Hat diese Session am Code
gearbeitet, startet sie einen **separaten Subagenten** und gibt ihm nur Repo, PR-Nummer, Branch und
diese Schritte, keine eigene Einschätzung. Er arbeitet in einem eigenen Worktree.

## 1. Lesen

- `git fetch origin main <branch>`, `git diff origin/main...<branch>`; vorher keine Suite.
- `git merge-tree --write-tree origin/main <branch>`: passt der Branch noch auf `main`?
- Gesucht: falsche Logik, Randfälle, Fehlerbehandlung, Wettläufe, Sicherheitslücken, Regressionen.
  In der Steuerzentrale besonders: der Agent führt nur signierte Manifest-Aktionen aus; Daten eines
  Betreibers oder Kunden erreichen keinen anderen; kein Geheimnis in Log, API oder Oberfläche;
  Sperrzeiten, Wartungsfenster und Zeitumstellung; Idempotenz von Aufträgen; keine App fest
  eingebaut.
- Die „Fertig, wenn“-Zeile des Punkts in `BAULISTE.md`: ist jedes Kriterium durch einen Test belegt?
- Keine Anmerkungen zu Stil oder Namen.

## 2. Jeden Verdacht mit einem Test beweisen

- Für jeden Verdacht einen Test, der das erwartete Verhalten beschreibt: Vitest neben dem Code,
  Datenbank-Tests mit SQLite in einer temporären Datei, Agent-Tests gegen Podman (`bun run
  test:agent`), Playwright nur für Abläufe in der Oberfläche.
- Nur ein Test, der auf dem Stand des PR rot ist, ist ein Befund. Bleibt er grün, wird der Verdacht
  verworfen (höchstens eine Zeile unter „Nicht belegt“).

## 3. Befunde in den PR

Ein Kommentar: je Befund Titel, Datei und Zeile, Testname, Ausgabe des roten Tests, kurze Erklärung;
dazu die verworfenen Verdachte in je einem Satz. Ohne Befund: kurz vermerken. Deutsch.

## 4. Fixen

Je Befund: Test committen, kleinster Fix, Test grün; Commits mit `Signed-off-by`. Bestehende Tests
nie abschwächen oder löschen. Danach gezielt prüfen: immer `lint` und `typecheck`, Tests der
geänderten Module; die volle Suite läuft in der CI. Im Abschluss nennen, was lokal lief.

## 5. Grün und Merge

CI abwarten; rote Checks beheben, nie überspringen. Hat das Review keine offenen Befunde und ist die
CI grün, mergt der Loop selbst (Squash) und hakt den Punkt in `BAULISTE.md` ab.
