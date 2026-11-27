---
name: checks
description: "Prüfungen der Steuerzentrale ausführen (Typen, Lint, Vitest, Build, die geteilten Regeln, der Agent gegen Podman, Playwright, Doku). Vor jedem Push, im Review und wenn Bun, Podman oder ein Werkzeug für die Tests fehlt."
---

# Prüfungen

Vor jedem Push grün, danach die CI prüfen. Voraussetzung: Bun in der Version aus `package.json`
(`packageManager`), für die Tests des Agenten Podman ab 4.9 mit systemd. Umgebung und alle Befehle:
`docs/entwicklung.md`, Umgebung.

```sh
bun install --frozen-lockfile   # übersetzt auch die Texte aus messages/ (Paraglide)
bun run check             # typecheck, lint (Biome, allowed-dependencies.json, Muster aus Solid 1.x), test, build
bun run test:agent        # der Agent gegen Podman mit systemd; die CI hat beides
bun run e2e               # Playwright gegen Zentrale und Agent in Containern, Desktop und @phone
zensical build --strict   # wenn docs/ oder mkdocs.yml geändert sind (pip install -r requirements-docs.txt)
shellcheck --shell=sh install/install.sh   # wenn install/ geändert ist
```

Die geteilten Prüfungen aus firsttris/workflows (`checks.json`: Dateien über 400 Zeilen, Funktionen über 80,
Zyklen zwischen Paketen, Texte, jede Route in `e2e/accessibility.spec.ts`) installiert die CI ohne Eintrag in
`bun.lock`:

```sh
bun add --dev --no-save "github:firsttris/workflows#v1" && bunx checks && bunx checks pr
```

In einer Sandbox ohne Zugriff auf Tarballs von GitHub geht das nicht; dann „nur CI“.

Die Regeln am Pull Request selbst prüft vor dem Push die Werkbank (Skill `beitrag`); was nur dieses Projekt prüft
(`Signed-off-by`, Punkt der Bauliste abgehakt), liegt in `scripts/pr-regeln/` und läuft mit `bun run test`.

## Was übersprungen wird

- Datenbank-Tests laufen gegen SQLite in einer temporären Datei; keiner braucht eine laufende Datenbank.
- `bun run test:agent` ohne Podman: übersprungen, mit `CI=true` ein Fehler.
- Der Test gegen Mailpit (`apps/zentrale/src/modules/benachrichtigung/mailpit.test.ts`) läuft nur mit
  `SZ_TEST_MAILPIT_SMTP` und `SZ_TEST_MAILPIT_API`; lokal sonst übersprungen, in der CI nie.
- Die Tests von `install/install.sh` brauchen `minisign` und `sha256sum`, die des Agenten `openssl`; das ganze
  Skript läuft nur in den Incus-VMs der CI (Job `server`), der Release-Kandidat nur auf einem Tag oder von Hand.

Was lokal nicht läuft (Podman, systemd, Incus-VMs), steht im Pull Request unter „Wie geprüft“ als „nur CI“; die CI
entscheidet. Übersprungenes mit Grund nennen, nie als bestanden.

## Ports und Namen

Laufende Prozesse und Container der Nutzerin oder des Nutzers nicht stoppen. Für Tests andere Ports und eigene Nutzer
und Unit-Namen (`sz-test-*`): Dev Zentrale 18300 und Vite 5181, E2E Zentrale 28300, Vite 5182, Demo-Build 5184 und
der Nachbau von Cloudflare 28301.
