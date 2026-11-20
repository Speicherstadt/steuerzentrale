# Bauliste

Die Liste, die der Agenten-Loop abarbeitet, in der Reihenfolge der Bauphasen aus dem
[Projektplan](docs/plan.md). Sie hat zwei Stufen:

- **Stufe 1 – eigener Betrieb** (Phasen 1 bis 7): genug, um die ersten zehn Kunden mit Haben,
  Belegt, Schreibzeug und Fixpunkt auf unseren Servern zu betreiben. Mit dem letzten Punkt der
  Stufe 1 erscheint die Steuerzentrale 1.0.
- **Stufe 2 – wachsen** (Phasen 8 bis 12): Partner, Kontext mit Mail und Single Sign-on, Wellen nach
  SLA, Umzug und Ausfall automatisiert, API für das Portal. Der Loop beginnt Stufe 2 erst, wenn ein
  Mensch die Zeile „Stufe 2 freigegeben“ unten abhakt; bis dahin endet er nach Stufe 1.

## So arbeitet der Loop

1. Den **ersten offenen Punkt** nehmen, dessen Abhängigkeiten (`nach:`) abgehakt sind und für den es
   keinen offenen Pull Request gibt (Titel beginnt mit seiner Nummer). Ohne `nach:` hängt ein Punkt
   am vorigen Punkt seiner Phase.
2. **Sofort reservieren**: Branch von aktuellem `origin/main`, Draft-Pull-Request mit Titel
   `Z-xxx: …`, damit parallele Sessions den Punkt als vergeben sehen.
3. **Kriterien zuerst**: Die Zeile „Fertig, wenn“ ist das Minimum. Reicht sie nicht, schärft der
   Loop sie im selben Pull Request nach, bevor er Code schreibt; streichen darf er keins.
4. Tests zuerst, dann Code, Doku und Texte in `de` und `en`, `bun run check` grün.
5. **Unabhängiges Review** durch einen eigenen Sub-Agenten (Skill `tdd-review`): ein Befund braucht
   einen fehlschlagenden Test. Befunde fixen, bis keine mehr kommen.
6. **CI grün → selbst mergen** (Squash), den Punkt hier im selben Pull Request abhaken. Der Loop
   wartet nie auf einen Menschen. Offene Fragen entscheidet er nach dem Projektplan
   („Entscheidungen“); eine neue Entscheidung schreibt er dort mit Grund hinein.
7. **Nicht hängen bleiben**: Scheitert ein Punkt dreimal, trägt der Loop ihn mit Grund unter
   „Zurückgestellt“ ein und macht mit dem nächsten Punkt weiter, der nicht davon abhängt. Was nur
   ein Mensch erledigen kann, steht unten unter „Schritte für Menschen“.

**Parallel**: Nach Z-104 laufen Phase 2 (reine Funktionen) und Z-105 (Oberfläche mit Demodaten)
unabhängig; nach Z-305 Phase 4 und Z-701 bis Z-703; nach Z-406 die Phasen 5 und 6. Jede Session
hakt nur in ihrer Phase ab und rebased vor jedem Merge auf `origin/main`.

# Stufe 1 – eigener Betrieb

## Phase 1 – Fundament

- [ ] **Z-101 Repo-Gerüst** – Vorhanden sind schon (wie in Kennwort und Soll): `package.json` mit
  `check`, Biome, TypeScript (`tsconfig.base.json`, Solution `tsconfig.json`), Vitest, die Liste
  erlaubter Abhängigkeiten, CI (`ci.yml`, `docs.yml`, `pr-regeln.yml`), Renovate, Vorlagen für Pull
  Requests und Issues, Zensical-Doku. Dazu kommen die Workspaces `packages/manifest`, `packages/protokoll`,
  `packages/planung`, `packages/ui` (von Kennwort kopiert, Quelle im Kommentar), `apps/zentrale`
  (Bun, Hono, Zod, `/health`, Logs ohne Geheimnisse, `bun build --compile`), `apps/agent`
  (`bun build --compile` für `linux-x64` und `linux-arm64`), `apps/web` (Solid 2, Vite, SPA);
  Paraglide mit `de` und `en` (`messages/`, `project.inlang` liegt vor) und dazu `i18n` in
  `checks.json`; Playwright; jede Workspace
  in `tsconfig.json` und `vitest.config.ts` eingetragen; Skripte `test:agent` und `e2e`, die die CI
  dann ausführt.
  Fertig, wenn: `bun run check` auf einem frischen Klon grün ist, die CI alle Workspaces prüft, beide
  Binaries für beide Architekturen gebaut werden, `/health` antwortet (Test) und ein Log weder
  Query-Werte noch `Authorization`- oder Cookie-Header enthält (Test).
