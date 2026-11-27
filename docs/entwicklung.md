---
title: Entwicklung
description: >-
  Wie die Steuerzentrale gebaut wird: Umgebung und Befehle, Workspaces, Konventionen für Code,
  Technik und Besonderheiten, Abhängigkeiten und die Quellen, auf die sich Details stützen.
---

# Entwicklung

Wie ein Beitrag abläuft (Pull Request, Prüfungen, Review), steht unter [Mitwirken](mitwirken.md).

## Umgebung { #umgebung }

Bun (Version aus `package.json`, `packageManager`), für die Tests des Agenten Podman ab 4.9 mit systemd.
Danach:

```sh
bun install          # übersetzt auch die Texte aus messages/ (Paraglide)
bun run check        # typecheck, lint, test, build
bun run test:agent   # der Agent gegen Podman; ohne Podman übersprungen, mit CI=true ein Fehler
bun run e2e          # Playwright gegen Zentrale (Port 28300) und Oberfläche (Port 5182); dazu der
                     # Demo-Build ohne Zentrale (Port 5184, jede Route einmal, e2e/demo.spec.ts)
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
genügt der neue. Tokens stehen nur als SHA-256 in der Datenbank. Gesichert und wiederhergestellt
wird die Datenbank mit `steuerzentrale sichern <datei>` und `steuerzentrale wiederherstellen <datei>`,
der Schlüssel getrennt davon ([Zentrale sichern](zentrale-sichern.md)).

Dazu braucht sie `STEUERZENTRALE_URL`: die Adresse der Oberfläche, wie sie im Browser steht (nur
Schema, Host und Port, z. B. `https://zentrale.example.de`). Better Auth prüft daran den Origin, und
Passkeys sind an deren Domain gebunden; `dev:zentrale` setzt `http://localhost:5181`, die E2E-Tests
`http://localhost:5182`. Das Geheimnis von Better Auth (Sitzungs-Cookies, TOTP-Schlüssel) entsteht beim
ersten Start und liegt mit `STEUERZENTRALE_SECRET_KEY` verschlüsselt in der Datenbank; das Rotieren
verschlüsselt es mit, Sitzungen und TOTP bleiben gültig.

Für Server braucht sie `STEUERZENTRALE_AGENT_URL`, die Adresse, unter der die Agenten sie erreichen
(`https://agent.<domain>`, nur Origin; `dev:zentrale` setzt `http://localhost:18300`, die E2E-Tests
`http://localhost:28300`), und `STEUERZENTRALE_AGENT_DATEIEN`, das Verzeichnis mit `install.sh`, den
Agent-Binaries und `SHA256SUMS` mit Signatur. `bun run build && bun scripts/agent-dateien.ts <verzeichnis>`
legt es an, signiert mit dem Test-Schlüssel ([Server hinzufügen](server-hinzufuegen.md)). Die Tests von
`install/install.sh` (`scripts/install-sh.test.ts`) brauchen `minisign` und `sha256sum`, die des Agenten
`openssl`; die CI prüft das Skript mit `shellcheck --shell=sh install/install.sh` und lässt es im Job
`server` in je einer Incus-VM mit Debian 13 und Ubuntu 24.04 laufen (nur CI).

DNS-Einträge setzt die Zentrale über die Cloudflare-API. Tests sprechen nie mit Cloudflare: sie
starten den Nachbau `apps/zentrale/src/testhilfen/cloudflare.ts`, die E2E-Tests auf Port 28301, und
`STEUERZENTRALE_CLOUDFLARE_API` lenkt die Zentrale dorthin; die Variable nimmt nur eine Adresse auf
localhost an ([Adressen und DNS](dns.md)).

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
laufen dort über den virtuellen Authenticator von Chromium. Für das Installieren bekommt die Zentrale
den öffentlichen Test-Schlüssel als `minisign.pub` (`playwright.config.ts`), die Tests signieren ihr
Manifest zur Laufzeit mit dem Test-Schlüssel, und ein Stellvertreter des Agenten
(`e2e/hilfen/agent.ts`) tritt mit dem Einmal-Token bei, verbindet sich und meldet Fakten; er führt
keinen Auftrag aus, eine Einrichtung für einen Host `kaputt…` meldet er gescheitert, eine für einen
Host `laeuft…` erledigt; den Zustand von Installationen (`zustand`) meldet er, wenn ein Test es sagt.

