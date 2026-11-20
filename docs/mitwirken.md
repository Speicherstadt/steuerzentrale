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
bun run dev:zentrale # Zentrale auf Port 18300 (STEUERZENTRALE_SECRET_KEY setzen; Einrichtungscode im Log)
bun run dev:web      # Oberfläche auf Port 5181, /api geht an die Zentrale
bun run dev:demo     # Oberfläche auf Port 5181 mit den Demodaten, ohne Zentrale und ohne Anmeldung
bun run db:generate  # neue Migration aus apps/zentrale/src/db/schema.ts
bun run manifest:schema # JSON Schema des Manifests neu schreiben
bun run manifeste:signieren # Manifeste der Apps mit dem Test-Schlüssel signieren
bun scripts/digest.ts ghcr.io/speicherstadt/haben:0.12.0 # Digest eines Tags aus der Registry
```

Die Zentrale startet nur mit `STEUERZENTRALE_SECRET_KEY` (32 Zufallsbytes in Base64,
`openssl rand -base64 32`); damit sind die Geheimnisse in der Datenbank verschlüsselt (AES-256-GCM,
Schlüssel-ID an jedem Wert). Ein Prüfwert in der Datenbank sorgt dafür, dass ein falscher Schlüssel
den Start verweigert. Zum Rotieren den neuen Schlüssel in `STEUERZENTRALE_SECRET_KEY`, den alten in
`STEUERZENTRALE_SECRET_KEY_ALT` setzen und `steuerzentrale schluessel-rotieren` ausführen; danach
genügt der neue. Tokens stehen nur als SHA-256 in der Datenbank.

Dazu braucht sie `STEUERZENTRALE_URL`: die Adresse der Oberfläche, wie sie im Browser steht (nur
Schema, Host und Port, z. B. `https://zentrale.example.de`). Better Auth prüft daran den Origin, und
Passkeys sind an deren Domain gebunden; `dev:zentrale` setzt `http://localhost:5181`, die E2E-Tests
`http://localhost:5182`. Das Geheimnis von Better Auth (Sitzungs-Cookies, TOTP-Schlüssel) entsteht beim
ersten Start und liegt mit `STEUERZENTRALE_SECRET_KEY` verschlüsselt in der Datenbank; das Rotieren
verschlüsselt es mit, Sitzungen und TOTP bleiben gültig.

Anmeldung und Rollen: `apps/zentrale/src/auth/` (Better Auth mit Organisationen, Passkeys und TOTP;
Rollen als Zugriffssteuerung des Organization-Plugins in `rollen.ts`). Jede Route steht mit ihrem
Recht in `apps/zentrale/src/routes/zugang.ts` (`ROUTEN`) und wird nur darüber angelegt; `zugang.test.ts`
fragt jede Route in jeder Rolle ab. Eine neue Route braucht dort einen Eintrag, sonst ist der Test rot.
Von Better Auths eigenen Pfaden unter `/api/auth` sind nur die in `AUTH_PFADE` erreichbar. Better Auth
schreibt seine Tabellen selbst (deshalb ist `auth/auth.ts` im Scan nach Schreibzugriffen erlaubt);
Betreiber, Mitgliedschaften und Einladungen schreibt die Zentrale über `schreiben`. Die Tests der API
melden sich über `apps/zentrale/src/testhilfen/` an, mit einem Software-Passkey und TOTP nach RFC 6238.
Die E2E-Tests richten zuerst den ersten Inhaber mit dem Einrichtungscode aus dem Log der Zentrale ein
(Projekt `einrichtung`, `e2e/einrichtung.setup.ts`); dessen Sitzung nutzen alle anderen Tests, Passkeys
laufen dort über den virtuellen Authenticator von Chromium.

Die Zentrale legt ihre Datenbank `zentrale.db` (SQLite, WAL) in `STEUERZENTRALE_DATA` an (Vorgabe:
`data`). Die Migrationen in `apps/zentrale/drizzle/` stecken im Binary (`migrationen.gen.ts`, erzeugt
von `bun run db:generate`); eine schon angewendete Migration wird nie mehr geändert, sonst verweigert
die Zentrale den Start. Geschrieben wird nur über `schreiben` (`apps/zentrale/src/modules/audit`),
das in derselben Transaktion einen Eintrag ins Audit-Log anfügt; alle anderen Module lesen über eine
Verbindung, die nicht schreiben kann. Ein Test sucht im Code nach Schreibzugriffen an `schreiben`
vorbei.

