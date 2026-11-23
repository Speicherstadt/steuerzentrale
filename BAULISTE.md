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

0. **Offene Pull Requests zuerst**: Gibt es einen offenen Pull Request des Loops (Titel `Z-xxx: …`),
   auf den seit mehr als einem Tag niemand gepusht hat, übernimmt ihn die Session: Branch holen,
   erledigen, was unter „Übergabe“ unten dazu steht, CI grün machen, mergen. Erst dann ein neuer
   Punkt.
1. Den **ersten offenen Punkt** nehmen, dessen Abhängigkeiten (`nach:`) abgehakt sind und für den es
   keinen offenen Pull Request gibt (Titel beginnt mit seiner Nummer). Ohne `nach:` hängt ein Punkt
   am vorigen Punkt seiner Phase.
2. **Sofort reservieren**: Branch von aktuellem `origin/main`, Draft-Pull-Request mit Titel
   `Z-xxx: …`, damit parallele Sessions den Punkt als vergeben sehen. Danach nach offenen Pull
   Requests mit derselben Nummer suchen: der mit der niedrigsten Nummer gewinnt, die anderen schließt
   ihre Session wieder.
3. **Kriterien zuerst**: Die Zeile „Fertig, wenn“ ist das Minimum. Reicht sie nicht, schärft der
   Loop sie im selben Pull Request nach, bevor er Code schreibt; streichen darf er keins.
4. Tests zuerst, dann Code, Doku und Texte in `de` und `en`, `bun run check` grün. Was lokal nicht
   läuft (Podman, systemd, Incus), steht im Pull Request unter „Wie geprüft“ als „nur CI“; maßgeblich
   ist die CI.
5. **Unabhängiges Review nur bei Sicherheit**: Berührt der Punkt, was der Agent ausführen darf,
   Anmeldung, Rechte, Geheimnisse, die Trennung der Betreiber, das Audit-Log, die Verbindung des
   Agenten, die Pforte oder `install.sh` (Liste in `CLAUDE.md`, „Pull requests“), prüft ihn ein eigener
   Sub-Agent (Skill `tdd-review`): ein Befund braucht einen fehlschlagenden Test; Befunde fixen, bis
   keine mehr kommen. Alles andere wird gemergt, sobald die CI grün ist.
6. **CI grün → selbst mergen** (Squash), den Punkt hier im selben Pull Request abhaken. Der Loop
   wartet nie auf einen Menschen. Offene Fragen entscheidet er nach dem Projektplan
   („Entscheidungen“); eine neue Entscheidung schreibt er dort mit Grund hinein.
7. **Nicht hängen bleiben**: Gescheitert ist ein Versuch, wenn sein Pull Request ohne Merge geschlossen
   wird oder die CI nach drei Pushes mit Fixes noch rot ist. Scheitert ein Punkt dreimal, trägt der Loop ihn mit Grund unter
   „Zurückgestellt“ ein und macht mit dem nächsten Punkt weiter, der nicht davon abhängt. Was nur
   ein Mensch erledigen kann, steht unten unter „Schritte für Menschen“.

**Parallel**: Nach Z-101 laufen Z-102 bis Z-105 (Fundament), Phase 2 und Z-502 (reine Funktionen)
unabhängig; nach Z-305 Phase 4; nach Z-406 Phase 5 und Z-702 bis Z-704. Phase 6 beginnt nach Z-603.
Die Nummern der Punkte bleiben, auch wo sich die Reihenfolge der Phasen geändert hat. Jede Session
hakt nur in ihrer Phase ab und rebased vor jedem Merge auf `origin/main`.

# Stufe 1 – eigener Betrieb

## Phase 1 – Fundament

- [x] **Z-101 Repo-Gerüst** – Vorhanden sind schon (wie in Kennwort und Soll): `package.json` mit
  `check`, Biome, TypeScript (`tsconfig.base.json`, Solution `tsconfig.json`), Vitest, die Liste
  erlaubter Abhängigkeiten, CI (`ci.yml`, `docs.yml`, `pr-regeln.yml`), Renovate, Vorlagen für Pull
  Requests und Issues, Zensical-Doku. Dazu kommen die Workspaces `packages/manifest`, `packages/protokoll`,
  `packages/planung`, `packages/ui` (von Kennwort kopiert, Quelle im Kommentar), `apps/zentrale`
  (Bun, Hono, Zod, `/health`, Logs ohne Geheimnisse, `bun build --compile`), `apps/agent`
  (`bun build --compile` für `linux-x64` und `linux-arm64`), `apps/web` (Solid 2, Vite, SPA);
  Paraglide mit `de` und `en` (`messages/`, `project.inlang` liegt vor) und dazu `i18n` in
  `checks.json`; Playwright; jede Workspace
  in `tsconfig.json` und `vitest.config.ts` eingetragen; Skripte `test:agent` und `e2e` mit je einem
  ersten Test (der Agent startet und meldet seine Version; die Startseite rendert), die mit `CI=true`
  fehlschlagen, wenn Podman fehlt oder kein Test lief (kein `--passWithNoTests`); der Job `check` in
  `ci.yml` nimmt `skipped` bei `agent` und `e2e` ab jetzt nicht mehr an (außer bei einem Pull
  Request ohne Code, den der Job `changes` erkennt).
  Fertig, wenn: `bun run check` auf einem frischen Klon grün ist, die CI alle Workspaces prüft und
  `agent` und `e2e` dort echt laufen, beide Binaries für beide Architekturen gebaut werden, `/health`
  antwortet (Test) und ein Log weder Query-Werte noch `Authorization`- oder Cookie-Header enthält
  (Test).
