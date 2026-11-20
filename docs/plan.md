---
title: Projektplan
description: >-
  Der Plan für die Steuerzentrale: Ziel, Aufbau aus Zentrale und Agent, die Apps der Speicherstadt
  und ihr Manifest, Entscheidungen, Technologie, Datenmodell, Sicherheit, Bauplan im Agenten-Loop
  und Tests.
---

# Projektplan

Die Steuerzentrale installiert, aktualisiert, sichert und überwacht die Apps der Speicherstadt auf
Servern: auf unseren eigenen, auf einem eigenen Server je Kunde oder auf einem Server beim Kunden.
Sie ist das Werkzeug für Hosting, Wartung und Support, Open Source unter der AGPL. Was gebaut wird
und in welcher Reihenfolge, steht in der
[Bauliste](https://github.com/Speicherstadt/steuerzentrale/blob/main/BAULISTE.md).

## Ziel

- **Ein Ort für alle Server und Installationen**: welcher Kunde welche App auf welchem Server hat, in
  welcher Version, ob sie gesund ist und wann das letzte Backup lief.
- **Updates ohne Handarbeit**: neue Versionen in Wellen, mit Backup vorher, Prüfung danach und
  Rückkehr zur alten Version, wenn die Prüfung fehlschlägt; nie in einer Sperrzeit einer App (Haben
  vom 7. bis 10. des Monats, Umsatzsteuer-Voranmeldung).
- **Server pflegen**: Betriebssystem-Updates, Neustarts im Wartungsfenster, Plattenplatz,
  Zertifikate, Backups, offene Ports.
- **Support mit Spur**: Zugriff auf eine Installation nur zeitlich begrenzt, protokolliert und für
  den Kunden sichtbar.
- **Keine App ist fest eingebaut**: Jede App beschreibt sich in einem Manifest; die Steuerzentrale
  kennt nur das Manifest.

**Bewusst nicht in der Steuerzentrale**: Buchung, Bezahlung und Rechnungen an Kunden (das Portal,
ein eigenes Projekt), Server bei Anbietern bestellen (später, über deren API), Fernwartung von
Geräten beim Kunden (Kontext-Box, Stellwerk-Agenten, Desktop-Apps).

## Aufbau

```text
                 Portal (eigenes Repo, öffentlich)
                        │  API: Kunde anlegen, App buchen, kündigen
                        ▼
  Betrieb ──▶  Zentrale (ein Server, nicht öffentlich: VPN oder IP-Liste)
                        ▲  ausgehend vom Server: WSS, Token je Server
       ┌────────────────┼────────────────┐
   Server A          Server B          Server C (beim Kunden,
   Agent             Agent             nur ausgehend, z. B. hinter NAT)
   Pforte (Caddy)    Pforte            Pforte oder Cloudflare Tunnel
   Haben, Soll, …    Kontext (allein)  Belegt, Kennwort
```

- **Zentrale**: Server mit API und Oberfläche. Sie hält Kunden, Server, Installationen, Manifeste,
  Aufträge, Ereignisse und das Audit-Log. Sie läuft genau einmal, auf einem eigenen kleinen Server.
- **Agent**: kleines Programm auf **jedem** verwalteten Server, als systemd-Dienst. Er baut die
  Verbindung zur Zentrale selbst auf (kein offener Port), meldet Heartbeat, Systemdaten und den
  Zustand jeder Installation und führt Aufträge aus. Er kennt nur die Aktionen, die ein Manifest
  beschreibt (installieren, aktualisieren, sichern, wiederherstellen, nur lesen, exportieren,
  neu starten, entfernen); eine freie Shell gibt es nicht.
- **Pforte**: ein Caddy je Server, den der Agent verwaltet. Er nimmt 80 und 443 an, holt die
  Zertifikate und leitet jede Subdomain an ihre Installation. Apps, die einen eigenen Caddy
  mitbringen, laufen ohne ihn (Option im Manifest).
- **Ein-Server-Betrieb**: Zentrale und Agent auf derselben Maschine, für Selbsthoster und Partner
  mit wenigen Kunden. Derselbe Code, die Zentrale als eine Quadlet-Unit mehr.
- **Portal**: öffentliche Website mit Buchung und Bezahlung, ein eigenes Repo. Es spricht mit der
  Zentrale nur über deren API (Kunde anlegen, App buchen, kündigen) und bekommt Ereignisse per
  Webhook (installiert, Störung, gekündigt). Es kommt nach der Steuerzentrale.

### Ablauf: Server hinzufügen

1. In der Zentrale „Server hinzufügen“: Name, Art (gemeinsam, eigen, beim Kunden), Wartungsfenster.
2. Die Zentrale zeigt einen Befehl mit Einmal-Token (24 h gültig):
   `curl -fsSL https://zentrale.example/install.sh | sudo sh -s -- --token …`
3. Das Skript prüft das System (Debian 13 oder Ubuntu 24.04, amd64 oder arm64; Debian 12 hat mit
   Podman 4.3 noch keine Quadlets), installiert
   Podman, unattended-upgrades und den Agenten, und der Agent tauscht das Einmal-Token gegen seinen
   dauerhaften Schlüssel.
4. Der Server erscheint mit seinen Fakten: CPU, RAM, Platte, Architektur, öffentliche IPv4 und
   IPv6, PTR, freie Ports.

### Ablauf: App installieren

1. Kunde wählen, App wählen, Server wählen. Die **Platzierung** (eine reine Funktion) prüft das
   Manifest gegen den Server und seine anderen Installationen: Architektur, RAM und Platte, Ports,
   öffentliche IP, „braucht einen Server für sich“, Abhängigkeiten. Sie liefert „passt“,
   Warnungen oder Gründe, warum es nicht geht.
2. Einstellungen nach Ebenen: was der Betreiber einmal setzt (Hersteller-ID für ELSTER), was je
   Installation gilt (Subdomain, Grenzen), was die Zentrale selbst erzeugt (Schlüssel, Secrets).
3. Die Zentrale rendert die Quadlet-Dateien (`.container`, `.volume`, `.network`) und die Podman-Secrets
   aus Manifest und Einstellungen (reine Funktion) und schickt den Auftrag. Der Agent legt einen eigenen
   Linux-Nutzer für die Installation an, zieht die Images, führt die Einrichtungsschritte des Manifests
   aus, startet, trägt die Subdomain in die Pforte ein und meldet, sobald der Health-Check grün ist.

### Ablauf: Update

1. Die Zentrale sieht neue Image-Versionen in der Registry (Docker Hub, GHCR).
2. Sie plant Wellen: intern, frühe Kunden, Standard, spät (SLA „spät“ für Kunden, die Ruhe wollen),
   jede Welle erst, wenn die vorige einen Tag gesund war, und nie in einer Sperrzeit.
3. Je Installation: Backup, Image ziehen, Schritte nach dem Update, Neustart, Health; bei Fehler
   zurück auf die alte Version und das Backup, Meldung an den Betrieb.

## Die Apps der Speicherstadt

Stand der Repos im November 2026. Das Manifest jeder App liegt zuerst in diesem Repo unter
`manifeste/`, mit der Quelle jeder Angabe (Datei im App-Repo); später übernimmt jede App ihr
Manifest in ihr eigenes Repo und veröffentlicht es mit jedem Release.

| App | Was | Container | Netz | Ressourcen | Anmeldung | Besonderes |
| --- | --- | --- | --- | --- | --- | --- |
| Haben | Buchhaltung, ELSTER | App, Postgres, Backup, Caddy (`deploy/quadlet/`, `deploy/compose.yml`) | HTTP | 2 GB RAM | OIDC | Sperrzeit 7.–10.; Hersteller-ID beim Betreiber; CLI für Instanzen; Health fehlt noch (Haben#946) |
| Belegt | Belege, GoBD-Archiv | App, Worker, Postgres, Restic; Profile journal, backup, ftp, ki, … | HTTP, optional FTP | 2 GB RAM | OIDC | eigener Caddy (Profil `https`); Backup mit Prüf-Restore |
| Kontext | Mail, Kalender, Kontakte, Anrufe | Stalwart, Caddy, LiveKit, Redis, App; Profile calls, documents | 25, 465, 587, 993, 7881/tcp, 7882/udp, 5060, 20000–20100/udp | 4 GB RAM | ist selbst Anbieter (Stalwart) | braucht öffentliche IPv4 mit PTR und einen Server für sich; nicht hinter Cloudflare; `setup-stalwart` nach jedem Update; Kontext-Box beim Kunden |
| Schreibzeug | Dokumente, gemeinsames Schreiben | App, SQLite | HTTP, WebSocket | 1 GB RAM | OIDC | nur amd64; steckt auch in Kontext (Profil documents) |
| Stellwerk | Dateien synchronisieren | Zentrale mit Hub-Syncthing | HTTP, 22001/tcp direkt erreichbar | Platz für die Dateien | ein Admin (OIDC: stellwerk#36) | kein Health ohne Anmeldung; Agenten auf Geräten beim Kunden |
| Fixpunkt | Aufmaß aus Drohnenbildern | App, optional NodeODM | HTTP, SSE | 4–16 GB RAM, mit NodeODM ~16 GB | eigene Konten (OIDC: fixpunkt#5) | Uploads bis 20 GB |
| Kennwort | Passwörter im Team | App, SQLite | HTTP | 512 MB RAM | OIDC über Kontext | in Entwicklung |
| Soll | Zeiterfassung, Dienstplan | App, SQLite | HTTP | 512 MB RAM | OIDC | in Entwicklung; Tablet-Terminal beim Kunden |

Haben und Kontext liefern Quadlets (`deploy/quadlet/`), Belegt und Schreibzeug nur Compose, Stellwerk und
Fixpunkt ein Image oder Binary. Das Manifest beschreibt deshalb die Container selbst; die Quadlets
erzeugt die Zentrale daraus.

Was daraus für das Manifest folgt: Ports und öffentliche IP, „Server für sich“, Optionen (bisher
Compose-Profile), Abhängigkeiten (Schreibzeug in Kontext, Kennwort braucht einen OIDC-Anbieter),
RAM, Platte und Architektur, Einrichtungsschritte und Schritte nach dem Update, eigener oder
geteilter Proxy, Backup-Art, Health ohne Anmeldung. Keine App hat heute einen Nur-lesen-Modus,
einen Status-Befehl oder Sperrzeiten im Code; bis dahin sagt das Manifest „nicht unterstützt“ und
die Zentrale bietet die Aktion nicht an.

## Manifest

Eine YAML-Datei je App und Version, geprüft mit dem Zod-Schema aus `packages/manifest`, als JSON
Schema veröffentlicht. Beispiel, gekürzt:

```yaml
schema: 1
id: haben
name: Haben
beschreibung: Buchhaltung für Selbständige
lizenz: AGPL-3.0-only
quelle: https://github.com/Speicherstadt/haben
container:                      # daraus werden Quadlet-Units; Quelle: deploy/quadlet/ in Speicherstadt/haben
  - { name: app, image: docker.io/tristanteu/haben, volumes: [belege, eric], braucht: [db] }
  - { name: db, image: docker.io/tristanteu/haben-db, volumes: [db] }
architektur: [amd64, arm64]
ressourcen: { ram_mb: 2048, platte_gb: 10 }
netz:
  http: { dienst: app, port: 3000 }  # an die Pforte
  ports: []                          # direkt am Server, z. B. 25/tcp bei Kontext
  oeffentliche_ipv4: false
  server_fuer_sich: false
proxy: geteilt                  # haben-caddy entfällt, die Pforte übernimmt; eigen: App braucht 80/443
rootful: false                  # true nur mit server_fuer_sich (Kontext, wie dessen Quadlets)
optionen: []                    # schalten Container zu, z. B. Belegt: ki, ftp
braucht: []                     # z. B. Kennwort: [oidc-anbieter]
bietet: []                      # z. B. Kontext: [oidc-anbieter, smtp]
anmeldung: oidc                 # oidc | eigen | anbieter
health: { pfad: /api/health }   # sobald Haben#946 umgesetzt ist
schritte:
  einrichten: ["bun run haben instanz anlegen --json"]
  nach_update: []
backup: { art: pg_dump, dienst: db }  # oder volume, restic, befehl
aktionen:
  nur_lesen: nicht_unterstuetzt     # bis Haben#947
  export: nicht_unterstuetzt        # bis Haben#948
sperrzeiten:
  - { monatlich: "07-10", grund: Umsatzsteuer-Voranmeldung }
env:
  - { name: ELSTER_HERSTELLER_ID, ebene: betreiber, pflicht: true, geheim: false }
  - { name: LAYOUTS_MAX_COUNT, ebene: installation, typ: zahl, vorgabe: 20 }
  - { name: BETTER_AUTH_SECRET, ebene: auto, erzeugen: zufall_32 }
  - { name: BETTER_AUTH_URL, ebene: auto, aus: url }
hinweis: Haben ist Open Source (AGPL), https://haben.app
```

Die Ebenen der Einstellungen:

| Ebene | Wer setzt sie | Beispiel |
| --- | --- | --- |
| `betreiber` | der Betrieb, einmal je App | Hersteller-ID für ELSTER, API-Schlüssel für KI |
| `installation` | der Betrieb je Installation, mit Vorgabe | Subdomain, Grenzen, Optionen |
| `auto` | die Zentrale, nie von Hand | Secrets, URL, OIDC-Client des Kunden |

## Entscheidungen

Der Loop entscheidet danach und trägt neue Entscheidungen hier mit Grund ein.

| Frage | Entscheidung | Warum |
| --- | --- | --- |
| Wo die Zentrale läuft | genau einmal, auf einem eigenen Server; im Ein-Server-Betrieb neben dem Agenten | ein Ort für alle Kunden; Selbsthoster brauchen keine zweite Maschine |
| Wer die Verbindung aufbaut | immer der Agent, ausgehend per WSS; Token je Server, rotiert | Server beim Kunden stehen hinter NAT; kein offener Port auf dem Server |
| Was der Agent darf | nur Aktionen aus dem Manifest der Installation, mit Argumenten nach Schema; keine Shell, kein `podman exec` mit freiem Befehl | ein übernommener Zugang zur Zentrale darf nicht beliebigen Code auf allen Servern ausführen |
| Aufträge | in der Zentrale gespeichert, idempotent mit ID, der Agent holt und bestätigt; ein Auftrag läuft nach Verbindungsabbruch weiter oder wird wiederholt | Netze brechen ab; ein doppelter Auftrag darf nichts doppelt tun |
| Orchestrierung | Podman-Quadlets unter systemd, rootless: je Installation ein eigener Linux-Nutzer (`sz-<installation>`, `loginctl enable-linger`) mit seinen Units in `~/.config/containers/systemd/`; kein Docker, kein Compose, kein Kubernetes | Stack-Vorgabe (`tech-stack.md`: Podman Quadlets); Kunden auf einem Server sind durch Linux-Nutzer getrennt, kein Root-Daemon; systemd übernimmt Neustarts, Abhängigkeiten und Logs; Haben und Kontext liefern schon Quadlets |
| Proxy | Pforte (Caddy) je Server, Subdomains als Caddy-Konfiguration vom Agenten; Apps mit eigenem Caddy nur auf einem Server für sich | 80/443 gibt es einmal je Server |
| Manifeste | zuerst in `manifeste/` dieses Repos mit Quellen; ein App-Repo kann später ein eigenes liefern, das dann Vorrang hat | der Loop ändert keine anderen Repos; die Apps sollen ihr Manifest selbst pflegen |
| Platzierung | reine Funktion: Manifest, Serverfakten und vorhandene Installationen → passt, Warnungen, Gründe | testbar ohne Server; dieselbe Funktion für Oberfläche, API und Portal |
| Mehrere Kunden auf einem Server | erlaubt („gemeinsam“), jede Installation unter eigenem Nutzer mit eigenem Netz und eigenen Volumes | günstige Pakete; Kontext und Apps mit eigenem Caddy bleiben allein |
| Updates | Wellen intern → früh → standard → spät; jede Welle nach 24 h ohne Störung; nie in einer Sperrzeit; Backup vorher, Rückkehr bei rotem Health | ein Fehler trifft zuerst uns |
| OS-Updates | unattended-upgrades für Sicherheitsupdates; Neustart nur im Wartungsfenster und außerhalb jeder Sperrzeit der Apps auf dem Server | Kernel-Updates brauchen Neustarts, Steuertermine nicht |
| Backups | Art aus dem Manifest, verschlüsselt mit restic an ein S3-Ziel je Betrieb; Prüf-Restore wöchentlich in einem Wegwerf-Projekt | ein Backup zählt erst, wenn es sich zurückspielen ließ |
| Geheimnisse | verschlüsselte Spalten mit `STEUERZENTRALE_SECRET_KEY`; Start ohne Schlüssel verweigert; auf dem Server nur als Podman-Secret des Nutzers der Installation | nichts im Klartext in der Datenbank oder im Repo |
| Anmeldung an der Zentrale | Better Auth, Passkey oder TOTP Pflicht für jedes Konto; Rollen Inhaber, Technik, Support, Partner (sieht nur eigene Kunden) | wer die Zentrale hat, hat alle Kunden |
| Support-Zugang | zeitlich begrenzt (Vorgabe 2 h), mit Grund, im Audit-Log und in der Ereignisliste des Kunden | Vertrauen; DSGVO Art. 28 (Auftragsverarbeitung) |
| SLA | Stufe je Vertrag: Basis, Plus (Reaktionszeit, frühe Welle möglich), Ruhe (späte Welle) | wer Ruhe kauft, bekommt Updates später |
| Partner | ein Partner ist ein Betreiber mit eigenen Kunden in derselben Zentrale oder mit eigener Zentrale | IT-Systemhäuser sollen unsere Apps betreiben können |
| Portal | eigenes Repo; spricht nur über die öffentliche API der Zentrale (Token mit Rechten) und Webhooks | die Zentrale bleibt nicht öffentlich |
| Was der Kunde sieht | nichts in der Zentrale; Zustand, Backups, Support-Zugänge und Export seiner Installationen zeigt das Portal über lesende Endpunkte der API | Kunden melden sich nie an der Zentrale an |
| Wo die Zentrale läuft | überall, wo die Agenten ihren Endpunkt per HTTPS erreichen (eigener Server, Büro, hinter einem Tunnel); die Oberfläche bleibt privat | die Agenten verbinden sich immer von sich aus; fällt die Zentrale aus, laufen die Apps weiter |
| Geräte beim Kunden | nicht verwaltet; die Zentrale zeigt nur, ob eine App solche Teile hat | Fernwartung von Geräten ist ein eigenes Thema |
| Was sich in der CI nicht echt testen lässt | Registry, S3 und Mail durch lokale Ersatzdienste (Registry-Container, MinIO, Mailpit); echte Server durch Podman mit systemd im Runner | die Kriterien für „fertig“ bleiben erfüllbar |
| Merge | der Loop merged selbst, wenn CI grün ist und das unabhängige Review keine Befunde mehr hat | er wartet nie auf einen Menschen |
| Beiträge | DCO (Signed-off-by), kein CLA | Open Source ohne Sonderrechte |

## Technologie

Derselbe Stack wie Kennwort und Soll. Gegenüber `tech-stack.md` aus firsttris/workflows dieselben
zwei Abweichungen wie dort (Solid 2 statt React, Hono-Server und SPA statt TanStack Start).

| Teil | Wahl | Begründung |
| --- | --- | --- |
| Monorepo | Bun Workspaces, Biome, TypeScript strict, Vitest, Playwright | wie überall |
| Zentrale | Bun, Hono, Drizzle mit SQLite (WAL), Zod, Better Auth, `bun build --compile` | ein Container ohne Datenbankserver; einige hundert Server sind für SQLite wenig |
| Agent | TypeScript, `bun build --compile` für amd64 und arm64, systemd-Dienst | teilt `packages/protokoll` und `packages/manifest` mit der Zentrale, kein Typen-Drift |
| Oberfläche | Solid 2 SPA, Paraglide, Tailwind 4, `packages/ui` von Kennwort, Geist, Zinc-Tokens | ein Look in der Suite |
| Verbindung | WebSocket über HTTPS, Nachrichten als Zod-Schemas mit Version | durch jede Firewall, die HTTPS durchlässt |
| Auf dem Server | Podman mit Quadlets unter systemd, rootless; `podman auto-update` aus | Updates nur über die Wellen der Zentrale, sonst greifen Sperrzeit und Backup vorher nicht |
| Pforte | Caddy als rootless Quadlet, Admin-API nur auf localhost; `net.ipv4.ip_unprivileged_port_start=80` | rootless darf sonst nicht auf 80/443; so in Haben `docs/installation.md` |
| Backup | restic | verschlüsselt, dedupliziert, S3 |
| Betrieb | Image der Zentrale (amd64, arm64, als Quadlet betrieben), Agent als Binary, Release-Workflow aus firsttris/workflows | |
| Doku | Zensical auf GitHub Pages | wie die anderen Apps |

## Projektstruktur

| Pfad | Inhalt |
| --- | --- |
| `packages/manifest` | Zod-Schema, Laden und Prüfen, JSON Schema, Platzierung, Quadlets rendern; reine Funktionen |
| `packages/protokoll` | Nachrichten zwischen Zentrale und Agent, Aufträge und ihre Zustände |
| `packages/planung` | Update-Wellen, Sperrzeiten, Wartungsfenster, Prüfungen der Server; reine Funktionen |
| `packages/ui` | Komponenten nach DESIGN.md, von Kennwort |
| `apps/zentrale` | Hono-API, Drizzle, Better Auth, Agent-Verbindungen; Routen dünn, Logik in `src/modules` |
| `apps/agent` | Verbindung, Systemdaten, Ausführung der Aufträge mit Podman, systemd und Caddy |
| `apps/web` | Solid-SPA der Zentrale |
| `manifeste/` | ein Verzeichnis je App: `manifest.yml` und `QUELLEN.md` |
| `install/` | `install.sh` für neue Server |
| `e2e/` | Playwright gegen Zentrale und einen Agenten im Container |

## Datenmodell

Betreiber → Kunde → Vertrag (SLA, Apps) → Installation (App, Version, Server, Optionen,
Einstellungen) → Server (Art, Wartungsfenster, Fakten). Dazu Manifest (App, Version, Inhalt),
Auftrag (Art, Installation oder Server, Zustand, Ergebnis), Ereignis (Health, Backup, Update,
Support-Zugang), Backup (Snapshot, Größe, Prüf-Restore), Einstellung (Ebene, Wert, verschlüsselt),
API-Token, Audit-Log. Alle Tabellen tragen `betreiber_id`; ein Partner sieht nur seine Kunden.

## Sicherheit

- Die Zentrale ist nicht öffentlich: nur über VPN (WireGuard) oder eine IP-Liste; die Agenten und
  die Portal-API erreichen sie über eigene Pfade mit Token.
- Jedes Konto mit Passkey oder TOTP; jede schreibende Aktion im Audit-Log (wer, was, wann, Grund).
- Agent-Schlüssel je Server, rotierbar, sofort sperrbar; ein gestohlener Schlüssel kann nur
  Meldungen dieses Servers fälschen und keine Aufträge erfinden.
- Aufträge nur aus dem Manifest; Argumente nach Schema; Ergebnis mit Log-Auszug ohne Geheimnisse.
- Die Zentrale sichert sich selbst (Datenbank und Schlüssel getrennt) und wird von außen überwacht.

## Bauplan im Agenten-Loop

Die Steuerzentrale wird als fertiges Produkt gebaut: Ein Agent arbeitet die Bauliste Punkt für
Punkt ab, bis jedes Häkchen gesetzt und jede Prüfung grün ist. Er wartet nie auf einen Menschen.

1. **Spezifikation zuerst**: das Manifest-Schema und die Kriterien je Punkt. Ohne Kriterium kein Code.
2. **Ein Durchlauf, ein Punkt**: reservieren (Draft-Pull-Request), Tests zuerst, umsetzen, Doku
   nachziehen, `bun run check` grün, unabhängiges Review, CI grün, selbst mergen, abhaken.
3. **Entscheiden statt fragen**: offene Fragen nach „Entscheidungen“; neue mit Grund dort eintragen.
4. **Nicht hängen bleiben**: dreimal gescheitert heißt zurückgestellt, weiter mit dem nächsten
   unabhängigen Punkt.
5. **Echt testen**: der Agent wird in der CI gegen echtes Podman mit systemd getestet, mit einer Beispiel-App
   aus diesem Repo; eine echte App der Speicherstadt erst in der Härtung.

Reihenfolge: 1 Fundament · 2 Manifest und Platzierung · 3 Agent · 4 Installationen · 5 Updates ·
6 Backups und Export · 7 Server-Pflege · 8 Kunden, Support und SLA · 9 API für das Portal ·
10 Härtung und Release.

## Tests

| Art | Was geprüft wird | Werkzeug |
| --- | --- | --- |
| Manifest | jedes Manifest in `manifeste/` gültig; ungültige Beispiele mit Fehlermeldung | Vitest |
| Platzierung | Ports doppelt, RAM knapp, Architektur, Server für sich, Abhängigkeit fehlt | Vitest, fast-check |
| Quadlets | gerenderte Units als Golden Files je App und Option; jede besteht `podman-system-generator --dryrun` | Vitest, CI |
| Planung | Wellen, Sperrzeiten über Monatswechsel, Wartungsfenster, Zeitumstellung | Vitest |
| Protokoll | jede Nachricht hin und zurück; alte Agent-Version gegen neue Zentrale | Vitest |
| Agent | installieren, aktualisieren, Rückkehr, Backup, Restore, entfernen mit der Beispiel-App | Vitest mit Podman in der CI |
| Mandanten | kein Endpunkt liefert Daten eines anderen Betreibers oder Partners | Vitest mit SQLite |
| Abläufe | Server hinzufügen, App installieren, Update, Support-Zugang | Playwright, Zentrale und Agent im Container |
| Barrierefreiheit | jede Seite | axe, `pages`-Check |

## Dokumentation

Zensical in `docs/`, nur Deutsch: Überblick, Installation der Zentrale, Server hinzufügen, Apps
installieren, Updates, Backups, Support, Manifest (für App-Entwickler), API (für das Portal),
Sicherheit.

## Offene Fragen

- Single Sign-on je Kunde: wird Kontext (Stalwart) der Anbieter für alle Apps eines Kunden, oder ein
  eigener Anbieter je Kunde (z. B. Kanidm), wenn er kein Kontext hat?
- Backup-Ziel: ein S3-Anbieter für alle oder je Kunde wählbar?
- Name und Domain der Steuerzentrale (Arbeitstitel).
