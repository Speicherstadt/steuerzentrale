# Bauliste

Die Liste, die der Agenten-Loop abarbeitet, in der Reihenfolge der Bauphasen aus dem
[Projektplan](docs/plan.md). Sie hat zwei Stufen:

- **Stufe 1 – eigener Betrieb** (Phasen 1 bis 7): genug, um die ersten zehn Kunden mit Haben,
  Belegt, Schreibzeug und Fixpunkt auf unseren Servern zu betreiben. Mit dem letzten Punkt der
  Stufe 1 erscheint die Steuerzentrale 1.0.
- **Stufe 2 – Zuschnitt auf den eigenen Betrieb** (Phasen 8 und 9): anbinden und überwachen, was
  schon läuft, und ausbauen, was ein einzelner Betreiber nicht braucht (Leistungen, SLA,
  Support-Zugänge, die dritte Rolle, Server-Art, Betriebsart, Grund, weitere Betreiber). Der Loop
  beginnt Stufe 2 erst, wenn ein Mensch die Zeile „Stufe 2 freigegeben“ unten abhakt; bis dahin
  endet er nach Stufe 1.

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
- [x] **Z-703 Benachrichtigungen und Webhooks** – Ereignisse nach Schwere per Mail (SMTP) und
  Webhook; Webhooks signiert (HMAC) und mit Wiederholung, dieselbe Zustellung nutzt später das
  Portal (Z-903); Ruhezeiten; eine Meldung je Störung, nicht je Prüfung.
  Fertig, wenn: eine Störung, die 10 Prüfungen lang besteht, eine Mail erzeugt (Mailpit) und ihre
  Behebung eine zweite, eine gefälschte Signatur im Test-Empfänger auffällt und eine Zustellung nach
  Ausfall des Empfängers wiederholt wird.
- [x] **Z-704 Überwachung von außen und Verfügbarkeit** – die Zentrale prüft jede öffentliche Adresse
  (DNS, Zertifikat, Pforte, Health) unabhängig vom Agenten; Verfügbarkeit je Installation und Monat;
  `/health` der Zentrale für einen externen Prüfdienst.
  nach: Z-407
  Fertig, wenn: „Agent grün, außen rot“ ein Ereignis erzeugt und die Verfügbarkeit aus einer
  Testreihe mit bekannten Ausfällen richtig berechnet wird (Test); dazu (Tests): 5 Minuten rot
  von außen sind eine Störung, die erst grün innen und außen beendet; Monate in `Europe/Berlin` über
  Monatsende und Zeitumstellung; kein Betreiber sieht die Prüfungen eines anderen; `/health` antwortet
  503, wenn die Datenbank nicht antwortet; kein Test fragt einen echten Nameserver.
- [x] **Z-604 Kündigung und Löschung** – Vertragsende, 30 Tage nur lesen (wenn angeboten) und Export
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
- [x] **Z-804 Leistungen** – je Kunde und Monat: Installationen, Speicher, Support-Zeit,
  Verfügbarkeit; Export als CSV.
  nach: Z-704
  Fertig, wenn: die Summen aus den Ereignissen berechnet werden (Test) und der Export gültiges CSV
  nach RFC 4180 ist.
- [x] **Z-1001 Sicherheitsprüfung** – `docs/sicherheit.md`: Bedrohungsmodell, Notzugang per SSH,
  TOMs nach Art. 32 DSGVO als Anlage zum Auftragsverarbeitungsvertrag.
  nach: Z-804
  Fertig, wenn: jede Bedrohung einen Test oder eine begründete Annahme hat, darunter: eine Zentrale
  mit fremdem Manifest bringt keinen Code auf einen Server (Test), ein gestohlenes Agent-Zertifikat
  erzeugt keine Aufträge (Test), Rate-Limits an Anmeldung und Token-Tausch greifen (Test).
- [x] **Z-1002 Zentrale sichern** – Backup der Zentrale (Datenbank und Schlüssel getrennt),
  Wiederherstellung auf einem neuen Server, Agenten verbinden sich wieder.
  Fertig, wenn: der Ablauf in der CI durchläuft.
