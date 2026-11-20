# Bauliste

Die Liste, die der Agenten-Loop abarbeitet, in der Reihenfolge der Bauphasen aus dem
[Projektplan](docs/plan.md). Die Steuerzentrale 1.0 ist fertig, wenn jeder Punkt abgehakt ist und
die Schritte für Menschen am Ende erledigt sind.

## So arbeitet der Loop

1. Den **ersten offenen Punkt** nehmen, dessen Abhängigkeiten (`nach:`) abgehakt sind und für den es
   keinen offenen Pull Request gibt (Titel beginnt mit seiner Nummer). Ohne `nach:` hängt ein Punkt
   am vorigen Punkt seiner Phase.
2. **Sofort reservieren**: Branch von aktuellem `origin/main`, Draft-Pull-Request mit Titel
   `Z-xxx: …`, damit parallele Sessions den Punkt als vergeben sehen.
3. **Kriterien zuerst**: Die Zeile „Fertig, wenn“ ist das Minimum. Reicht sie nicht, schärft der
   Loop sie im selben Pull Request nach, bevor er Code schreibt; streichen darf er keins.
4. Tests zuerst, dann Code, Doku und Texte in `de` und `en`, `bun run check` grün.
5. **Unabhängiges Review** durch einen eigenen Sub-Agenten (`tdd-review`): ein Befund braucht einen
   fehlschlagenden Test. Befunde fixen, bis keine mehr kommen.
6. **CI grün → selbst mergen** (Squash), den Punkt hier im selben Pull Request abhaken. Der Loop
   wartet nie auf einen Menschen. Offene Fragen entscheidet er nach dem Projektplan
   („Entscheidungen“); eine neue Entscheidung schreibt er dort mit Grund hinein.
7. **Nicht hängen bleiben**: Scheitert ein Punkt dreimal, trägt der Loop ihn mit Grund unter
   „Zurückgestellt“ ein und macht mit dem nächsten Punkt weiter, der nicht davon abhängt. Was nur
   ein Mensch erledigen kann, steht unten unter „Schritte für Menschen“ und liegt nicht auf dem Weg
   des Loops.

**Parallel**: Ab Z-104 laufen Phase 2 (Manifest, reine Funktionen) und Z-105 (Oberfläche mit
Demodaten) unabhängig; ab Z-305 können Phase 4 und Phase 7 je eine eigene Session bekommen, ab
Z-406 die Phasen 5, 6 und 8. Jede Session hakt nur in ihrer Phase ab und rebased vor jedem Merge
auf `origin/main`.

## Phase 1 – Fundament

- [ ] **Z-101 Repo-Gerüst** – Workspaces `packages/manifest`, `packages/protokoll`,
  `packages/planung`, `packages/ui` (von Kennwort kopiert, Quelle im Kommentar), `apps/zentrale`
  (Bun, Hono, Zod, `/health`, Logs ohne Geheimnisse, `bun build --compile`), `apps/agent`
  (`bun build --compile` für `linux-x64` und `linux-arm64`), `apps/web` (Solid 2, Vite, SPA);
  Paraglide mit `de` und `en`; Biome, Vitest, Playwright; `checks.json` mit `fileSize`, `cycles`,
  `i18n`, `pages`; CI mit allen Workspaces; Zensical-Doku mit `docs/plan.md`.
  Fertig, wenn: `bun run check` auf einem frischen Klon grün ist, die CI alle Workspaces prüft, beide
  Binaries für beide Architekturen gebaut werden, `/health` antwortet (Test) und ein Log weder
  Query-Werte noch `Authorization`- oder Cookie-Header enthält (Test).
- [ ] **Z-102 Datenbank und Audit-Log** – Drizzle mit SQLite (WAL), Migrationen eingecheckt und im
  Binary eingebettet; jede Tabelle mit `betreiber_id`; eine Schreibfunktion, die in derselben
  Transaktion einen Eintrag ins Audit-Log schreibt (Akteur, Zeitpunkt, Aktion, Ziel, Grund); das
  Audit-Log ist nur anfügbar.
  Fertig, wenn: ein Test über alle Schreibfunktionen zeigt, dass keine am Audit-Log vorbei schreibt,
  ein Fehler mitten in der Transaktion Zeile und Eintrag zurücknimmt, eine geänderte, schon
  angewendete Migration den Start verhindert und das Binary in einem leeren Datenverzeichnis die
  Datenbank anlegt (CI).
