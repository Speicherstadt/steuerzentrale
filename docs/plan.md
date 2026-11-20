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
3. Das Skript prüft Debian 13 oder Ubuntu 24.04 (amd64, arm64; Podman ab 4.9), cgroup-v2-Delegation und Uhrzeit, installiert Podman, unattended-upgrades und den
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
2. Die Zentrale plant Wellen: in Stufe 1 „intern“ und „alle“, ab Stufe 2 intern → früh (SLA Plus) →
   standard (Basis) → spät (Ruhe); jede erst nach 24 h ohne Störung, nie in einer Sperrzeit; ab
   Stufe 2 bekommt jeder Kunde den Termin 72 h vorher (Webhook an das Portal). Ein als **dringend** markiertes Update (Sicherheitslücke,
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
| haben | app, db | amd64, arm64 | 2048 | ja | – | nein | nein | oidc | http /api/health | ja |
| belegt | app, worker, db, ftp (Option) | amd64, arm64 | 2048 | ja | ftp (Option) | nein | nein | oidc | http /healthz | noch nicht |
| kontext | kontext, stalwart, redis, livekit, livekit-sip, caddy, schreibzeug (Option) | amd64, arm64 | 4096 | eigen | 25, 465, 587, 993, 7881, 7882/udp, 5060, 20000-20100/udp, 80, 443, 443/udp | ja | ja | anbieter | http /healthz | ja |
| schreibzeug | app | amd64 | 1024 | ja | – | nein | nein | oidc | http /api/health | ja |
| stellwerk | zentrale | amd64, arm64 | 1024 | ja | 22001 (je Installation) | ja | nein | eigen | keine (nur mit Anmeldung) | ja |
| fixpunkt | app, nodeodm (Option) | amd64, arm64 | 8192 | ja | – | nein | nein | eigen | http /api/health | noch nicht |
| kennwort | app | amd64, arm64 | 512 | ja | – | nein | nein | eigen | http /health | noch nicht |
| soll | app | amd64, arm64 | 512 | ja | – | nein | nein | eigen | http /health | noch nicht |

Besonderes: Haben hat eine Sperrzeit (7. bis 12. jedes Monats, Umsatzsteuer-Voranmeldung, mit
Puffer für Fristen am Wochenende nach § 108 Abs. 3 AO) und eine Hersteller-ID beim Betreiber. Kontext
braucht MX, SPF, DKIM, DMARC und PTR und führt `setup-stalwart` nach jedem Update aus; mit der Option
`documents` enthält es Schreibzeug und läuft dann nur auf amd64. Stellwerk und Fixpunkt brauchen viel
Platte (Grenze je Installation). Fixpunkt nimmt Uploads bis 20 GB, Schreibzeug braucht WebSocket,
Fixpunkt SSE. Geräte beim Kunden (Kontext-Box, Stellwerk-Agenten, Tablet-Terminal von Soll,
Desktop-Apps) verwaltet die Steuerzentrale nicht.

Keine App hat heute Nur-lesen-Modus oder Export (Haben#945–#948), und nur Kontext hat einen
Einrichtungsbefehl ohne Rückfrage (`setup-stalwart` mit `STALWART_ADMIN`). Bis dahin steht im Manifest
`nicht_unterstuetzt` und die Zentrale bietet die Aktion nicht an. Die Tabelle wird gegen die Manifeste
geprüft (`scripts/manifeste.test.ts`); „noch nicht“ heißt: für die Version des Manifests gibt es kein
veröffentlichtes Image.

## Manifest

Eine YAML-Datei je App und Version (`manifeste/<app>/<version>/manifest.yml`), geprüft mit dem Zod-Schema aus `packages/manifest`, als JSON
Schema veröffentlicht und mit dem Signierschlüssel des Betreibers signiert. Beispiel, gekürzt:

```yaml
schema: 1
id: haben
version: 1.9.0
lizenz: AGPL-3.0-only
quelle: https://github.com/Speicherstadt/haben
container:                       # daraus werden Quadlet-Units (Vorbild: deploy/quadlet/)
  - { name: app, image: docker.io/tristanteu/haben@sha256:…, braucht: [db], env: [ELSTER_HERSTELLER_ID],
      volumes: [{ name: belege, pfad: /app/belege }] }
  - { name: db, image: docker.io/tristanteu/haben-db@sha256:…, volumes: [{ name: daten, pfad: /var/lib/postgresql/data }] }
architektur: [amd64, arm64]      # je Container übersteuerbar, z. B. Schreibzeug nur amd64
ressourcen: { ram_mb: 2048, platte_gb: 10 }   # RAM als Grenze (MemoryMax), Platte als Planwert
netz:
  http: { dienst: app, port: 3000, websocket: false, sse: false, max_body_mb: 100, timeout_s: 60 }
  ports: []                      # Kontext: [{ dienst: stalwart, port: 25, fest: true }], Stellwerk: [{ dienst: zentrale, port: 22001, fest: false }]
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
  - { art: pg_dump, container: db, datenbank: haben, nutzer: haben }
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
| Protokoll und Versionen | jede Nachricht trägt `typ` und die Protokollversion ihres Absenders; Versionen fügen nur hinzu; die Zentrale liest die eigene und die vorige Version und wertet eine ältere Nachricht schrittweise auf (`AUFWERTUNGEN`); der Agent liest nur die Version seiner Zentrale; je Version liegt ein eingefrorenes Beispiel jeder Nachricht im Code, das spätere Versionen weiter lesen müssen; eine Nachricht hat höchstens 4 MiB (`MAX_NACHRICHT_BYTES`), größere werden weder gesendet noch gelesen | ein Agent ist nach einem Update der Zentrale bis zu seinem eigenen Update eine Version zurück (Z-504); ohne Grenze könnte ein Feld (Logzeile, Fehlertext, Daten) Speicher und Datenbank der Gegenseite füllen |
| Aufträge | in der Zentrale gespeichert, idempotent mit ID; der Agent holt, bestätigt, meldet; Aufträge können aufeinander warten, auch über Installationen hinweg | Netze brechen ab; der OIDC-Client entsteht beim Anbieter, bevor die App startet |
| Orchestrierung | Podman-Quadlets unter systemd, rootless: je Installation ein Linux-Nutzer `sz-<installation>` mit Linger, Units in `~/.config/containers/systemd/`; `AutoUpdate` nie gesetzt; kein Docker, kein Compose | Stack-Vorgabe (`tech-stack.md`); Kunden durch Linux-Nutzer getrennt; Updates nur über die Wellen |
| Pforte | Caddy rootless unter `sz-pforte` mit `Network=host`; jede Installation hat ein eigenes `.network` und veröffentlicht ihren HTTP-Dienst nur per `PublishPort=127.0.0.1:<port>:…`, den Port vergibt die Zentrale; die Client-IP kommt im Header `X-Forwarded-For` der Pforte an; `net.ipv4.ip_unprivileged_port_start=80` | ein Caddy kann den Netzen anderer Nutzer nicht beitreten; App und Datenbank teilen das Netz ihrer Installation |
| Ressourcen | `ram_mb` ist eine Grenze (`MemoryMax`) und die Platzierung rechnet mit Überbuchung 1,0; `platte_gb` ist in Stufe 1 nur Planwert, Z-702 misst die Belegung und warnt | rootless Volumes auf ext4 kennen keine Größenquote; ein Kunde darf den RAM nicht füllen |
| Ports | feste Ports (Mail) nur einmal je Server; Ports mit `fest: false` vergibt die Zentrale je Installation | ein zweiter Stellwerk-Kunde passt auf denselben Server |
| Mehrere Kunden auf einem Server | erlaubt („gemeinsam“); eine Installation gehört genau einem Kunden | einfache Trennung, einfaches Löschen |
| Server beim Kunden | mit Portweiterleitung 80/443 (und den Ports der App) auf den Server; kein Cloudflare Tunnel in 1.0 | ein Tunnel von Cloudflare beendet TLS und sieht die Daten (Unterauftragsverarbeiter in den USA); ein eigener Relay kommt später |
| DNS | Cloudflare als DNS-Anbieter, nur DNS, kein Proxy; die Zentrale setzt A und AAAA für `<app>.<kunde>.<domain>` per API; Server bekommen nie einen DNS-Token; eigene Domains des Kunden per CNAME, aktiv erst nach Prüfung; Zertifikate per HTTP-01 an der Pforte | ein übernommener Server darf keine Kunden umleiten können; Let's Encrypt erlaubt 50 neue Zertifikate je Domain und Woche, genug für den Start |
| Mail (Kontext) | die Zentrale zeigt MX, SPF, DKIM, DMARC und PTR aus dem Manifest und prüft sie; setzt sie selbst, wenn die Domain bei uns liegt | sonst landet Mail im Spam |
| Single Sign-on | hat der Kunde Kontext, ist es sein Anmeldedienst: die Zentrale legt dort per Auftrag den OIDC-Client jeder weiteren App an; ohne Kontext nutzt jede App ihre eigene Anmeldung | ein Anbieter je Kunde, kein zusätzlicher Dienst |
| Manifest-Schema | Feldnamen deutsch wie im Plan; unbekannte Felder sind ein Fehler; Verweise (Container, Befehle, Volumes, Einstellungen) prüft eine eigene Regelstufe nach dem Zod-Schema; ein Befehl darf keine Shell starten (`sh`, `bash`, `env`, …); `pg_dump` nennt `datenbank` und `nutzer`; die Signatur wird über die exakten Bytes vor dem YAML geprüft, beide minisign-Formate (`ED`, `Ed`) | ein Tippfehler darf nicht still übergangen werden; benannte Befehle wären sonst ein Umweg zur Shell |
| Manifeste | Ablage `manifeste/<app>/<version>/manifest.yml` mit `manifest.yml.minisig`, signiert vom Inhaber; die Zentrale bekommt ein Manifest per Import (Upload oder Befehl) und zeigt eine neue Version in der Registry als „Manifest fehlt“, bis es da ist; Digests kommen aus der Registry über `scripts/digest.ts` (Quelle: Registry, Tag, abgefragt am); ein App-Repo kann später ein eigenes Manifest liefern | der Schlüssel liegt offline, also kann die Zentrale nicht selbst signieren; die App-Repos nennen nur Tags |
| Images der Manifeste | ein App-Image von GHCR, wo die App dorthin veröffentlicht und es öffentlich abrufbar ist, sonst von Docker Hub; fremde Images (Postgres, Stalwart, LiveKit, Redis, Caddy, NodeODM) mit dem Tag aus den Quadlets oder der Compose-Datei der App; gibt es für die Version des Manifests kein Image (Belegt, Fixpunkt, Kennwort, Soll im November 2026), steht dort `noch_nicht_veroeffentlicht` mit dem Ergebnis der Abfrage, nie ein geratener Digest | Speicherstadt veröffentlicht unter `ghcr.io/speicherstadt`; ein Digest ohne Abfrage wäre nicht belegt |
| Was aus den Container-Dateien der Apps entfällt | der eigene Caddy (die Pforte ersetzt ihn; nur Kontext behält seinen, `proxy: eigen`), Backup- und Restore-Container und ihre Timer (die Steuerzentrale sichert selbst mit restic), Profile, die der Plan nicht nennt, und Geräte beim Kunden | sonst liefen zwei Proxys und zwei Sicherungen nebeneinander |
| Planwerte der Manifeste | `platte_gb` ist ein Planwert der Steuerzentrale, kein Wert der App: Haben 10, Belegt 20, Kontext 50, Schreibzeug 10, Stellwerk 100, Fixpunkt 200, Kennwort 1, Soll 1; `ram_mb` aus der Tabelle oben; `timeout_s` bleibt bei der Vorgabe, nur Belegt bekommt 3600 s für Exporte aus Paperless-ngx in einer Anfrage | keine App nennt ihren Plattenbedarf; Z-702 misst die Belegung und zeigt, wo ein Wert falsch ist |
| Namen im Netz der Installation | jeder Container ist im Netz seiner Installation unter seinem Namen aus dem Manifest erreichbar (Netzwerk-Alias, Z-205); Vorlagen und Konfigurationsdateien nennen ihn so (`db:5432`, `kontext:3000`) | so bleiben Caddyfile und `livekit.yaml` von Kontext unverändert, und keine Vorlage braucht den Namen der Installation |
| Quadlets rendern | eine reine Funktion (`quadletsRendern`, Z-205) rendert aus Manifest, Installation und Einstellungen Units, Podman-Secrets, `dateien` und die Route der Pforte; sie erzeugt nichts, ein fehlender erzeugter Wert oder Pflichtwert und ein Container ohne Image lehnen ab; jeder Name beginnt mit dem Namen der Installation; die RAM-Grenze ist `MemoryMax` einer Slice `<installation>.slice` des Nutzers, in der alle Container laufen; nicht geheime Werte stehen als `Environment=` in der Unit, geheime nur als Podman-Secret; `dateien` liegen unter `~/.config/steuerzentrale/dateien/` und werden mit `:ro` eingehängt; jeder Container läuft mit `NoNewPrivileges=true`, weitere Härtung (`ReadOnly`, `DropCapability`) erst mit einem Feld im Manifest; `argv` wird `Exec=` (ersetzt das `CMD`, der `ENTRYPOINT` bleibt), jedes Wort in Anführungszeichen mit verdoppeltem `%` und `$`, ein leeres Wort oder ein Steuerzeichen ist abgelehnt | `ressourcen.ram_mb` gilt für die ganze Installation, nicht je Container; Podman 4.9 kennt keinen Schlüssel für eine Grenze über mehrere Container; eine Datenbank braucht Capabilities und ein beschreibbares Dateisystem, das ein Manifest heute nicht beschreibt; Quadlet verliert ein leeres Wort in `ExecStart=`, und systemd ersetzt `%` und `$` dort |
| Vorlagen und erzeugte Werte | eine `vorlage` und ein DNS-Eintrag kennen `${adresse}`, `${host}`, `${ipv4}`, `${port:<dienst>:<port>}` (der vergebene Port) und `${env:<NAME>}` (eine Einstellung, die selbst keine Vorlage ist); andere geschweifte Klammern sind Text; `zufall_32` und `zufall_64` sind Zufallsbytes in Base64 (Standardalphabet), `zufall_hex_32` sind 32 Zufallsbytes als Hex für Werte in einer URL; eine Einstellung mit `option` gilt nur, solange die Option an ist; `dateien` sind Konfigurationsdateien mit festem Inhalt, nur lesbar eingehängt | Haben, Belegt und Soll verlangen 32 Byte Base64, ein Passwort in `DATABASE_URL` darf kein `+`, `/` oder `=` enthalten; Kontext braucht Caddyfile und `livekit.yaml`; Kontexts Dokumente und Fixpunkts NodeODM brauchen Werte nur mit ihrer Option |
| Apps ohne Betreiber-Vertrag | ohne Health keine automatischen Updates (nur von Hand, mit Grund); ohne Image nicht installierbar; nicht angebotene Aktionen fehlen in der Oberfläche | der Loop muss mit dem heutigen Stand der Apps bauen können |
| Platzierung | reine Funktion: Manifest, Optionen, Serverfakten, Installationen, Kunde → passt, Hinweise, Gründe | testbar ohne Server; dieselbe für Oberfläche, API und Portal |
| Updates | Wellen nach SLA, 24 h ohne Störung, Ankündigung 72 h vorher, nie in einer Sperrzeit; Backup vorher, Rückkehr bei Rot; dringende Updates sofort | ein Fehler trifft zuerst uns |
| Wartungsfenster und Zeitumstellung | ein Wartungsfenster ist Wochentage plus Uhrzeit von–bis in `Europe/Berlin`, über Mitternacht, wenn das Ende vor dem Beginn liegt; eine nicht existierende Ortszeit rückt um die Länge der Lücke vor (wie Temporal „compatible“), eine doppelte gilt beim ersten Mal; geprüft wird der Beginn eines Updates; ein dringendes Update wartet auf kein Wartungsfenster, aber auf das Ende einer Sperrzeit ohne Freigabe; eine Sperrzeit kann über den Monatswechsel reichen (`28-03`); eine Störung hält auch ein dringendes Update an | dringend heißt sofort; eine Sperrzeit schützt Fristen; ein zurückgenommenes Update ist kaputt, egal wie dringend |
| Welle „intern“ | wir betreiben von jeder App eine eigene Installation; fehlt sie, wartet die Welle auf eine Freigabe von Hand | „intern“ ohne Installation wäre kein Test |
| OS-Updates | unattended-upgrades für Sicherheitsupdates; Neustart nur im Wartungsfenster und außerhalb jeder Sperrzeit der Apps auf dem Server | Kernel-Updates brauchen Neustarts, Steuertermine nicht |
| Backups | ein restic-Repository mit eigenem Passwort je Installation auf dem S3-Ziel des Betreibers, mit einem S3-Zugang, der nur das Präfix dieser Installation erreicht; Zeitplan als systemd-Timer auf dem Server; Aufbewahrung 7 täglich, 4 wöchentlich, 6 monatlich; Prüf-Restore wöchentlich unter einem Wegwerf-Nutzer `sz-restore-*` auf einem Server mit Platz; Wiederherstellen je Backup-Art legt die Zentrale fest (bei `pg_dump`: App stoppen, `pg_restore --clean --if-exists`) | ein Server darf keine fremden Backups lesen oder löschen; Löschen eines Kunden heißt, seine Repositorys und Zugänge zu löschen |
| Kündigung und Löschung | Vertragsende → 30 Tage nur lesen (wenn die App es kann) und Export bzw. letztes Backup für den Kunden → Löschung der Installation und ihres Repositorys 90 Tage nach Vertragsende; Löschprotokoll als Ereignis und Webhook | Art. 28 Abs. 3 lit. g DSGVO; GoBD-Daten bewahrt der Kunde selbst auf (§ 147 AO), ein bezahlter Archivbetrieb kann später kommen |
| Daten der Zentrale | Heartbeats und Fakten-Verlauf 30 Tage, Log-Auszüge in Aufträgen 30 Tage, Ereignisse 13 Monate, Audit-Log dauerhaft | Log-Auszüge enthalten personenbezogene Daten der Kunden |
| Audit-Log | jede Schreibaktion läuft über eine Funktion (`schreiben`), die in derselben Transaktion je Änderung einen Eintrag (Akteur, Zeitpunkt, Aktion, Ziel, Grund, Inhalt) anfügt; Trigger verbieten Ändern und Löschen im Audit-Log; die Module lesen über eine Verbindung mit `query_only`; der tägliche Aufbewahrungslauf schreibt je Betreiber und Tabelle einen Eintrag mit der Zahl der gelöschten Zeilen statt einen je Zeile; die Buchführung der Migrationen liegt außerhalb | ein Eintrag je gelöschtem Heartbeat wäre Rauschen, ein Lauf ohne Spur wäre am Audit vorbei |
| Geheimnisse | verschlüsselte Spalten mit `STEUERZENTRALE_SECRET_KEY` (AES-256-GCM), mit Schlüssel-ID (die ersten 8 Hex-Stellen des SHA-256 des Schlüssels) an jedem Wert, rotierbar mit `steuerzentrale schluessel-rotieren` und dem alten Schlüssel in `STEUERZENTRALE_SECRET_KEY_ALT`; Tabelle, Betreiber und Zeile sind Zusatzdaten der Verschlüsselung; das Audit-Log vermerkt einen verschlüsselten Wert nur als geändert, ohne Chiffrat, und nach dem Rotieren wird das Write-Ahead-Log geleert, damit kein Wert mit dem alten Schlüssel in der Datei bleibt; ein Prüfwert in der Datenbank verweigert den Start mit falschem Schlüssel; Start ohne Schlüssel verweigert; Tokens nur als SHA-256 (32 Zufallsbytes brauchen keinen langsamen Hash); auf dem Server nur als Podman-Secret | nichts im Klartext; ein kopierter Wert lässt sich in keiner anderen Zeile entschlüsseln; ein falscher Schlüssel fällt vor dem ersten Schreiben auf |
| Anmeldung an der Zentrale | Better Auth mit Organization-Plugin (ein Betreiber je Organisation), `passkey` und `twoFactor`: ein Passkey genügt, ein Passwort nur zusammen mit TOTP; ohne zweiten Faktor nur `/einrichtung`; Rollen Inhaber, Technik, Support über die Zugriffssteuerung des Plugins; der erste Inhaber kommt über einen Einrichtungscode, der einmal ins Log geschrieben wird, einmal nutzbar und 24 h gültig (die einzige Ausnahme von „kein Geheimnis im Log“) | wer die Zentrale hat, hat alle Kunden; ohne ersten Inhaber kommt niemand hinein |
| Betreiber und Organisation | `betreiber_id` ist die ID der Organisation des Betreibers in Better Auth, keine eigene Spalte; der Einrichtungscode reserviert diese ID schon beim Start, so tragen Code und Audit-Einträge eine `betreiber_id`, bevor es den Betreiber gibt; Konto, Organisation und Mitgliedschaft legt ein Endpunkt von Better Auth an, der nur im Server aufrufbar ist (Registrieren ist aus) | eine ID für beides spart eine Abbildung, die auseinanderlaufen könnte; ohne Betreiber gäbe es sonst keine `betreiber_id` für den Code |
| Mitgliedschaften im Audit-Log | Better Auth schreibt seine Tabellen selbst; jede Mitgliedschaft und Rolle spiegelt die Zentrale über `schreiben` in `mitglieder`, und die Routen lesen die Rolle von dort; die Routen der Organisationen von Better Auth sind geschlossen, Rollen ändert nur die Zentrale | so steht jede Rechteänderung im Audit-Log, und ein entferntes Mitglied verliert den Zugang sofort (wie Soll) |
| Zweiter Faktor | ein Konto hat ihn mit Passkey und ohne Passwort oder mit Passwort und bestätigtem TOTP; ein Passkey neben einem Passwort ohne TOTP genügt nicht, und mit Passwort wird ein Passkey erst nach TOTP angelegt; bestätigtes TOTP beendet die anderen Sitzungen des Kontos, die nur mit dem Passwort angemeldet waren; ohne ihn nur `GET /api/v1/einrichtung` und die Pfade von Better Auth zum Einrichten; „Gerät merken“ (`trustDevice`) wird abgelehnt; Sitzungen 12 h, verlängert bei Nutzung | Better Auth meldet mit dem Passwort allein an, wenn TOTP fehlt; ein gemerktes Gerät überspränge TOTP 30 Tage |
| Routen und Rollen | jede Route steht mit ihrem Recht in einer Liste (`routes/zugang.ts`) und wird nur über sie angelegt; ein Test fragt jede Route in jeder Rolle ab und vergleicht die Liste mit den Routen der App; von Better Auth sind nur die Pfade einer zweiten Liste erreichbar | eine Route ohne Prüfung kann so nicht entstehen |
| Einladungen | eigene Tabelle mit Rolle und Ablauf (7 Tage), der Token nur als SHA-256 in `tokens`; der Token steht hinter dem `#` des Links und geht im Körper an die API, nie in einen Pfad; Better Auths Einladungen per E-Mail werden nicht genutzt | ein Pfad stünde im Request-Log; die Zentrale verschickt keine Mails |
| Geheimnis von Better Auth | 32 Zufallsbytes beim ersten Start, mit `STEUERZENTRALE_SECRET_KEY` verschlüsselt in der Datenbank (wie der Prüfwert außerhalb des Audit-Logs) und beim Rotieren mit neu verschlüsselt; nicht aus dem Schlüssel abgeleitet | abgeleitet würde ein Rotieren alle Sitzungen beenden und die TOTP-Schlüssel unlesbar machen, sobald der alte Schlüssel weg ist; eine eigene Variable wäre ein Geheimnis mehr zum Verwalten |
| Rate-Limit der Anmeldung | das von Better Auth, im Speicher: Passwort und TOTP-Code je 5, Passkey 10 je Minute und Adresse; die Adresse ist die des Sockets, hinter der Pforte (nur von `127.0.0.1`) der letzte Eintrag in `X-Forwarded-For`; ein Header des Browsers zählt nie | ein Angreifer darf weder seinem Zähler entkommen noch andere aussperren (wie Kennwort); ein Neustart setzt die Zähler zurück, das ist für eine Oberfläche nur über WireGuard genug |
| Adresse der Oberfläche | `STEUERZENTRALE_URL` ist Pflicht, ohne Vorgabe (nur Origin) | Better Auth prüft den Origin daran, und Passkeys sind an die Domain gebunden; eine falsche Vorgabe fiele erst bei der Anmeldung auf |
| Partner | ein Partner ist ein eigener Betreiber in derselben Zentrale: eigene Konten, Kunden, Server, S3-Ziel, Werte je App (eigene ELSTER-Hersteller-ID) und Marke | sperrt das Landesamt eine Hersteller-ID, trifft es nur einen Betreiber |
| Mandanten | jede Tabelle mit Daten eines Betreibers trägt `betreiber_id`; ausgenommen sind Manifeste und die Tabellen von Better Auth (Mitgliedschaft über deren Organisationen) | Manifeste gelten für alle |
| Support-Zugang | zeitlich begrenzt (Vorgabe 2 h), mit Grund, im Audit-Log und in den Ereignissen des Kunden | Vertrauen; Art. 28 DSGVO |
| Notzugang | SSH nur mit Schlüssel je Person, nur über WireGuard; der Agent meldet jede Anmeldung aus journald als Ereignis | Störungen brauchen manchmal den Server; das darf nicht am Audit vorbei gehen |
| SLA | Basis, Plus (frühe Welle), Ruhe (späte Welle); die Zentrale misst Verfügbarkeit je Installation und Monat; Reaktionszeiten misst das Ticket-System außerhalb | die Zentrale hat keine Tickets |
| Portal | eigenes Repo; nur über `api.<domain>` (Token mit Rechten) und signierte Webhooks | die Oberfläche der Zentrale bleibt privat |
| Was der Kunde sieht | nichts in der Zentrale; Zustand, Verfügbarkeit, Backups, Support-Zugänge, Wartungstermine und Export zeigt das Portal über lesende Endpunkte | Kunden melden sich nie an der Zentrale an |
| Überwachung von außen | die Zentrale prüft jede öffentliche Adresse (DNS, Zertifikat, Pforte, Health) unabhängig vom Agenten; die Zentrale selbst prüft ein externer Dienst | „Agent grün, außen rot“ muss auffallen |
| Geräte beim Kunden | nicht verwaltet | eigenes Thema |
| Was sich in der CI nicht echt testen lässt | Registry, S3, Mail und DNS-API durch lokale Ersatzdienste (Registry-Container, MinIO, Mailpit, nachgebaute Cloudflare-API); verwaltete Server sind Incus-VMs auf dem Runner (KVM ist auf den Linux-Runnern verfügbar), in denen `install.sh`, systemd, rootless Podman und Neustarts echt laufen; `sudo` ist in den Workflows erlaubt | rootless Podman mit systemd in einem Docker-Container läuft nicht verlässlich |
| Stufen | Stufe 1 betreibt Haben, Belegt, Schreibzeug und Fixpunkt für einen Betreiber; Kontext, Stellwerk, Kennwort, Soll, Partner, Portal-API, SLA-Wellen, Umzug und Ausfall folgen in Stufe 2, die ein Mensch freigibt | null gehostete Kunden heute; die ersten zehn brauchen keinen Partner und kein Portal, und Mail-Hosting ist ein eigenes Geschäft |
| Merge | der Loop merged selbst, wenn CI grün ist und das unabhängige Review keine Befunde mehr hat | er wartet nie auf einen Menschen |
| TLS und Zertifikate | die Zentrale läuft hinter der Pforte ihres Servers; Caddy beendet TLS für Oberfläche, `agent.` und `api.` und prüft auf `agent.` die Client-Zertifikate (`client_auth require_and_verify`) gegen die CA der Zentrale; den Fingerabdruck gibt Caddy per Header an `127.0.0.1`, und die Zentrale glaubt ihn nur von dort; Zertifikate stellt die Zentrale mit `@peculiar/x509` aus | Bun stellt keine X.509-Zertifikate aus; im Ein-Server-Betrieb hält die Pforte 443 |
| Signaturen in Tests | ein Test-Schlüsselpaar liegt unter `test/schluessel/`, als öffentlich bekannt markiert; die CI signiert damit die Manifeste der Beispiel-App zur Testzeit und Release-Kandidaten; ein Build für ein Release und der Agent außerhalb von Tests lehnen den Test-Schlüssel ab | der echte Schlüssel liegt offline beim Inhaber |
| Podman | ab 4.9 (Ubuntu 24.04; Debian 13 hat 5.x); Units nutzen nur Schlüssel, die 4.9 kennt | der GitHub-Runner und Ubuntu 24.04 haben 4.9 |
| Images der Zentrale selbst | Pforte (Caddy) und restic sind keine Apps und haben kein Manifest; ihre Version und ihr Digest stehen in `packages/manifest/src/system.ts`, Renovate hält sie aktuell, ausgerollt mit dem Update des Agenten | sie gehören zur Steuerzentrale |
| Release | der Loop baut nur einen Release-Kandidaten mit dem Test-Schlüssel (Workflow-Artefakt, lokale Registry); Tag, echte Signatur und Push macht ein Mensch; Image `ghcr.io/speicherstadt/steuerzentrale`, Agent-Binaries im GitHub-Release | der Signierschlüssel liegt offline |
| Export bei Kündigung | ein zeitlich begrenzter, vorsignierter S3-Link auf das Archiv des Exports oder letzten Backups; die Oberfläche zeigt ihn dem Betreiber, der ihn weitergibt; ab Stufe 2 übernimmt das Portal | Kunden melden sich nicht an der Zentrale an |
| DCO | Commits des Loops tragen das `Signed-off-by` des Maintainers (Git-Identität der Loop-Sessions), Claude steht als `Co-Authored-By` darunter | das DCO ist die Erklärung einer Person |
| Beiträge | DCO (Signed-off-by), kein CLA | Open Source ohne Sonderrechte |
| Oberfläche vor der API | die Seiten lesen über eine Datenschicht (`apps/web/src/daten/`), die bis Z-406 die Demodaten aus `apps/web/src/demo/` liefert: ein Betreiber, Stufe 1 (nur SLA Basis, Wellen „intern“ und „alle“, installiert sind Haben, Belegt, Schreibzeug, Fixpunkt), die Seite „Apps“ zeigt alle acht; schreibende Aktionen (Knöpfe, Dialoge mit Grund) kommen erst mit ihrem Punkt, Einstellungen sind bis dahin nur lesbar | ein Knopf ohne Wirkung täuscht; die Demodaten sind zugleich Vorlage für die API und Grundlage für E2E und Screenshots |

## Technologie

Derselbe Stack wie Kennwort und Soll, mit denselben zwei Abweichungen von `tech-stack.md` (Solid 2
statt React, Hono-Server mit SPA statt TanStack Start).

| Teil | Wahl | Begründung |
| --- | --- | --- |
| Monorepo | Bun Workspaces, Biome, TypeScript strict, Vitest, Playwright | wie überall |
| Zentrale | Bun, Hono, Drizzle mit SQLite (WAL), Zod, Better Auth, `bun build --compile` | ein Container ohne Datenbankserver |
| Agent | TypeScript, `bun build --compile` für amd64 und arm64, systemd-Dienst | teilt `packages/protokoll` und `packages/manifest` mit der Zentrale |
| Oberfläche | Solid 2 SPA mit TanStack Router 2 (dateibasierte Routen) und TanStack Query 6 (Daten vom Server), Paraglide, Tailwind 4, `packages/ui` von Kennwort, Geist, Zinc | ein Look in der Suite; Router und Query in den Versionen für Solid 2 (Stand in `docs/solid-2.0/README.md`), die Solid-2.0-Doku liegt in `docs/solid-2.0/` |
| Verbindung | WebSocket über HTTPS mit Client-Zertifikat, Nachrichten als Zod-Schemas mit Version | durch jede Firewall, die HTTPS durchlässt |
| Signaturen | minisign für Manifeste und Agent-Binaries | klein, ohne Infrastruktur |
| Auf dem Server | Podman ab 4.9 mit Quadlets, rootless; Caddy als Pforte; restic; minisign; unattended-upgrades | |
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

Zwei Stufen, damit die ersten Kunden früh laufen und Stufe 2 aus echtem Betrieb lernt:

- **Stufe 1 – eigener Betrieb** (41 Punkte): 1 Fundament · 2 Manifest und Platzierung · 3 Agent ·
  4 Installationen mit DNS · 5 Updates (Wellen „intern“ und „alle“) · 6 Backups und Kündigung ·
  7 Server-Pflege, Prüfung von außen, Kunden, Support-Zugang, Leistungen, Härtung, Release 1.0.
  Betrieben werden Haben, Belegt, Schreibzeug und Fixpunkt auf unseren Servern, ein Betreiber.
- **Stufe 2 – wachsen** (10 Punkte), erst nach Freigabe durch einen Menschen: 8 weitere Betreiber
  (Partner) · 9 Kontext mit eigenen Domains, Mail und Single Sign-on · 10 API für das Portal ·
  11 Wellen nach SLA mit Ankündigung · 12 Umzug und Ausfall automatisiert.

Das Schema trägt Stufe 2 schon (`betreiber_id`, SLA, `braucht`/`bietet`, `dns`), damit später keine
Migration alter Daten nötig ist; gebaut wird es erst mit seinem Punkt.

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