- [x] **Z-1003 Echte Apps** – Schreibzeug und Haben aus `manifeste/` in der CI installieren, sichern
  und wiederherstellen; Schreibzeug zusätzlich in einer Welle aktualisieren; Haben (ohne Health) von
  Hand mit Grund von einer auf die nächste Version aktualisieren, bewertet nach Units. Als
  Hersteller-ID des Betreibers der Testwert `74931` (Haben, `packages/elster/src/xml.ts`). Images von
  GHCR.
  nach: Z-503, Z-603
  Fertig, wenn: der Lauf grün ist.
- [x] **Z-1004 Release-Kandidat** – Image der Zentrale (amd64, arm64) mit Quadlet-Units und
  Agent-Binaries mit Prüfsummen, in der CI mit dem Test-Schlüssel signiert, nur als Workflow-Artefakt
  und in der lokalen Registry; `docs/installation.md` mit Ein-Server-Betrieb. Echte Signatur, Tag und
  Push macht ein Mensch (Schritte für Menschen).
  nach: alle anderen Punkte der Stufe 1; steht ein Punkt der Stufe 1 unter „Zurückgestellt“, wartet
  Z-1004.
  Fertig, wenn: ein Release-Kandidat in der CI entsteht und sich nach der Doku in einer Incus-VM
  installieren lässt.
- [x] **Z-805 Betriebsart: nur für mich oder für Kunden** – nach dem ersten Inhaber fragt die
  Zentrale einmal: „Nur für mich“ (eigene Apps auf eigenen Servern) oder „Für Kunden“ (Hosting für
  andere). Inhaber kann es unter Einstellungen mit Grund ändern. „Nur für mich“ blendet Kunden,
  Verträge, Kündigung, Support-Zugänge und Leistungen in Menü, Übersicht und Dialogen aus; „App
  installieren“ fragt keinen Kunden, alle Installationen gehören einem festen internen Kunden des
  Betreibers (`kunden.intern`), also eine einzige Welle. Datenmodell und API bleiben gleich, nur die
  Oberfläche und die Zentrale (die ausgeblendeten Endpunkte antworten `409 betriebsart`) richten
  sich danach. Partner (Z-803) bleiben außen vor.
  nach: Z-1004
  Fertig, wenn: die Frage nach dem ersten Inhaber kommt und ohne Antwort wiederkommt (Playwright);
  „Nur für mich“ zeigt im Menü weder Kunden noch Support-Zugänge noch Leistungen und installiert eine
  App ohne Kundenauswahl (Playwright, Desktop und `@phone`); der Wechsel zu „Für Kunden“ und zurück
  verliert keine Installation und steht mit Grund im Audit-Log (Test); nur Inhaber darf wechseln
  (Test je Rolle); ein Betreiber mit Installationen fremder Kunden kann nicht auf „Nur für mich“
  wechseln (`409`, Test); die Demo zeigt beide Arten (Umschalter in den Einstellungen).

# Stufe 2 – Zuschnitt auf den eigenen Betrieb

Die Steuerzentrale ist unser eigenes Werkzeug: ein Betreiber, eigene Server, vor allem überwachen.
Stufe 2 bindet an, was schon läuft, und baut aus, was nur ein Hoster mit Team, Partnern und SLA
braucht ([Projektplan](docs/plan.md), „Zuschnitt“). Die früheren Punkte der Stufe 2 (Partner Z-803,
Kontext mit Mail und Single Sign-on Z-409 und Z-408, API und Webhooks für das Portal Z-901 bis
Z-904, Wellen nach SLA Z-505, Umzug und Ausfall Z-605 und Z-606) sind gestrichen; was davon
wiederkommen kann, steht unter „Später, bei Bedarf“.

- [x] **Stufe 2 freigegeben** – hakt ein Mensch ab; bis dahin beginnt der Loop keinen Punkt dieser
  Stufe.

Für jeden Punkt dieser Stufe gilt:

- **Neues fragt keinen Grund** (er fällt mit Z-1207 weg) und kennt nur die Rechte von Inhaber und
  Mitglied (Z-1204): schreiben darf der Inhaber, lesen beide.