- [ ] **Z-103 Geheimnisse** – verschlüsselte Spalten (AES-256-GCM) mit dem Schlüssel aus
  `STEUERZENTRALE_SECRET_KEY` (32 Bytes, Base64); Start ohne oder mit falschem Schlüssel verweigert;
  Tokens nur als Hash.
  Fertig, wenn: kein Geheimnis im Klartext in der Datenbankdatei steht (Test sucht nach dem Wert),
  der Start ohne Schlüssel mit klarer Meldung abbricht und ein Token nach dem Speichern nicht mehr
  lesbar ist.
- [ ] **Z-104 Anmeldung und Rollen** – Better Auth mit Passkeys und TOTP, beides als Pflicht vor
  dem ersten Zugriff; erster Inhaber über einen Einrichtungscode im Log; Rollen Inhaber, Technik,
  Support, Partner; Einladungen per Link.
  Fertig, wenn: ein Konto ohne zweiten Faktor nichts außer der Einrichtung des Faktors erreicht, jede
  Route ihre Rollen prüft (Test je Route und Rolle) und ein Partner nur seine Kunden sieht (Test je
  Endpunkt).
- [ ] **Z-105 Oberfläche und Demodaten** – Shell nach DESIGN.md und `design/mockup/`: Seitenleiste,
  Übersicht, Server, Installationen, Apps, Updates, Backups, Kunden, Support, Einstellungen;
  `bun run dev:demo` mit Fixtures in `apps/web/src/demo/`, die auch E2E und Screenshots nutzen.
  nach: Z-101
  Fertig, wenn: jede Seite in hell und dunkel, Desktop und Handy ohne axe-Befund rendert (Playwright),
  jeder Text aus `messages/` kommt (`i18n`-Check) und die Demodaten die acht Apps der Speicherstadt
  zeigen.

## Phase 2 – Manifest und Platzierung

- [ ] **Z-201 Manifest-Schema** – Zod-Schema in `packages/manifest` nach `docs/plan.md` („Manifest“):
  Images, Architektur, Ressourcen, Netz (HTTP-Dienst, Ports, öffentliche IPv4, Server für sich),
  Proxy, Optionen (Compose-Profile), `braucht`/`bietet`, Anmeldung, Health, Schritte, Backup,
  Aktionen, Sperrzeiten, Einstellungen mit Ebenen; JSON Schema als Datei; `docs/manifest.md` für
  App-Entwickler.
  nach: Z-101
  Fertig, wenn: das Beispiel aus dem Plan gültig ist, zehn ungültige Beispiele mit einer Meldung
  scheitern, die Feld und Grund nennt, und das JSON Schema in der CI aus dem Zod-Schema neu erzeugt
  und verglichen wird.
- [ ] **Z-202 Beispiel-App** – `manifeste/beispiel/`: kleiner HTTP-Dienst mit SQLite-Volume,
  Health, einer Option, einem Schritt nach dem Update und einem Backup per Befehl; Image wird in der
  CI gebaut und in eine lokale Registry geschoben, in zwei Versionen und einer kaputten (Health rot).
  Fertig, wenn: das Manifest gültig ist und die drei Images in der CI entstehen.
- [ ] **Z-203 Manifeste der Speicherstadt** – `manifeste/<app>/` für Haben, Belegt, Kontext,
  Schreibzeug, Stellwerk, Fixpunkt, Kennwort und Soll, jeweils `manifest.yml`, `compose.yml` (aus
  dem App-Repo abgeleitet, eigener Caddy als abschaltbares Profil) und `QUELLEN.md` mit Datei und
  Commit jeder Angabe; was eine App nicht kann, als `nicht_unterstuetzt`.
  Fertig, wenn: alle acht gültig sind, `QUELLEN.md` jede Angabe belegt und ein Test die Tabelle „Die
  Apps der Speicherstadt“ im Plan gegen die Manifeste prüft (Ports, öffentliche IP, Server für sich,
  Architektur).