- [ ] **Z-102 Datenbank und Audit-Log** – Drizzle mit SQLite (WAL), Migrationen eingecheckt und im
  Binary eingebettet; jede Tabelle mit Daten eines Betreibers trägt `betreiber_id` (ausgenommen:
  Manifeste, Tabellen von Better Auth); eine Schreibfunktion, die in derselben Transaktion einen
  Eintrag ins Audit-Log schreibt (Akteur, Zeitpunkt, Aktion, Ziel, Grund); das Audit-Log ist nur
  anfügbar; Aufbewahrung nach plan.md („Daten der Zentrale“) als täglicher Lauf.
  Fertig, wenn: ein Test über alle Schreibfunktionen zeigt, dass keine am Audit-Log vorbei schreibt,
  ein Fehler mitten in der Transaktion Zeile und Eintrag zurücknimmt, eine geänderte, schon
  angewendete Migration den Start verhindert, das Binary in einem leeren Datenverzeichnis die
  Datenbank anlegt (CI) und der Aufbewahrungslauf alte Heartbeats und Log-Auszüge löscht, das
  Audit-Log aber nicht (Test).
- [ ] **Z-103 Geheimnisse** – verschlüsselte Spalten (AES-256-GCM) mit Schlüssel-ID und dem Schlüssel
  aus `STEUERZENTRALE_SECRET_KEY` (32 Bytes, Base64); Start ohne oder mit falschem Schlüssel
  verweigert; Befehl zum Rotieren; Tokens nur als Hash.
  Fertig, wenn: kein Geheimnis im Klartext in der Datenbankdatei steht (Test sucht nach dem Wert),
  der Start ohne Schlüssel mit klarer Meldung abbricht, nach dem Rotieren jeder Wert lesbar bleibt
  und mit dem neuen Schlüssel verschlüsselt ist (Test) und ein Token nach dem Speichern nicht mehr
  lesbar ist.
- [ ] **Z-104 Anmeldung, Rollen, Betreiber** – Better Auth mit Organisationen (eine je Betreiber),
  Passkey oder TOTP als Pflicht vor dem ersten Zugriff; erster Inhaber über einen Einrichtungscode im
  Log; Rollen Inhaber, Technik, Support; Einladungen per Link.
  In Stufe 1 gibt es einen Betreiber; `betreiber_id` steht trotzdem in jeder Tabelle (Z-102).
  Fertig, wenn: ein Konto ohne zweiten Faktor nichts außer dessen Einrichtung erreicht und jede
  Route ihre Rollen prüft (Test je Route und Rolle).
- [ ] **Z-105 Oberfläche und Demodaten** – Shell nach DESIGN.md und `design/mockup/`: Übersicht,
  Server, Installationen, Updates, Backups, Aufträge, Kunden, Support-Zugänge, Leistungen, Apps,
  Ereignisse, Audit-Log, Einstellungen; keine Kundenansicht (die ist im Portal); was das Mockup aus Stufe 2 zeigt
  (Betreiber wechseln, Umzug, dringende Updates), kommt erst mit seinem Punkt; `bun run dev:demo`
  mit Fixtures in `apps/web/src/demo/`, die auch E2E und Screenshots nutzen; `pages` in `checks.json`
  (Routenbaum und `e2e/accessibility.spec.ts`).
  nach: Z-101
  Fertig, wenn: jede Seite in hell und dunkel, Desktop und Handy ohne axe-Befund rendert (Playwright),
  jeder Text aus `messages/` kommt (`i18n`-Check) und die Demodaten die acht Apps zeigen.

## Phase 2 – Manifest und Platzierung