- **Ein Ausbau nimmt alles mit**: Code, Routen, Tabellen und Spalten (mit einer neuen Migration, nie
  einer geänderten), Texte in `messages/`, die Seite in `docs/`, die Zeile im README, die Demodaten.
  Die Tests des entfernten Verhaltens gehen mit ihm; jeder andere Test bleibt und bleibt grün.
- **Die Demo bleibt** und zeigt nach jedem Punkt den neuen Stand.
- **Sicherheitsrelevant** (unabhängiges Review vor dem Merge, Schritt 5 oben) ist, wo es am Punkt
  steht.

Phase 8 und Phase 9 hängen nicht voneinander ab und laufen parallel.

## Phase 8 – Bestehendes überwachen

- [x] **Z-1101 Beobachtete Dienste** – ein Dienst, den die Zentrale nicht installiert hat: Name,
  Adresse (`https://…`), Pfad der Health-Prüfung (Vorgabe `/`), auf Wunsch ein Kunde. Die Zentrale
  prüft ihn jede Minute von außen wie eine Installation (DNS, Zertifikat, Verbindung, Health;
  Z-704), mit denselben Ereignissen, derselben Störung nach 5 Minuten und derselben Verfügbarkeit.
  Mit den Adressen eines Servers vergleicht sie seine Einträge nicht: der Dienst darf hinter
  Cloudflare liegen. Er steht in der Übersicht und auf der Seite Apps als „beobachtet“, ohne Version,
  Backup, Update und Aktionen. Kein Agent, kein Manifest.
  nach: Z-704
  Fertig, wenn: ein beobachteter Dienst gegen den Test-Server grün wird, nach zwei roten Prüfungen
  `aussen_rot` und nach 5 Minuten `stoerung` schreibt (Test); ein Name, der auf eine nicht
  öffentliche Adresse auflöst, nie angefragt wird (Test); Anlegen, Ändern und Entfernen in Playwright
  laufen (Desktop und `@phone`); für ihn nie ein Auftrag an einen Agenten entsteht (Test).
  Geschärft: die Adresse ist nur `https://<host>` auf Port 443 (ohne Port, Pfad, Nutzer oder
  IP-Adresse; sonst `400`, Test); gesund heißt 200–399 wie der Health-Pfad einer Installation
  (Test); Ereignisse und Störung tragen das Ziel `dienst:<id>` und gehen wie jedes Ereignis an die
  Empfänger (Test); ein entfernter Dienst wird nicht mehr geprüft, seine Messwerte und Ereignisse
  bleiben bis zur Aufbewahrungsfrist (Test); kein Betreiber sieht oder ändert den Dienst eines
  anderen (Test je Endpunkt); schreiben darf nur der Inhaber (Test je Rolle).
- [x] **Z-1102 Server nur beobachten** – `install.sh --nur-beobachten` für einen Server, auf dem
  schon etwas läuft: nur der Agent kommt dazu. Kein Podman, keine Pforte, kein Nutzer `sz-pforte`,
  kein `ip_unprivileged_port_start`, keine Delegation der cgroup-Controller, keine Änderung an
  unattended-upgrades. Der Agent meldet Heartbeat, Fakten, Prüfungen (Z-702) und SSH-Anmeldungen. Den
  Modus hält der Agent lokal, von `install.sh` gesetzt; die Zentrale kann ihn nicht aufheben. Die
  Zentrale stellt für einen solchen Server keinen Auftrag aus, der etwas ändert (einrichten, Update,
  Backup, Wiederherstellen, Neustart, Betriebssystem, Update des Agenten ausgenommen), der Agent
  lehnt jeden solchen ab, und die Platzierung lehnt den Server ab (`nur_beobachten`).
  nach: Z-304, Z-702
  Fertig, wenn: in der CI ein Server mit belegten Ports 80 und 443 beitritt und danach Pakete,
  sysctl, Linux-Nutzer und lauschende Ports dieselben sind wie davor (Test); der Agent im Modus
  jeden ändernden Auftrag ablehnt, auch wenn die Zentrale ihn schickt (Test je Auftragsart); die
  Platzierung ihn mit Grund ablehnt (Test); die Prüfung „offene Ports, die kein Manifest nennt“ auf
  ihm nichts meldet (Test).
  Geschärft: den Modus hält die Datei `/etc/steuerzentrale/nur-beobachten`; ein zweiter Lauf von
  `install.sh` ohne den Schalter behält ihn, ein schon verwalteter Server wird nicht umgestellt
  (Abbruch, nichts geändert, Test); `install.sh --nur-beobachten` installiert kein Paket und
  bricht ab, wenn `minisign`, `curl` oder `sha256sum` fehlen (Test); der Agent meldet den Modus mit
  den Fakten, und erlaubt ist ihm im Modus nur `agent_update` (Test je Auftragsart).
  Sicherheitsrelevant: `install.sh`, was der Agent ausführt.
