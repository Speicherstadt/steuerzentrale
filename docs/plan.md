---
title: Projektplan
description: >-
  Der Plan für die Steuerzentrale: Ziel, Aufbau aus Zentrale und Agent, die Apps der Speicherstadt
  und ihr Manifest, Entscheidungen, Technologie, Datenmodell, Sicherheit, Bauplan im Agenten-Loop
  und Tests.
---

# Projektplan

Die Steuerzentrale installiert, aktualisiert, sichert und überwacht die Apps der Speicherstadt auf
Servern: auf gemeinsamen Servern, auf einem eigenen Server je Kunde oder auf einem Server beim
Kunden. Sie ist das Werkzeug für Hosting, Wartung und Support, Open Source unter der AGPL. Was
gebaut wird und in welcher Reihenfolge, steht in der
[Bauliste](https://github.com/Speicherstadt/steuerzentrale/blob/main/BAULISTE.md).

## Ziel

- **Ein Ort für alle Server und Installationen**: welcher Kunde welche App auf welchem Server hat, in
  welcher Version, ob sie gesund ist und wann das letzte Backup lief.
- **Updates ohne Handarbeit**: neue Versionen in Wellen, mit Backup vorher, Prüfung danach und
  Rückkehr zur alten Version, wenn die Prüfung fehlschlägt; nie in einer Sperrzeit einer App.
- **Server pflegen**: Betriebssystem-Updates, Neustarts im Wartungsfenster, Platte, Zertifikate,
  Backups, offene Ports, Mail-Zustellbarkeit.
- **Support mit Spur**: Zugriff auf eine Installation nur zeitlich begrenzt, mit Grund, protokolliert
  und für den Kunden sichtbar.
- **Keine App ist fest eingebaut**: Jede App beschreibt sich in einem Manifest; die Steuerzentrale
  kennt nur das Manifest.

**Bewusst nicht in der Steuerzentrale**: Buchung, Bezahlung, Rechnungen, Tickets und alles, was der
Kunde selbst sieht (das Portal, ein eigenes Projekt); Server bei Anbietern bestellen (später, über
deren API); Fernwartung von Geräten beim Kunden (Kontext-Box, Stellwerk-Agenten, Desktop-Apps).

## Aufbau

```text
                 Portal (eigenes Repo, öffentlich)
                        │  api.<domain>: Kunden, Buchen, Kündigen, Lesen; Webhooks zurück
                        ▼
  Betrieb ──VPN──▶  Zentrale  ◀── agent.<domain>: WSS, Client-Zertifikat je Server
                        │   └── DNS-API (Cloudflare): A, AAAA, Prüfung der Kundendomains
       ┌────────────────┼────────────────┐
   Server A          Server B          Server C (beim Kunden,
   Agent             Agent             Portweiterleitung 80/443)
   Pforte (Caddy)    Kontext allein    Agent, Pforte
   Haben, Soll, …    (rootful)         Belegt, Kennwort
```

- **Zentrale**: Server mit API und Oberfläche; läuft genau einmal. Drei Hostnamen: die Oberfläche
  nur über VPN, `agent.<domain>` für die Agenten und `api.<domain>` für das Portal öffentlich.
- **Agent**: kleines Programm auf **jedem** verwalteten Server, als systemd-Dienst. Er baut die
  Verbindung selbst auf (kein offener Port für ihn), meldet Heartbeat, Fakten und Zustand und führt
  Aufträge aus. Er führt nur Aktionen aus signierten Manifesten aus; eine freie Shell gibt es nicht.
  Backups laufen als systemd-Timer auf dem Server weiter, auch wenn die Zentrale ausfällt.
- **Pforte**: ein Caddy je Server unter dem Nutzer `sz-pforte`. Er nimmt 80 und 443 an, holt die
  Zertifikate (HTTP-01) und leitet jede Adresse an den lokalen Port ihrer Installation.
- **Ein-Server-Betrieb**: Zentrale und Agent auf derselben Maschine, für Selbsthoster.
- **Portal**: öffentliche Website mit Buchung, Bezahlung und Kundenbereich, ein eigenes Repo. Es
  spricht nur über `api.<domain>` mit der Zentrale und bekommt Ereignisse per Webhook.

### Ablauf: Server hinzufügen

1. In der Zentrale „Server hinzufügen“: Name, Art (gemeinsam, eigen, beim Kunden), Wartungsfenster.
2. Die Zentrale zeigt einen Befehl mit Einmal-Token (24 h):
   `curl -fsSL https://agent.<domain>/install.sh | sudo sh -s -- --token …`
3. Das Skript prüft Debian 13 oder Ubuntu 24.04 (amd64, arm64; Debian 12 hat mit Podman 4.3 noch
   keine Quadlets), cgroup-v2-Delegation und Uhrzeit, installiert Podman, unattended-upgrades und den
   Agenten (Prüfsumme und Signatur), erlaubt rootless Ports ab 80 und hinterlegt den öffentlichen
   Schlüssel für Manifeste. Der Agent tauscht das Token gegen sein Client-Zertifikat.
4. Der Server erscheint mit seinen Fakten: CPU, RAM, Platte, Architektur, IPv4, IPv6, PTR, Ports,
   ausgehender Port 25.

### Ablauf: App installieren

1. Kunde, App, Server, Optionen wählen. Die **Platzierung** (reine Funktion) prüft Manifest, Server
   und vorhandene Installationen und liefert „passt“, Hinweise oder Gründe.
2. Einstellungen nach Ebenen: Betreiber (einmal), Installation (je Kunde), automatisch (Secrets).
3. Die Zentrale vergibt den lokalen Port, rendert die Quadlet-Units und Podman-Secrets, setzt den
   DNS-Eintrag und schickt den Auftrag. Bietet eine andere Installation des Kunden einen
   Anmeldedienst, legt ein vorgeschalteter Auftrag dort den OIDC-Client an.
4. Der Agent legt den Linux-Nutzer `sz-<installation>` an, schreibt Units und Secrets, zieht die
   Images per Digest, führt die Einrichtungsschritte aus, startet und trägt die Adresse in die Pforte
   ein. Fertig ist die Installation, wenn Health innen und die Prüfung von außen grün sind.

### Ablauf: Update

1. Eine neue Version erscheint in der Registry mit signiertem Manifest.
2. Die Zentrale plant Wellen: intern → früh (SLA Plus) → standard (Basis) → spät (Ruhe), jede erst
   nach 24 h ohne Störung, nie in einer Sperrzeit, und kündigt jedem Kunden den Termin 72 h vorher an
   (Webhook an das Portal). Ein als **dringend** markiertes Update (Sicherheitslücke,
   Mindestversion von ERiC) läuft sofort durch alle Wellen; eine Sperrzeit übergeht nur der Inhaber
   mit Grund.
3. Je Installation: Backup, Image ziehen, Schritte nach dem Update, Neustart, Health; bei Rot zurück
   auf die alte Version und das Backup, Welle anhalten, Meldung.

Eine **Störung** ist: Health innen oder außen länger als 5 Minuten rot, oder eine Rückkehr nach einem
Update.

## Die Apps der Speicherstadt

Stand der Repos im November 2026. Das Manifest jeder App liegt zuerst in diesem Repo unter
`manifeste/`, mit der Quelle jeder Angabe in `QUELLEN.md`; später liefert jede App ihr Manifest mit
dem Release.

| App | Container | Arch | RAM | HTTP | Ports | IPv4 | Für sich | Anmeldung | Health | Image |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| haben | app, db | amd64, arm64 | 2048 | ja | – | nein | nein | oidc | keine (Haben#946) | ja |
| belegt | app, worker, db | amd64, arm64 | 2048 | ja | ftp (Option) | nein | nein | oidc | http /healthz | ja |
| kontext | kontext, stalwart, redis, livekit, caddy | amd64, arm64 | 4096 | eigen | 25, 465, 587, 993, 7881, 7882/udp, 5060, 20000-20100/udp | ja | ja | anbieter | http /healthz | ja |
| schreibzeug | app | amd64 | 1024 | ja | – | nein | nein | oidc | http /api/health | ja |
| stellwerk | zentrale | amd64, arm64 | 1024 | ja | 22001 (je Installation) | ja | nein | eigen | keine (nur mit Anmeldung) | ja |
| fixpunkt | app, nodeodm (Option) | amd64, arm64 | 8192 | ja | – | nein | nein | eigen | http /api/health | ja |
| kennwort | app | amd64, arm64 | 512 | ja | – | nein | nein | oidc | http /health | noch nicht |
| soll | app | amd64, arm64 | 512 | ja | – | nein | nein | oidc | http /health | noch nicht |

Besonderes: Haben hat eine Sperrzeit (7. bis 12. jedes Monats, Umsatzsteuer-Voranmeldung, mit
Puffer für Fristen am Wochenende nach § 108 Abs. 3 AO) und eine Hersteller-ID beim Betreiber. Kontext
braucht MX, SPF, DKIM, DMARC und PTR und führt `setup-stalwart` nach jedem Update aus; mit der Option
`documents` enthält es Schreibzeug und läuft dann nur auf amd64. Stellwerk und Fixpunkt brauchen viel
Platte (Grenze je Installation). Fixpunkt nimmt Uploads bis 20 GB, Schreibzeug braucht WebSocket,
Fixpunkt SSE. Geräte beim Kunden (Kontext-Box, Stellwerk-Agenten, Tablet-Terminal von Soll,
Desktop-Apps) verwaltet die Steuerzentrale nicht.

Keine App hat heute Nur-lesen-Modus, Export, Status-Befehl oder einen Einrichtungsbefehl
(Haben#945–#948). Bis dahin steht im Manifest `nicht_unterstuetzt` und die Zentrale bietet die Aktion
nicht an.

## Manifest

Eine YAML-Datei je App und Version, geprüft mit dem Zod-Schema aus `packages/manifest`, als JSON
Schema veröffentlicht und mit dem Signierschlüssel des Betreibers signiert. Beispiel, gekürzt:

```yaml
schema: 1
id: haben
version: 1.9.0
lizenz: AGPL-3.0-only
quelle: https://github.com/Speicherstadt/haben
container:                       # daraus werden Quadlet-Units (Vorbild: deploy/quadlet/)
  - { name: app, image: docker.io/tristanteu/haben@sha256:…, braucht: [db] }
  - { name: db, image: docker.io/tristanteu/haben-db@sha256:… }
architektur: [amd64, arm64]      # je Container übersteuerbar, z. B. Schreibzeug nur amd64
ressourcen: { ram_mb: 2048, platte_gb: 10 }   # Grenzen in den Units (MemoryMax, Quota)
netz:
  http: { dienst: app, port: 3000, websocket: false, sse: false, max_body_mb: 100, timeout_s: 60 }
  ports: []                      # Kontext: [{ port: 25, proto: tcp, fest: true }], Stellwerk: [{ port: 22001, fest: false }]
  oeffentliche_ipv4: false
  mail: false                    # true: PTR, Port 25 ausgehend, Blacklist-Prüfung
  server_fuer_sich: false
proxy: geteilt                   # eigen: App bringt Caddy mit, nur mit server_fuer_sich
rootful: false                   # true nur mit server_fuer_sich
optionen: []                     # schalten Container zu, mit eigener Architektur und RAM
braucht: []                      # Kennwort: [oidc-anbieter]
bietet: []                       # Kontext: [oidc-anbieter, smtp]
anmeldung: oidc                  # oidc | eigen | anbieter
health: { art: keine, hinweis: Haben#946 }    # http | tcp | befehl | keine
befehle: {}                      # benannte Befehle: { name: { container, argv: [...] } }
schritte: { einrichten: [], nach_update: [] } # nur Namen aus befehle
backup:
  - { art: pg_dump, container: db }
  - { art: volume, volume: belege }
aktionen: { nur_lesen: nicht_unterstuetzt, export: nicht_unterstuetzt }
sperrzeiten: [{ monatlich: "07-12", grund: Umsatzsteuer-Voranmeldung }]
dns: []                          # Kontext: MX, SPF, DKIM, DMARC, autoconfig
env:
  - { name: ELSTER_HERSTELLER_ID, ebene: betreiber, pflicht: true }
  - { name: LAYOUTS_MAX_COUNT, ebene: installation, typ: zahl, vorgabe: 20 }
  - { name: BETTER_AUTH_SECRET, ebene: auto, erzeugen: zufall_32 }
  - { name: OIDC_CLIENT_SECRET, ebene: auto, aus: oidc-anbieter }
hinweis: Haben ist Open Source (AGPL), https://haben.app
```

| Ebene | Wer setzt sie | Beispiel |
| --- | --- | --- |
| `betreiber` | der Betreiber, einmal je App | Hersteller-ID für ELSTER, API-Schlüssel für KI |
| `installation` | der Betreiber je Installation, mit Vorgabe | Grenzen, Domain für Mail |
| `auto` | die Zentrale, nie von Hand | Secrets, URL, OIDC-Client vom Anbieter des Kunden |

## Entscheidungen

Der Loop entscheidet danach und trägt neue Entscheidungen hier mit Grund ein.

| Frage | Entscheidung | Warum |
| --- | --- | --- |
| Wo die Zentrale läuft | genau einmal, auf einem eigenen Server (netcup); im Ein-Server-Betrieb neben dem Agenten. Oberfläche nur über WireGuard; `agent.<domain>` und `api.<domain>` öffentlich, nur mit Client-Zertifikat bzw. Token und Rate-Limit | Server beim Kunden haben wechselnde IPs; install.sh muss erreichbar sein; die Oberfläche bleibt privat |
| Wer die Verbindung aufbaut | immer der Agent, ausgehend per WSS mit Client-Zertifikat je Server (mTLS), rotierbar, sofort sperrbar | kein offener Port für den Agenten; ein Zertifikat gilt nur für einen Server |
| Was der Agent ausführt | nur Manifeste mit gültiger Signatur des Betreibers; der öffentliche Schlüssel wird bei der Installation hinterlegt, der private liegt offline beim Inhaber, nie auf der Zentrale. Images nur per Digest; Schritte nur als benannte Befehle mit argv, nie als Shell-Text | eine übernommene Zentrale darf keinen Code auf den Servern ausführen können |
| Aufträge | in der Zentrale gespeichert, idempotent mit ID; der Agent holt, bestätigt, meldet; Aufträge können aufeinander warten, auch über Installationen hinweg | Netze brechen ab; der OIDC-Client entsteht beim Anbieter, bevor die App startet |
| Orchestrierung | Podman-Quadlets unter systemd, rootless: je Installation ein Linux-Nutzer `sz-<installation>` mit Linger, Units in `~/.config/containers/systemd/`; `AutoUpdate` nie gesetzt; kein Docker, kein Compose | Stack-Vorgabe (`tech-stack.md`); Kunden durch Linux-Nutzer getrennt; Updates nur über die Wellen |
| Pforte | Caddy rootless unter `sz-pforte` mit `Network=host`; jede Installation veröffentlicht ihren HTTP-Dienst nur auf `127.0.0.1:<port>`, den Port vergibt die Zentrale; Netzwerk mit pasta, damit die Client-IP ankommt; `net.ipv4.ip_unprivileged_port_start=80` | ein Caddy kann den Netzen anderer Nutzer nicht beitreten; die Apps brauchen die echte IP für Rate-Limits |
| Ressourcen | `ram_mb` und `platte_gb` sind Grenzen in den Units; die Platzierung rechnet mit Überbuchung 1,0 für RAM | ein Kunde darf den gemeinsamen Server nicht füllen |
| Ports | feste Ports (Mail) nur einmal je Server; Ports mit `fest: false` vergibt die Zentrale je Installation | ein zweiter Stellwerk-Kunde passt auf denselben Server |
| Mehrere Kunden auf einem Server | erlaubt („gemeinsam“); eine Installation gehört genau einem Kunden | einfache Trennung, einfaches Löschen |
| Server beim Kunden | mit Portweiterleitung 80/443 (und den Ports der App) auf den Server; kein Cloudflare Tunnel in 1.0 | ein Tunnel von Cloudflare beendet TLS und sieht die Daten (Unterauftragsverarbeiter in den USA); ein eigener Relay kommt später |
| DNS | Cloudflare als DNS-Anbieter, nur DNS, kein Proxy; die Zentrale setzt A und AAAA für `<app>.<kunde>.<domain>` per API; Server bekommen nie einen DNS-Token; eigene Domains des Kunden per CNAME, aktiv erst nach Prüfung; Zertifikate per HTTP-01 an der Pforte | ein übernommener Server darf keine Kunden umleiten können; Let's Encrypt erlaubt 50 neue Zertifikate je Domain und Woche, genug für den Start |
| Mail (Kontext) | die Zentrale zeigt MX, SPF, DKIM, DMARC und PTR aus dem Manifest und prüft sie; setzt sie selbst, wenn die Domain bei uns liegt | sonst landet Mail im Spam |
| Single Sign-on | hat der Kunde Kontext, ist es sein Anmeldedienst: die Zentrale legt dort per Auftrag den OIDC-Client jeder weiteren App an; ohne Kontext nutzt jede App ihre eigene Anmeldung | ein Anbieter je Kunde, kein zusätzlicher Dienst |
| Manifeste | zuerst in `manifeste/` dieses Repos mit Quellen; ein App-Repo kann später ein eigenes liefern; jede Version signiert | der Loop ändert keine anderen Repos |
| Apps ohne Betreiber-Vertrag | ohne Health keine automatischen Updates (nur von Hand, mit Grund); ohne Image nicht installierbar; nicht angebotene Aktionen fehlen in der Oberfläche | der Loop muss mit dem heutigen Stand der Apps bauen können |
| Platzierung | reine Funktion: Manifest, Optionen, Serverfakten, Installationen, Kunde → passt, Hinweise, Gründe | testbar ohne Server; dieselbe für Oberfläche, API und Portal |
| Updates | Wellen nach SLA, 24 h ohne Störung, Ankündigung 72 h vorher, nie in einer Sperrzeit; Backup vorher, Rückkehr bei Rot; dringende Updates sofort | ein Fehler trifft zuerst uns |
| Welle „intern“ | wir betreiben von jeder App eine eigene Installation; fehlt sie, wartet die Welle auf eine Freigabe von Hand | „intern“ ohne Installation wäre kein Test |
| OS-Updates | unattended-upgrades für Sicherheitsupdates; Neustart nur im Wartungsfenster und außerhalb jeder Sperrzeit der Apps auf dem Server | Kernel-Updates brauchen Neustarts, Steuertermine nicht |
| Backups | ein restic-Repository und ein Schlüssel je Installation auf dem S3-Ziel des Betreibers; Zeitplan als systemd-Timer auf dem Server; Aufbewahrung 7 täglich, 4 wöchentlich, 6 monatlich; Prüf-Restore wöchentlich unter einem Wegwerf-Nutzer `sz-restore-*` auf einem Server mit Platz | Löschen eines Kunden heißt, sein Repository zu löschen; Backups laufen auch ohne Zentrale |
| Kündigung und Löschung | Vertragsende → 30 Tage nur lesen (wenn die App es kann) und Export bzw. letztes Backup für den Kunden → Löschung der Installation und ihres Repositorys 90 Tage nach Vertragsende; Löschprotokoll als Ereignis und Webhook | Art. 28 Abs. 3 lit. g DSGVO; GoBD-Daten bewahrt der Kunde selbst auf (§ 147 AO), ein bezahlter Archivbetrieb kann später kommen |
| Daten der Zentrale | Heartbeats und Fakten-Verlauf 30 Tage, Log-Auszüge in Aufträgen 30 Tage, Ereignisse 13 Monate, Audit-Log dauerhaft | Log-Auszüge enthalten personenbezogene Daten der Kunden |
| Geheimnisse | verschlüsselte Spalten mit `STEUERZENTRALE_SECRET_KEY`, mit Schlüssel-ID, rotierbar; Start ohne Schlüssel verweigert; auf dem Server nur als Podman-Secret | nichts im Klartext |
| Anmeldung an der Zentrale | Better Auth; jedes Konto braucht einen zweiten Faktor, Passkey oder TOTP; Rollen Inhaber, Technik, Support | wer die Zentrale hat, hat alle Kunden |
| Partner | ein Partner ist ein eigener Betreiber in derselben Zentrale: eigene Konten, Kunden, Server, S3-Ziel, Werte je App (eigene ELSTER-Hersteller-ID) und Marke | sperrt das Landesamt eine Hersteller-ID, trifft es nur einen Betreiber |
| Mandanten | jede Tabelle mit Daten eines Betreibers trägt `betreiber_id`; ausgenommen sind Manifeste und die Tabellen von Better Auth (Mitgliedschaft über deren Organisationen) | Manifeste gelten für alle |
| Support-Zugang | zeitlich begrenzt (Vorgabe 2 h), mit Grund, im Audit-Log und in den Ereignissen des Kunden | Vertrauen; Art. 28 DSGVO |
| Notzugang | SSH nur mit Schlüssel je Person, nur über WireGuard; der Agent meldet jede Anmeldung aus journald als Ereignis | Störungen brauchen manchmal den Server; das darf nicht am Audit vorbei gehen |
| SLA | Basis, Plus (frühe Welle), Ruhe (späte Welle); die Zentrale misst Verfügbarkeit je Installation und Monat; Reaktionszeiten misst das Ticket-System außerhalb | die Zentrale hat keine Tickets |
| Portal | eigenes Repo; nur über `api.<domain>` (Token mit Rechten) und signierte Webhooks | die Oberfläche der Zentrale bleibt privat |
| Was der Kunde sieht | nichts in der Zentrale; Zustand, Verfügbarkeit, Backups, Support-Zugänge, Wartungstermine und Export zeigt das Portal über lesende Endpunkte | Kunden melden sich nie an der Zentrale an |
| Überwachung von außen | die Zentrale prüft jede öffentliche Adresse (DNS, Zertifikat, Pforte, Health) unabhängig vom Agenten; die Zentrale selbst prüft ein externer Dienst | „Agent grün, außen rot“ muss auffallen |
| Geräte beim Kunden | nicht verwaltet | eigenes Thema |
| Was sich in der CI nicht echt testen lässt | Registry, S3, Mail und DNS-API durch lokale Ersatzdienste (Registry-Container, MinIO, Mailpit, nachgebaute Cloudflare-API); Server durch Podman mit systemd im Runner | die Kriterien bleiben erfüllbar |
| Merge | der Loop merged selbst, wenn CI grün ist und das unabhängige Review keine Befunde mehr hat | er wartet nie auf einen Menschen |
| Beiträge | DCO (Signed-off-by), kein CLA | Open Source ohne Sonderrechte |

## Technologie

Derselbe Stack wie Kennwort und Soll, mit denselben zwei Abweichungen von `tech-stack.md` (Solid 2
statt React, Hono-Server mit SPA statt TanStack Start).

| Teil | Wahl | Begründung |
| --- | --- | --- |
| Monorepo | Bun Workspaces, Biome, TypeScript strict, Vitest, Playwright | wie überall |
| Zentrale | Bun, Hono, Drizzle mit SQLite (WAL), Zod, Better Auth, `bun build --compile` | ein Container ohne Datenbankserver |
| Agent | TypeScript, `bun build --compile` für amd64 und arm64, systemd-Dienst | teilt `packages/protokoll` und `packages/manifest` mit der Zentrale |
| Oberfläche | Solid 2 SPA, Paraglide, Tailwind 4, `packages/ui` von Kennwort, Geist, Zinc | ein Look in der Suite |
| Verbindung | WebSocket über HTTPS mit Client-Zertifikat, Nachrichten als Zod-Schemas mit Version | durch jede Firewall, die HTTPS durchlässt |
| Signaturen | minisign für Manifeste und Agent-Binaries | klein, ohne Infrastruktur |
| Auf dem Server | Podman ab 4.4 mit Quadlets, rootless, pasta; Caddy als Pforte; restic; unattended-upgrades | |
| DNS | Cloudflare-API, nur DNS | schon im Einsatz |
| Doku | Zensical auf GitHub Pages | wie die anderen Apps |

## Projektstruktur

| Pfad | Inhalt |
| --- | --- |
| `packages/manifest` | Schema, Laden, Signatur prüfen, JSON Schema, Platzierung, Quadlets rendern; reine Funktionen |
| `packages/protokoll` | Nachrichten zwischen Zentrale und Agent, Aufträge und ihre Zustände |
| `packages/planung` | Wellen, Sperrzeiten, Wartungsfenster, Prüfungen der Server, Verfügbarkeit; reine Funktionen |
| `packages/ui` | Komponenten nach DESIGN.md, von Kennwort |
| `apps/zentrale` | Hono-API, Drizzle, Better Auth, Agent-Verbindungen, DNS, Prüfung von außen; Routen dünn, Logik in `src/modules` |
| `apps/agent` | Verbindung, Fakten, Aufträge mit Podman, systemd, Caddy und restic |
| `apps/web` | Solid-SPA der Zentrale |
| `manifeste/` | ein Verzeichnis je App: `manifest.yml`, `QUELLEN.md` |
| `install/` | `install.sh` für neue Server |
| `e2e/` | Playwright gegen Zentrale und einen Agenten im Container |

## Datenmodell

Betreiber → Kunde → Vertrag (SLA) → Installation (App, Version, Server, Port, Adresse, Optionen,
Einstellungen) → Server (Art, Wartungsfenster, Fakten, Zertifikat des Agenten). Dazu Manifest (App,
Version, Inhalt, Signatur), Auftrag (Art, Ziel, Zustand, wartet auf, Ergebnis), Ereignis, Backup
(Repository je Installation, Snapshot, Prüf-Restore), Prüfung von außen, Einstellung (Ebene, Wert,
verschlüsselt), DNS-Eintrag, API-Token, Webhook, Audit-Log. Partner sind Betreiber.

## Sicherheit

- Oberfläche nur über WireGuard; `agent.` mit mTLS, `api.` mit Token; Rate-Limits an Anmeldung,
  Token-Tausch und API.
- Jedes Konto mit Passkey oder TOTP; jede schreibende Aktion im Audit-Log mit Grund.
- Manifeste und Agent-Binaries signiert, Images per Digest; der Signierschlüssel liegt offline beim
  Inhaber. Eine übernommene Zentrale kann Server anhalten, aber keinen fremden Code ausführen.
- Ein gestohlenes Agent-Zertifikat fälscht höchstens Meldungen dieses Servers.
- Server bekommen keinen DNS-Token und keinen S3-Schlüssel eines anderen Kunden.
- Notzugang per SSH nur über WireGuard, jede Anmeldung als Ereignis.
- `docs/sicherheit.md` führt Bedrohungen und die technischen und organisatorischen Maßnahmen nach
  Art. 32 DSGVO als Anlage zum Auftragsverarbeitungsvertrag.

## Bauplan im Agenten-Loop

Ein Agent arbeitet die Bauliste Punkt für Punkt ab, bis jedes Häkchen gesetzt und jede Prüfung grün
ist. Er wartet nie auf einen Menschen.

1. **Spezifikation zuerst**: das Manifest-Schema und die Kriterien je Punkt. Ohne Kriterium kein Code.
2. **Ein Durchlauf, ein Punkt**: reservieren (Draft-Pull-Request), Tests zuerst, umsetzen, Doku
   nachziehen, `bun run check` grün, unabhängiges Review (`tdd-review`), CI grün, selbst mergen,
   abhaken.
3. **Entscheiden statt fragen**: offene Fragen nach „Entscheidungen“; neue mit Grund dort eintragen.
4. **Nicht hängen bleiben**: dreimal gescheitert heißt zurückgestellt.
5. **Echt testen**: der Agent läuft in der CI gegen Podman mit systemd, mit einer Beispiel-App aus
   diesem Repo; eine echte App (Schreibzeug) in der Härtung.

Reihenfolge: 1 Fundament · 2 Manifest und Platzierung · 3 Agent · 4 Installationen · 5 Updates ·
6 Backups, Umzug und Kündigung · 7 Server-Pflege und Überwachung · 8 Kunden, Support, Betreiber ·
9 API für das Portal · 10 Härtung und Release.

## Tests

| Art | Was geprüft wird | Werkzeug |
| --- | --- | --- |
| Manifest | jedes Manifest gültig und signiert; ungültige und unsignierte Beispiele mit Meldung | Vitest |
| Platzierung | Architektur je Container, RAM, Platte, Ports, IPv4, Mail, Server für sich, rootful, Proxy, Kunde, Betreiber, Abhängigkeiten | Vitest, fast-check |
| Quadlets | gerenderte Units als Golden Files je App und Option, `podman-system-generator --dryrun` | Vitest, CI |
| Planung | Wellen, Sperrzeiten über Monatswechsel, Wartungsfenster, Zeitumstellung, Verfügbarkeit | Vitest |
| Protokoll | jede Nachricht hin und zurück; Agent `n-1` gegen neue Zentrale | Vitest |
| Agent | installieren, aktualisieren, Rückkehr, Backup, Restore, Umzug, entfernen mit der Beispiel-App; unsigniertes Manifest abgelehnt | Vitest mit Podman in der CI |
| Mandanten | kein Endpunkt liefert Daten eines anderen Betreibers | Vitest mit SQLite |
| Abläufe | Server hinzufügen, App installieren, Update, Support-Zugang, Kündigung | Playwright |
| Barrierefreiheit | jede Seite | axe, `pages`-Check |

## Dokumentation

Zensical in `docs/`, nur Deutsch: Überblick, Installation der Zentrale, Server hinzufügen, Apps
installieren, DNS und Mail, Updates, Backups und Restore, Support, Manifest (für App-Entwickler), API
(für das Portal), Sicherheit mit TOMs.

## Offene Fragen

- Name und Domain der Steuerzentrale (Arbeitstitel); davon hängen `agent.<domain>` und
  `api.<domain>` ab.
- Bezahlter Archivbetrieb für gekündigte Kunden mit GoBD-Daten: ja oder nein, zu welchem Preis?
- Ein Kontext für mehrere Kunden (Stalwart kann mehrere Domains): spart Server, bricht aber „eine
  Installation, ein Kunde“; Entscheidung nach den ersten Kunden.