Die Zentrale legt ihre Datenbank `zentrale.db` (SQLite, WAL) in `STEUERZENTRALE_DATA` an (Vorgabe:
`data`). Die Migrationen in `apps/zentrale/drizzle/` stecken im Binary (`migrationen.gen.ts`, erzeugt
von `bun run db:generate`); eine schon angewendete Migration wird nie mehr geändert, sonst verweigert
die Zentrale den Start. Geschrieben wird nur über `schreiben` (`apps/zentrale/src/modules/audit`),
das in derselben Transaktion einen Eintrag ins Audit-Log anfügt; alle anderen Module lesen über eine
Verbindung, die nicht schreiben kann. Ein Test sucht im Code nach Schreibzugriffen an `schreiben`
vorbei.

Die Oberfläche liest ihre Daten über `apps/web/src/daten/` (Typen, `quelle.ts` und reine Ableitungen
wie Prüfungen, Wellen und „Zu tun“). Bis die Zentrale ihre API hat, liefert `quelle.ts`
die Demodaten aus `apps/web/src/demo/`: ein Betreiber mit den Apps der Speicherstadt, die ein
veröffentlichtes Release haben (gelesen aus den echten Manifesten in `manifeste/`), Servern,
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
| `manifeste/<app>/<version>` | Manifeste der Apps mit `QUELLEN.md` und Signatur des Test-Schlüssels |

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

## Konventionen { #konventionen }

### Technik { #technik }

