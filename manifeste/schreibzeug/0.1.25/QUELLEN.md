# Quellen: Schreibzeug

Manifest: `manifest.yml` daneben. Alle Dateien unten stammen aus
[Speicherstadt/schreibzeug](https://github.com/Speicherstadt/schreibzeug), Commit
`8acafdef033b19f5a3c9c8127647ae635322904f`, sofern nichts anderes dasteht. Schreibzeug hat keine
Quadlets; der Container folgt `deploy/compose.yaml`. Der Caddy dort entfällt (die Pforte ersetzt ihn).

## Images

| Container | Image (Tag) | Digest | Quelle des Digests | Plattformen |
| --- | --- | --- | --- | --- |
| `app` | `ghcr.io/speicherstadt/schreibzeug:0.1.25` | `ghcr.io/speicherstadt/schreibzeug@sha256:41baec9bfe28f7603fe59723d44e7a92d7ba1950cea4dd21f12b18ecd2fce09b` | Registry ghcr.io, Tag 0.1.25, abgefragt am 2026-11-20 (`scripts/digest.ts`) | linux/amd64 |

GHCR statt `docker.io/tristanteu/schreibzeug` (so `deploy/compose.yaml`):
`.github/workflows/release.yml` pusht mit `ghcr: true`.

## Angaben

| Angabe | Wert | Quelle |
| --- | --- | --- |
| `schema` | 1 | Schema der Steuerzentrale (`docs/manifest.md`) |
| `id` | schreibzeug | `package.json` (`name`) |
| `version` | 0.1.25 | `package.json` (`version`) |
| `lizenz` | AGPL-3.0-only | `package.json` (`license`), `LICENSE` |
| `quelle` | https://github.com/Speicherstadt/schreibzeug | Repository |
| `container` | `app` | `deploy/compose.yaml` (`schreibzeug`); Name wie in docs/plan.md |
| Volume `daten` | `/data` | `deploy/compose.yaml` (`schreibzeug-data:/data`), `docker/Dockerfile` (`VOLUME /data`, `SCHREIBZEUG_DATA_DIR` = /data) |
| `architektur` | amd64 | `.github/workflows/release.yml` (`platforms: linux/amd64`); Plattformen des Images |
| `ressourcen` `ram_mb` | 1024 | docs/plan.md, Tabelle |
| `ressourcen` `platte_gb` | 10 | Planwert der Steuerzentrale (docs/plan.md, „Planwerte der Manifeste“) |
| `netz` `http` | `app`, Port 3000, WebSocket | `docker/Dockerfile` (`EXPOSE 3000`), `deploy/Caddyfile` („WebSockets included“, `flush_interval -1`) |
| `netz` `http` `max_body_mb` | 512 | `apps/server/src/config.ts` (`SCHREIBZEUG_MAX_UPLOAD_MB` Vorgabe 512) |
| `netz` (sonst) | keine Ports, keine IPv4, keine Mail, kein Server für sich | docs/plan.md, Tabelle |
| `proxy` | geteilt | Caddy des Repos entfällt (docs/plan.md, „Pforte“) |
| `rootful` | nein | `docker/Dockerfile` (`USER bun`) |
| `optionen`, `braucht`, `bietet` | keine | – |
| `anmeldung` | oidc | `apps/server/src/config.ts` (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`) |
| `health` | http `/api/health` auf `app` | `docker/Dockerfile` (`HEALTHCHECK … /api/health`) |
| `befehle`, `schritte` | keine | – |
| `backup` | Volume `daten` | `apps/server/src/config.ts` („The blobs and the SQLite database (schreibzeug.db) live here“) |
| `aktionen` | nur lesen, Export: nicht unterstützt | docs/plan.md, „Die Apps der Speicherstadt“ |
| `sperrzeiten`, `dns` | keine | – |
| `hinweis` | Lizenz und Repository | `package.json`, `LICENSE` |

## Einstellungen (`env`)

| Name | Ebene | Quelle |
| --- | --- | --- |
| `SCHREIBZEUG_URL` | auto, Adresse | `deploy/compose.yaml` (`https://${SCHREIBZEUG_DOMAIN}`), `apps/server/src/config.ts` |
| `SCHREIBZEUG_AUTH_SECRET` | auto, `zufall_32` | `apps/server/src/config.ts` (mindestens 32 Zeichen; ohne Wert legt der Server einen im Datenordner ab) |
| `SCHREIBZEUG_OPEN_SIGNUP` | installation, Vorgabe `false` | `deploy/compose.yaml` (`${SCHREIBZEUG_OPEN_SIGNUP:-false}`), `apps/server/src/config.ts` |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | auto, vom OIDC-Anbieter | `apps/server/src/config.ts`; docs/plan.md, „Single Sign-on“ |

Nicht im Manifest: `SCHREIBZEUG_TRUSTED_PROXIES` (`deploy/compose.yaml` nennt die feste Adresse seines
Caddy; die Adresse, unter der die Pforte im Container ankommt, legt erst Z-205 fest), die Archiv- und
Import-Werte aus `apps/server/src/config.ts`.
