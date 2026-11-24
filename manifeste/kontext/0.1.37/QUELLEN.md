# Quellen: Kontext

Manifest: `manifest.yml` daneben. Alle Dateien unten stammen aus
[Speicherstadt/kontext](https://github.com/Speicherstadt/kontext), Commit
`2574d301cc53559d6ec9e177d33aa40663868570`, sofern nichts anderes dasteht. Die Container folgen den
Quadlets in `deploy/quadlet/` (mit `deploy/compose.yaml` für Werte, die die Quadlets in Env-Dateien
auslagern). Kontext bringt seinen Caddy mit (`proxy: eigen`, docs/plan.md, Tabelle): er beendet TLS
auch für `mta-sts.` und `openpgpkey.` der Mail-Domain und für die Dokumente. `kontext-box.container`
entfällt (Gerät beim Kunden, docs/plan.md, „Geräte beim Kunden“).

## Images

| Container | Image (Tag) | Digest | Quelle des Digests | Plattformen |
| --- | --- | --- | --- | --- |
| `kontext` | `ghcr.io/speicherstadt/kontext:0.1.37` | `ghcr.io/speicherstadt/kontext@sha256:e36307756e0f6ed5ebcf525cc96ef8889049a62ca44eb5e791452b5b67b547c7` | Registry ghcr.io, Tag 0.1.37, abgefragt am 2026-11-20 (`scripts/digest.ts`) | linux/amd64, linux/arm64 |
| `stalwart` | `docker.io/stalwartlabs/stalwart:v1.1.1` | `docker.io/stalwartlabs/stalwart@sha256:5ebdf474b237161742fe4309396af4ae8797c938e8e6eb7e2d4837332c4f9851` | Registry docker.io, Tag v1.1.1, abgefragt am 2026-11-20 | linux/amd64, linux/arm64, linux/arm |
| `redis` | `docker.io/library/redis:8.10.3-alpine` | `docker.io/library/redis@sha256:7958cfbb9d152f87dadfbc89f1b0b15938f0b81ff8982feb327476f4911935c3` | Registry docker.io, Tag 8.10.3-alpine, abgefragt am 2026-11-20 | linux/amd64, linux/arm64 (und weitere) |
| `livekit` | `docker.io/livekit/livekit-server:v1.13.11` | `docker.io/livekit/livekit-server@sha256:25cd902de7cacbd5f1f779f6a6ac1eae20ba8f56b0935934ce6b0ab80d1e3d20` | Registry docker.io, Tag v1.13.11, abgefragt am 2026-11-20 | linux/amd64, linux/arm64 |
| `livekit-sip` | `docker.io/livekit/sip:v1.25.0` | `docker.io/livekit/sip@sha256:92361877818f865ece21c171b9703a4c68b133136a3e721f86dda42984c9c400` | Registry docker.io, Tag v1.25.0, abgefragt am 2026-11-20 | linux/amd64, linux/arm64 |
| `caddy` | `docker.io/library/caddy:2.11.9-alpine` | `docker.io/library/caddy@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0` | Registry docker.io, Tag 2.11.9-alpine, abgefragt am 2026-11-20 | linux/amd64, linux/arm64 (und weitere) |
| `schreibzeug` (Option) | `ghcr.io/speicherstadt/schreibzeug:0.1.25` | `ghcr.io/speicherstadt/schreibzeug@sha256:41baec9bfe28f7603fe59723d44e7a92d7ba1950cea4dd21f12b18ecd2fce09b` | Registry ghcr.io, Tag 0.1.25, abgefragt am 2026-11-20 | linux/amd64 |

Tags: `kontext` aus `package.json` (0.1.37, auch `deploy/quadlet/kontext.container`), die übrigen
aus den Quadlets (`stalwart.container`, `redis.container`, `livekit.container`,
`livekit-sip.container`, `caddy.container`, `schreibzeug.container`). Kontext und Schreibzeug von
GHCR statt `docker.io/tristanteu/…`: ihre Release-Workflows pushen mit `ghcr: true`.

## Konfigurationsdateien (`dateien`)

| Container | Pfad | Inhalt | SHA-256 des Inhalts |
| --- | --- | --- | --- |
| `caddy` | `/etc/caddy/Caddyfile` | `deploy/Caddyfile`, unverändert (`caddy.container`: `Volume=…/Caddyfile:/etc/caddy/Caddyfile:ro`) | `8bb29ef1e4672c1bfa2c3d323b8c1a4e758947febbd6b3674c130062d73b96b0` |
| `livekit` | `/etc/livekit.yaml` | `deploy/livekit.yaml`, unverändert (`livekit.container`: `Volume=…/livekit.yaml:/etc/livekit.yaml:ro`) | `9af76d279ea93da7071ef24f87ebe6bfd504d5b3f4a4bb771819325f19798e66` |

Beide nennen die anderen Container beim Namen (`kontext:3000`, `stalwart:8080`, `livekit:7880`,
`redis:6379`, `schreibzeug:3000`); so heißen sie im Netz der Installation (docs/plan.md,
„Entscheidungen“ → „Namen im Netz der Installation“).

## Angaben

| Angabe | Wert | Quelle |
| --- | --- | --- |
| `schema` | 1 | Schema der Steuerzentrale (`docs/manifest.md`) |
| `id` | kontext | `package.json` (`name`) |
| `version` | 0.1.37 | `package.json` (`version`), `deploy/.env.example` (`KONTEXT_VERSION` = 0.1.37) |
| `lizenz` | AGPL-3.0-only | `package.json` (`license`), `LICENSE` |
| `quelle` | https://github.com/Speicherstadt/kontext | Repository |
| `container` | `kontext`, `stalwart`, `redis`, `livekit`, `livekit-sip`, `caddy` | `deploy/quadlet/*.container` |
| `braucht` | `kontext` → `stalwart`; `livekit` → `redis`; `livekit-sip` → `redis`, `livekit`; `caddy` → `kontext`; `schreibzeug` → `kontext` | `After=`/`Wants=` der Quadlets |
| `feste_env` von `kontext` | `STALWART_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY` | `kontext.container` (`Environment=…`) |
| Volume `kontext-data` | `/data` | `kontext.container`, `docker/Dockerfile` (`VOLUME /data`, `DATABASE_PATH` = /data/kontext.db) |
| Volumes `stalwart-config`, `stalwart-data` | `/etc/stalwart`, `/var/lib/stalwart` | `stalwart.container` |
| Volumes `caddy-data`, `caddy-config` | `/data`, `/config` | `caddy.container` |
| Volume `schreibzeug-data` | `/data` | `schreibzeug.container` |
| `feste_env` von `schreibzeug` | `OIDC_CLIENT_ID` = schreibzeug | `schreibzeug.container` (`Environment=OIDC_CLIENT_ID=schreibzeug`) |
| `redis` `argv` | `redis-server --save --appendonly no` | `redis.container` (`Exec=redis-server --save "" --appendonly no`), `deploy/compose.yaml` (`command`); ohne das leere `""`, weil Quadlet ein leeres Wort beim Schreiben von `ExecStart=` weglässt (Podman v4.9.0, `pkg/systemd/parser/split.go`, `escapeWords`; so läuft auch Kontexts eigenes Quadlet) und Redis `--save` vor einer weiteren Option als `--save ""` liest (redis/redis 8.0.0, `src/server.c`, „Special case: handle some things like `--save --config value`“) |
| `livekit` `argv` | `--config /etc/livekit.yaml --udp-port 7882` | `livekit.container` (`Exec=`) |
| `architektur` | amd64, arm64 | Plattformen der Images oben; docs/plan.md, Tabelle |
| `ressourcen` `ram_mb` | 4096 | docs/plan.md, Tabelle |
| `ressourcen` `platte_gb` | 50 | Planwert der Steuerzentrale (docs/plan.md, „Planwerte der Manifeste“) |
| `netz` `http` | keiner (eigener Proxy) | `caddy.container` veröffentlicht 80 und 443 selbst |
| `netz` `ports` | `stalwart` 25, 465, 587, 993; `livekit` 7881, 7882/udp; `livekit-sip` 5060, 20000–20100/udp; `caddy` 80, 443, 443/udp; alle fest | `PublishPort=` in `stalwart.container`, `livekit.container`, `livekit-sip.container`, `caddy.container`; Stalwarts Admin (`127.0.0.1:8080`) entfällt, erreichbar nur über SSH |
| `netz` `oeffentliche_ipv4`, `mail`, `server_fuer_sich` | ja, ja, ja | `docs/installation.md`, „1. Server und DNS“ (Port 25, PTR); docs/plan.md, Tabelle |
| `proxy` | eigen | docs/plan.md, Tabelle („eigen“), `deploy/Caddyfile` |
| `rootful` | nein | die Quadlets brauchen kein root im Container; Stalwart bindet die Mail-Ports mit `CAP_NET_BIND_SERVICE` (`stalwart.container`). Offen für Stufe 2: rootless veröffentlicht Port 25 erst mit `net.ipv4.ip_unprivileged_port_start` ≤ 25 (heute 80, docs/plan.md, „Pforte“) |
| `optionen` | `documents`: `schreibzeug`, nur amd64, 1024 MB | `deploy/compose.yaml` (Profil `documents`), `schreibzeug.container`; Architektur: Plattformen des Images; RAM: docs/plan.md, Tabelle (Zeile schreibzeug) |
| `braucht` | keine | – |
| `bietet` | `oidc-anbieter`, `smtp` | `deploy/compose.yaml` (`OIDC_ISSUER: https://${KONTEXT_DOMAIN}/api/auth` für Schreibzeug), `server/oidc/`; Stalwart mit Port 587 |
| `anmeldung` | anbieter | docs/plan.md, Tabelle; Kontext ist selbst der Anbieter |
| `health` | http `/healthz` auf `kontext`, Port 3000 | `server/app.ts` (`app.get("/healthz", …)`), `docker/Dockerfile` (`HEALTHCHECK`, `PORT` = 3000) |
| `befehle` | `setup-stalwart`: `bun server/setup-stalwart.ts` in `kontext` | `server/setup-stalwart.ts` („safe to run again after every update“), `docs/installation.md`, „Einrichtungsbefehl“ |
| `schritte` | `setup-stalwart` beim Einrichten und nach jedem Update | `server/setup-stalwart.ts`; docs/plan.md, „Die Apps der Speicherstadt“ |
| `backup` | Volumes `stalwart-data`, `stalwart-config`, `kontext-data`, `schreibzeug-data` | `deploy/backup.sh` (Stalwarts Speicher und Einstellungen, Kontexts SQLite und Dateien, Schreibzeug) |
| `aktionen` | nur lesen, Export: nicht unterstützt | docs/plan.md, „Die Apps der Speicherstadt“ |
| `sperrzeiten` | keine | – |
| `dns` | A für Mailserver, `mta-sts.` und `openpgpkey.`; MX; SPF; DMARC | `docs/installation.md`, „1. Server und DNS“; DKIM fehlt, den Schlüssel erzeugt Stalwart |
| `hinweis` | Lizenz und Repository | `package.json`, `LICENSE` |

## Einstellungen (`env`)

| Name | Ebene | Quelle |
| --- | --- | --- |
| `BETTER_AUTH_URL` | auto, Adresse | `deploy/compose.yaml` (`https://${KONTEXT_DOMAIN}`), `server/env.ts` |
| `BETTER_AUTH_SECRET` | auto, `zufall_64` | `deploy/compose.yaml` (`KONTEXT_SECRET`), `deploy/.env.example` („openssl rand -base64 48“), `server/env.ts` (`secret()`, mindestens 32) |
| `STALWART_ADMIN` | installation, Pflicht | `server/setup-stalwart.ts` („takes it from STALWART_ADMIN="name:password"“) |
| `STALWART_ADMIN_KEY` | installation | `kontext.container`, `deploy/.env.example` (API-Schlüssel von `kontext-server`), `server/env.ts` |
| `STALWART_HOSTNAME` | installation, Pflicht | `stalwart.container`, `deploy/.env.example` (MX, PTR) |
| `STALWART_PUBLIC_URL` | auto, Adresse | `deploy/compose.yaml` (`https://${KONTEXT_DOMAIN}`) |
| `STALWART_BLOB_KEY` | auto, `zufall_32` | `deploy/compose.yaml`, `deploy/.env.example` („openssl rand -base64 32“) |
| `LIVEKIT_API_SECRET` | auto, `zufall_32` | `kontext.container`, `deploy/compose.yaml` (`LIVEKIT_SECRET`), `server/env.ts` |
| `LIVEKIT_KEYS` | auto, Vorlage | `livekit.container` (`LIVEKIT_KEYS` = "kontext: <secret>"), `deploy/compose.yaml` |
| `SIP_CONFIG_BODY` | auto, Vorlage | `livekit-sip.container` (eine Zeile in YAML-Flow-Stil), `deploy/compose.yaml` |
| `KONTEXT_DOMAIN` | auto, Vorlage (`${host}`) | `caddy.container`, `deploy/Caddyfile` |
| `MAIL_DOMAIN` | installation, Pflicht | `caddy.container`, `deploy/.env.example` |
| `ACME_EMAIL` | betreiber, Pflicht | `caddy.container`, `deploy/Caddyfile` (`email {$ACME_EMAIL}`) |
| `SCHREIBZEUG_URL` | installation, Pflicht mit Option `documents` | `kontext.container`, `schreibzeug.container`, `caddy.container`, `deploy/.env.example` |
| `SCHREIBZEUG_CLIENT_SECRET` | auto, `zufall_32`, Option `documents` | `kontext.container`, `deploy/.env.example` |
| `SCHREIBZEUG_EMBED_ORIGIN` | auto, Adresse, Option `documents` | `schreibzeug.container`, `deploy/compose.yaml` (`https://${KONTEXT_DOMAIN}`) |
| `OIDC_ISSUER` | auto, Vorlage, Option `documents` | `deploy/compose.yaml` (`https://${KONTEXT_DOMAIN}/api/auth`) |
| `OIDC_CLIENT_SECRET` | auto, Vorlage, Option `documents` | `deploy/compose.yaml` (`${SCHREIBZEUG_CLIENT_SECRET}`) |

### Titel (`titel`)

Der Titel, den die Einstellungen der Steuerzentrale statt des Namens zeigen, steht nur, wo Kontext
den Wert selbst in Worten nennt (gleicher Commit wie oben):

| Name | Titel | Quelle |
| --- | --- | --- |
| `ACME_EMAIL` | Adresse für Let's Encrypt | `docs/installation.md`, Tabelle der Variablen („Adresse für Let's Encrypt“) |

Nicht im Manifest: `SCHREIBZEUG_TRUSTED_PROXIES` (das feste Netz `10.89.250.0/24` der Quadlets gibt es
unter der Steuerzentrale nicht; ohne den Wert zählen Anmeldungen bei Schreibzeug je Proxy statt je
Client), `PLACES_URL` (Vorgabe der App), die Sicherung des Repos (`deploy/backup.sh`, die
Steuerzentrale sichert selbst).
