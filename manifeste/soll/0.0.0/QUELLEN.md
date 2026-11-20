# Quellen: Soll

Manifest: `manifest.yml` daneben. Alle Dateien unten stammen aus
[Speicherstadt/soll](https://github.com/Speicherstadt/soll), Commit
`6223f0916c34f4c936fd1fc02d234e2e8398d9d7`, sofern nichts anderes dasteht. Soll hat noch kein Image,
keine Compose-Datei und keine Quadlets (`BAULISTE.md` von Soll, S-905 offen); das Manifest beschreibt
den Server aus `apps/server/` mit seinen Einstellungen aus `apps/server/src/env.ts`.

## Images

| Container | Image (Tag) | Digest | Quelle des Digests | Plattformen |
| --- | --- | --- | --- | --- |
| `app` | – | **fehlt**: noch nicht veröffentlicht | `scripts/digest.ts` am 2026-11-20: `ghcr.io/speicherstadt/soll:0.0.0` antwortet `token: HTTP 403` | – |

## Angaben

| Angabe | Wert | Quelle |
| --- | --- | --- |
| `schema` | 1 | Schema der Steuerzentrale (`docs/manifest.md`) |
| `id` | soll | Name des Repositorys |
| `version` | 0.0.0 | `package.json` (`version`) |
| `lizenz` | AGPL-3.0-only | `package.json` (`license`), `LICENSE` |
| `quelle` | https://github.com/Speicherstadt/soll | Repository |
| `container` | `app` | `apps/server/` (ein Server); Name wie in docs/plan.md |
| Volume `daten` | `/daten` | `apps/server/src/env.ts` (`SOLL_DATA_DIR`, Vorgabe `data`); der Pfad im Container ist eine Festlegung der Steuerzentrale über `SOLL_DATA_DIR` |
| `feste_env` von `app` | `SOLL_PORT` = 8200, `SOLL_DATA_DIR` = /daten | `apps/server/src/env.ts` (Vorgabe 8200) |
| `architektur` | amd64, arm64 | `BAULISTE.md` von Soll, S-905 („Docker-Image (amd64, arm64)“) |
| `ressourcen` `ram_mb` | 512 | docs/plan.md, Tabelle |
| `ressourcen` `platte_gb` | 1 | Planwert der Steuerzentrale (docs/plan.md, „Planwerte der Manifeste“) |
| `netz` `http` | `app`, Port 8200 | `apps/server/src/env.ts` (`SOLL_PORT`) |
| `netz` (sonst) | keine Ports, keine IPv4, keine Mail, kein Server für sich | docs/plan.md, Tabelle |
| `proxy`, `rootful` | geteilt, nein | docs/plan.md, „Pforte“ |
| `optionen`, `braucht`, `bietet` | keine | – |
| `anmeldung` | eigen | `apps/server/src/` hat keinen OIDC-Client (Better Auth mit Passkey und Passwort, `docs/anmeldung.md`) |
| `health` | http `/health` auf `app` | `apps/server/src/app.ts` (`app.get("/health", …)`) |
| `befehle`, `schritte` | keine | – |
| `backup` | Volume `daten` | `apps/server/src/env.ts` (`SOLL_DATA_DIR`) |
| `aktionen` | nur lesen, Export: nicht unterstützt | docs/plan.md, „Die Apps der Speicherstadt“ |
| `sperrzeiten`, `dns` | keine | – |
| `hinweis` | Lizenz und Repository | `package.json`, `LICENSE` |

## Einstellungen (`env`)

| Name | Ebene | Quelle |
| --- | --- | --- |
| `SOLL_URL` | auto, Adresse | `apps/server/src/env.ts` („Where the instance is reached“) |
| `SOLL_SECRET_KEY` | auto, `zufall_32` | `apps/server/src/env.ts` („32 random bytes in base64 (openssl rand -base64 32)“) |

Nicht im Manifest: `SOLL_SMTP_URL` und `SOLL_MAIL_VON` (Mail ist optional und braucht beide oder
keinen, `apps/server/src/env.ts`).
