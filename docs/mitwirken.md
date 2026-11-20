---
title: Mitwirken
description: >-
  Wie ein Beitrag zur Steuerzentrale aussieht: Umgebung, Prüfungen, Pull Request mit DCO, Review und
  die Regeln, die die CI am Pull Request prüft.
---

# Mitwirken

## Umgebung

Bun (Version aus `package.json`, `packageManager`), für die Tests des Agenten Podman ab 4.4 mit systemd.
Danach:

```sh
bun install
bun run check        # typecheck, lint, test, build
```

`bun run lint` prüft auch, dass jede Laufzeit-Abhängigkeit in `allowed-dependencies.json` steht, mit Grund und
der dort festgelegten Hauptversion (TanStack Router 2, Query 6, Solid 2), dass keines der verbotenen Pakete aus
Solid 1 auftaucht,
und dass kein Code Muster aus Solid 1.x nutzt. Die Oberfläche ist Solid 2.0; dessen Doku liegt als Kopie in
`docs/solid-2.0/` (Einstieg: `MIGRATION.md`).

## Pull Request

- Ein Thema je Pull Request. Titel: `Z-xxx: was gebaut wird` für einen Punkt der
  [Bauliste](https://github.com/Speicherstadt/steuerzentrale/blob/main/BAULISTE.md), sonst
  `Bereich: was sich ändert`. Beim Squash-Merge wird der Titel zum Commit auf `main`.
- Jeder Commit trägt `Signed-off-by` ([Developer Certificate of Origin](https://developercertificate.org/)):
  `git commit -s`. Ein CLA gibt es nicht.
- Tests für das Geänderte, Doku in `docs/` und Texte in `messages/de.json` und `messages/en.json` im selben
  Pull Request.
- Vor dem Merge ein unabhängiges Review: Ein Befund zählt nur mit einem Test, der fehlschlägt.

## Was die CI am Pull Request prüft

| Prüfung | Was | Workflow |
| --- | --- | --- |
| PR-Regeln | Titel, `Signed-off-by` an jedem Commit, Punkt der Bauliste abgehakt; Hinweise bei Code ohne Doku und Fix ohne Test | `pr-regeln.yml` |
| Unit | Typen, Biome, erlaubte Abhängigkeiten, keine Muster aus Solid 1.x (`scripts/solid-muster.ts`), Dateigröße, Funktionslänge und Zyklen (`checks.json`; Texte und Seiten kommen mit der Oberfläche dazu), Vitest, Build, `bun audit` | `ci.yml` |
| Agent | der Agent gegen Podman mit systemd | `ci.yml` |
| E2E | Playwright, Desktop und Handy, mit axe | `ci.yml` |
| Doku | `zensical build --strict`, jede Seite mit `description` | `docs.yml` |

## Sicherheitslücken

Bitte nicht als Issue, sondern privat melden: [SECURITY.md](https://github.com/Speicherstadt/steuerzentrale/blob/main/SECURITY.md).