- [x] **Z-102 Datenbank und Audit-Log** – Drizzle mit SQLite (WAL), Migrationen eingecheckt und im
  Binary eingebettet; jede Tabelle mit Daten eines Betreibers trägt `betreiber_id` (ausgenommen:
  Manifeste, Tabellen von Better Auth); eine Schreibfunktion, die in derselben Transaktion einen
  Eintrag ins Audit-Log schreibt (Akteur, Zeitpunkt, Aktion, Ziel, Grund); das Audit-Log ist nur
  anfügbar; Aufbewahrung nach plan.md („Daten der Zentrale“) als täglicher Lauf.
  Fertig, wenn: ein Test über alle Schreibfunktionen zeigt, dass keine am Audit-Log vorbei schreibt,
  ein Fehler mitten in der Transaktion Zeile und Eintrag zurücknimmt, eine geänderte, schon
  angewendete Migration den Start verhindert, das Binary in einem leeren Datenverzeichnis die
  Datenbank anlegt (CI) und der Aufbewahrungslauf alte Heartbeats und Log-Auszüge löscht, das
  Audit-Log aber nicht (Test).
- [x] **Z-103 Geheimnisse** – verschlüsselte Spalten (AES-256-GCM) mit Schlüssel-ID und dem Schlüssel
  aus `STEUERZENTRALE_SECRET_KEY` (32 Bytes, Base64); Start ohne oder mit falschem Schlüssel
  verweigert; Befehl zum Rotieren; Tokens nur als Hash.
  Fertig, wenn: kein Geheimnis im Klartext in der Datenbankdatei steht (Test sucht nach dem Wert),
  der Start ohne Schlüssel mit klarer Meldung abbricht, nach dem Rotieren jeder Wert lesbar bleibt
  und mit dem neuen Schlüssel verschlüsselt ist (Test) und ein Token nach dem Speichern nicht mehr
  lesbar ist.
- [x] **Z-105 Oberfläche und Demodaten** – Shell nach DESIGN.md und `design/mockup/`: Übersicht,
  Server, Installationen, Updates, Backups, Aufträge, Kunden, Support-Zugänge, Leistungen, Apps,
  Ereignisse, Audit-Log, Einstellungen; keine Kundenansicht (die ist im Portal); was das Mockup aus Stufe 2 zeigt
  (Betreiber wechseln, Umzug, dringende Updates), kommt erst mit seinem Punkt; `bun run dev:demo`
  mit Fixtures in `apps/web/src/demo/`, die auch E2E und Screenshots nutzen; `pages` in `checks.json`
  (Routenbaum und `e2e/accessibility.spec.ts`).
  Die Seiten für Anmeldung und zweiten Faktor baut Z-104.
  nach: Z-101
  Fertig, wenn: jede Seite in hell und dunkel, Desktop und Handy ohne axe-Befund rendert (Playwright),
  jeder Text aus `messages/` kommt (`i18n`-Check) und die Demodaten die acht Apps zeigen.
- [x] **Z-104 Anmeldung, Rollen, Betreiber** – Better Auth mit Organisationen (eine je Betreiber) und
  den Plugins `passkey` und `twoFactor` (plan.md, „Anmeldung“): ein Passkey genügt, ein Passwort nur
  zusammen mit TOTP; ohne zweiten Faktor erreicht ein Konto nur `/einrichtung`. Erster Inhaber über
  einen Einrichtungscode im Log (einmalig, 24 h gültig); Rollen Inhaber, Technik, Support über die
  Zugriffssteuerung des Organization-Plugins; Einladungen per Link. Seiten: Anmeldung, zweiter Faktor
  einrichten (TOTP mit QR-Code, Passkey), Einladung annehmen. In Stufe 1 gibt es einen Betreiber;
  `betreiber_id` steht trotzdem in jeder Tabelle (Z-102).
  nach: Z-102, Z-103, Z-105
  Fertig, wenn: ein Konto ohne zweiten Faktor nichts außer dessen Einrichtung erreicht, jede Route
  ihre Rollen prüft (Test je Route und Rolle), der Einrichtungscode nach Gebrauch und nach 24 h
  abgelehnt wird und Anmeldung mit Passkey (virtueller Authenticator) und mit Passwort und TOTP in
  Playwright laufen.
- [x] **Z-801 Kunden und Verträge** – Kunde mit Kontakt, Vertrag mit SLA (in Stufe 1 nur Basis; Plus und
  Ruhe mit Z-505), Kündigungsdatum; Liste und Seite je Kunde, zuerst ohne Installationen (die zeigt
  Z-406).
  nach: Z-104
  Fertig, wenn: Kunden angelegt, geändert und mit Kündigungsdatum versehen werden (Playwright), jede
  Änderung im Audit-Log steht und kein Kunde eines anderen Betreibers erreichbar ist (Test je
  Endpunkt).

## Phase 2 – Manifest und Platzierung

- [x] **Z-201 Manifest-Schema** – Zod-Schema in `packages/manifest` nach plan.md („Manifest“):
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
- [x] **Z-202 Beispiel-App** – `manifeste/beispiel/`: kleiner HTTP-Dienst mit SQLite-Volume, Health,
  einer Option, einem Befehl nach dem Update, einem vergebenen Port und einem Backup aus zwei Teilen;
  Image in der CI gebaut, in eine lokale Registry geschoben, in zwei Versionen und einer kaputten
  (Health rot). Die Manifeste der Beispiel-App erzeugt die CI zur Testzeit mit den Digests der eben
  gebauten Images und signiert sie mit dem Test-Schlüssel aus `test/schluessel/` (öffentlich bekannt,
  plan.md, „Signaturen in Tests“); eingecheckt ist nur die Vorlage.
  Fertig, wenn: die erzeugten Manifeste gültig und signiert sind, die drei Images in der CI
  entstehen und ein Build für ein Release den Test-Schlüssel ablehnt (Test).
