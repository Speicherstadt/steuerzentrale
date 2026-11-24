# Quellen: Belegt

Manifest: `manifest.yml` daneben. Alle Dateien unten stammen aus
[Speicherstadt/belegt](https://github.com/Speicherstadt/belegt), Tag `v0.0.7`, Commit
`11232b958e7a95a959c287e1dc667e3561862b2c`, sofern nichts anderes dasteht. Belegt hat keine
Quadlets; die Container folgen `deploy/compose.yml`. Es entfallen: `caddy` (Profil `https`, die Pforte
ersetzt ihn), `backup` und `restore` (die Steuerzentrale sichert selbst mit restic, docs/plan.md,
„Backups“), `smtp` (Profil `journal`), `validator`, `gotenberg` und `ollama` (Profile, nicht in
docs/plan.md).

## Images

| Container | Image (Tag) | Digest | Quelle des Digests | Plattformen |
| --- | --- | --- | --- | --- |
| `app`, `worker` | `ghcr.io/speicherstadt/belegt:0.0.7` | `ghcr.io/speicherstadt/belegt@sha256:0aa5bcf46b6551ab9e0a6918f8e41868bc0e7074aa73c6e897a91e9a4d13603c` | Registry ghcr.io, Tag 0.0.7, abgefragt am 2026-11-24 (`scripts/digest.ts`) | linux/amd64, linux/arm64 |
| `ftp` (Option) | `ghcr.io/speicherstadt/belegt-ftp:0.0.7` | `ghcr.io/speicherstadt/belegt-ftp@sha256:b2ee95435fd144bb028a4d8e09363e7c52183cd5cde320770cee60c497a66d01` | Registry ghcr.io, Tag 0.0.7, abgefragt am 2026-11-24 (`scripts/digest.ts`) | linux/amd64, linux/arm64 |
| `db` | `docker.io/library/postgres:18` | `docker.io/library/postgres@sha256:c699303802144847d238196173655dbbecf7a96aeca1565f2b02eb671a1f0b6b` | Registry docker.io, Tag 18, abgefragt am 2026-11-24 (`scripts/digest.ts`) | linux/amd64, linux/arm64 (und weitere) |

`deploy/compose.yml` nennt `docker.io/tristanteu/belegt` und `docker.io/tristanteu/belegt-ftp`;
`.github/workflows/release.yml` pusht dieselben Images mit `ghcr: true` auch nach
`ghcr.io/speicherstadt/belegt` und (`ghcr-image`) `ghcr.io/speicherstadt/belegt-ftp`. Der Worker
nutzt das Image des Servers (`deploy/compose.yml`). Postgres kommt laut `deploy/compose.yml` von
Docker Hub.

## Angaben

| Angabe | Wert | Quelle |
| --- | --- | --- |
| `schema` | 1 | Schema der Steuerzentrale (`docs/manifest.md`) |
| `id` | belegt | `package.json` (`name`) |
| `version` | 0.0.7 | `package.json` (`version`) |
| `lizenz` | AGPL-3.0-only | `package.json` (`license`), `LICENSE` |
| `quelle` | https://github.com/Speicherstadt/belegt | Repository |
| `container` | `app`, `worker`, `db` | `deploy/compose.yml` (`server`, `worker`, `postgres`); Namen wie in docs/plan.md |
| `worker` `argv` | `bun server/worker.ts` | `deploy/compose.yml` (`command: ["bun", "server/worker.ts"]`) |
| `braucht` | `app` → `db`, `worker` → `app` | `deploy/compose.yml` (`depends_on`) |
| Volume `daten` | `/var/lib/belegt` | `deploy/compose.yml` (`dokumente:/var/lib/belegt`), `Containerfile` (`VOLUME /var/lib/belegt`) |
| Volume `eingang` | `/var/lib/belegt/eingang` im `worker`, `/eingang` im `ftp` | `deploy/compose.yml` (`./eingang:/var/lib/belegt/eingang`, `./eingang:/eingang`) |
| Volume `db` | `/var/lib/postgresql` | `deploy/compose.yml` (`postgres:/var/lib/postgresql`) |
| `feste_env` von `db` | `POSTGRES_USER` = belegt, `POSTGRES_DB` = belegt | `deploy/compose.yml` |
| `architektur` | amd64, arm64 | `.github/workflows/release.yml` („für amd64 und arm64“) |
| `ressourcen` `ram_mb` | 2048 | docs/plan.md, Tabelle |
| `ressourcen` `platte_gb` | 20 | Planwert der Steuerzentrale (docs/plan.md, „Entscheidungen“ → „Planwerte der Manifeste“) |
| `netz` `http` | `app`, Port 3000 | `Containerfile` (`EXPOSE 3000`), `deploy/compose.yml` |
| `netz` `http` `max_body_mb`, `timeout_s` | 20480, 3600 | `deploy/compose.yml` (Caddyfile: „Keine Grenze für Anfragen … der Export aus Paperless-ngx ist bis IMPORT_MAX_GB groß“), `server/env.ts` (`IMPORT_MAX_GB` Vorgabe 20); Timeout: docs/plan.md, „Planwerte der Manifeste“ |
| `netz` `ports` | `ftp` 21 und 30000–30009 (Option) | `deploy/compose.yml` (`ftp`: `21:21`, `30000-30009:30000-30009`), `deploy/ftp/Containerfile` (`EXPOSE 21 30000-30009`) |
| `netz` (sonst) | keine IPv4, keine Mail, kein Server für sich | docs/plan.md, Tabelle |
| `proxy` | geteilt | Caddy des Repos entfällt (docs/plan.md, „Pforte“) |
| `rootful` | nein | – |
| `optionen` | `ftp` | `deploy/compose.yml` (Profil `ftp`), `deploy/ftp/README.md`; docs/plan.md, Tabelle („ftp (Option)“) |
| `braucht`, `bietet` | keine | – |
| `anmeldung` | oidc | `server/env.ts` (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`) |
| `health` | http `/healthz` auf `app` | `server/app.ts` (`app.get("/healthz", …)`), `Containerfile` (`HEALTHCHECK`) |
| `befehle`, `schritte` | keine | Migrationen beim Start (`server/start.sh`) |
| `backup` | `pg_dump` von `belegt` als `belegt`, Volume `daten` | `deploy/backup/backup.sh`, `deploy/compose.yml` (Eigentümer `belegt`) |
| `aktionen` | nur lesen, Export: nicht unterstützt | docs/plan.md, „Die Apps der Speicherstadt“ |
| `sperrzeiten`, `dns` | keine | – |
| `hinweis` | Lizenz und Repository | `package.json`, `LICENSE` |

## Einstellungen (`env`)

| Name | Ebene | Quelle |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | auto, `zufall_hex_32` | `deploy/compose.yml`; `deploy/compose.env.example` („Passwörter nur aus Buchstaben und Ziffern … sie stehen in den Adressen“) |
| `DATABASE_URL` | auto, Vorlage | `deploy/compose.yml` (`postgres://belegt:${POSTGRES_PASSWORD}@postgres:5432/belegt`), `server/env.ts`; Host `db` |
| `BETTER_AUTH_URL` | auto, Adresse | `deploy/compose.yml` (`BELEGT_URL`), `server/env.ts` |
| `BETTER_AUTH_SECRET` | auto, `zufall_32` | `deploy/compose.yml` („mindestens 32 Zeichen“), `server/env.ts` |
| `BELEGT_SCHLUESSEL` | auto, `zufall_32` | `deploy/compose.yml` („openssl rand -base64 32“), `server/crypto.ts` („32 Bytes, base64“) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | auto, vom OIDC-Anbieter | `deploy/compose.env.example`, `server/env.ts` |
| `EINGANG_ORDNER` | auto, Option `ftp` | `deploy/compose.yml` (Kommentar am Worker), `deploy/compose.env.example`, `server/env.ts` |
| `FTP_BENUTZER`, `FTP_PASSWORT`, `FTP_TLS` | installation, Option `ftp` | `deploy/compose.yml`, `deploy/compose.env.example`, `deploy/ftp/start.sh` (Pflicht, mindestens 8 Zeichen, `aus`/`an`/`pflicht`) |
| `FTP_PASV_ADRESSE` | auto (`${ipv4}`), Option `ftp` | `deploy/ftp/start.sh`, `deploy/compose.env.example` („Adresse dieses Rechners“) |

Nicht im Manifest: die getrennte Rolle `belegt_app` (`APP_DB_PASSWORD`, `MIGRATION_DATABASE_URL`;
ohne sie läuft Belegt als Eigentümer, `deploy/compose.yml`), Microsoft, Google, S3, TSA, KI,
Vorschau, Validator und Mail aus `server/env.ts`.

## Offen

- Nicht im Manifest: `BELEGT_TRUSTED_PROXIES` (`server/env.ts`: „Proxys, deren X-Forwarded-For gilt …;
  ohne sie zählt nur die Verbindung“; `deploy/compose.yml` setzt die feste Adresse seines Caddy). Die
  Adresse, unter der die Pforte im Container ankommt, ist noch nicht festgelegt; wie bei
  `SCHREIBZEUG_TRUSTED_PROXIES` (`manifeste/schreibzeug/0.1.26/QUELLEN.md`) sieht Belegt bis dahin die
  Adresse der Weiterleitung statt der des Nutzers.
- Option `ftp`: Port 21 ist fest (`deploy/compose.yml`). Rootless veröffentlicht ihn erst mit
  `net.ipv4.ip_unprivileged_port_start` ≤ 21 (heute 80, docs/plan.md, „Pforte“); bis dahin startet
  der Container `ftp` nicht. Wie Port 25 bei Kontext (`manifeste/kontext/0.1.37/QUELLEN.md`) offen für
  Stufe 2.