- [ ] **Z-201 Manifest-Schema** – Zod-Schema in `packages/manifest` nach plan.md („Manifest“):
  Container mit Image per Digest und Architektur, Ressourcen als Grenzen, Netz (HTTP mit WebSocket,
  SSE, Upload-Grenze, Timeout; Ports fest oder vergeben; IPv4; Mail; Server für sich), Proxy,
  `rootful`, Optionen mit eigenen Containern, `braucht`/`bietet`, Anmeldung, Health
  (`http|tcp|befehl|keine`), benannte Befehle mit argv, Schritte nur als Befehlsnamen, Backup aus
  mehreren Teilen, Aktionen, Sperrzeiten, DNS-Einträge, Einstellungen mit Ebenen; Signatur mit
  minisign prüfen; JSON Schema als Datei; `docs/manifest.md`.
  nach: Z-101
  Fertig, wenn: das Beispiel aus dem Plan gültig ist, zehn ungültige Beispiele mit einer Meldung
  scheitern, die Feld und Grund nennt, ein Schritt als Shell-Text und ein Image ohne Digest abgelehnt
  werden, ein verändertes oder unsigniertes Manifest abgelehnt wird (Test) und das JSON Schema in der
  CI neu erzeugt und verglichen wird.
- [ ] **Z-202 Beispiel-App** – `manifeste/beispiel/`: kleiner HTTP-Dienst mit SQLite-Volume, Health,
  einer Option, einem Befehl nach dem Update, einem vergebenen Port und einem Backup aus zwei Teilen;
  Image in der CI gebaut, in eine lokale Registry geschoben, in zwei Versionen und einer kaputten
  (Health rot); Manifeste mit einem Test-Schlüssel signiert.
  Fertig, wenn: die Manifeste gültig und signiert sind und die drei Images in der CI entstehen.
- [ ] **Z-203 Manifeste der Speicherstadt** – `manifeste/<app>/` für alle acht Apps:
  `manifest.yml` (Container aus `deploy/quadlet/` oder, wo es keine gibt, aus der Compose-Datei bzw.
  Doku des App-Repos; eigener Caddy entfällt) und `QUELLEN.md` mit Datei und Commit jeder Angabe;
  was eine App nicht kann, als `nicht_unterstuetzt`; Kennwort und Soll ohne Image als
  `noch_nicht_veroeffentlicht`.
  Fertig, wenn: alle acht gültig sind, `QUELLEN.md` jede Angabe belegt und ein Test die Tabelle „Die
  Apps der Speicherstadt“ im Plan (Spalten Arch, RAM, Ports, IPv4, Für sich, Anmeldung, Health,
  Image) gegen die Manifeste prüft.
- [ ] **Z-204 Platzierung** – reine Funktion: Manifest, Optionen, Serverfakten, vorhandene
  Installationen, Kunde → `passt` | Hinweise | Gründe. Regeln: Architektur je Container und Option,
  RAM und Platte als Summe der Grenzen, feste Ports doppelt, öffentliche IPv4, Mail (PTR, Port 25
  ausgehend), Server für sich (beide Richtungen), `rootful` und eigener Proxy nur mit Server für
  sich, Server eines anderen Kunden oder Betreibers, `braucht` ohne passendes `bietet` beim Kunden,
  fehlende Pflichtwerte des Betreibers, Agent nicht verbunden, App ohne Image.
  Fertig, wenn: jede Regel einen Fall „passt“, „Grenze“ und „passt nicht“ hat, fast-check zeigt,
  dass eine angenommene Platzierung nie zwei Installationen auf denselben festen Port legt und nie
  mehr RAM vergibt als der Server hat, und Kontext mit `documents` auf arm64 abgelehnt wird.
- [ ] **Z-205 Quadlets rendern** – reine Funktion: Manifest, Installation, Einstellungen →
  `.container`-, `.volume`- und `.network`-Units, Podman-Secrets, Caddy-Schnipsel; Namen mit der
  Installation als Präfix; HTTP-Dienst nur auf `127.0.0.1:<port>`; Netz mit pasta; `MemoryMax` und
  Quota aus den Ressourcen; `AutoUpdate` nie gesetzt; Images per Digest; `auto`-Werte erzeugt die
  Zentrale einmal und speichert sie verschlüsselt. Vorbild: `deploy/quadlet/` in Haben und Kontext.
  nach: Z-201
  Fertig, wenn: Golden Files für jede App mit jeder Option entstehen, jede Unit in der CI
  `podman-system-generator --user --dryrun` besteht, zwei Installationen derselben App keine Namen
  und Ports teilen und ein `auto`-Geheimnis bei erneutem Rendern gleich bleibt.

## Phase 3 – Agent

- [ ] **Z-301 Protokoll** – Nachrichten in `packages/protokoll` als Zod-Schemas mit Version: Hallo,
  Heartbeat, Fakten, Zustand der Installationen, Auftrag (mit Manifest und Signatur), Fortschritt,
  Ergebnis, Log-Auszug, SSH-Anmeldung.
  nach: Z-101
  Fertig, wenn: jede Nachricht hin und zurück geprüft ist und ein Agent mit Protokoll `n-1` von der
  Zentrale verstanden wird (Test).