- [ ] **Z-1103 Vorhandene Units beobachten** – zu einem beobachteten Dienst auf einem beobachteten
  Server nennt der Betreiber den Linux-Nutzer (oder das System), die systemd-Units und auf Wunsch
  Port und Pfad der Health-Prüfung auf `127.0.0.1`. Der Agent liest den Zustand der Units mit
  `systemctl show` und prüft Health wie bei einer Installation (Z-403); grün, gelb, rot oder
  unbekannt mit Grund nach denselben Regeln, innen und außen zusammen ergeben die Störung. Die Namen
  von Nutzer und Units prüfen Zentrale und Agent gegen ein Muster, sie stehen nie in einer
  Shell-Zeile; der Agent liest nur, er startet und stoppt nichts.
  nach: Z-1101, Z-1102
  Fertig, wenn: in der CI eine von Hand angelegte Quadlet-Unit unter einem fremden Linux-Nutzer grün
  erscheint, gestoppt rot mit Grund, und eine Unit, die es nicht gibt, unbekannt und nie grün
  (Test); ein Name mit Leerzeichen, `;`, `/` oder führendem `-` von Zentrale und Agent abgelehnt wird
  (Test); dafür kein Befehl außer `systemctl show` und der HTTP- oder TCP-Prüfung läuft (Test über
  die aufgezeichneten argv).
  Sicherheitsrelevant: was der Agent ausführt.
- [ ] **Z-1104 Oberfläche über Cloudflare Tunnel** – ein zweiter Weg neben WireGuard: Mit
  `STEUERZENTRALE_ACCESS_TEAM` und `STEUERZENTRALE_ACCESS_AUD` nimmt die Zentrale Oberfläche und API
  nur mit gültigem `Cf-Access-Jwt-Assertion` an (Signatur gegen die Schlüssel des Teams, Audience,
  Ablauf; Cloudflare-Doku „Validate JWTs“); die eigene Anmeldung mit zweitem Faktor bleibt dahinter.
  `steuerzentrale pforte --tunnel` setzt die Route der Oberfläche nur für Loopback (cloudflared auf
  demselben Server). `agent.<domain>` bleibt öffentlich und direkt: mTLS endet an der Pforte, ein
  Tunnel würde es bei Cloudflare beenden. Ohne die beiden Variablen gilt WireGuard wie bisher.
  Fertig, wenn: ein Aufruf ohne Token, mit falscher Signatur, mit falscher Audience oder nach Ablauf
  `403` bekommt (Test mit eigenem Schlüsselpaar); ein Aufruf mit gültigem Token und gefälschtem
  `X-SZ-Client-Fingerabdruck` keine Rechte eines Agenten bekommt (Test); die Schlüssel nur von
  `https://<team>.cloudflareaccess.com` kommen und bei unbekannter Schlüssel-ID einmal neu geladen
  werden (Test); `docs/installation.md` beide Wege beschreibt.
  Sicherheitsrelevant: Anmeldung, Pforte.