Die Technik folgt `tech-stack.md` in [firsttris/workflows](https://github.com/firsttris/workflows) und dem Stack von
Kennwort und Soll, mit denselben zwei Abweichungen: **Solid 2 statt React** und **ein Hono-Server mit statischer SPA
statt TanStack Start**. Die SPA nutzt TanStack Router (dateibasierte Routen) und TanStack Query für Daten vom Server,
in ihren Versionen für Solid 2 (Skill `solid-2`, Stand in `docs/solid-2.0/README.md`). Der Agent ist auch TypeScript, mit
`bun build --compile` übersetzt, damit Zentrale und Agent `packages/protokoll` und `packages/manifest` ohne
Abweichung der Typen teilen.

### Code { #code }

Clean Code, funktional geschrieben: klare Namen, kleine Funktionen, die eine Sache tun, Abhängigkeiten werden
übergeben, keine Doppelungen und kein toter Code, Kommentare sagen warum; keine Klassen, keine Vererbung, keine
Klassenhierarchien. Reine Funktionen, die Daten nehmen und Daten zurückgeben, Seiteneffekte am Rand; Fehler als Werte.
Eine Datei tut eine Sache: über ~400 Zeilen wird sie geteilt, eine Funktion über ~80. Ein Refactor ändert kein
Verhalten.

### Besonderheiten der Steuerzentrale { #besonderheiten }

- Reine Funktionen ohne I/O: `packages/manifest` (Schema, Platzierung, Quadlet-Units, Podman-Secrets und
  Caddy-Schnipsel erzeugen) und `packages/planung` (Update-Wellen, Sperrzeiten, Wartungsfenster, Prüfungen der
  Server). Zentrale und Agent rufen sie nur auf.
- Aufträge liegen in der Zentrale, tragen eine ID und sind idempotent; der Agent holt sie, bestätigt sie, meldet
  Fortschritt und Ergebnis. Ein Auftrag nennt eine Aktion des Manifests und ihre Argumente, nie einen Befehl.
- Podman-Quadlets unter systemd, rootless: ein Linux-Nutzer je Installation (`sz-<installation>`, Lingering), ihre
  Units in `~/.config/containers/systemd/`, eigenes Netz und eigene Volumes, Geheimnisse als Podman-Secrets. Rootful
  nur für eine App, deren Manifest `rootful: true` sagt, was `server_fuer_sich` voraussetzt. Nie `AutoUpdate`
  setzen: Updates kommen nur über die Wellen. Ein Caddy je Server („Pforte“, Nutzer `sz-pforte`, `Network=host`),
  seine Admin-API nur auf localhost; jede Installation hat ihr eigenes `.network` und veröffentlicht ihren
  HTTP-Dienst nur mit `PublishPort=127.0.0.1:<port>:…`, den Port vergibt die Zentrale; die IP des Clients kommt im
  `X-Forwarded-For` der Pforte an. Podman 4.9 ist das Minimum: nur Schlüssel, die 4.9 kennt.
- Die Zentrale hat zwei Hostnamen: die Oberfläche nur über WireGuard und `agent.<domain>` (mTLS je Server).
  DNS-Einträge setzt die Zentrale über die Cloudflare-API, nie ein Server.
- Die Zentrale hat genau einen Betreiber (`betreiber`) und eine Agent-CA; ein zweiter Betreiber wird abgelehnt.
- Jede Tabelle mit Daten eines Betreibers trägt `betreiber_id` (ausgenommen: Manifeste, die Tabellen von Better
  Auth); jede Abfrage filtert danach; ein Test je Endpunkt beweist, dass kein Betreiber die Daten eines anderen
  sieht. Geschrieben wird über eine Funktion, die in derselben Transaktion ans Audit-Log anfügt.
- Geheimnisse: verschlüsselte Spalten (Schlüssel, Tokens und Rotieren unter [Umgebung](#umgebung)); Zertifikate der
  Agenten stehen als Fingerabdruck in der Datenbank.
- Zeiten: Zeitpunkte als UTC-Millisekunden; Sperrzeiten und Wartungsfenster in `Europe/Berlin`, die Zeitumstellung
  getestet.

### Abhängigkeiten { #abhaengigkeiten }

`bun run lint` prüft, dass jede Laufzeit-Abhängigkeit in `allowed-dependencies.json` steht, mit Grund und der dort
festgelegten Hauptversion (TanStack Router 2, Query 6, Solid 2), dass keines der verbotenen Pakete aus Solid 1
auftaucht und dass kein Code Muster aus Solid 1.x nutzt. Die Oberfläche ist Solid 2.0; dessen Doku liegt als Kopie
in `docs/solid-2.0/` (Einstieg: `MIGRATION.md`).

`bun add` installiert das `latest` von npm, für TanStack Router und Query noch die Linie für Solid 1: die Version
nennen (`bun add @tanstack/solid-router@2.0.0-rc.11 --exact`).

## Quellen { #quellen }

Details stützen sich auf diese Quellen, nicht auf das Gedächtnis:

- **Die Apps**: `Speicherstadt/<app>` für jeden Wert eines Manifests (Quadlets in `deploy/quadlet/`,
  Compose-Dateien, Dockerfiles, Schema der Umgebungsvariablen, Health-Route, Backup-Skripte). Ein Wert ohne
  Quelldatei wird nicht geschrieben; die Quelle eines Image-Digests ist die Abfrage der Registry, die
  `scripts/digest.ts` festhält (Registry, Tag, Datum).
- **Kennwort und Soll**: `Speicherstadt/kennwort`, `Speicherstadt/soll` für denselben Stack in der Praxis (Solid 2,
  Hono, Better Auth, Paraglide, `packages/ui`, CI, Doku, Dateien des Loops).
- **Podman-Quadlets**: `podman-systemd.unit(5)` und die Podman-Doku zum Betrieb ohne root; die Quadlets von Haben
  und Kontext als Beispiele. **Caddy**: die Doku seiner Admin-API. **restic**: seine Doku zu Repositories,
  `backup`, `forget`, `check`, `restore`.
- **firsttris/workflows**: `tech-stack.md`, die wiederverwendbaren Release-Workflows.
