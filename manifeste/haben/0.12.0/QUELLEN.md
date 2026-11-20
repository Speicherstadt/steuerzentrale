# Quellen: Haben

Manifest: `manifest.yml` daneben. Alle Dateien unten stammen aus
[Speicherstadt/haben](https://github.com/Speicherstadt/haben), Commit
`baab21d6533f5ec5d27a8f5c6fc613af9e03c953`, sofern nichts anderes dasteht. Die Container folgen den
Quadlets in `deploy/quadlet/`; `haben-caddy` entfällt (die Pforte ersetzt ihn), `haben-backup` und
`haben-backup.timer` entfallen (die Steuerzentrale sichert selbst mit restic, docs/plan.md,
„Backups“).

## Images

| Container | Image (Tag) | Digest | Quelle des Digests | Plattformen |
| --- | --- | --- | --- | --- |
| `app` | `ghcr.io/speicherstadt/haben:0.12.0` | `ghcr.io/speicherstadt/haben@sha256:9b6a9d6d957297df189ec6a7a5a61cad799a4b04102cb7b51e19b03dc94a3ec7` | Registry ghcr.io, Tag 0.12.0, abgefragt am 2026-11-20 (`scripts/digest.ts`) | linux/amd64, linux/arm64 |
| `db` | `ghcr.io/speicherstadt/haben-db:0.12.0` | `ghcr.io/speicherstadt/haben-db@sha256:028a904a9814a93e0b1ab5705e3e878a43703479aeee1ec9f43aab05d2fc8808` | Registry ghcr.io, Tag 0.12.0, abgefragt am 2026-11-20 (`scripts/digest.ts`) | linux/amd64, linux/arm64 |

GHCR statt Docker Hub: `.github/workflows/release.yml` pusht mit `ghcr: true` (App:
`ghcr.io/<owner>/<repo>` laut `docker-release.yml` in firsttris/workflows, Commit
`83964dcf916e4241fabb68488676ef4dcd610c3b`; Datenbank: `ghcr-image: speicherstadt/haben-db`), mit
denselben Tags wie auf Docker Hub. Die Quadlets nennen `docker.io/tristanteu/haben:latest` und
`docker.io/tristanteu/haben-db:latest`; der Tag `0.12.0` ist die Version aus `package.json`.

## Angaben

| Angabe | Wert | Quelle |
| --- | --- | --- |
| `schema` | 1 | Schema der Steuerzentrale (`docs/manifest.md`) |
| `id` | haben | Name des Repositorys und `package.json` (`name`) |
| `version` | 0.12.0 | `package.json` (`version`); Tag `0.12.0` in der Registry |
| `lizenz` | AGPL-3.0-only | `package.json` (`license`), `LICENSE` |
| `quelle` | https://github.com/Speicherstadt/haben | Repository |
| `container` | `app`, `db` | `deploy/quadlet/haben-app.container`, `deploy/quadlet/haben-db.container` |
| `container` `app` `braucht` | `db` | `haben-app.container`: `Requires=haben-db.service` |
| Volume `belege` | `/var/lib/haben/belege` | `haben-app.container` (`Volume=haben-belege.volume:/var/lib/haben/belege`), `Containerfile` (`DOCUMENTS_DIR`) |
| Volume `eric-log` | `/var/lib/haben/eric-log` | `haben-app.container`, `Containerfile` (`ERIC_LOG_DIR`) |
| Volume `eric` | `/var/lib/haben/eric` | `haben-app.container`, `Containerfile` (`ERIC_DIR`) |
| Volume `db` | `/var/lib/postgresql/data` | `haben-db.container` (`Volume=haben-db.volume:/var/lib/postgresql/data`) |
| `feste_env` von `db` | `POSTGRES_USER` = haben, `POSTGRES_DB` = haben | `haben-db.container` (`Environment=POSTGRES_USER=haben POSTGRES_DB=haben`) |
| `architektur` | amd64, arm64 | Kommentar in `haben-app.container` („amd64 und arm64“); Plattformen der Images oben; docs/plan.md, Tabelle |
| `ressourcen` `ram_mb` | 2048 | docs/plan.md, Tabelle „Die Apps der Speicherstadt“ |
| `ressourcen` `platte_gb` | 10 | Planwert der Steuerzentrale (docs/plan.md, „Ressourcen“ und „Entscheidungen“ → „Planwerte der Manifeste“) |
| `netz` `http` | `app`, Port 3000 | `Containerfile` (`EXPOSE 3000`, `PORT` = 3000) |
| `netz` `http` `max_body_mb` | 250 | `deploy/Caddyfile` (`request_body { max_size 250MB }`) |
| `netz` `http` `websocket`, `sse`, `timeout_s` | nein, nein, Vorgabe | `deploy/Caddyfile` leitet ohne Besonderheiten weiter; `timeout_s` ist die Vorgabe der Zentrale |
| `netz` (sonst) | keine Ports, keine IPv4, keine Mail, kein Server für sich | docs/plan.md, Tabelle; die Quadlets veröffentlichen nur Caddy |
| `proxy` | geteilt | Caddy des Repos entfällt, die Pforte ersetzt ihn (docs/plan.md, „Pforte“) |
| `rootful` | nein | Quadlets laufen rootless (`%h/.config/haben/…`) |
| `optionen`, `braucht`, `bietet` | keine | – |
| `anmeldung` | oidc | `apps/web/src/server/env.ts` (`OIDC_ONLY`, `OIDC_ISSUER` …); docs/plan.md, Tabelle |
| `health` | http `/api/health` auf `app` | `apps/web/src/routes/api/health.ts`, `apps/web/src/server/db/health.ts` („Öffentliche Probe für Monitore“), `Containerfile` (`HEALTHCHECK`) |
| `befehle`, `schritte` | keine | Migrationen laufen beim Start (`deploy/entrypoint.sh`: `bun src/server/db/migrate.ts`) |
| `backup` | `pg_dump` von `haben` als `haben`, Volume `belege` | `deploy/backup/backup.sh` (pg_dump und die Belege unter `/belege`), `haben-db.container` (Nutzer und Datenbank) |
| `aktionen` | nur lesen, Export: nicht unterstützt | docs/plan.md, „Die Apps der Speicherstadt“ (Haben#945–#948) |
| `sperrzeiten` | 07.–12. jedes Monats, Umsatzsteuer-Voranmeldung | docs/plan.md, „Die Apps der Speicherstadt“ (§ 108 Abs. 3 AO) |
| `dns` | keine | – |
| `hinweis` | Lizenz und Repository | `package.json`, `LICENSE` |

## Einstellungen (`env`)

| Name | Ebene | Quelle |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | auto, `zufall_hex_32` | `haben-db.container` (`Secret=haben-db-password,…,target=POSTGRES_PASSWORD`); hex, weil es in `DATABASE_URL` steht |
| `DATABASE_URL` | auto, Vorlage | `haben-app.container` (`Secret=haben-database-url,…,target=DATABASE_URL`), `apps/web/src/server/env.ts` (`DATABASE_URL: z.string().url()`); Host `db`, Nutzer und Datenbank aus `haben-db.container` |
| `BETTER_AUTH_URL` | auto, Adresse | `deploy/haben.env.example`, `env.ts` („Öffentliche Adresse“) |
| `BETTER_AUTH_SECRET` | auto, `zufall_32` | `haben-app.container` (Secret), `env.ts` (`min(32)`) |
| `HABEN_ENCRYPTION_KEY` | auto, `zufall_32` | `haben-app.container` (Secret), `env.ts` („32 Byte (base64)“) |
| `ELSTER_HERSTELLER_ID` | betreiber, Pflicht | `deploy/haben.env.example`, `env.ts`; Ebene laut docs/plan.md („Hersteller-ID beim Betreiber“) |
| `ERIC_AUTO_INSTALL` | betreiber | `deploy/haben.env.example`, `deploy/entrypoint.sh` |
| `FINTS_PRODUKT_ID` | betreiber | `deploy/haben.env.example`, `env.ts` („eigene Registrierungsnummer … Haben bringt keine mit“) |
| `ANTHROPIC_API_KEY` | betreiber | `haben-app.container` (optionales Secret), `env.ts`; Ebene laut docs/plan.md („API-Schlüssel für KI“) |
| `OIDC_ONLY` | installation | `deploy/haben.env.example`, `env.ts` (Vorgabe `false`) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | auto, vom OIDC-Anbieter | `deploy/haben.env.example`, `env.ts`; docs/plan.md, „Single Sign-on“ |
| `OIDC_GROUP_INHABER`, `OIDC_GROUP_STEUERBERATUNG` | installation | `deploy/haben.env.example`, `env.ts` (Pflicht mit `OIDC_ONLY` = true) |

Nicht im Manifest: `HABEN_SETUP_CODE` (ohne ihn schreibt Haben einen Code ins Log, `env.ts`), die
optionalen Werte für ERiC von Hand, Enable Banking, KI-Dienste und die Test-Adressen aus `env.ts`.