- [x] **Z-1105 Meldung aufs Handy** – Empfänger-Art `ntfy` neben Mail und Webhook: `POST` an die
  Adresse des Themas mit dem Text des Ereignisses, Titel und Priorität nach Schwere (ntfy-Doku,
  „Publishing“), das Zugriffstoken verschlüsselt; Ruhezeit und Wiederholung wie in Z-703.
  nach: Z-703
  Fertig, wenn: Störung und Behebung beim Test-Empfänger mit Titel und Priorität ankommen (Test), das
  Token in keiner Antwort und keinem Log steht (Test) und eine gescheiterte Zustellung wiederholt
  wird (Test).
  Geschärft: veröffentlicht wird als JSON an die Wurzel des ntfy-Servers (ntfy-Doku, „Publish as
  JSON“: `topic`, `title`, `message`, `priority`, `tags`); Priorität 5 für eine Störung, 4 für eine
  Warnung, 3 für Hinweis und Behebung (Test); die Adresse des Themas nur `https://`, an eine
  öffentliche Adresse wie ein Webhook (Test); das Token ist freiwillig (öffentliches Thema); das
  Anlegen fragt keinen Grund.
- [ ] **Z-1106 CPU und Arbeitsspeicher** – der Agent meldet mit den Fakten, was bisher nur die Demo
  zeigt: je Server CPU-Auslastung (aus `/proc/stat`, über die Zeit zwischen zwei Meldungen), Last
  (`/proc/loadavg`) und belegten Arbeitsspeicher (`MemTotal` minus `MemAvailable` aus
  `/proc/meminfo`); je Installation und je beobachtetem Dienst mit Linux-Nutzer dasselbe aus der
  cgroup seines Nutzers (`memory.current`, `cpu.stat` unter `user-<uid>.slice`). Er liest nur
  Dateien. Die Zentrale bewahrt die Werte 30 Tage auf wie die Platte; der Reiter „Auslastung“ des
  Servers und „Messwerte“ der App zeigen sie über 24 Stunden, 7 und 30 Tage, die Tabellen Server und
  Apps bekommen die Spalten. Eine Prüfung meldet Arbeitsspeicher über 90 % gelb, über 95 % rot
  (Z-702). Der Hinweis „noch ohne Punkt“ in `docs/uebersicht.md` entfällt.
  nach: Z-304, Z-702
  Fertig, wenn: die Werte aus festen Beispieldateien richtig berechnet werden, auch beim ersten
  Lauf ohne Vorwert und nach einem Neustart des Servers (Test); eine nicht lesbare Datei als
  unbekannt gemeldet wird, nie als 0 (Test); in der CI eine Installation, die Speicher belegt, mit
  einem höheren Wert erscheint als davor (Test); die Verläufe in Playwright stehen (Desktop und
  `@phone`) und die Demo dieselben Felder nutzt wie die API.

## Phase 9 – Ausbau

- [x] **Z-1201 Leistungen entfernen** – Seite, Reiter am Kunden, CSV-Export, Modul und Routen
  (Z-804). Die Verfügbarkeit je App und Monat bleibt an der App (Z-704).
  Fertig, wenn: die Routen der Leistungen `404` antworten (Test), kein Menüpunkt dorthin führt und
  die Verfügbarkeit an der App weiter steht (Playwright).
- [x] **Z-1202 SLA entfernen** – ein Vertrag hat Beginn und Ende, keine SLA: Spalte, Dialog,
  Kundenseite, API.
  Fertig, wenn: ein Vertrag ohne SLA angelegt wird (Test, Playwright), die Migration vorhandene
  Verträge behält (Test auf einer Datenbank mit Verträgen) und `sla` in keinem Schema der API mehr
  vorkommt (Test).
- [x] **Z-1203 Support-Zugänge entfernen** – Tabelle, Modul, Routen, Seiten und Ereignisse (Z-802).
  Log-Auszug und Neustart bleiben Aktionen der App.
  Fertig, wenn: die Routen der Support-Zugänge `404` antworten (Test) und Log-Auszug und Neustart
  ohne Zugang laufen (Playwright).
  Sicherheitsrelevant: Rechte.
