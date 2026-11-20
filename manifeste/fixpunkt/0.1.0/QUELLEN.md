# Quellen: Fixpunkt

Manifest: `manifest.yml` daneben. Alle Dateien unten stammen aus
[Speicherstadt/fixpunkt](https://github.com/Speicherstadt/fixpunkt), Commit
`d46b7b4d763a9d2707644986d72a961dbd919bb8`, sofern nichts anderes dasteht. Fixpunkt hat keine
Quadlets im Repo; der Container folgt dem Quadlet in `docs/installation.md`, die Option dem
Compose-Beispiel in `docs/drohnenfotos.md`.

## Images

| Container | Image (Tag) | Digest | Quelle des Digests | Plattformen |
| --- | --- | --- | --- | --- |
| `app` | `docker.io/tristanteu/fixpunkt:0.1.0` | **fehlt**: noch nicht veröffentlicht | `scripts/digest.ts` am 2026-11-20: docker.io antwortet für Tag 0.1.0 `HTTP 404` (das Repository hat nur `edge`); ghcr.io antwortet `token: HTTP 403` (`release.yml` pusht nicht nach GHCR) | – |
| `nodeodm` (Option) | `docker.io/opendronemap/nodeodm:latest` | `docker.io/opendronemap/nodeodm@sha256:fcd99eb23d8db194a7d1dc95f029f518283b3d6be32dd64422395f4e7af56720` | Registry docker.io, Tag latest, abgefragt am 2026-11-20 (`scripts/digest.ts`) | linux/amd64, linux/arm64 |

`edge` ist kein Release, sondern ein Lauf von Hand (`.github/workflows/release.yml`); bis zum ersten
Release ist Fixpunkt nicht installierbar (docs/plan.md, „Apps ohne Betreiber-Vertrag“).

## Angaben

| Angabe | Wert | Quelle |
| --- | --- | --- |
| `schema` | 1 | Schema der Steuerzentrale (`docs/manifest.md`) |
| `id` | fixpunkt | Name des Repositorys |
| `version` | 0.1.0 | `Cargo.toml` (`[workspace.package] version`) |
| `lizenz` | UNLICENSED | `Cargo.toml` und `package.json` (`license`); das Repository hat keine `LICENSE` |
| `quelle` | https://github.com/Speicherstadt/fixpunkt | `Cargo.toml` (`repository`) |
| `container` | `app` | `docs/installation.md` („Podman Quadlet“); Name wie in docs/plan.md |
| Volume `daten` | `/data` | `docs/installation.md` (`Volume=fixpunkt.volume:/data`), `docker/Dockerfile` (`VOLUME ["/data"]`) |
| `feste_env` von `app` | `FIXPUNKT_SECURE_COOKIES` = true | `docs/installation.md` („hinter einen Reverse-Proxy mit HTTPS … dann `FIXPUNKT_SECURE_COOKIES` = true setzen“), `docs/konfiguration.md` |
| `architektur` | amd64, arm64 | `docs/installation.md` („Linux-Server (amd64 oder arm64)“) |
| `ressourcen` `ram_mb` | 8192 | docs/plan.md, Tabelle; `docs/installation.md` („für große Flüge 8–16 GB“) |
| `ressourcen` `platte_gb` | 200 | Planwert der Steuerzentrale (docs/plan.md, „Planwerte der Manifeste“; „Fixpunkt braucht viel Platte“) |
| `netz` `http` | `app`, Port 8080, SSE | `docker/Dockerfile` (`EXPOSE 8080`), `docs/konfiguration.md` (Caddy: „Live-Updates (Server-Sent Events) nicht puffern“) |
| `netz` `http` `max_body_mb` | 20480 | `docs/konfiguration.md` (`request_body { max_size 20GB }`, `FIXPUNKT_MAX_UPLOAD_GB` Vorgabe 20) |
| `netz` (sonst) | keine Ports, keine IPv4, keine Mail, kein Server für sich | docs/plan.md, Tabelle |
| `proxy` | geteilt | `docs/konfiguration.md`, „Reverse-Proxy“ |
| `rootful` | nein | `docker/Dockerfile` (`USER fixpunkt`) |
| `optionen` | `nodeodm` | `docs/drohnenfotos.md`, „NodeODM einrichten“; docs/plan.md, Tabelle („nodeodm (Option)“) |
| `braucht`, `bietet` | keine | – |
| `anmeldung` | eigen | `docs/installation.md`, „Erster Start“; OIDC fehlt noch (fixpunkt#5, BAULISTE.md) |
| `health` | http `/api/health` auf `app` | `crates/server/src/api.rs` (`.route("/health", get(health))` unter `/api`), `docker/Dockerfile` (`HEALTHCHECK`), `docs/installation.md` |
| `befehle`, `schritte` | keine | Migrationen beim Start (`docs/backup.md`, „Updates“) |
| `backup` | Volume `daten` | `docs/backup.md`, „Was gesichert werden muss“ (alles im Datenverzeichnis) |
| `aktionen` | nur lesen, Export: nicht unterstützt | docs/plan.md, „Die Apps der Speicherstadt“ |
| `sperrzeiten`, `dns` | keine | – |
| `hinweis` | Repository | `Cargo.toml` |

## Einstellungen (`env`)

| Name | Ebene | Quelle |
| --- | --- | --- |
| `FIXPUNKT_PUBLIC_URL` | auto, Adresse | `docs/konfiguration.md` („schaltet Passkeys ein“), `docs/installation.md` |
| `FIXPUNKT_USER`, `FIXPUNKT_PASSWORD` | installation, Pflicht | `docs/konfiguration.md` („Erster Admin, falls es noch keinen Benutzer gibt“), `docs/installation.md` (mindestens 8 Zeichen); Pflicht, damit nicht der erste Besucher Admin wird |
| `FIXPUNKT_MAX_JOBS` | installation, Vorgabe 1 | `docs/konfiguration.md` |
| `FIXPUNKT_NODEODM_URL` | auto, `http://nodeodm:3000`, Option `nodeodm` | `docs/drohnenfotos.md` (`FIXPUNKT_NODEODM_URL: http://nodeodm:3000`), `docs/konfiguration.md` |

Offen: Die Option `nodeodm` hat kein eigenes `ram_mb`, weil keine Quelle eines nennt.