Die Oberfläche liest ihre Daten über `apps/web/src/daten/` (Typen, `quelle.ts` und reine Ableitungen
wie Prüfungen, Wellen und „Braucht Aufmerksamkeit“). Bis die Zentrale ihre API hat, liefert `quelle.ts`
die Demodaten aus `apps/web/src/demo/`: ein Betreiber mit den acht Apps der Speicherstadt, Servern,
Installationen, Kunden, Ereignissen und Aufträgen. Dieselben Daten zeigen `bun run dev:demo`, die
E2E-Tests und die Screenshots; mit der API (Z-406) bleiben sie für den Modus `demo` von Vite erhalten.
Namen und Freitexte in den Demodaten sind Daten, keine Texte der Oberfläche; deshalb nimmt `checks.json`
den Ordner von der Prüfung `i18n` aus. Seiten sind dateibasierte Routen von TanStack Router in
`apps/web/src/routes/`; der Routenbaum `routeTree.gen.ts` entsteht beim Bauen und wird mit eingecheckt.

`bun run build` baut Zentrale und Agent als je ein Binary für `linux-x64` und `linux-arm64`
(`apps/*/dist/`) und die Oberfläche als statische Seite.

| Workspace | Inhalt |
| --- | --- |
| `packages/manifest` | Manifest: Schema, Signatur, Platzierung, Quadlets; reine Funktionen |
| `packages/protokoll` | Nachrichten zwischen Zentrale und Agent, Version |
| `packages/planung` | Wellen, Sperrzeiten, Wartungsfenster; reine Funktionen |
| `packages/ui` | Komponenten und Texte der Oberfläche, von Kennwort übernommen |
| `apps/zentrale` | Hono-Server: Anmeldung, Rollen, Betreiber, Audit-Log, Geheimnisse, Logs ohne Geheimnisse |
| `apps/agent` | der Agent auf jedem verwalteten Server |
| `apps/web` | die Oberfläche (Solid 2, Vite, TanStack Router) mit Demodaten |
| `manifeste/beispiel` | Beispiel-App für die Tests: Dienst, Containerfile, Manifest-Vorlage |
| `manifeste/<app>/<version>` | Manifeste der acht Apps mit `QUELLEN.md` und Signatur des Test-Schlüssels |

Die Beispiel-App (`manifeste/beispiel/`) ist ein kleiner HTTP-Dienst mit SQLite-Volume, Health,
einer Option, einem Befehl nach dem Update, einem vergebenen Port und einem Backup aus zwei Teilen.
`bun run test:agent` baut ihr Image in drei Varianten (1.0.0, 2.0.0 und 2.1.0 mit rotem Health),
schiebt sie in eine lokale Registry und erzeugt die Manifeste mit den Digests, signiert mit dem
öffentlichen Test-Schlüssel (`scripts/beispiel-images.ts`, Ausgabe in `test-results/beispiel/`).
Ein Build für ein Release lehnt den Test-Schlüssel ab (`scripts/release-schluessel.ts`).

Ein Manifest der Apps (`manifeste/<app>/<version>/manifest.yml`) ändern: Werte nur aus dem
App-Repository (Datei und Commit in `QUELLEN.md` daneben), Digests nur aus `scripts/digest.ts` (mit
Registry, Tag und Datum in `QUELLEN.md`), danach `bun run manifeste:signieren`. `bun run test` prüft,
dass jedes Manifest gültig und signiert ist, `QUELLEN.md` jede Angabe nennt und die Tabelle „Die Apps
der Speicherstadt“ in `docs/plan.md` zu den Manifesten passt. Den Test von `scripts/digest.ts` gegen
die lokale Registry führt `bun run test:agent` aus.

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
| Unit | Typen, Biome, erlaubte Abhängigkeiten, keine Muster aus Solid 1.x (`scripts/solid-muster.ts`), Dateigröße, Funktionslänge, Zyklen, Texte und Seiten (`checks.json`: jede Route steht in `e2e/accessibility.spec.ts`), Vitest, Build, `bun audit` | `ci.yml` |
| Agent | der Agent gegen Podman mit systemd (`bun run test:agent`) | `ci.yml` |
| E2E | Playwright, Desktop und Handy; jede Seite hell und dunkel ohne Befund von axe und ohne seitliches Scrollen | `ci.yml` |
| Doku | `zensical build --strict`, jede Seite mit `description` | `docs.yml` |

## Sicherheitslücken

Bitte nicht als Issue, sondern privat melden: [SECURITY.md](https://github.com/Speicherstadt/steuerzentrale/blob/main/SECURITY.md).