- [ ] **Z-302 Server hinzufügen** – Einmal-Token (24 h, einmal nutzbar); `agent.<domain>` liefert
  `install.sh` und die signierten Agent-Binaries; das Skript prüft System, Architektur, cgroup-v2-
  Delegation und Uhrzeit, installiert Podman (ab 4.4), unattended-upgrades und den Agenten als
  systemd-Dienst, setzt `net.ipv4.ip_unprivileged_port_start=80`, hinterlegt den öffentlichen
  Schlüssel für Manifeste; der Agent tauscht das Token gegen ein Client-Zertifikat.
  nach: Z-104, Z-301
  Fertig, wenn: das Skript in einem Debian-13- und einem Ubuntu-24.04-Container (systemd) in der CI
  durchläuft, ein benutztes oder abgelaufenes Token und ein Binary mit falscher Signatur abgelehnt
  werden, `shellcheck` grün ist und der Dialog den Befehl zeigt (Playwright).
- [ ] **Z-303 Verbindung und Heartbeat** – WSS mit mTLS an `agent.<domain>`, Meldung alle 30 s;
  Zustände „verbunden“, „seit x min still“, „getrennt“; Wiederverbindung mit Backoff; Zertifikat
  rotieren und sperren; Rate-Limit am Token-Tausch.
  nach: Z-302
  Fertig, wenn: ein Test Verbindungsabbruch, Wiederverbindung, gesperrtes Zertifikat und Rate-Limit
  abdeckt und ein stiller Server nach 3 min ein Ereignis erzeugt.
- [ ] **Z-304 Serverfakten** – CPU, RAM, Platte je Mount, Architektur, OS und Kernel (läuft,
  installiert), „Neustart nötig“, ausstehende Updates, Podman-Version, IPv4/IPv6, PTR, belegte Ports,
  ausgehender Port 25, Uhrzeit; SSH-Anmeldungen aus journald als Ereignis.
  nach: Z-303, Z-204
  Fertig, wenn: die Fakten in der CI im Container gelesen werden, die Platzierung sie ohne Umweg
  nutzt und eine SSH-Anmeldung im Container ein Ereignis erzeugt (Test).
- [ ] **Z-305 Aufträge** – Warteschlange in der Zentrale; der Agent holt, bestätigt, meldet
  Fortschritt und Ergebnis; idempotent über die ID; Aufträge können auf andere warten, auch über
  Installationen hinweg; der Agent führt nur Befehle aus Manifesten mit gültiger Signatur aus,
  Argumente nach Schema; Zeitlimit je Aktion.
  Fertig, wenn: ein doppelt zugestellter Auftrag einmal ausgeführt wird, ein Auftrag mit nicht
  signiertem oder verändertem Manifest vom Agenten abgelehnt wird (Test), ein wartender Auftrag erst
  nach dem Ende seines Vorgängers startet und ein Auftrag nach Neustart des Agenten fortgesetzt oder
  als gescheitert gemeldet wird.

## Phase 4 – Installationen

