# Quellen: Stellwerk

Manifest: `manifest.yml` daneben. Alle Dateien unten stammen aus
[Speicherstadt/stellwerk](https://github.com/Speicherstadt/stellwerk), Commit
`749142ae128d8faf9af0f07245cd360f0892e2a3`, sofern nichts anderes dasteht. Stellwerk hat keine
Quadlets im Repo; der Container folgt dem Quadlet und der Compose-Datei in `docs/installation.md`
(„Zentrale als Container“).

## Images

| Container | Image (Tag) | Digest | Quelle des Digests | Plattformen |
| --- | --- | --- | --- | --- |
| `zentrale` | `docker.io/tristanteu/stellwerk:0.1.12` | `docker.io/tristanteu/stellwerk@sha256:41f38458d09c1c5f3865e23a7719739cb5d71fdf0272cbe652b8c2db84810291` | Registry docker.io, Tag 0.1.12, abgefragt am 2026-11-20 (`scripts/digest.ts`) | linux/amd64, linux/arm64 |

Docker Hub statt GHCR: `.github/workflows/release.yml` setzt zwar `ghcr: true`, aber
`ghcr.io/speicherstadt/stellwerk` ist nicht öffentlich abrufbar (`scripts/digest.ts` am 2026-11-20:
`token: HTTP 403`). Der Tag `0.1.12` ist die Version aus `Cargo.toml`.

## Angaben

| Angabe | Wert | Quelle |
| --- | --- | --- |
| `schema` | 1 | Schema der Steuerzentrale (`docs/manifest.md`) |
| `id` | stellwerk | Name des Repositorys |
| `version` | 0.1.12 | `Cargo.toml` (`[workspace.package] version`) |
| `lizenz` | AGPL-3.0-only | `Cargo.toml` (`license`), `LICENSE` |
| `quelle` | https://github.com/Speicherstadt/stellwerk | Repository |
| `container` | `zentrale` | `docs/installation.md` („Podman Quadlet“); Name wie in docs/plan.md |
| Volume `daten` | `/data` | `docs/installation.md` (`Volume=stellwerk.volume:/data`), `docker/Dockerfile` (`VOLUME /data`) |
| `architektur` | amd64, arm64 | `docs/installation.md` („Linux auf amd64 oder arm64“); Plattformen des Images |
| `ressourcen` `ram_mb` | 1024 | docs/plan.md, Tabelle |
| `ressourcen` `platte_gb` | 100 | Planwert der Steuerzentrale (docs/plan.md, „Planwerte der Manifeste“; „Stellwerk braucht viel Platte“) |
| `netz` `http` | `zentrale`, Port 8080, WebSocket | `docker/Dockerfile` (`STELLWERK_LISTEN` = 0.0.0.0:8080), `docs/reference.md` (WebSocket der Oberfläche und der Agenten) |
| `netz` `ports` | `zentrale` 22001/tcp, je Installation vergeben | `docker/Dockerfile` (`STELLWERK_HUB_LISTEN` = tcp://0.0.0.0:22001), `docs/installation.md` („Der Hub-Port 22001 geht nicht über den Proxy“); vergeben: docs/plan.md, „Ports“ |
| `netz` `oeffentliche_ipv4` | ja | docs/plan.md, Tabelle; die Geräte erreichen den Hub direkt (`docs/installation.md`) |
| `netz` (sonst) | keine Mail, kein Server für sich | docs/plan.md, Tabelle |
| `proxy` | geteilt | `docs/installation.md` (TLS-Proxy vor 8080) |
| `rootful` | nein | `docker/Dockerfile` (distroless `nonroot`, UID 65532) |
| `optionen`, `braucht`, `bietet` | keine | – |
| `anmeldung` | eigen | `crates/zentrale/src/api/mod.rs` (`/api/login`); OIDC fehlt noch (stellwerk#36, BAULISTE.md) |
| `health` | keine, nur mit Anmeldung | `crates/zentrale/src/api/mod.rs` und `crates/zentrale/src/server.rs`: kein Endpunkt für einen Health-Check ohne Sitzung; docs/plan.md, Tabelle |
| `befehle`, `schritte` | keine | `stellwerk set-password` liest das Passwort von der Standardeingabe (`docs/installation.md`); ein benannter Befehl hat keine |
| `backup` | Volume `daten` | `docs/installation.md`, „Sichern und wiederherstellen“ (alles unter `/data`) |
| `aktionen` | nur lesen, Export: nicht unterstützt | docs/plan.md, „Die Apps der Speicherstadt“ |
| `sperrzeiten`, `dns` | keine | – |
| `hinweis` | Lizenz und Repository | `Cargo.toml`, `LICENSE` |

## Einstellungen (`env`)

| Name | Ebene | Quelle |
| --- | --- | --- |
| `STELLWERK_HUB_ADDRESS` | auto, Vorlage `tcp://${host}:${port:zentrale:22001}` | `docs/installation.md` („In einem Container … setz die Adresse also immer. Bildest du den Hub auf einen anderen Port nach außen ab, gehört dieser Port in die Adresse.“), `docs/reference.md` |
| `STELLWERK_PUBLIC_URL` | auto, Adresse | `docs/installation.md`, `docs/reference.md` |