- [x] **Z-203 Manifeste der Speicherstadt** – `manifeste/<app>/<version>/` für alle acht Apps:
  `manifest.yml` (Container aus `deploy/quadlet/` oder, wo es keine gibt, aus der Compose-Datei bzw.
  Doku des App-Repos; eigener Caddy entfällt; Images von GHCR, wo die App dort veröffentlicht) und
  `QUELLEN.md` mit Datei und Commit jeder Angabe; Digests liefert `scripts/digest.ts` aus der Registry
  (Quelle: Registry, Tag, abgefragt am); was eine App nicht kann, als `nicht_unterstuetzt`; Kennwort
  und Soll ohne Image als `noch_nicht_veroeffentlicht`. Signiert werden die Manifeste von einem
  Menschen (Schritte für Menschen); bis dahin liegt die `.minisig` des Test-Schlüssels daneben.
  Fertig, wenn: alle acht gültig sind, `QUELLEN.md` jede Angabe belegt, `scripts/digest.ts` einen Tag
  in einen Digest übersetzt (Test gegen die lokale Registry) und ein Test die Tabelle „Die Apps der
  Speicherstadt“ im Plan (Spalten Arch, RAM, Ports, IPv4, Für sich, Anmeldung, Health, Image) gegen
  die Manifeste prüft.
- [x] **Z-204 Platzierung** – reine Funktion: Manifest, Optionen, Serverfakten, vorhandene
  Installationen, Kunde → `passt` | Hinweise | Gründe. Regeln: Architektur je Container und Option,
  RAM und Platte als Summe der Grenzen, feste Ports doppelt, öffentliche IPv4, Mail (PTR, Port 25
  ausgehend), Server für sich (beide Richtungen), `rootful` und eigener Proxy nur mit Server für
  sich, Server eines anderen Kunden oder Betreibers, `braucht` ohne passendes `bietet` beim Kunden,
  fehlende Pflichtwerte des Betreibers, Agent nicht verbunden, App ohne Image.
  Fertig, wenn: jede Regel einen Fall „passt“, „Grenze“ und „passt nicht“ hat, fast-check zeigt,
  dass eine angenommene Platzierung nie zwei Installationen auf denselben festen Port legt und nie
  mehr RAM vergibt als der Server hat, und Kontext mit `documents` auf arm64 abgelehnt wird.
- [x] **Z-205 Quadlets rendern** – reine Funktion: Manifest, Installation, Einstellungen →
  `.container`-, `.volume`- und ein `.network`-Unit je Installation, Podman-Secrets, Caddy-Schnipsel;
  Namen mit der Installation als Präfix; HTTP-Dienst nur per `PublishPort=127.0.0.1:<port>:…`;
  `MemoryMax` aus den Ressourcen (Platte nur geplant, plan.md, „Ressourcen“); nur Schlüssel, die
  Podman 4.9 kennt; `AutoUpdate` nie gesetzt; Images per Digest; erzeugte Werte und Vorlagen aus
  Z-201, `auto`-Werte erzeugt die Zentrale einmal und speichert sie verschlüsselt. Vorbild:
  `deploy/quadlet/` in Haben und Kontext.
  nach: Z-201, Z-203
  Fertig, wenn: Golden Files für jede App mit jeder Option entstehen, jede Unit in der CI
  `podman-system-generator --user --dryrun` mit Podman 4.9 (Runner) und 5.x (Debian 13) besteht,
  zwei Installationen derselben App keine Namen und Ports teilen und ein `auto`-Geheimnis bei
  erneutem Rendern gleich bleibt.

## Phase 3 – Agent

- [x] **Z-301 Protokoll** – Nachrichten in `packages/protokoll` als Zod-Schemas mit Version: Hallo,
  Heartbeat, Fakten, Zustand der Installationen, Auftrag (mit Manifest und Signatur), Fortschritt,
  Ergebnis, Log-Auszug, SSH-Anmeldung.
  nach: Z-101
  Fertig, wenn: jede Nachricht hin und zurück geprüft ist und ein Agent mit Protokoll `n-1` von der
  Zentrale verstanden wird (Test).
- [x] **Z-302 Server hinzufügen** – Einmal-Token (24 h, einmal nutzbar); `agent.<domain>` liefert
  `install.sh`, die Agent-Binaries und eine minisign-signierte Prüfsummendatei; das Skript prüft
  System, Architektur, cgroup-v2-Delegation und Uhrzeit, installiert Podman (ab 4.9), minisign,
  unattended-upgrades und den Agenten als systemd-Dienst, prüft die Prüfsummen gegen die Signatur,
  setzt `net.ipv4.ip_unprivileged_port_start=80`, hinterlegt den öffentlichen Schlüssel für
  Manifeste; der Agent tauscht das Token gegen ein Client-Zertifikat (plan.md, „TLS und Zertifikate“).
  nach: Z-104, Z-301
  Fertig, wenn: das Skript in je einer Incus-VM mit Debian 13 und Ubuntu 24.04 auf dem Runner
  durchläuft (plan.md, „Testserver“), ein benutztes oder abgelaufenes Token und ein Binary mit
  falscher Signatur abgelehnt werden, `shellcheck` grün ist und der Dialog den Befehl zeigt
  (Playwright).