- [ ] **Z-401 Pforte** – Caddy rootless unter `sz-pforte` mit `Network=host`, Admin-API nur auf
  localhost; Adressen hinzufügen und entfernen ohne Neustart; WebSocket, SSE, Upload-Grenze und
  Timeout aus dem Manifest.
  nach: Z-305, Z-202, Z-205
  Fertig, wenn: in der CI zwei Installationen der Beispiel-App unter zwei Hostnamen erreichbar sind
  (lokale CA statt Let's Encrypt), die echte Client-IP bei der App ankommt (Test), Installation A den
  Port von B nicht direkt erreicht (Test) und das Entfernen einer die andere nicht unterbricht.
- [ ] **Z-402 Installieren und Entfernen** – Dialog mit Kunde, App, Server, Optionen und
  Einstellungen nach Ebenen, Platzierung live; der Agent legt `sz-<installation>` mit Linger an,
  schreibt Units und Secrets, zieht Images, führt `schritte.einrichten` aus, startet; Entfernen mit
  Backup vorher.
  nach: Z-401, Z-204
  Fertig, wenn: die Beispiel-App in der CI per Auftrag installiert und entfernt wird, ein Fehler im
  Einrichtungsschritt nichts halb Installiertes zurücklässt, eine Installation die Dateien einer
  anderen nicht lesen kann (Test) und der Ablauf in Playwright läuft.
- [ ] **Z-403 Health und Zustand** – Health nach Art aus dem Manifest, dazu der Zustand der
  systemd-Units; grün, gelb, rot oder unbekannt mit Grund und Verlauf; Störung nach plan.md.
  Fertig, wenn: die kaputte Beispiel-App rot wird, eine beendete Unit gelb, eine App mit
  `health: keine` nur nach Units bewertet wird und 5 Minuten Rot ein Ereignis „Störung“ erzeugen.
- [ ] **Z-404 Einstellungen** – Ebenen aus dem Manifest; Formular aus dem Schema (keine App fest
  eingebaut); Änderung erzeugt den Auftrag „neu konfigurieren“; Geheimnisse nie zurück an die
  Oberfläche.
  Fertig, wenn: das Formular für jedes der acht Manifeste ohne App-spezifischen Code entsteht
  (Test), ein fehlender Pflichtwert des Betreibers die Installation blockiert, und kein Geheimnis in
  einer API-Antwort steht (Test).
- [ ] **Z-405 Neustart, Logs, nur lesen** – Aktionen Neustart, Log-Auszug (letzte 500 Zeilen aus
  journald, Werte der Secrets ersetzt), nur lesen, wenn das Manifest sie anbietet; jede mit Grund.
  Fertig, wenn: eine nicht angebotene Aktion in der Oberfläche fehlt und vom Agenten abgelehnt wird
  und der Wert eines Secrets im Log-Auszug ersetzt ist.
- [ ] **Z-406 Server-Detail und Übersicht** – echte Daten statt Demodaten; Übersicht mit allem, was
  Aufmerksamkeit braucht, nach Schwere.
  Fertig, wenn: die E2E-Fälle aus Z-105 gegen Zentrale und Agent im Container laufen.
- [ ] **Z-407 Adressen und DNS** – Adresse `<app>.<kunde>.<domain>`; die Zentrale setzt A und AAAA
  über die Cloudflare-API und entfernt sie mit der Installation.
  nach: Z-402
  Fertig, wenn: in der CI gegen eine nachgebaute Cloudflare-API eine Installation ihren Eintrag
  bekommt und beim Entfernen verliert und kein Server einen DNS-Token erhält (Test).

## Phase 5 – Updates

- [ ] **Z-501 Versionen** – die Zentrale fragt die Registries nach Tags (Semver) und lädt das
  signierte Manifest jeder Version; Vorabversionen nur für die Welle „intern“; Markierung `dringend`.
  nach: Z-406
  Fertig, wenn: gegen die lokale Registry eine neue Version erkannt wird, ein Manifest ohne gültige
  Signatur verworfen wird und eine Vorabversion nur intern erscheint.
- [ ] **Z-502 Wellen und Sperrzeiten** – reine Funktion in `packages/planung`: Installationen,
  Sperrzeiten, Wartungsfenster, Zeitpunkt → Plan. Zwei Wellen: „intern“ (unsere eigenen
  Installationen) und „alle“, 24 h nach „intern“ ohne Störung; „intern“ ohne eigene Installation
  wartet auf Freigabe; `dringend` läuft sofort durch beide Wellen, eine Sperrzeit übergeht nur der
  Inhaber mit Grund.
  Fertig, wenn: Tests Sperrzeiten über den Monatswechsel, Zeitumstellung, Wartungsfenster über
  Mitternacht, eine gestoppte Welle nach einer Störung und ein dringendes Update abdecken und Haben
  nie zwischen dem 7. und 12. aktualisiert wird, außer mit Freigabe.
- [ ] **Z-503 Update mit Rückkehr** – Backup, Pull per Digest, `schritte.nach_update`, Neustart,
  Health; bei Rot zurück auf die alte Version und das Backup; Welle anhalten; Ereignis; Apps mit
  `health: keine` nur von Hand.
  Fertig, wenn: in der CI die Beispiel-App von Version 1 auf 2 kommt, die kaputte Version
  automatisch zurückgenommen wird, mit den Daten von vorher, und eine App ohne Health in keiner
  Welle automatisch aktualisiert wird.
- [ ] **Z-504 Updates des Agenten** – Agent lädt neue Version, prüft Prüfsumme und minisign-Signatur,
  startet sich im Wartungsfenster neu; die Zentrale versteht `n-1`.
  Fertig, wenn: ein Agent in der CI sich aktualisiert und eine falsche Signatur abgelehnt wird.

## Phase 6 – Backups und Kündigung

- [ ] **Z-601 Backups** – Teile aus dem Manifest (`pg_dump`, `volume`, `befehl`); ein
  restic-Repository und ein Schlüssel je Installation auf dem S3-Ziel des Betreibers; Zeitplan als
  systemd-Timer des Nutzers; Aufbewahrung nach plan.md.
  nach: Z-406
  Fertig, wenn: in der CI ein Backup aus zwei Teilen in MinIO landet, die Aufbewahrung alte Snapshots
  löscht, ein Backup bei getrennter Zentrale trotzdem läuft und ein gescheitertes Backup ein
  Ereignis erzeugt.
- [ ] **Z-602 Prüf-Restore** – wöchentlich je Installation unter einem Wegwerf-Nutzer
  `sz-restore-*` auf einem Server, den die Platzierung als passend meldet; Health prüfen, entfernen.
  Fertig, wenn: ein absichtlich beschädigtes Backup als „Prüf-Restore gescheitert“ erscheint und ein
  Server ohne Platz nicht für den Prüf-Restore gewählt wird.
- [ ] **Z-603 Wiederherstellen** – Snapshot wählen, Grund angeben, vorher Backup vom Ist-Zustand.
  Fertig, wenn: die Daten nach dem Wiederherstellen dem Snapshot entsprechen (Test) und der Vorgang
  im Audit-Log steht.
- [ ] **Z-604 Kündigung und Löschung** – Vertragsende, 30 Tage nur lesen (wenn angeboten) und Export
  bzw. letztes Backup für den Kunden, Löschung von Installation, Repository und DNS-Einträgen 90 Tage
  nach Vertragsende; Löschprotokoll als Ereignis und Webhook.
  nach: Z-801
  Fertig, wenn: der Ablauf mit der Beispiel-App in Playwright läuft, vor Ablauf der Frist nichts
  gelöscht wird und nach der Löschung weder Repository noch DNS-Eintrag noch Linux-Nutzer existieren
  (Test).

## Phase 7 – Server-Pflege, Kunden, Release

- [ ] **Z-701 Betriebssystem** – Status von unattended-upgrades, ausstehende Pakete, „Neustart
  nötig“; Neustart als Auftrag im Wartungsfenster außerhalb aller Sperrzeiten der Apps auf dem
  Server.
  nach: Z-305, Z-502
  Fertig, wenn: die Planung den Neustart verschiebt, wenn eine Sperrzeit läuft, und ein Neustart im
  Container der CI ausgeführt und der Server danach wieder verbunden ist.
- [ ] **Z-702 Prüfungen** – Platte über 80/90 %, Zertifikat in 14 Tagen, Backup älter als 26 h,
  Port offen, der in keinem Manifest steht, Uhrzeit.
  nach: Z-601, Z-401
  Fertig, wenn: jede Prüfung einen Test mit Grenzfall hat und ihr Ergebnis in der Übersicht steht.
- [ ] **Z-703 Benachrichtigungen** – Ereignisse nach Schwere per Mail (SMTP) und Webhook; Ruhezeiten;
  eine Meldung je Störung, nicht je Prüfung.
  Fertig, wenn: eine Störung, die 10 Prüfungen lang besteht, eine Mail erzeugt (Mailpit) und ihre
  Behebung eine zweite.
- [ ] **Z-704 Überwachung von außen und Verfügbarkeit** – die Zentrale prüft jede öffentliche Adresse
  (DNS, Zertifikat, Pforte, Health) unabhängig vom Agenten; Verfügbarkeit je Installation und Monat;
  `/health` der Zentrale für einen externen Prüfdienst.
  nach: Z-407
  Fertig, wenn: „Agent grün, außen rot“ ein Ereignis erzeugt und die Verfügbarkeit aus einer
  Testreihe mit bekannten Ausfällen richtig berechnet wird (Test).
- [ ] **Z-801 Kunden und Verträge** – Kunde mit Kontakt, Vertrag mit SLA (in Stufe 1 nur Basis; Plus und Ruhe mit Z-505),
  Kündigungsdatum; ein Kunde mit mehreren Apps auf mehreren Servern.
  nach: Z-406
  Fertig, wenn: die Kundenseite alle seine Installationen
  zeigt.
- [ ] **Z-802 Support-Zugang** – zeitlich begrenzt (Vorgabe 2 h), mit Grund; erlaubt Log-Auszug,
  Neustart und die Aktionen der Rolle Support; endet von selbst; erscheint in den Ereignissen des
  Kunden.
  Fertig, wenn: nach Ablauf jeder Zugriff abgelehnt wird (Test) und der Zugang im Audit-Log mit Grund
  steht.
- [ ] **Z-804 Leistungen** – je Kunde und Monat: Installationen, Speicher, Support-Zeit,
  Verfügbarkeit; Export als CSV.
  nach: Z-704
  Fertig, wenn: die Summen aus den Ereignissen berechnet werden (Test) und der Export gültiges CSV
  nach RFC 4180 ist.
- [ ] **Z-1001 Sicherheitsprüfung** – `docs/sicherheit.md`: Bedrohungsmodell, Notzugang per SSH,
  TOMs nach Art. 32 DSGVO als Anlage zum Auftragsverarbeitungsvertrag.
  nach: Z-804
  Fertig, wenn: jede Bedrohung einen Test oder eine begründete Annahme hat, darunter: eine Zentrale
  mit fremdem Manifest bringt keinen Code auf einen Server (Test), ein gestohlenes Agent-Zertifikat
  erzeugt keine Aufträge (Test), Rate-Limits an Anmeldung und Token-Tausch greifen (Test).
- [ ] **Z-1002 Zentrale sichern** – Backup der Zentrale (Datenbank und Schlüssel getrennt),
  Wiederherstellung auf einem neuen Server, Agenten verbinden sich wieder.
  Fertig, wenn: der Ablauf in der CI durchläuft.
- [ ] **Z-1003 Echte App** – Schreibzeug und Haben aus `manifeste/` in der CI installieren, aktualisieren,
  sichern und wiederherstellen.
  Fertig, wenn: der Lauf grün ist.
- [ ] **Z-1004 Release** – Image der Zentrale (amd64, arm64) mit Quadlet-Units, Agent-Binaries mit
  Prüfsummen und minisign-Signatur, Release-Workflow aus firsttris/workflows;
  `docs/installation.md` mit Ein-Server-Betrieb.
  Fertig, wenn: ein Release-Kandidat in der CI entsteht und sich nach der Doku auf einem frischen
  Container installieren lässt.

# Stufe 2 – wachsen

- [ ] **Stufe 2 freigegeben** – hakt ein Mensch ab, wenn die ersten Kunden auf Stufe 1 laufen; bis
  dahin beginnt der Loop keinen Punkt dieser Stufe.

## Phase 8 – Weitere Betreiber (Partner)

- [ ] **Z-803 Weitere Betreiber (Partner)** – ein Partner ist ein eigener Betreiber in derselben
  Zentrale: eigene Konten, Kunden, Server, S3-Ziel, Werte je App und Marke im Hinweis der
  Installation.
  Fertig, wenn: kein Endpunkt einem Betreiber Daten eines anderen liefert (Test je Endpunkt), eine
  Installation die Hersteller-ID ihres Betreibers bekommt (Test) und Backups beider Betreiber in
  getrennten Repositorys landen.

## Phase 9 – Kontext, Mail und Single Sign-on

- [ ] **Z-409 Kontext, eigene Domains und Mail** – eigene Domain des Kunden, aktiv erst nach
  erfolgreicher CNAME-Prüfung; DNS-Einträge aus dem Manifest (MX, SPF, DKIM, DMARC) anzeigen, prüfen
  und setzen, wenn die Domain bei uns liegt; Prüfungen für Mail: PTR (IPv4 und IPv6), Port 25
  ausgehend, Blacklists, Rate-Limit für ausgehende Mail; `rootful` für Kontext auf einem Server für
  sich.
  Fertig, wenn: eine eigene Domain ohne CNAME nicht aktiv wird, fehlende Mail-Einträge als Hinweis
  erscheinen, jede Mail-Prüfung einen Test mit Grenzfall hat und Kontext in der CI auf einem Server
  für sich startet.
- [ ] **Z-408 Single Sign-on über Kontext** – `aus: oidc-anbieter` erzeugt einen vorgeschalteten
  Auftrag beim Anbieter des Kunden (Kontext), der den OIDC-Client anlegt; die App startet erst danach.
  nach: Z-409
  Fertig, wenn: der OIDC-Client beim Anbieter vor dem Start der App angelegt ist (Test mit der
  Beispiel-App als Anbieter) und das Entfernen der App den Client wieder löscht.

## Phase 10 – API für das Portal

- [ ] **Z-901 API-Tokens und OpenAPI** – `api.<domain>`; Tokens mit Rechten (lesen, Kunden anlegen,
  buchen, kündigen), Rate-Limit, OpenAPI aus den Zod-Schemas, `docs/api.md`.
  nach: Z-801
  Fertig, wenn: jede Route ihr Recht prüft (Test) und die OpenAPI-Datei in der CI neu erzeugt und
  verglichen wird.
- [ ] **Z-902 Buchen über die API** – Kunde anlegen, App buchen mit automatischer Platzierung auf
  einem gemeinsamen Server oder „Server nötig“, kündigen.
  Fertig, wenn: eine Buchung die Beispiel-App in der CI installiert und eine nicht platzierbare
  Buchung mit Grund abgelehnt wird.
- [ ] **Z-903 Webhooks** – Ereignisse installiert, Wartung geplant, Störung, behoben, gekündigt,
  gelöscht (mit Löschprotokoll); signiert (HMAC), mit Wiederholung.
  Fertig, wenn: eine gefälschte Signatur im Test-Empfänger auffällt und eine Zustellung nach Ausfall
  des Empfängers wiederholt wird.
- [ ] **Z-904 Lesen für das Portal** – lesende Endpunkte je Kunde: Installationen mit Zustand,
  Verfügbarkeit, letztes Backup und Prüf-Restore, Wartungstermine, Support-Zugänge, Ereignisse,
  Export zum Herunterladen (wenn angeboten); ein Token des Portals sieht nur den Kunden, für den es
  fragt.
  Fertig, wenn: kein Endpunkt Daten eines anderen Kunden liefert (Test je Endpunkt) und keine
  Antwort ein Geheimnis, einen Linux-Nutzer oder einen Log-Auszug enthält (Test).

## Phase 11 – Wellen nach SLA

- [ ] **Z-505 Wellen nach SLA und Ankündigung** – Wellen intern, früh (Plus), standard (Basis),
  spät (Ruhe), jede nach 24 h ohne Störung; Termin je Kunde mindestens 72 h vorher, als Webhook an
  das Portal.
  nach: Z-903
  Fertig, wenn: die SLA die Welle bestimmt (Test), die 72-h-Ankündigung für jede Installation vor
  ihrem Update als Webhook ausgeht (Test) und „spät“ nie vor „standard“ läuft.

## Phase 12 – Umzug und Ausfall

- [ ] **Z-605 Umzug einer Installation** – von Server A nach B (z. B. gemeinsam nach eigen): Backup,
  Restore auf B, DNS umschalten, A erst nach grünem Health entfernen; nie in einer Sperrzeit.
  nach: Z-603, Z-407
  Fertig, wenn: in der CI die Beispiel-App umzieht, die Daten gleich sind und die Quelle bei rotem
  Health auf B stehen bleibt.
- [ ] **Z-606 Server wiederherstellen** – einen Server als verloren markieren; alle seine
  Installationen aus den letzten Backups auf einen oder mehrere neue Server bringen.
  nach: Z-605
  Fertig, wenn: in der CI zwei Installationen eines gelöschten Servers auf einem neuen wieder laufen
  und die Dauer als Ereignis gemessen wird.

## Zurückgestellt

## Schritte für Menschen

Nicht auf dem Weg des Loops.

- Name und Domain der Steuerzentrale; Zone bei Cloudflare, API-Token nur für die Zentrale.
- Server für die Zentrale (netcup), WireGuard, S3-Ziel für Backups, Mail-Versand, externer Prüfdienst
  für `/health` der Zentrale.
- Signierschlüssel (minisign) erzeugen, offline aufbewahren; Manifeste und Agent-Releases signieren.
- Je App eine eigene interne Installation für die Welle „intern“.
- Betreiber-Vertrag in den App-Repos: Health ohne Anmeldung, nur lesen, Export, Einrichtungsbefehl
  (Haben#945–#948, #1307; für die anderen Apps noch anzulegen); Images für Kennwort und Soll.
- OIDC in Stellwerk (stellwerk#36) und Fixpunkt (fixpunkt#5).
- Auftragsverarbeitungsvertrag mit TOMs aus `docs/sicherheit.md`, SLA-Texte, Preise, Ticket-System.
- Erster eigener Server mit unseren Installationen, dann Pilotkunden.
- Repo für das Portal, sobald Phase 9 fertig ist.
- Später: Server bei netcup und Hetzner über deren API bestellen; eigener Relay-Tunnel für Server
  beim Kunden ohne Portweiterleitung; Archivbetrieb nach Kündigung.