- [ ] **Z-204 Platzierung** – reine Funktion: Manifest, Optionen, Serverfakten und vorhandene
  Installationen → `passt` | Warnungen | Gründe. Regeln: Architektur, RAM und Platte mit Reserve,
  doppelte Ports, öffentliche IPv4 und PTR, Server für sich (in beide Richtungen), eigener Proxy
  braucht 80/443, `braucht` ohne passendes `bietet` beim Kunden.
  Fertig, wenn: jede Regel einen Fall „passt“, „Grenze“ und „passt nicht“ hat, fast-check zeigt,
  dass eine angenommene Platzierung nie zwei Installationen auf denselben Port legt, und Kontext auf
  einem gemeinsamen Server mit Haben abgelehnt wird.
- [ ] **Z-205 Compose rendern** – reine Funktion: Manifest, Installation, Einstellungen → Compose-
  Datei, `.env`, Caddy-Schnipsel; Projektname aus der Installation, eigenes Netz und Volumes;
  `auto`-Werte erzeugt die Zentrale einmal und speichert sie verschlüsselt.
  Fertig, wenn: Golden Files für jede App mit jeder Option entstehen, zwei Installationen derselben
  App auf einem Server keine Namen teilen und ein `auto`-Geheimnis bei erneutem Rendern gleich
  bleibt.

## Phase 3 – Agent

- [ ] **Z-301 Protokoll** – Nachrichten in `packages/protokoll` als Zod-Schemas mit Version: Hallo,
  Heartbeat, Fakten, Zustand der Installationen, Auftrag, Fortschritt, Ergebnis, Log-Auszug.
  nach: Z-101
  Fertig, wenn: jede Nachricht hin und zurück geprüft ist und ein Agent mit Protokoll `n-1` von der
  Zentrale verstanden wird (Test).
- [ ] **Z-302 Server hinzufügen** – Einmal-Token (24 h, einmal nutzbar) in der Zentrale;
  `install/install.sh` prüft System und Architektur, installiert Docker, unattended-upgrades, den
  Agenten als systemd-Dienst und tauscht das Token gegen einen Schlüssel.
  nach: Z-104
  Fertig, wenn: das Skript in einem Debian-12- und einem Ubuntu-24.04-Container (systemd) in der CI
  durchläuft, ein benutztes oder abgelaufenes Token abgelehnt wird, `shellcheck` grün ist und der
  Dialog in der Oberfläche den Befehl zeigt (Playwright).
- [ ] **Z-303 Verbindung und Heartbeat** – Agent verbindet sich per WSS, meldet alle 30 s; die
  Zentrale zeigt „verbunden“, „seit x min still“, „getrennt“; Wiederverbindung mit Backoff;
  Schlüssel rotieren und sperren.
  Fertig, wenn: ein Test Verbindungsabbruch, Wiederverbindung und gesperrten Schlüssel abdeckt und
  ein stiller Server nach 3 min ein Ereignis erzeugt.
- [ ] **Z-304 Serverfakten** – CPU, RAM, Platte je Mount, Architektur, OS und Kernel, „Neustart
  nötig“, ausstehende Updates, Docker-Version, öffentliche IPv4/IPv6, PTR, belegte Ports.
  Fertig, wenn: die Fakten in der CI im Container gelesen werden und die Platzierung (Z-204) sie
  ohne Umweg nutzt.
- [ ] **Z-305 Aufträge** – Warteschlange in der Zentrale, Agent holt, bestätigt, meldet Fortschritt
  und Ergebnis; idempotent über die ID; nur Aktionen aus dem Manifest, Argumente nach Schema; Zeit-
  limit je Aktion.
  Fertig, wenn: ein doppelt zugestellter Auftrag einmal ausgeführt wird, ein Auftrag mit einer nicht
  im Manifest stehenden Aktion vom Agenten abgelehnt wird (Test) und ein Auftrag nach Neustart des
  Agenten fortgesetzt oder als gescheitert gemeldet wird.

## Phase 4 – Installationen