- [x] **Z-1204 Zwei Rollen** – Inhaber und Mitglied statt Inhaber, Technik und Support. Der Inhaber
  darf alles. Ein Mitglied sieht alles und darf Neustart und Log-Auszug; es installiert, entfernt,
  kündigt und stellt nichts wieder her, ändert keine Einstellung und kein Geheimnis (DNS, S3,
  Benachrichtigungen, Werte des Betreibers) und lädt niemanden ein. Vorhandene Mitglieder der Rolle
  Technik werden Inhaber, die der Rolle Support Mitglied (Migration). Der letzte Inhaber lässt sich
  weiter nicht entfernen.
  nach: Z-1203
  Fertig, wenn: jede Route ohne Anmeldung weiter `401` antwortet und jede Route in beiden Rollen
  ihr Recht prüft (Test je Route und Rolle), ein Mitglied an jeder schreibenden Route außer
  Neustart und Log-Auszug `403` bekommt (Test), die Migration die Rollen wie beschrieben umsetzt
  (Test) und eine Einladung nur diese zwei Rollen anbietet (Playwright: `POST /api/v1/einladungen`
  lehnt jede andere Rolle mit `400` ab, die Seite der Einladung nennt „Inhaber“ oder „Mitglied“; eine
  Oberfläche zum Einladen gibt es nicht).
  Sicherheitsrelevant: Anmeldung, Rollen und Rechte.
- [ ] **Z-1205 Server-Art entfernen** – jeder Server ist ein eigener Server des Betreibers für
  mehrere Kunden. „Eigen“ (ein Kunde) und „beim Kunden“ entfallen, mit dem Kunden am Server und der
  Platzierungsregel dazu.
  Fertig, wenn: „Server hinzufügen“ keine Art fragt (Playwright), Installationen zweier Kunden auf
  einen Server passen (Test) und die Migration vorhandene Server behält (Test).
- [ ] **Z-1206 Betriebsart entfernen** – die Frage „Nur für mich oder für Kunden“ (Z-805) entfällt.
  Kunden gibt es immer; der interne Kunde bleibt für eigene Installationen und die Welle „intern“.
  nach: Z-1201, Z-1203
  Fertig, wenn: nach dem ersten Inhaber keine Frage kommt (Playwright), kein Endpunkt mehr
  `409 betriebsart` antwortet (Test) und eine Installation für den internen Kunden ohne einen
  weiteren Kunden angelegt wird (Test).
- [ ] **Z-1207 Grund nicht mehr fragen** – kein Dialog fragt einen Grund. Die API nimmt `grund`
  weiter an, verlangt ihn aber nicht; das Audit-Log schreibt jede Änderung wie bisher, dann mit
  leerem Grund. Wiederherstellen, Kündigen, Entfernen und Zertifikat sperren behalten ihre
  Bestätigung.
  nach: Z-1203
  Fertig, wenn: jede schreibende Route ohne `grund` angenommen wird und ihren Eintrag im Audit-Log
  schreibt (Test je Route), kein Dialog das Feld zeigt (Playwright) und die vier genannten Aktionen
  ohne Bestätigung nichts tun (Playwright).
  Sicherheitsrelevant: Audit-Log.
- [ ] **Z-1208 Ein Betreiber** – die Zentrale hat genau einen Betreiber: ein zweiter lässt sich nicht
  anlegen, „von einem anderen Betreiber“ und die Marke je Betreiber entfallen, es gibt eine
  Agent-CA. `betreiber_id` bleibt in Tabellen und Abfragen (docs/plan.md, „Entscheidungen“).
  `CLAUDE.md`, README und Doku nennen keinen Partner mehr.
  nach: Z-1204
  Fertig, wenn: ein zweiter Betreiber abgelehnt wird (Test), die Tests der Trennung nach
  `betreiber_id` grün bleiben und `steuerzentrale pforte` genau eine CA lädt (Test).
  Sicherheitsrelevant: Trennung der Betreiber, Zertifikate der Agenten.

## Später, bei Bedarf

Keine Punkte des Loops; ein Mensch macht daraus einen Punkt, wenn der Betrieb es verlangt.

- **Buchen über einen Endpunkt**: Kunde anlegen und App installieren mit einem Token, für die
  Buchung auf der Webseite (früher Z-901 und Z-902).
