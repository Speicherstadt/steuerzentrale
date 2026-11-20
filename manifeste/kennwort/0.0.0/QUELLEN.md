# Quellen: Kennwort

Manifest: `manifest.yml` daneben. Alle Dateien unten stammen aus
[Speicherstadt/kennwort](https://github.com/Speicherstadt/kennwort), Commit
`b1ee7423cd36105c27b234af09d90e77afd86c70`, sofern nichts anderes dasteht. Kennwort hat noch kein
Image, keine Compose-Datei und keine Quadlets (`BAULISTE.md` von Kennwort, K-703 offen); das Manifest
beschreibt den Server aus `apps/server/` mit seinen Einstellungen aus `apps/server/src/config.ts`.

## Images

| Container | Image (Tag) | Digest | Quelle des Digests | Plattformen |
| --- | --- | --- | --- | --- |
| `app` | – | **fehlt**: noch nicht veröffentlicht | `scripts/digest.ts` am 2026-11-20: `ghcr.io/speicherstadt/kennwort:0.0.0` antwortet `token: HTTP 403` | – |

## Angaben

| Angabe | Wert | Quelle |
| --- | --- | --- |
| `schema` | 1 | Schema der Steuerzentrale (`docs/manifest.md`) |
| `id` | kennwort | Name des Repositorys |
| `version` | 0.0.0 | `package.json` (`version`) |
| `lizenz` | AGPL-3.0-only | `package.json` (`license`), `LICENSE` |
| `quelle` | https://github.com/Speicherstadt/kennwort | Repository |
| `container` | `app` | `apps/server/` (ein Server); Name wie in docs/plan.md |
| Volume `daten` | `/daten` | `apps/server/src/config.ts` (`KENNWORT_DATABASE`, Vorgabe `data/kennwort.db`, relativ); der Pfad im Container ist eine Festlegung der Steuerzentrale über `KENNWORT_DATABASE` |
| `feste_env` von `app` | `KENNWORT_PORT` = 8100, `KENNWORT_DATABASE` = /daten/kennwort.db, `KENNWORT_BEHIND_PROXY` = true | `apps/server/src/config.ts` (Vorgabe 8100; „Behind a reverse proxy …“) |
| `architektur` | amd64, arm64 | docs/plan.md, Tabelle (ohne Image noch nicht belegbar) |
| `ressourcen` `ram_mb` | 512 | docs/plan.md, Tabelle |
| `ressourcen` `platte_gb` | 1 | Planwert der Steuerzentrale (docs/plan.md, „Planwerte der Manifeste“) |
| `netz` `http` | `app`, Port 8100 | `apps/server/src/config.ts` (`KENNWORT_PORT`) |
| `netz` (sonst) | keine Ports, keine IPv4, keine Mail, kein Server für sich | docs/plan.md, Tabelle |
| `proxy`, `rootful` | geteilt, nein | docs/plan.md, „Pforte“ |
| `optionen`, `braucht`, `bietet` | keine | – |
| `anmeldung` | eigen | `apps/server/src/config.ts` und `apps/server/src/tenancy/session.ts`: kein OIDC-Client; `BAULISTE.md` von Kennwort, K-604 („OpenID Connect“) offen |
| `health` | http `/health` auf `app` | `apps/server/src/app.ts` (`app.get("/health", …)`, 503 ohne Datenbank) |
| `befehle`, `schritte` | keine | – |
| `backup` | Volume `daten` | die SQLite-Datei liegt dort (`KENNWORT_DATABASE`) |
| `aktionen` | nur lesen, Export: nicht unterstützt | docs/plan.md, „Die Apps der Speicherstadt“ |
| `sperrzeiten`, `dns` | keine | – |
| `hinweis` | Lizenz und Repository | `package.json`, `LICENSE` |

## Einstellungen (`env`)

| Name | Ebene | Quelle |
| --- | --- | --- |
| `KENNWORT_PUBLIC_URL` | auto, Adresse | `apps/server/src/config.ts` („The address people open“) |
| `KENNWORT_AUTH_SECRET` | auto, `zufall_32` | `apps/server/src/config.ts` („at least 32 characters, generated once per installation“) |
| `KENNWORT_SETUP_CODE` | installation, Pflicht | `apps/server/src/config.ts` („chosen by the admin, at least 16 characters … Without it the server cannot be set up from outside“) |