- [ ] **Z-401 Pforte** – Agent richtet Caddy als eigenes Compose-Projekt ein, Admin-API nur auf
  localhost; Subdomains hinzufügen und entfernen ohne Neustart.
  nach: Z-305
  Fertig, wenn: in der CI zwei Installationen der Beispiel-App unter zwei Hostnamen erreichbar sind
  (lokale CA statt Let's Encrypt) und das Entfernen einer die andere nicht unterbricht.
- [ ] **Z-402 Installieren und Entfernen** – Dialog in der Oberfläche mit Kunde, App, Server,
  Optionen und Einstellungen nach Ebenen, Platzierung live; Agent legt
  `/srv/steuerzentrale/<installation>` an, zieht Images, führt `schritte.einrichten` aus, startet;
  Entfernen mit Backup vorher und Frist.
  Fertig, wenn: die Beispiel-App in der CI per Auftrag installiert und entfernt wird, ein Fehler im
  Einrichtungsschritt nichts halb Installiertes zurücklässt und der Ablauf in Playwright läuft.
- [ ] **Z-403 Health und Zustand** – Agent prüft Health aus dem Manifest und den Zustand der
  Container; Zentrale zeigt grün, gelb, rot mit Grund und Verlauf.
  Fertig, wenn: die kaputte Beispiel-App rot wird, ein beendeter Container gelb und ein Ereignis mit
  Zeitpunkt entsteht.
- [ ] **Z-404 Einstellungen** – Ebenen `betreiber`, `installation`, `auto` aus dem Manifest;
  Formular aus dem Schema (keine App fest eingebaut); Änderung erzeugt einen Auftrag „neu
  konfigurieren“; Geheimnisse nie zurück an die Oberfläche.
  Fertig, wenn: das Formular für jedes der acht Manifeste ohne App-spezifischen Code entsteht
  (Test), ein Pflichtwert der Ebene `betreiber` die Installation blockiert, bis er gesetzt ist, und
  kein Geheimnis in einer API-Antwort steht (Test).
- [ ] **Z-405 Neustart, Logs, nur lesen** – Aktionen Neustart, Log-Auszug (letzte 500 Zeilen, ohne
  Geheimnisse), nur lesen und wieder schreiben, wenn das Manifest sie anbietet.
  Fertig, wenn: eine nicht angebotene Aktion in der Oberfläche fehlt und vom Agenten abgelehnt wird
  und ein Wert aus der `.env` im Log-Auszug ersetzt ist.
- [ ] **Z-406 Server-Detail und Übersicht** – echte Daten statt Demodaten: Server mit Fakten,
  Installationen, Ereignissen; Übersicht mit allem, was Aufmerksamkeit braucht.
  Fertig, wenn: die E2E-Fälle aus Z-105 gegen Zentrale und Agent im Container laufen.

## Phase 5 – Updates

- [ ] **Z-501 Versionen** – Zentrale fragt die Registries der Manifeste nach Tags (Semver), zeigt
  „neu verfügbar“ je App; Manifest je Version.
  nach: Z-406
  Fertig, wenn: gegen die lokale Registry der CI eine neue Version erkannt wird und Vorabversionen
  nur für die Welle „intern“ gelten.
- [ ] **Z-502 Wellen und Sperrzeiten** – reine Funktion in `packages/planung`: Installationen,
  SLA, Sperrzeiten der Apps, Wartungsfenster der Server, Zeitpunkt → Plan. Wellen intern, früh,
  standard, spät, jede nach 24 h ohne Störung.
  Fertig, wenn: Tests Sperrzeiten über den Monatswechsel, Zeitumstellung, Wartungsfenster über
  Mitternacht und eine gestoppte Welle nach einer Störung abdecken und Haben nie zwischen dem 7. und
  10. aktualisiert wird.
- [ ] **Z-503 Update mit Rückkehr** – Backup, Pull, `schritte.nach_update`, Neustart, Health; bei
  Rot zurück auf die alte Version und das Backup; Ereignis und Meldung.
  Fertig, wenn: in der CI die Beispiel-App von Version 1 auf 2 kommt und die kaputte Version
  automatisch zurückgenommen wird, mit den Daten von vorher.
- [ ] **Z-504 Updates des Agenten** – Agent lädt neue Version, prüft SHA-256 und Signatur, startet
  sich neu; die Zentrale versteht `n-1`.
  Fertig, wenn: ein Agent in der CI sich aktualisiert und eine falsche Prüfsumme abgelehnt wird.

## Phase 6 – Backups und Export

- [ ] **Z-601 Backups** – Arten `volume`, `pg_dump`, `restic`, `befehl` aus dem Manifest; restic an
  S3, je Betreiber eigenes Repository und eigener Schlüssel; Zeitplan und Aufbewahrung.
  nach: Z-406
  Fertig, wenn: in der CI ein Backup der Beispiel-App in MinIO landet, die Aufbewahrung alte
  Snapshots löscht und ein fehlgeschlagenes Backup ein Ereignis erzeugt.
- [ ] **Z-602 Prüf-Restore** – wöchentlich je Installation in ein Wegwerf-Projekt, Health prüfen,
  wieder entfernen; Ergebnis in der Liste der Backups.
  Fertig, wenn: ein absichtlich beschädigtes Backup als „Restore gescheitert“ erscheint.
- [ ] **Z-603 Wiederherstellen** – Snapshot wählen, Grund angeben, Backup vom Ist-Zustand vorher.
  Fertig, wenn: Daten nach dem Wiederherstellen dem Snapshot entsprechen (Test) und der Vorgang im
  Audit-Log steht.
- [ ] **Z-604 Export und Kündigung** – Export nach Manifest zum Herunterladen für den Kunden; bei
  Kündigung: nur lesen, Export, Löschung nach Frist mit Backup.
  Fertig, wenn: der Ablauf mit der Beispiel-App in Playwright läuft und vor Ablauf der Frist nichts
  gelöscht wird.

## Phase 7 – Server-Pflege

- [ ] **Z-701 Betriebssystem** – Status von unattended-upgrades, ausstehende Pakete, „Neustart
  nötig“; Neustart als Auftrag, geplant im Wartungsfenster außerhalb aller Sperrzeiten der Apps auf
  dem Server.
  nach: Z-305
  Fertig, wenn: die Planung (Z-502) den Neustart verschiebt, wenn eine Sperrzeit läuft, und ein
  Neustart im Container der CI ausgeführt und der Server danach wieder verbunden ist.
- [ ] **Z-702 Prüfungen** – Platte über 80/90 %, Zertifikat läuft in 14 Tagen ab, Backup älter als
  26 h, Port offen, der nicht im Manifest steht, PTR fehlt für eine App mit Mail, Uhr geht falsch.
  Fertig, wenn: jede Prüfung einen Test mit Grenzfall hat und ihr Ergebnis in der Übersicht steht.
- [ ] **Z-703 Benachrichtigungen** – Ereignisse nach Schwere per Mail (SMTP) und Webhook; Ruhe-
  zeiten; eine Meldung je Störung, nicht je Prüfung.
  Fertig, wenn: eine Störung, die 10 Prüfungen lang besteht, eine Mail erzeugt (Mailpit in der CI)
  und ihre Behebung eine zweite.

## Phase 8 – Kunden, Support und SLA

- [ ] **Z-801 Kunden und Verträge** – Kunde mit Kontakt, Vertrag mit SLA-Stufe (Basis, Plus,
  Ruhe), gebuchte Apps; Kunde mit mehreren Apps auf mehreren Servern.
  nach: Z-406
  Fertig, wenn: die SLA-Stufe die Welle (Z-502) bestimmt (Test) und die Kundenseite alle seine
  Installationen zeigt.
- [ ] **Z-802 Support-Zugang** – zeitlich begrenzt (Vorgabe 2 h), mit Grund; erlaubt Log-Auszug,
  Neustart und die Aktionen der Rolle Support; endet von selbst; erscheint in den Ereignissen des
  Kunden.
  Fertig, wenn: nach Ablauf jeder Zugriff abgelehnt wird (Test) und der Zugang im Audit-Log mit
  Grund steht.
- [ ] **Z-803 Partner** – Partner sieht und verwaltet nur seine Kunden und Server; eigene Marke im
  Hinweis der Installation.
  Fertig, wenn: kein Endpunkt einem Partner fremde Daten liefert (Test je Endpunkt).
- [ ] **Z-804 Leistungen** – Übersicht je Kunde und Monat: Installationen, Speicher, Support-Zeit;
  Export als CSV.
  Fertig, wenn: die Summen aus den Ereignissen berechnet werden (Test) und der Export gültiges CSV
  nach RFC 4180 ist.

## Phase 9 – API für das Portal

- [ ] **Z-901 API-Tokens und OpenAPI** – Tokens mit Rechten (lesen, Kunden anlegen, buchen,
  kündigen), OpenAPI aus den Zod-Schemas, `docs/api.md`.
  nach: Z-801
  Fertig, wenn: jede Route ihr Recht prüft (Test) und die OpenAPI-Datei in der CI neu erzeugt und
  verglichen wird.
- [ ] **Z-902 Buchen über die API** – Kunde anlegen, App buchen mit automatischer Platzierung
  (Z-204) auf einem gemeinsamen Server oder „Server nötig“, kündigen.
  Fertig, wenn: eine Buchung über die API die Beispiel-App in der CI installiert und eine nicht
  platzierbare Buchung mit Grund abgelehnt wird.
- [ ] **Z-903 Webhooks** – Ereignisse installiert, Störung, behoben, gekündigt; signiert (HMAC),
  mit Wiederholung.
  Fertig, wenn: eine gefälschte Signatur im Test-Empfänger auffällt und eine Zustellung nach
  Ausfall des Empfängers wiederholt wird.

## Phase 10 – Härtung und Release

- [ ] **Z-1001 Sicherheitsprüfung** – Bedrohungsmodell in `docs/sicherheit.md`; Tests für: Agent
  führt nichts außerhalb des Manifests aus, gestohlener Agent-Schlüssel kann keine Aufträge
  erzeugen, Rate-Limits an Anmeldung und Token-Tausch.
  nach: Z-903
  Fertig, wenn: jede Bedrohung im Dokument einen Test oder eine begründete Annahme hat.
- [ ] **Z-1002 Zentrale sichern** – Backup der Zentrale (Datenbank und Schlüssel getrennt),
  Wiederherstellung auf einem neuen Server, Agenten verbinden sich wieder.
  Fertig, wenn: der Ablauf in der CI durchläuft.
- [ ] **Z-1003 Echte App** – Kennwort oder Soll (klein, SQLite) aus `manifeste/` in der CI
  installieren, aktualisieren und sichern.
  Fertig, wenn: der Lauf grün ist; scheitert er an der App, steht der Grund als Issue-Entwurf in
  `docs/betreiber-vertrag.md`.
- [ ] **Z-1004 Release** – Docker-Image der Zentrale (amd64, arm64), Agent-Binaries mit Prüfsummen
  und Signatur, Release-Workflow aus firsttris/workflows; `docs/installation.md` mit Ein-Server-
  Betrieb.
  Fertig, wenn: ein Release-Kandidat in der CI entsteht und sich nach der Doku auf einem frischen
  Container installieren lässt.

## Zurückgestellt

## Schritte für Menschen

Nicht auf dem Weg des Loops.

- Server für die Zentrale mieten, Domain, VPN oder IP-Liste, S3-Ziel für Backups, Mail-Versand.
- Betreiber-Vertrag in den App-Repos: Health ohne Anmeldung, nur lesen, Export, Status-Befehl,
  Sperrzeiten im Code (für Haben angelegt: Haben#945–951, #1307; für die anderen Apps noch nicht).
- OIDC in Stellwerk (stellwerk#36) und Fixpunkt (fixpunkt#5).
- Manifeste in die App-Repos übernehmen, sobald das Schema stabil ist.
- Auftragsverarbeitungsvertrag, SLA-Texte, Preise.
- Erster echter Server mit unseren eigenen Installationen, dann Pilotkunden.
- Repo für das Portal anlegen; es beginnt, wenn Phase 9 fertig ist.
- Später: Server bei Hetzner und netcup über deren API bestellen.
