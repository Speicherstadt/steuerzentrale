---
title: Mitwirken
description: >-
  Wie ein Beitrag zur Steuerzentrale aussieht: Umgebung, Prüfungen, Pull Request mit DCO, Review und
  die Regeln, die die CI am Pull Request prüft.
---

# Mitwirken

## Umgebung

Bun (Version aus `package.json`, `packageManager`), für die Tests des Agenten Podman ab 4.9 mit systemd.
Danach:

```sh
bun install          # übersetzt auch die Texte aus messages/ (Paraglide)
bun run check        # typecheck, lint, test, build
bun run test:agent   # der Agent gegen Podman; ohne Podman übersprungen, mit CI=true ein Fehler
bun run e2e          # Playwright gegen Zentrale (Port 28300) und Oberfläche (Port 5182)
bun run dev:zentrale # Zentrale auf Port 18300 (STEUERZENTRALE_SECRET_KEY setzen)
bun run dev:web      # Oberfläche auf Port 5181, /api geht an die Zentrale
bun run db:generate  # neue Migration aus apps/zentrale/src/db/schema.ts
```

Die Zentrale startet nur mit `STEUERZENTRALE_SECRET_KEY` (32 Zufallsbytes in Base64,
`openssl rand -base64 32`); damit sind die Geheimnisse in der Datenbank verschlüsselt (AES-256-GCM,
Schlüssel-ID an jedem Wert). Ein Prüfwert in der Datenbank sorgt dafür, dass ein falscher Schlüssel
den Start verweigert. Zum Rotieren den neuen Schlüssel in `STEUERZENTRALE_SECRET_KEY`, den alten in
`STEUERZENTRALE_SECRET_KEY_ALT` setzen und `steuerzentrale schluessel-rotieren` ausführen; danach
genügt der neue. Tokens stehen nur als SHA-256 in der Datenbank.

Die Zentrale legt ihre Datenbank `zentrale.db` (SQLite, WAL) in `STEUERZENTRALE_DATA` an (Vorgabe:
`data`). Die Migrationen in `apps/zentrale/drizzle/` stecken im Binary (`migrationen.gen.ts`, erzeugt
von `bun run db:generate`); eine schon angewendete Migration wird nie mehr geändert, sonst verweigert
die Zentrale den Start. Geschrieben wird nur über `schreiben` (`apps/zentrale/src/modules/audit`),
das in derselben Transaktion einen Eintrag ins Audit-Log anfügt; alle anderen Module lesen über eine
Verbindung, die nicht schreiben kann. Ein Test sucht im Code nach Schreibzugriffen an `schreiben`
vorbei.

`bun run build` baut Zentrale und Agent als je ein Binary für `linux-x64` und `linux-arm64`
(`apps/*/dist/`) und die Oberfläche als statische Seite.

| Workspace | Inhalt |
| --- | --- |
| `packages/manifest` | Manifest: Schema, Signatur, Platzierung, Quadlets; reine Funktionen |
| `packages/protokoll` | Nachrichten zwischen Zentrale und Agent, Version |
| `packages/planung` | Wellen, Sperrzeiten, Wartungsfenster; reine Funktionen |
| `packages/ui` | Komponenten und Texte der Oberfläche, von Kennwort übernommen |
| `apps/zentrale` | Hono-Server mit `/health` und Logs ohne Geheimnisse |
| `apps/agent` | der Agent auf jedem verwalteten Server |
| `apps/web` | die Oberfläche (Solid 2, Vite) |

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
| Unit | Typen, Biome, erlaubte Abhängigkeiten, keine Muster aus Solid 1.x (`scripts/solid-muster.ts`), Dateigröße, Funktionslänge, Zyklen und Texte (`checks.json`; die Seiten kommen mit Z-105 dazu), Vitest, Build, `bun audit` | `ci.yml` |
| Agent | der Agent gegen Podman mit systemd (`bun run test:agent`) | `ci.yml` |
| E2E | Playwright, Desktop und Handy, mit axe | `ci.yml` |
| Doku | `zensical build --strict`, jede Seite mit `description` | `docs.yml` |

## Sicherheitslücken

Bitte nicht als Issue, sondern privat melden: [SECURITY.md](https://github.com/Speicherstadt/steuerzentrale/blob/main/SECURITY.md).