- [x] **Z-303 Verbindung und Heartbeat** – WSS mit mTLS an `agent.<domain>`, Meldung alle 30 s;
  Zustände „verbunden“, „seit x min still“, „getrennt“; Wiederverbindung mit Backoff; Zertifikat
  rotieren und sperren; Rate-Limit am Token-Tausch.
  nach: Z-302
  Fertig, wenn: ein Test Verbindungsabbruch, Wiederverbindung, gesperrtes Zertifikat und Rate-Limit
  abdeckt und ein stiller Server nach 3 min ein Ereignis erzeugt.
- [x] **Z-304 Serverfakten** – CPU, RAM, Platte je Mount, Architektur, OS und Kernel (läuft,
  installiert), „Neustart nötig“, ausstehende Updates, Podman-Version, IPv4/IPv6, PTR, belegte Ports,
  ausgehender Port 25, Uhrzeit; SSH-Anmeldungen aus journald als Ereignis.
  nach: Z-303, Z-204
  Fertig, wenn: die Fakten in der CI im Container gelesen werden, die Platzierung sie ohne Umweg
  nutzt und eine SSH-Anmeldung im Container ein Ereignis erzeugt (Test).
- [x] **Z-305 Aufträge** – Warteschlange in der Zentrale; der Agent holt, bestätigt, meldet
  Fortschritt und Ergebnis; idempotent über die ID; Aufträge können auf andere warten, auch über
  Installationen hinweg; der Agent führt nur Befehle aus Manifesten mit gültiger Signatur aus,
  Argumente nach Schema; Zeitlimit je Aktion.
  Fertig, wenn: ein doppelt zugestellter Auftrag einmal ausgeführt wird, ein Auftrag mit nicht
  signiertem oder verändertem Manifest vom Agenten abgelehnt wird (Test), ein wartender Auftrag erst
  nach dem Ende seines Vorgängers startet und ein Auftrag nach Neustart des Agenten fortgesetzt oder
  als gescheitert gemeldet wird; dazu (Tests): eine Aktion, die kein Befehl des Manifests ist, und
  Argumente gegen das Schema des Befehls werden abgelehnt, ohne dass etwas startet; ein Befehl über
  seinem Zeitlimit wird beendet und gescheitert gemeldet; ein wartender Auftrag startet auch über
  Server hinweg erst nach seinem Vorgänger und wird abgebrochen, wenn der scheitert; Zyklen und
  Vorgänger eines anderen Betreibers werden abgelehnt, und kein Betreiber und kein Agent erreicht
  Aufträge eines anderen; ein Auftrag läuft über die Test-Pforte durch Zentrale und Agent.

## Phase 4 – Installationen

