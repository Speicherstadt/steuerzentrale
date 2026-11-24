# Quellen: Kennwort

Manifest: `manifest.yml` daneben. Alle Dateien unten stammen aus
[Speicherstadt/kennwort](https://github.com/Speicherstadt/kennwort), Commit
`b8bfb7255b0c4a312e03388f958866578744f1fe` (Tag `v0.1.3`), sofern nichts anderes dasteht. Der
Container folgt `docker/quadlet/kennwort.container` und `docker/compose.yaml`; der Caddy dort
(`kennwort-caddy.container`, `docker/Caddyfile`) entfällt, die Pforte ersetzt ihn. `AutoUpdate=registry`
aus `kennwort.container` wird nicht übernommen (Updates nur über die Wellen).

## Images

| Container | Image (Tag) | Digest | Quelle des Digests | Plattformen |
| --- | --- | --- | --- | --- |
| `app` | `ghcr.io/speicherstadt/kennwort:0.1.3` | `ghcr.io/speicherstadt/kennwort@sha256:9d5856324b99e172908e393fba1bf5a978ba86649d9b788b15b4647d2dd4e3cc` | Registry ghcr.io, Tag 0.1.3, abgefragt am 2026-11-24 (`scripts/digest.ts`) | linux/amd64, linux/arm64 |

## Angaben

| Angabe | Wert | Quelle |
| --- | --- | --- |
| `schema` | 1 | Schema der Steuerzentrale (`docs/manifest.md`) |
| `id` | kennwort | Name des Repositorys |
| `version` | 0.1.3 | `package.json` (`version`) |
| `lizenz` | AGPL-3.0-only | `package.json` (`license`), `LICENSE` |
| `quelle` | https://github.com/Speicherstadt/kennwort | Repository |
| `container` | `app` | `docker/compose.yaml` (`kennwort`), `docker/quadlet/kennwort.container`; Name wie in docs/plan.md |
| Volume `daten` | `/data` | `docker/Dockerfile` (`VOLUME ["/data"]`, `KENNWORT_DATABASE=/data/kennwort.db`), `docker/quadlet/kennwort.container` (`kennwort-data.volume:/data`) |
| `feste_env` von `app` | `KENNWORT_BEHIND_PROXY` = true | `docker/compose.yaml`, `docker/kennwort.env.example`; `apps/server/src/config.ts` („Behind a reverse proxy …“). `KENNWORT_PORT` = 8100 und `KENNWORT_DATABASE` setzt das Image selbst (`docker/Dockerfile`, `ENV`) |
| `architektur` | amd64, arm64 | `.github/workflows/release.yml` (Matrix `linux/amd64`, `linux/arm64`); Plattformen des Images |
| `ressourcen` `ram_mb` | 512 | docs/plan.md, Tabelle |
| `ressourcen` `platte_gb` | 1 | Planwert der Steuerzentrale (docs/plan.md, „Planwerte der Manifeste“) |
| `netz` `http` | `app`, Port 8100 | `docker/Dockerfile` (`EXPOSE 8100`), `docker/Caddyfile` (`reverse_proxy kennwort:8100`) |
| `netz` (sonst) | keine Ports, keine IPv4, keine Mail, kein Server für sich | `docker/compose.yaml` („No port of its own“); docs/plan.md, Tabelle |
| `proxy` | geteilt | Caddy des Repos entfällt (docs/plan.md, „Pforte“) |
| `rootful` | nein | `docker/Dockerfile` (`USER 65532:65532`) |
| `optionen`, `braucht`, `bietet` | keine | – |
| `anmeldung` | oidc | `apps/server/src/oidc/settings.ts` (`KENNWORT_OIDC_ISSUER`, `KENNWORT_OIDC_CLIENT_ID`, `KENNWORT_OIDC_CLIENT_SECRET`; ohne Issuer bleibt OIDC aus, die eigene Anmeldung bleibt) |
| `health` | http `/health` auf `app` | `apps/server/src/app.ts` (`app.get("/health", …)`, 503 ohne Datenbank); `docker/Dockerfile` (`HEALTHCHECK … health`) |
| `befehle`, `schritte` | keine | – |
| `backup` | Volume `daten` | die SQLite-Datei liegt dort (`docker/Dockerfile`, `docs/backup.md`) |
| `aktionen` | nur lesen, Export: nicht unterstützt | docs/plan.md, „Die Apps der Speicherstadt“ |
| `sperrzeiten`, `dns` | keine | – |
| `hinweis` | Lizenz und Repository | `package.json`, `LICENSE` |

## Einstellungen (`env`)

| Name | Ebene | Quelle |
| --- | --- | --- |
| `KENNWORT_PUBLIC_URL` | auto, Adresse | `apps/server/src/config.ts` („The address people open“), `docker/compose.yaml` (`https://${KENNWORT_DOMAIN}`) |
| `KENNWORT_AUTH_SECRET` | auto, `zufall_32` | `apps/server/src/config.ts` („at least 32 characters, generated once per installation“) |
| `KENNWORT_SETUP_CODE` | installation, Pflicht | `apps/server/src/config.ts` („at least 16 characters … Without it the server cannot be set up from outside“), `docker/kennwort.env.example` |
| `KENNWORT_OIDC_ISSUER`, `KENNWORT_OIDC_CLIENT_ID`, `KENNWORT_OIDC_CLIENT_SECRET` | auto, vom OIDC-Anbieter | `apps/server/src/oidc/settings.ts`; docs/plan.md, „Single Sign-on“ |

Nicht im Manifest: `KENNWORT_OIDC_NAME`, `KENNWORT_OIDC_SCOPES`, `KENNWORT_OIDC_GROUPS_CLAIM` (Vorgaben
in `apps/server/src/oidc/settings.ts`), `KENNWORT_UPDATE_CHECK`, `KENNWORT_PUSH*`, `KENNWORT_PWNED_URL`,
`KENNWORT_LOG_LEVEL` (Vorgaben in `apps/server/src/config.ts`).

Offen: `docs/backup.md` nennt eine Kopie der Datei bei laufendem Server kein konsistentes Backup
(WAL) und empfiehlt `kennwort-server backup <ziel>`; der schreibt in eine Datei, nicht auf die
Standardausgabe, und passt deshalb nicht zum Teil `befehl` (Ausgabe des Befehls). Bis dahin sichert
das Manifest das Volume.
