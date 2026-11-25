---
title: Sicherheit
description: >-
  Bedrohungsmodell der Steuerzentrale mit der Maßnahme und dem Test zu jeder Bedrohung, der
  Notzugang per SSH und die technischen und organisatorischen Maßnahmen nach Art. 32 DSGVO als
  Anlage zum Auftragsverarbeitungsvertrag.
---

# Sicherheit

Diese Seite führt, wovor die Steuerzentrale schützt, womit und wie das belegt ist. Jede Bedrohung hat
einen Test (Pfad › Name des Tests) oder eine begründete Annahme. Der Leitsatz aus dem
[Projektplan](plan.md#sicherheit): **Eine übernommene Zentrale kann Server anhalten, aber keinen
fremden Code auf ihnen ausführen; ein gestohlenes Agent-Zertifikat fälscht höchstens Meldungen
seines Servers.** Wie eine Lücke gemeldet wird, steht in `SECURITY.md`.

## Was geschützt wird

| Wert | Wo er liegt |
| --- | --- |
| Daten der Kunden (Datenbanken, Dateien, Dokumente der Apps) | in den Volumes der Installationen auf den Servern, in den restic-Repositories auf dem S3-Ziel |
| Code, der auf einem Server läuft | Manifeste (signiert), Images (per Digest), Agent-Binaries (signierte `SHA256SUMS`) |
| der private Signierschlüssel der Manifeste und des Agenten | offline beim Inhaber, nie auf Zentrale, Server oder in der CI |
| Geheimnisse: DNS-Token, S3-Zugänge, restic-Passwörter, Geheimnisse der Apps, SMTP-Passwort, Schlüssel der Webhooks, CA der Agenten | verschlüsselt in der Datenbank der Zentrale; auf dem Server nur die eigenen als Podman-Secrets |
| `STEUERZENTRALE_SECRET_KEY` | in der Umgebung der Zentrale, die Sicherung offline ([Zentrale sichern](zentrale-sichern.md)) |
| Konten, Sitzungen, Rollen | Better Auth in der Datenbank der Zentrale |
| Audit-Log und Ereignisse | Datenbank der Zentrale, das Audit-Log nur anhängend |
| Verfügbarkeit der Apps | Server, Pforte, Wellen der Updates, Sperrzeiten |

## Wer angreift

| Akteur | Was er hat |
| --- | --- |
| Angreifer im Internet | erreicht `agent.<domain>`, die Pforten der Server (80, 443) und SSH-Port 22, sonst nichts |
| Angreifer mit übernommener Zentrale | Datenbank, `STEUERZENTRALE_SECRET_KEY`, CA der Agenten, Verbindungen aller Agenten; **nicht** den Signierschlüssel |
| Angreifer mit einem gestohlenen Server oder Agent-Zertifikat | Schlüssel und Zertifikat eines Agenten, die Podman-Secrets dieses Servers |
| ein anderer Betreiber (Partner) in derselben Zentrale | ein gültiges Konto mit Rollen in seinem Betreiber |
| ein Mitglied mit zu wenig Rechten | ein gültiges Konto mit der Rolle Mitglied |
| eine kompromittierte App auf einem gemeinsamen Server | Code in den Containern einer Installation |
| Cloudflare, S3-Anbieter, Registry | ihre eigene Infrastruktur |

## Vertrauensgrenzen

```text
Browser ──WireGuard──▶ Oberfläche ┐
                                  ├─ Zentrale (Hono, SQLite, verschlüsselte Spalten)
Agent ──WSS + mTLS──▶ agent.<domain> (Pforte der Zentrale, prüft das Zertifikat,
                                  │   reicht den Fingerabdruck an 127.0.0.1 weiter)
                                  ┘
Zentrale ──HTTPS──▶ Cloudflare-API (DNS), MinIO-Admin-API (S3-Zugänge), Registries (Digests)
Agent ──HTTPS──▶ S3-Ziel (restic, nur der Zugang seiner Installation), Registry (Images per Digest)
Internet ──▶ Pforte des Servers (Caddy, :80/:443) ──▶ 127.0.0.1:<Port> der Installation
```

- **Zentrale ↔ Agent**: Der Agent baut die Verbindung immer selbst auf, auf dem Server ist kein Port
  für ihn offen. Die Zentrale glaubt nur den Fingerabdruck, den ihre Pforte von `127.0.0.1` schickt.
  Der Agent glaubt der Zentrale nichts, was nicht mit seinem Schlüssel signiert ist.
- **Pforte ↔ Installation**: Jede Installation hat ihr eigenes Netz und veröffentlicht HTTP nur auf
  `127.0.0.1`; die Pforte setzt `X-Forwarded-For` selbst.
- **Zentrale ↔ Cloudflare, S3**: Nur die Zentrale hat den DNS-Token und den Admin-Zugang des S3-Ziels;
  ein Server bekommt nur den auf das Präfix seiner Installation beschränkten Zugang.
- **Browser ↔ Zentrale**: Die Oberfläche ist nur über WireGuard erreichbar oder, mit
  `STEUERZENTRALE_ACCESS_TEAM` und `STEUERZENTRALE_ACCESS_AUD`, durch einen Cloudflare Tunnel, dessen
  Access-Token die Zentrale selbst prüft (Z-1104); jede Anfrage braucht eine Sitzung mit zweitem
  Faktor und das Recht der Route.

## Bedrohungen

Spalte „Art“ nach STRIDE: **S**poofing, **T**ampering, **R**epudiation, **I**nformation
Disclosure, **D**enial of Service, **E**levation of Privilege. Tests ohne Pfad zu `apps/` oder
`packages/` liegen in `apps/zentrale/src/`.

### Zentrale und Agent

| Nr. | Bedrohung | Art | Maßnahme | Beleg |
| --- | --- | --- | --- | --- |
| B-01 | Eine übernommene Zentrale schickt ein Manifest, das sie selbst geschrieben oder mit einem eigenen Schlüssel signiert hat, und bringt so Code auf einen Server | T, E | Der Agent prüft jedes Manifest mit dem öffentlichen Schlüssel, der bei `install.sh` hinterlegt wurde (`packages/manifest/src/signatur.ts`, `apps/agent/src/auftraege/pruefen.ts`); der private Schlüssel liegt offline | `apps/agent/src/auftraege/auftraege.test.ts` › a job the agent refuses, without starting anything › the manifest signed with another key, as a taken-over Zentrale would send it; › a manifest changed in one byte; › an unsigned manifest |
| B-02 | Die Zentrale schickt einen Auftrag mit einem Befehl oder Argument, das das Manifest nicht beschreibt (Shell, fremdes argv, Option für podman) | T, E | Nur Befehle unter `befehle` mit argv, Argumente nach Schema (`befehlFuellen`), kein Shell-Programm im Schema, kein Name mit `-` | `apps/agent/src/auftraege/auftraege.test.ts` › a job the agent refuses, without starting anything (Aktion, Argumente, Installation); `packages/manifest/src/schema.test.ts` › invalid manifests (a step as shell text, a command that starts a shell …); `apps/agent/src/auftraege/ausfuehren.test.ts` › hands each word over as it is, with no shell to read it; `apps/zentrale/src/routes/verbindung.test.ts` › ends a connection that does not start with hallo, or sends what it cannot read |
| B-03 | Ein Image wird über einen Tag ausgetauscht | T | Images nur per Digest im signierten Manifest | `packages/manifest/src/schema.test.ts` › invalid manifests (an image without digest); `apps/agent/src/einrichtung/einrichten.test.ts` › pulls each image by its digest, … |
| B-04 | Ein manipuliertes Agent-Binary oder `install.sh` wird verteilt | T, E | Signierte `SHA256SUMS`, Prüfsumme je Binary; `install.sh` trägt den öffentlichen Schlüssel | `apps/agent/src/agent-update/aktualisieren.test.ts` › refuses a signature of another key; › refuses a binary whose checksum is not the one of SHA256SUMS; `routes/auslieferung.test.ts` › serves install.sh with its own address and the signing key filled in; CI-Schritt „A wrong signature is refused“ (Incus-VM) |
| B-05 | Der öffentliche Test-Schlüssel aus dem Repository wird in Produktion benutzt | S, E | Agent und Release-Build lehnen den Test-Schlüssel außerhalb des Testmodus ab | `packages/manifest/src/vertrauen.test.ts` › refuses the test key for a release; `apps/agent/src/auftraege/auftraege.test.ts` › a manifest signed with the public test key, outside test mode; `apps/agent/src/dienst.test.ts` › refuses the public test key when it did not join in test mode |
| B-06 | Ein gestohlenes Agent-Zertifikat erzeugt Aufträge | S, E | Über die Verbindung gibt es keine Nachricht, die einen Auftrag anlegt; die API nimmt den Fingerabdruck nicht als Anmeldung; Meldungen gelten nur für Aufträge des eigenen Servers | `routes/verbindung.test.ts` › a stolen certificate › creates no jobs: not over the connection, not through the API behind the Pforte; `modules/auftraege/anlegen.test.ts` › operators › never reach each other's servers or jobs |
| B-07 | Ein gestohlenes Zertifikat wird weiter benutzt, nachdem der Diebstahl bemerkt wurde | S | Sperren trennt die Verbindung sofort, jeder neue Versuch wird abgewiesen, ein wartendes rotiertes Zertifikat verfällt | `routes/verbindung.test.ts` › a revoked certificate › ends the running connection at once and is refused from then on; › drops what the connection sends after it was revoked; `modules/verbindung/sitzung.test.ts` › drops a rotated certificate that waits when the server is revoked |
| B-08 | Ein Client gibt sich als Agent aus (eigenes Zertifikat, gesetzter Header) | S | mTLS gegen die CA des Betreibers; der Fingerabdruck-Header zählt nur von `127.0.0.1` | `routes/verbindung.test.ts` › is refused without a certificate, or with one the operator's CA did not issue; › believes the fingerprint header only from the loopback address; `modules/verbindung/herkunft.test.ts` › ignores the header from anywhere else |
| B-09 | Ein Agent meldet Ergebnisse, Backups oder Zustände für Installationen eines anderen Servers oder Betreibers | S, T | Jede Meldung wird gegen Server und Betreiber der Verbindung geprüft und sonst verworfen und protokolliert | `modules/auftraege/anlegen.test.ts` › never reach each other's servers or jobs; `modules/backups/stand.test.ts` › of another server's or another operator's installation is dropped and logged; `modules/bewertung/melden.test.ts` › changes nothing for an installation of another server or operator, and logs it; `modules/auftraege/log-auszug.test.ts` › is dropped for a job that is no log excerpt, … |
| B-10 | Ein Agent flutet die Zentrale (Heartbeats, Fakten, SSH-Anmeldungen, Fortschritt, große Nachrichten) | D | Mindestabstände und Eimer je Verbindung, 4 MiB je Nachricht | `modules/verbindung/sitzung.test.ts` › keeps one per interval: …; `modules/verbindung/meldungen.test.ts` › cannot flood the events and the audit log: …; `modules/verbindung/meldungen.test.ts` › are dropped when they come closer than a minute, … |
| B-11 | Der Einmal-Token zum Beitreten wird erraten oder zweimal benutzt | S | 32 Zufallsbytes, 24 h, einmal, nur als SHA-256 gespeichert, in einer Transaktion verbraucht; Rate-Limit 10 je 10 Minuten und Adresse (/64 bei IPv6) | `routes/agent.test.ts` › the token exchange › refuses a token that was used; › lets only one of two exchanges with the same token through; › limits the attempts per address; › counts the addresses of one IPv6 network together; › counts the client behind the Pforte, and a client's own forwarding header not at all |
| B-12 | Ein Server bekommt den S3-Zugang, das restic-Passwort oder den DNS-Token einer fremden Installation | I | Zugang je Installation, auf ihr Präfix beschränkt, nur im Auftrag an ihren Server; der DNS-Token verlässt die Zentrale nie | `modules/backups/abgleich.test.ts` › gets only the access and password of its own installations; › never gets another server's installation's password, even in a job addressed to it; `modules/dns/abgleich.test.ts` › stands only encrypted in the database and in no log, event, audit entry or agent message |
| B-13 | Ein Agent wird über einen offenen Port angegriffen | S, E | Der Agent lauscht nie, er verbindet sich nur ausgehend; die Prüfungen melden jeden unerwarteten Port | `packages/planung/src/pruefungen.test.ts` › is yellow for a port no manifest names, the protocol counting; Annahme: `apps/agent` öffnet keinen Socket zum Lauschen (kein `listen` im Code, Review) |

### Anmeldung, Rechte und Betreiber

| Nr. | Bedrohung | Art | Maßnahme | Beleg |
| --- | --- | --- | --- | --- |
| B-20 | Passwort oder TOTP-Code wird durchprobiert | S | Rate-Limit von Better Auth: Passwort und TOTP je 5, Passkey 10 je Minute und Adresse; die Adresse ist die des Sockets bzw. der Pforte | `routes/anmeldung.test.ts` › the sign-in's rate limit › stops a sixth attempt within a minute from one address; › also limits the TOTP code; › is not escaped by an X-Forwarded-For or address header a client sends; › counts each address on its own: one client does not lock out another |
| B-21 | Ein Konto ohne zweiten Faktor oder mit gestohlenem Passwort erreicht die Oberfläche | S, E | Passkey oder Passwort mit TOTP, sonst nur die Einrichtung; kein „Gerät merken“ | `routes/zweiter-faktor.test.ts` › reaches no route that needs a role; `routes/anmeldung.test.ts` › never trusts a device, which would skip TOTP next time |
| B-22 | Eine Route ohne Prüfung der Sitzung oder des Rechts | E | Eine Liste aller Routen mit ihrem Recht (`routes/zugang.ts`); eine Route ohne Eintrag lässt den Test scheitern | `routes/zugang.test.ts` › holds exactly the routes the app registers; › refuses a request without a session; › needs a session where the list says so |
| B-23 | Ein Mitglied tut mehr, als seine Rolle erlaubt | E | Rechte je Rolle (`auth/rollen.ts`), geprüft in jeder Route | `routes/zugang.test.ts` › <Route> › as inhaber/mitglied answers by the list (jede Route mit Recht in jeder Rolle, sonst `403 keine_berechtigung`); › gives every route that needs a right at least one role; › a member › is refused <Route> (jede schreibende Route außer Neustart und Log-Auszug); `auth/rollen.test.ts` › darf |
| B-24 | Ein Betreiber (Partner) sieht oder ändert Daten eines anderen | I, T | `betreiber_id` in jeder Tabelle und Abfrage; `schreiben` lehnt fremde Zeilen ab | `routes/mandanten.test.ts` › no operator reaches another's data; `routes/kunden-mandanten.test.ts`; `routes/betrieb-mandanten.test.ts`; `modules/audit/schreiben.test.ts` › refuses a row of another operator |
| B-25 | Der Einrichtungscode des ersten Inhabers wird erraten oder wiederverwendet | S | Einmal, 24 h, nie im Log | `routes/erster-inhaber.test.ts` › refuses the code a second time; › refuses the code after 24 hours; › never writes the code into the request log |
| B-26 | Ein Mitglied (früher Support über einen Support-Zugang) ändert mehr als Neustart und Log-Auszug | E | Support-Zugänge gibt es seit Z-1203 nicht mehr, die Wache kennt keinen Ersatz für ein fehlendes Recht; die Rolle Mitglied hat außer Lesen nur `installationen:neustart` und `installationen:log_auszug` (Z-1204) | `routes/zugang.test.ts` › a member › is refused <Route>; `routes/aktionen.test.ts` › lets a member restart and take a log excerpt, never „nur lesen“; `auth/rollen.test.ts` › lets a member change nothing else |
| B-27 | Ein Angreifer auf `api.<domain>` probiert Tokens durch | S | Annahme: `api.<domain>` hat keine Route, die API für das Portal ist gestrichen (Bauliste, „Später, bei Bedarf“); käme sie, dann mit Tokens als Hash und einem Rate-Limit mit eigenem Test | – |
| B-28 | Eine fremde Seite im Browser eines Mitglieds (etwa eine App unter derselben Domain) schreibt mit dessen Sitzung (CSRF) | S, E | Jede schreibende Anfrage mit Sitzung braucht den Origin der Oberfläche, sonst `403 fremder_ursprung` (Entscheidung „Schreiben nur vom eigenen Origin“); Better Auth prüft seine Pfade selbst gegen `STEUERZENTRALE_URL` | `routes/zugang.test.ts` › a write from a page of another origin › … is refused, with the member's session (jede schreibende Route) |

### Geheimnisse, Nachvollziehbarkeit, Netz

| Nr. | Bedrohung | Art | Maßnahme | Beleg |
| --- | --- | --- | --- | --- |
| B-30 | Ein Geheimnis steht im Klartext in Datenbank, Sicherung oder Audit-Log | I | AES-GCM-Spalten mit `STEUERZENTRALE_SECRET_KEY`, Schlüssel-ID, an Zweck und Zeile gebunden, rotierbar | `modules/geheim/speicher.test.ts` › are nowhere in the database file in plain text, the audit log included; › leaves no value on the old key in the database file, …; `modules/geheim/geheim.test.ts` › refuse another key, another purpose, a changed value or a changed key id |
| B-31 | Ein Geheimnis gelangt in ein Log, eine API-Antwort oder ein Ereignis | I | Logs ohne Query, Werte der Geheimnisse in Log-Auszügen ersetzt, API zeigt nur „gesetzt“ | `log.test.ts` › redactUrl; `routes/installationen.test.ts` › carry no secret: …; `modules/backups/abgleich.test.ts` › stand only encrypted in the database and in no log, …; `apps/agent/test/aktionen.agent.test.ts` › sends the app's lines with [geheim] … (nur CI) |
| B-32 | Die Zentrale startet ohne oder mit falschem Schlüssel | I | Start verweigert, der Wert wird nie ausgegeben | `env.test.ts` › refuses to start without a key, with a clear message; › refuses a key that is not 32 bytes, without repeating its value; `modules/geheim/speicher.test.ts` › must open the database: … |
| B-33 | Eine Handlung wird abgestritten oder das Audit-Log nachträglich geändert | R, T | Jede Änderung über `schreiben` mit Akteur, Zeit und Grund in derselben Transaktion; Trigger verbieten Ändern und Löschen | `modules/audit/schreiben.test.ts` › appends actor, time, action, target and reason with every insert; › cannot be changed or deleted, not even over the writable connection |
| B-34 | Eine Installation erreicht eine andere auf demselben Server | I, T | Eigenes Netz je Installation, HTTP nur auf `127.0.0.1`, eigener Linux-Nutzer | `apps/agent/test/pforte.agent.test.ts` › does not let installation A reach the port of B, by any way round the Pforte (nur CI); `apps/agent/src/einrichtung/einrichten.test.ts` › makes the user with a home of its own and no login shell |
| B-35 | Ein Client fälscht seine Adresse über `X-Forwarded-For` | S | Die Pforte setzt den Header selbst; die Zentrale glaubt ihn nur von `127.0.0.1` | `apps/agent/test/pforte.agent.test.ts` › hands the app the client's real address in X-Forwarded-For, never one the client sent (nur CI); `modules/anmeldung/adresse.test.ts` › ignores an X-Forwarded-For a client sends itself |
| B-36 | Die Oberfläche wird aus dem Internet angegriffen | S, E | Die Oberfläche lauscht nur auf `127.0.0.1` hinter der Pforte, die sie nur im WireGuard-Netz anbietet | `env.test.ts` › listens on localhost:8300 by default, behind the Pforte; Annahme: Firewall und WireGuard des Zentrale-Servers richtet der Inhaber ein („Schritte für Menschen“ in `BAULISTE.md`) |
| B-37 | Ein DNS-Eintrag eines anderen wird überschrieben | T | Die Zentrale ändert nur Einträge mit ihrem Kommentar | `modules/dns/plan.test.ts` › never joins or touches a record without the Zentrale's comment |
| B-38 | Ein Webhook wird gefälscht oder wiederholt | S, T | HMAC-SHA256 über Zeit und Körper, fünf Minuten gültig | `modules/benachrichtigung/signatur.test.ts` › fails for a forged one, …; › fails when older or newer than five minutes, … |

### Verfügbarkeit und Daten

| Nr. | Bedrohung | Art | Maßnahme | Beleg |
| --- | --- | --- | --- | --- |
| B-40 | Ein Update oder Neustart zerstört Daten oder trifft eine Sperrzeit | D | Backup vor jedem Update und Neustart, keine Aktion in einer Sperrzeit, Wellen | `modules/updates/anlegen.test.ts` › sends no update into a freeze window that began while the backup before ran; `modules/neustart/planen.test.ts` › reboots no server when a backup before fails, and says why; `modules/updates/schleife.test.ts` › starts no update in a freeze window, also within the maintenance window |
| B-41 | Backups sind da, lassen sich aber nicht zurückspielen | D | Wöchentlicher Prüf-Restore je Installation auf eigene Ports, Hinweis nach 8 Tagen ohne | `modules/pruef-restore/zeitplan.test.ts` › makes one on the installation's own server, …; `modules/pruef-restore/lesen.test.ts` › comes 8 days after the first successful backup without one, … |
| B-42 | Die Zentrale fällt aus oder ihre Daten gehen verloren | D | Sicherung der Datenbank mit restic, Schlüssel getrennt; Agenten verbinden sich nach der Wiederherstellung von selbst | CI-Schritt „The Zentrale is backed up and restored on a new server“ ([Zentrale sichern](zentrale-sichern.md)) |
| B-43 | Eine übernommene Zentrale hält Server an, entfernt Installationen oder löscht Backups | D | Annahme: Gegen eine übernommene Zentrale ist die Verfügbarkeit nicht geschützt (Leitsatz oben), nur die Ausführung fremden Codes; Schutz bieten die Härtung des Zentrale-Servers (nur WireGuard, mTLS, Token) und die getrennte Sicherung der Zentrale (B-42) | – |
| B-44 | Kundendaten werden vor Ende der Kündigungsfrist oder ohne Backup gelöscht | D | Entfernen nur einer Installation, die nicht läuft; das Löschen nach Vertragsende mit letztem Backup kommt mit Z-604 und seinem Test | `modules/installationen/entfernen.test.ts` › is refused while it is set up and once it runs; Annahme bis Z-604: Daten löscht nur ein Mensch, der eine Installation entfernt |
| B-45 | Jemand erreicht die Oberfläche durch den Cloudflare Tunnel ohne Access oder gibt sich durch ihn als Agent aus | S, E | Vor jeder Route außer denen von `agent.<domain>` ein gültiges Token von Access (RS256 mit dem Schlüssel des Teams, `iss`, `aud`, `exp`, `nbf`), Schlüssel nur von `https://<team>.cloudflareaccess.com`; eine Anfrage mit einem Kopf von Cloudflare gilt nie als Agent; die Pforte lässt die Oberfläche mit `--tunnel` nur von Loopback herein | `routes/access.test.ts` › answers 403 to a wrong signature, a wrong audience and an expired token; gives no agent's rights to a request through Cloudflare with a forged fingerprint; `modules/access/access.test.ts`; Annahme: Cloudflare sieht den Verkehr der Oberfläche (docs/plan.md, Z-1104) |

## Notzugang per SSH

Bei einer Störung, die der Agent nicht beheben kann (er läuft nicht, der Server bootet nicht sauber,
die Platte ist voll), braucht ein Mensch eine Shell. Dafür gilt (Entscheidung „Notzugang“ im
[Projektplan](plan.md#entscheidungen)):

- **Schlüssel je Person**: Jede Person mit Notzugang hat einen eigenen SSH-Schlüssel in
  `authorized_keys` des Admin-Kontos, kein geteilter Schlüssel, keine Passwort-Anmeldung
  (`PasswordAuthentication no`). Verlässt eine Person das Team, wird ihr Schlüssel auf allen Servern
  entfernt.
- **Nur über WireGuard**: `sshd` ist nur im WireGuard-Netz des Betreibers erreichbar; die Firewall
  des Servers lässt Port 22 von außen nicht durch. Annahme: Das richtet der Inhaber beim Aufsetzen
  des Servers ein, `install.sh` ändert weder `sshd` noch die Firewall. Die Prüfungen der Server
  dulden Port 22 als Systemport ([Prüfungen](pruefungen.md)), weil ein Server beim Kunden ihn für
  dessen eigene Verwaltung brauchen kann.
- **Jede Anmeldung ist ein Ereignis**: Der Agent liest jede erfolgreiche Anmeldung aus dem Journal
  von `sshd` und meldet sie; die Zentrale legt das Ereignis `ssh_anmeldung` (Schwere `warn`) mit
  Nutzer, Adresse und Verfahren über das Audit-Log an ([Server hinzufügen](server-hinzufuegen.md#ssh-anmeldungen)).
  Belegt durch `apps/agent/src/ssh/anmeldungen.test.ts` › reports each login and keeps the cursor of
  every line read; › starts after the saved cursor, so a login while the agent was away is not lost;
  `modules/verbindung/meldungen.test.ts` › an SSH login › becomes one event of the server through the
  audit log; › cannot flood the events and the audit log: ….
- **Mit Grund**: Wer sich anmeldet, trägt den Grund nachträglich am Ereignis bzw. im Ticket ein; eine
  Anmeldung ohne Grund wird in der regelmäßigen Überprüfung (unten) geklärt.

Ein Mensch mit Notzugang ist root auf dem Server und damit außerhalb dessen, was die Zentrale
technisch verhindern kann. Der Notzugang ist deshalb eine organisatorische Maßnahme mit technischem
Nachweis, keine technische Grenze.

## Anlage: Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

Diese Anlage beschreibt die Maßnahmen des Betreibers als Auftragsverarbeiter für den Betrieb der
Apps der Speicherstadt mit der Steuerzentrale. Sie ist Teil des Auftragsverarbeitungsvertrags. Wo
eine Maßnahme technisch umgesetzt ist, verweist sie auf die Bedrohung oben und damit auf ihren Test.

### Vertraulichkeit (Art. 32 Abs. 1 lit. b)

**Zutrittskontrolle**: Die Server stehen in Rechenzentren der Hoster (netcup bzw. beim Kunden) mit
deren Zutrittskontrolle; der Betreiber hat keinen physischen Zugang.

**Zugangskontrolle**

- Die Oberfläche der Zentrale ist nur über WireGuard erreichbar (B-36).
- Jedes Konto meldet sich mit Passkey oder mit Passwort und TOTP an; Rate-Limits gegen Durchprobieren
  (B-20, B-21).
- Server verbinden sich nur mit einem eigenen Client-Zertifikat, das sofort gesperrt werden kann
  (B-07, B-08); der Beitritt mit Einmal-Token und Rate-Limit (B-11).
- SSH nur mit Schlüssel je Person über WireGuard, jede Anmeldung als Ereignis (Notzugang oben).

**Zugriffskontrolle**

- Rollen Inhaber und Mitglied mit festen Rechten je Route, Schreiben nur von der Oberfläche
  selbst (B-22, B-23, B-28); kein Support-Zugang, der ein fehlendes Recht ersetzt (B-26).
- Trennung der Betreiber durch `betreiber_id` in jeder Abfrage (B-24).
- Auf den Servern läuft jede Installation unter einem eigenen Linux-Nutzer ohne Login-Shell, in
  einem eigenen Netz (B-34); der Agent führt nur signierte Manifeste aus (B-01 bis B-05).

**Trennungskontrolle**: Eine Installation je Kunde und App mit eigenem Nutzer, eigenen Volumes,
eigenem Netz, eigenem S3-Präfix und eigenem restic-Passwort (B-12, B-34); Betreiber getrennt (B-24);
Prüf-Restores laufen als eigene Kopie mit eigenen Ports (B-41).

**Pseudonymisierung**: Die Steuerzentrale verarbeitet selbst keine Inhaltsdaten der Kunden; sie
kennt Kunden unter einem Kürzel, Installationen unter Kürzel und App. Die Inhaltsdaten bleiben in
den Apps. In Log-Auszügen werden die Werte der Geheimnisse ersetzt (B-31). Eine weitergehende
Pseudonymisierung ist für den Betrieb nicht nötig und nicht vorgesehen.

**Verschlüsselung**

- Transport: TLS an jeder Pforte (Zertifikate von Let's Encrypt bzw. der internen CA), mTLS zwischen
  Agent und Zentrale, WireGuard zur Oberfläche, HTTPS zu Cloudflare, S3 und Registries.
- Ruhend: Geheimnisse in der Datenbank der Zentrale mit AES-GCM, der Schlüssel getrennt von der
  Datenbank und rotierbar (B-30, B-32); Backups mit restic verschlüsselt, das Passwort je
  Installation nur bei der Zentrale und auf ihrem Server (B-12).

### Integrität (Art. 32 Abs. 1 lit. b)

**Eingabekontrolle**: Jede schreibende Handlung steht mit Akteur, Zeit, Ziel und Grund im Audit-Log,
das sich nicht ändern oder löschen lässt (B-33); Meldungen der Agenten tragen den Server als Akteur.

**Weitergabekontrolle**: Code kommt nur über signierte Manifeste, Images per Digest und signierte
Agent-Binaries auf einen Server (B-01 bis B-05); Geheimnisse verlassen die Zentrale nur im Auftrag an
den Server ihrer Installation (B-12) und nie über die API (B-31).

### Verfügbarkeit und Belastbarkeit (Art. 32 Abs. 1 lit. b und c)

- Tägliche Backups jeder Installation mit restic auf ein S3-Ziel außerhalb des Servers, Aufbewahrung
  nach [Backups](backups.md); Backup vor jedem Update und Neustart (B-40).
- Updates in Wellen, in Wartungsfenstern und nie in einer Sperrzeit der App (B-40).
- Überwachung: Heartbeats, Health der Apps, Prüfung von außen, Prüfungen der Server, Benachrichtigung
  bei Störungen ([Health und Zustand](zustand.md), [Prüfung von außen](aussen.md)).
- Die Zentrale selbst wird täglich gesichert, der Schlüssel getrennt; die Wiederherstellung auf einem
  neuen Server ist in der CI erprobt (B-42).
- Begrenzungen gegen Überlastung durch Agenten und Clients (B-10, B-11, B-20).

### Rasche Wiederherstellung (Art. 32 Abs. 1 lit. c)

- Wöchentlicher Prüf-Restore jeder Installation mit Backups, ein Hinweis nach 8 Tagen ohne
  erfolgreichen (B-41).
- Wiederherstellung einer Installation aus einem Snapshot über die Oberfläche, mit Backup des
  aktuellen Stands davor ([Backups](backups.md)).
- Wiederherstellung der Zentrale nach [Zentrale sichern](zentrale-sichern.md).

### Umgang mit Sicherheitsvorfällen

- Meldung von Lücken nach `SECURITY.md`, privat über ein Security Advisory.
- Ein verlorener Server oder ein Zertifikat in fremden Händen wird in der Oberfläche gesperrt; die
  Verbindung endet sofort (B-07, [Server hinzufügen](server-hinzufuegen.md)).
- Der Schlüssel der Geheimnisse lässt sich rotieren (`steuerzentrale schluessel-rotieren`), die
  Zugänge zu S3 und DNS lassen sich je Betreiber und Installation neu setzen.
- Ereignisse (SSH-Anmeldung, stiller Server, gescheitertes Backup, offener Port) gehen als
  Benachrichtigung an den Betreiber ([Benachrichtigungen](benachrichtigungen.md)).
- Eine Verletzung des Schutzes personenbezogener Daten meldet der Betreiber dem Verantwortlichen
  unverzüglich (Art. 33 Abs. 2 DSGVO), mit dem, was Audit-Log und Ereignisse dazu zeigen.

### Regelmäßige Überprüfung (Art. 32 Abs. 1 lit. d)

- Jede Bedrohung auf dieser Seite hat einen automatischen Test, der bei jeder Änderung in der CI
  läuft; eine Änderung an Agent, Signaturen, Anmeldung, Rechten, Geheimnissen, Trennung der
  Betreiber, Audit-Log, Verbindung, Pforte oder `install.sh` braucht zusätzlich ein unabhängiges
  Review (`CLAUDE.md`, „Pull requests“).
- Abhängigkeiten hält Renovate aktuell (`SECURITY.md`); neue Laufzeit-Abhängigkeiten brauchen eine
  Begründung in `allowed-dependencies.json`.
- Vierteljährlich prüft der Inhaber: Mitglieder und Rollen, SSH-Schlüssel auf den Servern und die
  SSH-Anmeldungen des Quartals, gesperrte und stille Server, das Ergebnis der Prüf-Restores; einmal im
  Jahr diese Seite gegen den Stand der Software.