- [x] **Z-401 Pforte** – Caddy rootless unter `sz-pforte` mit `Network=host`, Admin-API nur auf
  localhost; Adressen hinzufügen und entfernen ohne Neustart; WebSocket, SSE, Upload-Grenze und
  Timeout aus dem Manifest.
  nach: Z-305, Z-202, Z-205
  Fertig, wenn: in der CI zwei Installationen der Beispiel-App unter zwei Hostnamen erreichbar sind
  (lokale CA statt Let's Encrypt), die echte Client-IP im Header `X-Forwarded-For` bei der App
  ankommt (Test), Installation A den
  Port von B nicht direkt erreicht (Test) und das Entfernen einer die andere nicht unterbricht.
  Dazu: die Admin-API ist nur über einen Unix-Socket erreichbar, ein vom Client gesendeter
  `X-Forwarded-For` kommt nicht an (Test), die Upload-Grenze des Manifests gilt (413, Test), die
  Unit der Pforte besteht den Quadlet-Generator von Podman 4.9 (Test), das Entfernen unterbricht
  weder eine laufende Verbindung noch neue Anfragen an die andere und Caddy startet dabei nicht neu
  (Test), und Pforte-Aufträge mit falschem Host, Port oder Manifest lehnen Zentrale und Agent ab
  (Test); `install.sh` legt `sz-pforte` mit Linger an (CI, Job `server`).
- [x] **Z-402 Installieren** – Dialog mit Kunde, App, Server, Optionen und Einstellungen nach Ebenen,
  Platzierung live; der Agent legt `sz-<installation>` mit Linger an, schreibt Units und Secrets,
  zieht Images, führt `schritte.einrichten` aus, startet; ebenso schreibt und startet er die Unit der
  Pforte unter `sz-pforte` (`pforteUnit`, Z-401) und setzt ihre Route mit `pforte_route_setzen`. Entfernt wird hier nur eine Installation,
  deren Einrichtung gescheitert ist; Entfernen mit Daten kommt mit Z-604 (erst Backup).
  nach: Z-401, Z-204, Z-801
  Fertig, wenn: die Beispiel-App in der CI per Auftrag installiert wird, ein Fehler im
  Einrichtungsschritt nichts halb Installiertes zurücklässt, eine Installation die Dateien einer
  anderen nicht lesen kann (Test) und der Ablauf in Playwright läuft; dazu (Tests): der Agent rendert
  die Units selbst aus dem signierten Manifest und lehnt einen Einrichtungsauftrag mit verändertem
  Manifest, ungültigem Namen (auch `pforte`), Port außerhalb 1024–65535 oder unbekannter Option ab,
  ohne etwas anzulegen; kein Geheimnis steht im Klartext in der Datenbank, im Audit-Log oder in
  einer API-Antwort; ein doppelt zugestellter Einrichtungsauftrag richtet einmal ein; einen Nutzer
  `sz-<name>`, den der Agent nicht angelegt hat, fasst er nicht an; `installation_entfernen` wird
  für eine fertig eingerichtete Installation abgelehnt; zwei Installationen bekommen auf einem Server
  nie denselben Port oder Namen; die Route der Pforte wird erst gesetzt, wenn die Einrichtung
  gelungen ist; kein Betreiber erreicht Installationen eines anderen (Test je Endpunkt).
- [x] **Z-403 Health und Zustand** – Health nach Art aus dem Manifest, dazu der Zustand der
  systemd-Units; grün, gelb, rot oder unbekannt mit Grund und Verlauf; Störung nach plan.md.
  Fertig, wenn: die kaputte Beispiel-App rot wird, eine beendete Unit gelb, eine App mit
  `health: keine` nur nach Units bewertet wird und 5 Minuten Rot ein Ereignis „Störung“ erzeugen;
  dazu (Tests): Health `http`, `tcp` und `befehl` prüfen nur das Ziel aus dem signierten Manifest
  (kein Ziel aus der Zentrale), `befehl` läuft als Nutzer der Installation mit Zeitlimit; ohne
  Meldung seit 90 s ist eine Installation unbekannt, nie grün; nach einer Störung erzeugt Grün
  einmal „Störung behoben“; der Verlauf hält jeden Wechsel mit Grund; eine Meldung für eine
  Installation eines anderen Servers oder Betreibers ändert nichts; die Installationsseite zeigt
  Zustand, Grund und Verlauf (Playwright).
- [x] **Z-404 Einstellungen** – Ebenen aus dem Manifest; Formular aus dem Schema (keine App fest
  eingebaut); Änderung erzeugt den Auftrag „neu konfigurieren“; Geheimnisse nie zurück an die
  Oberfläche.
  Fertig, wenn: das Formular für jedes der acht Manifeste ohne App-spezifischen Code entsteht
  (Test), ein fehlender Pflichtwert des Betreibers die Installation blockiert, und kein Geheimnis in
  einer API-Antwort steht (Test); dazu (Tests): ein Wert gegen das Schema (Typ, Pflicht, Ebene,
  unbekannter Name) wird abgelehnt; ein leeres geheimes Feld behält den alten Wert; „neu
  konfigurieren“ wird in einer Sperrzeit und bei einem offenen Auftrag der Installation abgelehnt;
  der Agent konfiguriert nur eine fertig eingerichtete Installation neu, behält ihre Daten (Volume)
  und stellt bei einem Fehler den alten Stand wieder her (CI gegen Podman); kein Betreiber erreicht
  die Einstellungen eines anderen (Test je Endpunkt); Werte des Betreibers im Dialog und neu
  konfigurieren in Playwright.
- [x] **Z-405 Neustart, Logs, nur lesen** – Aktionen Neustart, Log-Auszug (letzte 500 Zeilen aus
  journald, Werte der Secrets ersetzt), nur lesen, wenn das Manifest sie anbietet; jede mit Grund.
  Fertig, wenn: eine nicht angebotene Aktion in der Oberfläche fehlt und vom Agenten abgelehnt wird
  und der Wert eines Secrets im Log-Auszug ersetzt ist; dazu (Tests): auch ein erzeugter Wert der
  Ebene `auto` ist im Log-Auszug ersetzt (CI gegen Podman mit einer App, die ihn ausgibt); ein
  Neustart wird in einer Sperrzeit und bei offenem Auftrag abgelehnt und in einer Sperrzeit nicht
  zugestellt; jede Aktion ohne Grund wird abgelehnt und steht mit Grund im Audit-Log; kein
  Betreiber erreicht Aktionen oder Log-Auszüge eines anderen (Test je Endpunkt); Neustart und
  Log-Auszug in Playwright.
- [x] **Z-406 Übersicht und echte Daten** – Übersicht, Server, Server-Detail, Installationen,
  Installation, Aufträge, Ereignisse, Audit-Log und Einstellungen mit echten Daten statt Demodaten;
  die Kundenseite zeigt ihre Installationen; Übersicht mit allem, was Aufmerksamkeit braucht, nach
  Schwere. Spätere Punkte stellen ihre Seite (Backups, Updates, Support-Zugänge, Leistungen) selbst
  auf echte Daten um.
  Fertig, wenn: die E2E-Fälle dieser Seiten gegen Zentrale und Agent laufen; dazu (Tests): jede
  neue lesende Route zeigt keinem Betreiber Daten eines anderen und prüft die Rollen (Audit-Log nur
  Inhaber und Technik); die Übersicht ordnet nach Schwere und verweist auf die Ursache (auch der
  E2E-Fall „von der Übersicht zur Ursache“ wieder mit einer echten Installation statt „Nicht
  gefunden“); seitenweises Lesen liefert jede Zeile genau einmal; angemeldet erscheint nirgends
  ein Demodatum.
- [x] **Z-407 Adressen und DNS** – Adresse `<app>.<kunde>.<domain>`; die Zentrale setzt A und AAAA
  über die Cloudflare-API und entfernt sie mit der Installation.
  nach: Z-402
  Fertig, wenn: in der CI gegen eine nachgebaute Cloudflare-API eine Installation ihren Eintrag
  bekommt und beim Entfernen verliert und kein Server einen DNS-Token erhält (Test); dazu (Tests):
  der Token steht nur verschlüsselt in der Datenbank und in keiner API-Antwort, keinem Log und
  keiner Nachricht an einen Agenten; ein Eintrag ohne den Kommentar der Zentrale wird nie geändert
  oder gelöscht; ein Fehler der API erzeugt `dns_fehler` und einen späteren erfolgreichen Versuch;
  ein Host außerhalb der Domain bekommt keinen Eintrag; ein Kürzel ist je Betreiber eindeutig und
  unter einer laufenden Installation nicht änderbar; kein Betreiber erreicht Kürzel oder
  DNS-Einstellungen eines anderen (Test je Endpunkt).

## Phase 5 – Backups und Wiederherstellen

- [x] **Z-601 Backups** – Teile aus dem Manifest (`pg_dump`, `volume`, `befehl`); ein
  restic-Repository mit eigenem Passwort je Installation auf dem S3-Ziel des Betreibers, mit einem
  S3-Zugang, der nur das Präfix dieser Installation erreicht; Zeitplan als systemd-Timer des Nutzers;
  Aufbewahrung nach plan.md.
  nach: Z-406
  Fertig, wenn: in der CI ein Backup aus zwei Teilen in MinIO landet, der S3-Zugang einer Installation
  das Präfix einer anderen weder lesen noch löschen kann (MinIO-Policy, Test), die Aufbewahrung alte
  Snapshots löscht, ein Backup bei getrennter Zentrale trotzdem läuft und ein gescheitertes Backup
  ein Ereignis erzeugt; dazu (Tests): der Admin-Zugang des S3-Ziels und das restic-Passwort stehen
  nur verschlüsselt in der Datenbank und in keiner API-Antwort oder keinem Log, ein Server bekommt
  nur Zugang und Passwort seiner eigenen Installationen; ein Teil `pg_dump` und ein Teil `befehl`
  landen als eigene Snapshots im Repository (CI gegen MinIO und Podman); `backup.json` gehört dem
  Nutzer mit 0600; der Zugang einer entfernten Installation ist gelöscht; „Backup jetzt“ in
  Playwright; kein Betreiber erreicht Backups oder S3-Ziel eines anderen (Test je Endpunkt).
- [x] **Z-602 Prüf-Restore** – wöchentlich je Installation unter einem Wegwerf-Nutzer
  `sz-restore-*` auf einem Server, den die Platzierung als passend meldet; Health prüfen, entfernen.
  Fertig, wenn: ein absichtlich beschädigtes Backup als „Prüf-Restore gescheitert“ erscheint und ein
  Server ohne Platz nicht für den Prüf-Restore gewählt wird; dazu (Tests): ein gutes Backup ergibt in
  der CI gegen Podman und MinIO einen gelungenen Prüf-Restore, in dem die Daten des Snapshots stehen
  (Eintrag der Beispiel-App über HTTP gelesen), und danach gibt es weder Nutzer noch Home, Units,
  Volumes oder Container der Kopie, auch nach einem Fehler; die Original-Installation läuft dabei
  unverändert weiter; nie bekommt ein anderer Server den Backup-Zugang einer Installation; der
  Zeitplan legt höchstens einen Prüf-Restore je Installation und Woche an; die Seite der
  Installation zeigt den letzten Prüf-Restore (Playwright); kein Betreiber erreicht Prüf-Restores
  eines anderen (Test je Endpunkt).
- [x] **Z-603 Wiederherstellen** – Snapshot wählen, Grund angeben, vorher Backup vom Ist-Zustand;
  Ablauf je Backup-Art in der Zentrale (bei `pg_dump`: App-Container stoppen, `pg_restore --clean
  --if-exists` mit `datenbank` und `nutzer` aus dem Manifest, App starten, Health; bei `volume`: Units
  stoppen, Volume ersetzen, starten).
  Fertig, wenn: die Daten nach dem Wiederherstellen dem Snapshot entsprechen (Test je Art) und der
  Vorgang im Audit-Log steht; dazu (Tests): in der CI gegen Podman und MinIO kehren nach einem
  Wiederherstellen die Daten eines älteren Laufs zurück und spätere Änderungen sind weg (Volume der
  Beispiel-App über HTTP gelesen; `pg_dump` mit einem Postgres-Container); vor dem Wiederherstellen
  entsteht ein Backup vom Ist-Zustand, scheitert es, wird nichts zurückgespielt; ein Lauf einer
  anderen Installation wird abgelehnt; nach einem Fehler laufen die Units wieder; ein Zeitlimit lässt
  keinen Prozess des Zurückspielens übrig; kein Betreiber erreicht das Wiederherstellen eines
  anderen (Test je Endpunkt); Snapshot wählen und Wiederherstellen in Playwright.

## Phase 6 – Updates

- [x] **Z-501 Versionen und Manifeste** – die Zentrale fragt die Registries nach Tags (Semver) und
  zeigt „neue Version, Manifest fehlt“, bis ein signiertes Manifest dieser Version importiert ist
  (Upload in der Oberfläche oder `zentrale manifest importieren <pfad>`); Vorabversionen nur für die
  Welle „intern“; Markierung `dringend` im Manifest.
  nach: Z-406
  Fertig, wenn: gegen die lokale Registry eine neue Version erkannt wird, ein Manifest ohne gültige
  Signatur beim Import abgelehnt wird und eine Vorabversion nur intern erscheint; dazu (Tests):
  Import über die Oberfläche und über den Befehl; ein zweiter Import derselben Version mit anderem
  Inhalt wird abgelehnt; der Dialog „App installieren“ installiert aus einem importierten Manifest
  (Playwright); nur Inhaber und Technik importieren, nur Inhaber markieren einen Kunden als intern
  (Test je Route); ein Fehler der Registry erzeugt ein Ereignis; „dringend“ steht an der Version.
- [x] **Z-502 Wellen und Sperrzeiten** – reine Funktion in `packages/planung`: Installationen,
  Sperrzeiten, Wartungsfenster, Zeitpunkt → Plan. Zwei Wellen: „intern“ (unsere eigenen
  Installationen) und „alle“, 24 h nach „intern“ ohne Störung; „intern“ ohne eigene Installation
  wartet auf Freigabe; `dringend` läuft sofort durch beide Wellen, eine Sperrzeit übergeht nur der
  Inhaber mit Grund.
  nach: Z-101
  Fertig, wenn: Tests Sperrzeiten über den Monatswechsel, Zeitumstellung, Wartungsfenster über
  Mitternacht, eine gestoppte Welle nach einer Störung und ein dringendes Update abdecken und Haben
  nie zwischen dem 7. und 12. aktualisiert wird, außer mit Freigabe.
- [x] **Z-503 Update mit Rückkehr** – Backup, Pull per Digest, `schritte.nach_update`, Neustart,
  Health; bei Rot zurück auf die alte Version und das Backup; Welle anhalten; Ereignis; Apps mit
  `health: keine` nur von Hand.
  nach: Z-501, Z-502, Z-603
  Fertig, wenn: in der CI die Beispiel-App von Version 1 auf 2 kommt, die kaputte Version
  automatisch zurückgenommen wird, mit den Daten von vorher, und eine App ohne Health in keiner
  Welle automatisch aktualisiert wird; dazu (Tests): vor jedem Update entsteht ein Backup, scheitert
  es, wird nicht aktualisiert; `schritte.nach_update` laufen; nach einer Rücknahme ist die Welle
  angehalten und ein Ereignis da; kein automatisches Update in einer Sperrzeit oder außerhalb des
  Wartungsfensters, ein dringendes sofort; höchstens ein Update je Server zugleich; ein Update von
  Hand mit Grund (Playwright); kein Betreiber erreicht Updates eines anderen (Test je Endpunkt).
- [x] **Z-504 Updates des Agenten** – Agent lädt neue Version, prüft Prüfsumme und minisign-Signatur,
  startet sich im Wartungsfenster neu; die Zentrale versteht `n-1`.
  Fertig, wenn: ein Agent in der CI sich aktualisiert und eine falsche Signatur abgelehnt wird
  (Incus-VM: der neue Agent läuft, meldet sich mit der neuen Version, das alte Binary liegt daneben;
  bei der falschen Signatur läuft der alte weiter und die Zentrale hat ein Ereignis); dazu (Tests):
  Signatur eines fremden Schlüssels, falsche Prüfsumme, fehlende Zeile in `SHA256SUMS`, eine nicht
  neuere Version und der Test-Schlüssel außerhalb des Testmodus werden abgelehnt, ohne etwas zu
  ersetzen; die feste Form des Auftrags (keine Adresse, keine Installation) prüfen Zentrale und Agent;
  geplant nur im Wartungsfenster des Servers, nie neben einem offenen Auftrag, je Version höchstens
  ein Versuch am Tag; ein neuer Agent, der seine Zentrale nicht erreicht, wird vom alten ersetzt; die
  Zentrale liest die eingefrorenen Beispiele der vorigen Protokollversion und schreibt einem Agenten
  in dessen Version.

## Phase 7 – Server-Pflege, Kündigung, Support, Release

- [x] **Z-701 Betriebssystem** – Status von unattended-upgrades, ausstehende Pakete, „Neustart
  nötig“; Neustart als Auftrag im Wartungsfenster außerhalb aller Sperrzeiten der Apps auf dem
  Server.
  nach: Z-305, Z-502
  Fertig, wenn: die Planung den Neustart verschiebt, wenn eine Sperrzeit läuft, und ein Neustart in
  einer Incus-VM der CI ausgeführt und der Server danach wieder verbunden ist; dazu (Tests): Status
  von unattended-upgrades, ausstehende Pakete, „Neustart nötig“ und Boot-ID kommen mit den Fakten und
  stehen auf der Serverseite; vor dem Neustart ein Backup jeder laufenden Installation des Servers,
  scheitert eines, kein Neustart; nur im Wartungsfenster (Zeitumstellung), nie neben einem offenen
  Auftrag des Servers, höchstens einer am Tag; die feste Form des Auftrags prüfen Zentrale und
  Agent, und der Agent startet für einen Auftrag nie zweimal neu (Boot-ID); erfolgreich erst, wenn
  sich der Agent mit einer neuen Boot-ID meldet; ein Neustart von Hand mit Grund (Playwright), nie in
  einer Sperrzeit; kein Betreiber erreicht Neustarts eines anderen (Test je Endpunkt).
- [x] **Z-702 Prüfungen** – Platte über 80/90 %, Zertifikat in 14 Tagen, Backup älter als 26 h,
  Port offen, der in keinem Manifest steht, Uhrzeit.
  nach: Z-601, Z-401
  Fertig, wenn: jede Prüfung einen Test mit Grenzfall hat und ihr Ergebnis in der Übersicht steht;
  ein Befund ein Ereignis bei Beginn und Behebung erzeugt, nicht bei jedem Lauf, und kein Betreiber
  die Prüfungen eines anderen sieht (Test).
- [ ] **Z-703 Benachrichtigungen und Webhooks** – Ereignisse nach Schwere per Mail (SMTP) und
  Webhook; Webhooks signiert (HMAC) und mit Wiederholung, dieselbe Zustellung nutzt später das
  Portal (Z-903); Ruhezeiten; eine Meldung je Störung, nicht je Prüfung.
  Fertig, wenn: eine Störung, die 10 Prüfungen lang besteht, eine Mail erzeugt (Mailpit) und ihre
  Behebung eine zweite, eine gefälschte Signatur im Test-Empfänger auffällt und eine Zustellung nach
  Ausfall des Empfängers wiederholt wird.
- [ ] **Z-704 Überwachung von außen und Verfügbarkeit** – die Zentrale prüft jede öffentliche Adresse
  (DNS, Zertifikat, Pforte, Health) unabhängig vom Agenten; Verfügbarkeit je Installation und Monat;
  `/health` der Zentrale für einen externen Prüfdienst.
  nach: Z-407
  Fertig, wenn: „Agent grün, außen rot“ ein Ereignis erzeugt und die Verfügbarkeit aus einer
  Testreihe mit bekannten Ausfällen richtig berechnet wird (Test).
- [ ] **Z-604 Kündigung und Löschung** – Vertragsende, 30 Tage nur lesen (wenn angeboten) und Export
  bzw. letztes Backup für den Kunden als zeitlich begrenzter, vorsignierter S3-Link, den die
  Oberfläche dem Betreiber zeigt; Löschung von Installation, Repository, S3-Zugang und
  DNS-Einträgen 90 Tage nach Vertragsende, vorher ein letztes Backup; Löschprotokoll als Ereignis und
  signierter Webhook (Z-703).
  nach: Z-801, Z-603, Z-703
  Fertig, wenn: der Ablauf mit der Beispiel-App in Playwright läuft, vor Ablauf der Frist nichts
  gelöscht wird, der Link nach seiner Frist abgelehnt wird und nach der Löschung weder Repository
  noch DNS-Eintrag noch Linux-Nutzer existieren (Test).
- [x] **Z-802 Support-Zugang** – zeitlich begrenzt (Vorgabe 2 h), mit Grund; erlaubt Log-Auszug,
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
- [x] **Z-1003 Echte Apps** – Schreibzeug und Haben aus `manifeste/` in der CI installieren, sichern
  und wiederherstellen; Schreibzeug zusätzlich in einer Welle aktualisieren; Haben (ohne Health) von
  Hand mit Grund von einer auf die nächste Version aktualisieren, bewertet nach Units. Als
  Hersteller-ID des Betreibers der Testwert `74931` (Haben, `packages/elster/src/xml.ts`). Images von
  GHCR.
  nach: Z-503, Z-603
  Fertig, wenn: der Lauf grün ist.
- [ ] **Z-1004 Release-Kandidat** – Image der Zentrale (amd64, arm64) mit Quadlet-Units und
  Agent-Binaries mit Prüfsummen, in der CI mit dem Test-Schlüssel signiert, nur als Workflow-Artefakt
  und in der lokalen Registry; `docs/installation.md` mit Ein-Server-Betrieb. Echte Signatur, Tag und
  Push macht ein Mensch (Schritte für Menschen).
  nach: alle anderen Punkte der Stufe 1; steht ein Punkt der Stufe 1 unter „Zurückgestellt“, wartet
  Z-1004.
  Fertig, wenn: ein Release-Kandidat in der CI entsteht und sich nach der Doku in einer Incus-VM
  installieren lässt.

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
- [ ] **Z-903 Webhooks für das Portal** – Ereignisse installiert, Wartung geplant, Störung, behoben,
  gekündigt, gelöscht (mit Löschprotokoll) an das Portal, über die signierte Zustellung mit
  Wiederholung aus Z-703.
  Fertig, wenn: jedes dieser Ereignisse beim Test-Empfänger ankommt und ein Portal nur die
  Ereignisse seiner Kunden bekommt (Test).
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

## Übergabe

Was eine Session offen hinterlassen hat und die nächste zuerst erledigt (Schritt 0). Erledigtes wird
hier gestrichen.

## Zurückgestellt

## Schritte für Menschen

Nicht auf dem Weg des Loops.

- Name und Domain der Steuerzentrale; Zone bei Cloudflare, API-Token nur für die Zentrale.
- Server für die Zentrale (netcup), WireGuard, S3-Ziel für Backups, Mail-Versand, externer Prüfdienst
  für `/health` der Zentrale.
- Vor dem Start des Loops: `main` aus `claude/startdateien` anlegen und als Standard-Branch setzen;
  Repo öffentlich; Ruleset auf `main` (nur per Pull Request, Checks `check` und `pr-regeln` Pflicht,
  nur Squash); Pages-Quelle „GitHub Actions“.
- Für die Loop-Sessions: Push auf `Speicherstadt/steuerzentrale`, Lesen auf die App-Repos und
  `firsttris/workflows`, Netz zu `registry-1.docker.io` und `ghcr.io`; Git-Identität des Maintainers
  für `Signed-off-by` (plan.md, „DCO“).
- Signierschlüssel (minisign) erzeugen, offline aufbewahren; Manifeste der Apps (Z-203) und jedes
  Release signieren.
- Release (nach Z-1004): Ziel-Registry und Image-Name bestätigen (plan.md), Secret für den Push, Tag
  setzen, mit dem echten Schlüssel signieren, veröffentlichen.
- Je App eine eigene interne Installation für die Welle „intern“.
- Betreiber-Vertrag in den App-Repos: Health ohne Anmeldung, nur lesen, Export, Einrichtungsbefehl
  (Haben#945–#948, #1307; für die anderen Apps noch anzulegen); Images für Kennwort und Soll, für
  Belegt (app, worker, ftp; noch kein veröffentlichtes Image, Stand Z-203) und ein Release-Image
  von Fixpunkt (bisher nur `edge`): ohne sie sind diese Apps nicht installierbar (Z-1003, Stufe 1).
- OIDC in Stellwerk (stellwerk#36) und Fixpunkt (fixpunkt#5).
- Auftragsverarbeitungsvertrag mit TOMs aus `docs/sicherheit.md`, SLA-Texte, Preise, Ticket-System.
- Erster eigener Server mit unseren Installationen, dann Pilotkunden.
- Repo für das Portal, sobald Phase 9 fertig ist.
- Später: Server bei netcup und Hetzner über deren API bestellen; eigener Relay-Tunnel für Server
  beim Kunden ohne Portweiterleitung; Archivbetrieb nach Kündigung.