- **Server wiederherstellen und Umzug** (früher Z-606 und Z-605).
- **Verwalten, was schon läuft**: Installationen auf einem Server mit eigenem Caddy oder hinter einem
  Cloudflare Tunnel; aus einem beobachteten Dienst eine verwaltete Installation machen.
- **Kontext mit eigenen Domains, Mail und Single Sign-on** (früher Z-409 und Z-408).
- **Englisch**: behalten oder `messages/en.json` streichen (Paraglide bleibt).

## Übergabe

Was eine Session offen hinterlassen hat und die nächste zuerst erledigt (Schritt 0). Erledigtes wird
hier gestrichen.

## Zurückgestellt

## Schritte für Menschen

Nicht auf dem Weg des Loops.

- Name und Domain der Steuerzentrale; Zone bei Cloudflare, API-Token nur für die Zentrale.
- Server für die Zentrale (netcup), WireGuard oder Cloudflare Tunnel (Z-1104), S3-Ziel für Backups, Mail-Versand, externer Prüfdienst
  für `/health` der Zentrale.
- Vor dem Start des Loops: `main` aus `claude/startdateien` anlegen und als Standard-Branch setzen;
  Repo öffentlich; Ruleset auf `main` (nur per Pull Request, Checks `check` und `pr-regeln` Pflicht,
  nur Squash); Pages-Quelle „GitHub Actions“.
- Für die Loop-Sessions: Push auf `Speicherstadt/steuerzentrale`, Lesen auf die App-Repos und
  `firsttris/workflows`, Netz zu `registry-1.docker.io` und `ghcr.io`; Git-Identität des Maintainers
  für `Signed-off-by` (plan.md, „DCO“).
- Signierschlüssel (minisign) erzeugen, offline aufbewahren; Manifeste der Apps (Z-203) und jedes
  Release signieren.
- Release (nach Z-1004): einmalig das Secret `BUMP_DEPLOY_KEY` (Deploy Key mit Schreibrecht, auf der
  Bypass-Liste des Rulesets) und Pages für die Demo; dann „Bump version“ starten, den Entwurf, den
  `release.yml` anlegt, nach `docs/release.md` mit dem echten Schlüssel signieren (`minisign -Sm
  SHA256SUMS`, vorher `bun scripts/release-schluessel.ts minisign.pub`), Schlüssel-ID in die
  Release-Notiz, veröffentlichen.
- Erste eigene Zentrale nach `docs/installation.md` (Server, DNS für Oberfläche und `agent.`,
  WireGuard).
- Je App eine eigene interne Installation für die Welle „intern“.
- Betreiber-Vertrag in den App-Repos: Health ohne Anmeldung, nur lesen, Export, Einrichtungsbefehl
  (Haben#945–#948, #1307; für die anderen Apps noch anzulegen); Images für Kennwort und Soll, für
  Belegt (app, worker, ftp; noch kein veröffentlichtes Image, Stand Z-203) und ein Release-Image
  von Fixpunkt (bisher nur `edge`): ohne sie sind diese Apps nicht installierbar (Z-1003, Stufe 1).
- OIDC in Stellwerk (stellwerk#36) und Fixpunkt (fixpunkt#5).
- Auftragsverarbeitungsvertrag mit TOMs aus `docs/sicherheit.md`, Preise.
- Erster eigener Server mit unseren Installationen, dann Pilotkunden.
- Für gehostetes Haben, in `Speicherstadt/haben`: der Einrichtungscode des ersten Kontos kommt
  über das Manifest zum Kunden (`HABEN_SETUP_CODE`); das Release erzeugt das Manifest mit Digest, es
  bleiben Signieren und Importieren; `ram_mb` nach gemessenem Verbrauch statt 2048; Export für die
  Kündigung (Haben#945–#948).
- Den eigenen Server anbinden, sobald Z-1101 bis Z-1103 gemergt sind: Zentrale auf einem zweiten
  Server, `install.sh --nur-beobachten` auf dem bestehenden, die laufenden Dienste als beobachtet
  eintragen.
- Später: Server bei netcup und Hetzner über deren API bestellen; eigener Relay-Tunnel für Server
  beim Kunden ohne Portweiterleitung; Archivbetrieb nach Kündigung.
