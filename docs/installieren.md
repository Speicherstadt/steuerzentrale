---
title: Apps installieren
description: >-
  Wie die Steuerzentrale prüft, ob eine App auf einen Server passt (Platzierung), wie sie eine
  Installation anlegt (importiertes Manifest, Name, Ports, Einstellungen, Einrichtungsauftrag) und wie
  der Agent sie auf dem Server einrichtet und bei einem Fehler wieder abbaut.
---

# Apps installieren

Vor jeder Installation prüft die **Platzierung**, ob die App mit den gewählten Optionen auf den
Server passt. Sie ist eine reine Funktion (`packages/manifest`, `platzieren`) und liefert eines von
drei Ergebnissen:

- **passt**: nichts spricht dagegen;
- **Hinweise**: es passt, aber knapp (RAM oder Platte danach über 80 %);
- **passt nicht**: mit jedem Grund, warum nicht.

## Regeln

| Regel | passt nicht, wenn … |
| --- | --- |
| Architektur | ein Container der App oder einer gewählten Option, oder eine gewählte Option ohne eigene Container, die Architektur des Servers nicht kennt (Kontext mit `documents` läuft nur auf amd64) |
| RAM | die Summe der Grenzen (`ram_mb` der App und der gewählten Optionen und aller Installationen auf dem Server) den RAM des Servers übersteigt |
| Platte | `platte_gb` der App den freien Platz übersteigt oder die Summe der Planwerte (`platte_gb` der App und aller Installationen auf dem Server) die Größe der Platte (in Stufe 1 Planwerte) |
| Feste Ports | ein fester Port (auch in einem Bereich, je Protokoll) schon von einer Installation oder dem Server belegt ist; vergebene Ports (`fest: false`) verteilt die Zentrale |
| Öffentliche IPv4 | die App eine öffentliche IPv4 braucht und der Server nur private Adressen hat |
| Mail | die App Mail verschickt und der öffentlichen Adresse ein PTR-Eintrag fehlt oder Port 25 ausgehend gesperrt oder unbekannt ist |
| Server für sich | die App einen Server für sich braucht (auch `rootful` und ein eigener Proxy) und schon etwas anderes darauf läuft, oder umgekehrt |
| Kunde und Betreiber | der Server einem anderen Betreiber gehört, oder ein eigener Server bzw. einer beim Kunden einem anderen Kunden |
| Abhängigkeiten | die App etwas braucht (`braucht`, z. B. `oidc-anbieter`), das keine Installation des Kunden bietet |
| Werte des Betreibers | ein Pflichtwert auf Ebene `betreiber` (z. B. die Hersteller-ID für ELSTER) fehlt |
| Agent | der Agent des Servers nicht verbunden ist |
| Image | ein Container der App oder einer gewählten Option noch kein Image hat (`noch_nicht_veroeffentlicht`) |
| Fakten | der Agent eine nötige Angabe (Architektur, RAM, Platte unter `/home/sz-*`, IPv4, belegte Ports) noch nicht gemeldet hat (`fakten_fehlen`) |

## Installation anlegen

Der Betreiber wählt im Dialog App und Version aus den importierten Manifesten
([Manifeste und Versionen](manifeste.md)); ein Hochladen gibt es seit Z-501 nicht mehr. Eine
Vorabversion bietet der Dialog nur für einen internen Kunden an, und die Zentrale lehnt sie für jeden
anderen ab (`409 nur_intern`), auch über die API. Eine Version ohne importiertes Manifest lehnt sie
mit `404 kein_manifest` ab. Die Signatur prüft die Zentrale noch einmal mit dem Schlüssel, den sie in
`install.sh` einsetzt, damit ein inzwischen gewechselter Schlüssel nicht erst auf dem Server
auffällt; der Agent prüft sie vor dem Einrichten ohnehin. Die Installation behält den Text ihres
Manifests.

Dann, in dieser Reihenfolge:

1. **Platzierung** mit den neuesten Fakten des Servers, den Installationen darauf und den Werten des
   Betreibers, mit denen, die der Dialog dazu angibt ([Einstellungen](einstellungen.md)). Passt die
   App nicht, lehnt die Zentrale mit jedem Grund ab; fehlt ein Pflichtwert der Ebene `betreiber`,
   steht sein Name im Grund (`betreiberwert_fehlt`).
2. **Host**: eindeutig unter den nicht entfernten Installationen des Betreibers. Liegt er unter der
   Domain des Betreibers, setzt die Zentrale nach dem Anlegen A und AAAA ([DNS](dns.md)); einen anderen
   Host setzt der Betreiber selbst.
3. **Einstellungen der Ebene `installation`** aus dem Dialog, geprüft gegen das Formular des
   Manifests (`einstellungenPruefen`): nur Einstellungen dieser Ebene, die mit den gewählten Optionen
   gelten, mit einem Wert ihres Typs; ein Pflichtfeld ohne Wert und ohne Vorgabe wird abgelehnt.
4. **Name** `<app>-<6 Zeichen a–z, 0–9>`, z. B. `haben-x7k2p9`; er ist das Präfix der Units und der
   Linux-Nutzer `sz-<name>`.
5. **Ports** aus 20000–29999 auf dem Server: der HTTP-Port auf 127.0.0.1 und jeder Port mit
   `fest: false` (ein Bereich als zusammenhängender Block), jeweils der niedrigste freie, ohne die
   Ports, die der Server laut Fakten schon belegt. Kein Port wird auf einem Server zweimal vergeben.
6. **Erzeugte Werte** (`erzeugen: zufall_32`, `zufall_64`, `zufall_hex_32`) für die Einstellungen der
   Ebene `auto`.
7. **Gegenrendern**: die Zentrale rendert die Units mit derselben Funktion wie der Agent und lehnt ab,
   was nicht rendert.

Erst dann schreibt sie in einer Transaktion mit dem Audit-Log die Installation (Zustand
`wird_eingerichtet`), ihre Ports, die Werte des Betreibers, die der Dialog dazu angab, den Auftrag
`installation_einrichten` und, wenn die App hinter der Pforte liegt, `pforte_route_setzen`, der auf
das Einrichten wartet ([Aufträge](auftraege.md)).

### Geheimnisse

Geheime Werte (Typ `geheim`, verschlüsselt gespeicherte Werte des Betreibers) und alle erzeugten
Werte stehen nur verschlüsselt in der Spalte `geheim` der Installation. Die Werte, die nicht geheim
sind, stehen lesbar daneben und kommen in der API zurück; ein Geheimnis gibt die API nie zurück, auch
nicht seinen verschlüsselten Wert. Erst beim Zustellen des Einrichtungsauftrags setzt die Zentrale
die Werte entschlüsselt in die Nachricht an den Agenten ein; im Auftrag in der Datenbank und im
Audit-Log stehen sie nicht. Die Werte des Betreibers gelten so, wie sie beim Anlegen waren; ändern
lassen sie sich mit „neu konfigurieren“ (Z-404).

### Zustände

| Zustand | Bedeutung |
| --- | --- |
| wird_eingerichtet | angelegt, der Einrichtungsauftrag läuft oder wartet auf den Agenten |
| laeuft | der Agent hat sie eingerichtet; die Route der Pforte geht jetzt an ihn |
| gescheitert | das Einrichten ist gescheitert; der Agent hat aufgeräumt, die Route wurde abgebrochen |
| entfernt | nach einem gescheiterten Einrichten mit `installation_entfernen` entfernt |

Entfernt wird hier nur eine Installation im Zustand `gescheitert`. Scheitert das Entfernen, bleibt
sie `gescheitert` und kann noch einmal entfernt werden. Eine eingerichtete Installation entfernt nur
die Löschung 90 Tage nach dem Vertragsende (`installation_loeschen`, nach einem Backup; siehe
[Kunden](kunden.md)), danach ist sie ebenfalls `entfernt`.

## In der Oberfläche

Den Knopf **App installieren** zeigen die Seite „Apps“ und die Seite eines Kunden, dessen
Vertrag nicht gekündigt ist, nur den Rollen Inhaber und Technik. Der Dialog fragt:

- **Kunde** (von der Kundenseite aus schon gewählt) und **Server**; gesperrte Server und Kunden nach
  Vertragsende stehen nicht zur Wahl;
- **Manifest** (`manifest.yml`) und **Signatur** (`manifest.yml.minisig`) als Dateien. Die
  Oberfläche liest das Manifest mit derselben Funktion wie die Zentrale (`manifestPruefen`) und nennt
  App und Version oder, was am Manifest nicht stimmt; die Signatur prüft nur die Zentrale;
- **Optionen** aus dem Manifest, je ein Kästchen;
- **Einstellungen dieser Installation**: ein Feld je Feld von `einstellungsFormular` für die Ebene
  `installation` und die gewählten Optionen, nach seinem Typ (Text, Zahl, Ja/Nein, geheim als
  Passwortfeld). Ein Pflichtfeld des Manifests ohne Vorgabe muss ausgefüllt sein; ein leeres Feld
  mit Vorgabe bleibt leer, dann gilt die Vorgabe des Manifests. `auto`-Werte setzt die Zentrale.
  Kein App-Name steht im Code der Oberfläche;
- **Fehlende Werte des Betreibers**, nur wenn die Platzierung einen Pflichtwert der Ebene
  `betreiber` vermisst: ein Feld je fehlendem Wert; die Zentrale speichert ihn mit der Installation
  für alle Installationen der App ([Einstellungen](einstellungen.md));
- **Adresse** (Host), vorgeschlagen als `<app>.<kürzel>.<domain>` aus der App des Manifests, dem
  Kürzel des Kunden und der Domain der DNS-Einstellungen; ohne Domain bleibt das Feld leer. Ein neuer
  Kunde oder ein neues Manifest bringt einen neuen Vorschlag ([DNS](dns.md));
- **Grund** fürs Audit-Log.

Sobald Kunde, Server, Manifest und Signatur da sind, fragt der Dialog die **Platzierung** ab und
wiederholt das bei jeder Änderung von Kunde, Server, Manifest, Signatur oder Optionen; nur dieses
Feld wartet auf die Antwort. Es zeigt „Passt“, „Passt, mit Hinweis“ oder „Passt nicht“ und jeden
Grund und Hinweis als Satz; die Codes der Zentrale übersetzt die Oberfläche selbst, einen
unbekannten zeigt sie mit seinem Namen. Lehnt die Zentrale das Anlegen ab, bleibt der Dialog offen
und nennt den Fehler, bei `passt_nicht` mit allen Gründen.

Nach dem Anlegen steht die Installation in der Liste mit dem Zustand **wird eingerichtet**.

### Die Seite „Apps“

Eine Tabelle mit jeder App, die nicht entfernt ist: **App** (Symbol und Name), **Kunde**, **Zustand**,
**Version**, **Letztes Backup** und **Server**. Ein Klick irgendwo in der Zeile öffnet die App.

- **Zustand** in Worten, mit Symbol: „Einrichtung gescheitert“ und „Störung: …“ (rot), „Backup ist
  … alt“ (der letzte gelungene Lauf älter als 26 h), „Backup gescheitert“, „Prüf-Restore
  gescheitert“ und eine gelbe Meldung des Agenten (gelb), „Keine Meldung …“ (unbekannt), „wird
  eingerichtet“ und „wird gerade aktualisiert“, sonst „läuft“.
- Was jemanden braucht, steht oben: rot, gelb, unbekannt, dann was unterwegs ist (Einrichtung,
  Update), dann der Rest, jeweils in der Reihenfolge der Zentrale.
- **Version**: die installierte; „→ 0.12.0“, solange ein Update läuft; die Marke „↑ 0.12.0“, wenn
  eine neuere Version angeboten ist ([Updates](updates.md)).
- Hinter dem Kunden „· gekündigt zum …“ nach einer Kündigung, „· eigene“ beim eigenen Kunden.
- Filter: **Alle**, **Braucht dich** (rot, gelb, unbekannt) und **Update möglich**; **Gruppieren**
  nicht, nach Kunde oder nach Server (eine graue Zeile je Gruppe); die Suche findet App, Kunde,
  Adresse und Server.
- In der Betriebsart „Nur für mich“ fehlen die Spalte „Kunde“ und „nach Kunde“.

Alle Backups auf einen Blick zeigt die Seite **Backups**, erreichbar über „Alle Backups“ im Reiter
„Backups“ einer App.

### Die Seite einer App

Im Kopf das Symbol, „App · Kunde“, der Zustand in einem Satz („Läuft, alles in Ordnung“ oder die
Störung) und die Adresse. Daneben **Öffnen** (die Adresse in einem neuen Fenster), **Neustart** und
**Mehr …** mit Log-Auszug, Backup jetzt, Prüf-Restore jetzt, Einstellungen ändern, Support-Zugang
starten oder beenden und „nur lesen“: jede Aktion nur, wo das Manifest oder die Backups sie anbieten,
und mit denselben Rechten wie bisher ([Aktionen](aktionen.md), [Backups](backups.md),
[Einstellungen](einstellungen.md), [Support-Zugang](support.md)). Nach einer gescheiterten
Einrichtung steht darunter **Entfernen …** mit Grund.

Die Reiter stehen in der Adresse (`?tab=`):

| Reiter | Inhalt |
| --- | --- |
| Überblick | fünf Zeilen: **Erreichbar** (Antwortzeit von außen, Zertifikat), **Version** (ein angebotenes Update mit „Aktualisieren …“, sonst aktuell), **Backup** (letzter Lauf, Größe, jede Nacht, letzter Prüf-Restore; „Backup jetzt“), **Verfügbarkeit** (dieser und der letzte Monat), **Server** (Verbindung, RAM, Platte); daneben der Kunde (Vertrag, Ansprechperson) und die letzten drei Ereignisse und Aufträge mit „Ganzer Verlauf“ |
| Messwerte | nur Gemessenes: die Verfügbarkeit der letzten 90 Tage als Balken je Tag ([Prüfung von außen](aussen.md)) und die Größe jedes nächtlichen Backups über 24 Stunden, 7 oder 30 Tage, die Skala von 0 bis zu einer runden Zahl; ein Zeitraum ohne Backup ist als solcher beschriftet. Antwortzeit, CPU und Arbeitsspeicher folgen, sobald der Agent sie meldet |
| Backups | Läufe, Prüf-Restore, Wiederherstellen und was nach einem Vertragsende folgt; „Alle Backups“ |
| Einstellungen | die Werte dieser Installation (ohne Geheimnisse) |
| Verlauf | jeder Wechsel des Zustands und die Ereignisse der App |
| Technik | Units und Health, Linux-Nutzer, Adresse, HTTP-Port, weitere Ports, Optionen, Version und Manifest (mit SHA-256), angelegt; Adresse und Prüfung von außen; die Aufträge der Einrichtung mit Zustand, letztem Schritt und Fehler; der Support-Zugang |

## API

Alle Rollen lesen, Inhaber und Technik schreiben. Jede schreibende Route verlangt einen `grund`, der
ins Audit-Log geht.

| Route | Körper | Antwort |
| --- | --- | --- |
| `POST /api/v1/installationen/platzierung` | `kundeId`, `serverId`, `manifest`, `signatur`, `optionen` | `{ platzierung }` mit `art` `passt`, `hinweise` oder `passt_nicht` und den Codes |
| `POST /api/v1/installationen` | wie oben, dazu `host`, `einstellungen` (Ebene `installation`), `betreiberWerte` (fehlende Werte des Betreibers, freiwillig), `grund` | `201` mit der Installation |
| `GET /api/v1/installationen` | – | `{ installationen }` |
| `GET /api/v1/installationen/:installationId` | – | die Installation mit ihren Aufträgen (Zustand, letzter Schritt, Fehler) und dem Formular ihrer Einstellungen |
| `DELETE /api/v1/installationen/:installationId` | `grund` | die Installation mit dem neuen Auftrag `installation_entfernen` |

Fehler kommen als `{ fehler }` mit einem Code, bei `passt_nicht` mit `gruende`, bei einem
ungültigen Manifest oder einem Wert, der nicht rendert, mit `detail`: `signatur_ungueltig`,
`manifest_ungueltig`, `nicht_einrichtbar` (422), `kein_kunde`, `kein_server`, `keine_installation`
(404), `server_gesperrt`, `passt_nicht`, `host_vergeben`, `keine_ports`, `nicht_gescheitert`,
`entfernen_laeuft` (409), `einstellung_ungueltig`, `ungueltig` (400), `kein_schluessel` (503, kein
öffentlicher Schlüssel neben `install.sh`).

## Auf dem Server

Eingerichtet wird eine Installation mit dem Auftrag `installation_einrichten`
([Aufträge](auftraege.md)). Er trägt das signierte Manifest der App, den Namen der Installation und
die Angaben der Zentrale (Kunde, Host, Ports, Optionen, Einstellungen); Units, Images und Befehle
stehen nie im Auftrag. Der Agent prüft Schlüssel und Signatur, lehnt einen ungültigen Namen (auch
`pforte`), einen Port außerhalb von 1024 bis 65535 und eine Option, die das Manifest nicht kennt,
ab, ohne etwas anzulegen, und rendert die Units selbst aus dem Manifest.

### Ablauf

Jeder Schritt ist ein festes Programm mit festen Argumenten, ohne Shell:

1. Bei einer App hinter der [Pforte](pforte.md) (`proxy: geteilt`) schreibt er die Unit der Pforte
   unter `sz-pforte` und startet sie, falls sie noch nicht läuft.
2. `useradd` legt den Linux-Nutzer `sz-<installation>` an: Home `/home/sz-<installation>` mit
   0700, keine Login-Shell (`/usr/sbin/nologin`), eigene Gruppe. Der Nutzer braucht Einträge in
   `/etc/subuid` und `/etc/subgid` für rootless Podman.
3. `loginctl enable-linger`; der Agent wartet, bis der systemd-Nutzer-Manager läuft.
4. Die Units nach `~/.config/containers/systemd/`, die Slice (RAM-Grenze) nach
   `~/.config/systemd/user/`, die Dateien aus `dateien` nach `~/.config/steuerzentrale/dateien/`,
   alles als Eigentum des Nutzers. Units 0600, Ordner 0700; eine Datei aus `dateien` 0644, damit
   der Prozess im Container sie lesen kann, geschützt durch das Home mit 0700.
5. Jedes Geheimnis als Podman-Secret, über die Standardeingabe von `podman secret create`, nie als
   Argument (das sähe jeder Nutzer in der Prozessliste) und nie in einer Datei. Die Standardeingabe
   ist eine benannte Pipe, die Podman 4.9 dafür verlangt; ihr Knoten liegt in einem Ordner nur für
   root und ist gelöscht, bevor Podman startet.
6. `podman pull` jedes Images per Digest.
7. `systemctl --user daemon-reload` und `start` der Units; der Agent wartet, bis sie aktiv sind.
8. Die Befehle aus `schritte.einrichten` (etwa eine Migration) mit
   `podman exec <installation>-<container>`.

Die Schritte 5 bis 8 laufen als Nutzer der Installation, mit `runuser` und einer festen Umgebung
(`HOME`, `USER`, `PATH`, `XDG_RUNTIME_DIR`, Bus des Nutzers); die Dateien aus Schritt 4 schreibt
der Agent als root und übergibt sie dem Nutzer, ohne einem Symlink im Home zu folgen. So trennt der
Nutzer die Installation
von jeder anderen: Dateien, Netz und Prozesse. Der ganze Auftrag hat höchstens 30 Minuten. Die
Route der Pforte setzt die Zentrale erst, wenn das Einrichten gelungen ist (`pforte_route_setzen`).

### Abbau, wenn ein Schritt scheitert

Scheitert ein Schritt, baut der Agent alles ab, bevor er das Ergebnis meldet: Units stoppen,
`loginctl disable-linger`, `loginctl terminate-user`, `userdel --remove`. Mit dem Home verschwinden
Units, Volumes, Images und Secrets. Zurück bleibt nichts: kein Nutzer, kein Home, kein Container. Das
Ergebnis nennt den Schritt und endet mit „alles abgebaut“. Gelingt auch der Abbau nicht, sagt das
Ergebnis „Abbau unvollständig“, und `installation_entfernen` kann es noch einmal versuchen.

### Gedächtnis des Agenten

In `/var/lib/steuerzentrale/installationen.json` (nur für root lesbar) merkt sich der Agent jede
Installation, die er anlegt: „angelegt“, bevor `useradd` läuft, „fertig“, wenn alle Schritte
gelungen sind. Daran hält er sich:

- Einen Nutzer `sz-<name>` oder ein Home `/home/sz-<name>`, das er nicht selbst angelegt hat, fasst
  er nie an: Einrichten und Entfernen lehnt er ab.
- Ein doppelt zugestellter Einrichtungsauftrag richtet einmal ein; für eine fertige Installation
  ändert ein weiterer nichts. Startete der Agent mitten im Einrichten neu, baut er die halbe
  Installation ab und richtet sie neu ein.
- `installation_entfernen` nimmt er nur für eine Installation an, deren Einrichtung nicht fertig
  wurde. Eine laufende Installation hat Daten; sie wird erst mit Backup entfernt (Z-604).
- Befehle aus Aufträgen führt er nur in Installationen aus, die er fertig eingerichtet hat.
- Mit „fertig“ merkt er sich, was die Health-Prüfung braucht: die Units und das Ziel der Prüfung
  aus dem signierten Manifest ([Health und Zustand](zustand.md)).
- Ist die Datei unlesbar, richtet er nichts ein, entfernt nichts und führt keinen Befehl aus, bis
  sie repariert ist.

### Neu konfigurieren

Neue Einstellungen bringt der Auftrag `installation_konfigurieren` auf den Server. Er hat dieselbe
Form wie `installation_einrichten` (signiertes Manifest, Name, Feld `einrichtung` mit Optionen,
Ports und Einstellungen), und der Agent prüft und rendert ihn ebenso. Er nimmt ihn nur an, wenn

- die Installation in seinem Gedächtnis „fertig“ ist (eine fremde oder halb eingerichtete lehnt er
  ab, ohne etwas zu tun),
- die Units dieselben bleiben wie im Gedächtnis: andere Optionen ändert neu konfigurieren nicht,
- jede Datei, die er schreiben würde, schon da ist (eine Unit, die Slice oder eine Datei aus
  `dateien`); sonst änderte sich, welche Dateien die Installation hat.

Dann, jeder Schritt ein festes Programm ohne Shell, als Nutzer der Installation:

1. Den alten Stand sichern, nur im Speicher: den Inhalt der Units, der Slice und der Dateien (als
   root gelesen, ohne einem Symlink im Home zu folgen) und die Werte der Podman-Secrets. Die Namen
   liefert `podman secret ls`, die Werte `podman secret inspect --showsecret`, beides über eine
   Pipe in den Speicher des Agenten, nie in eine Datei, ein Log oder ein Ergebnis. Sind sie nicht
   lesbar, bricht er ab, bevor er etwas ändert.
2. Units, Slice und Dateien neu schreiben, jedes Secret mit `podman secret rm` entfernen und mit
   `podman secret create` über die benannte Pipe neu anlegen.
3. `systemctl --user daemon-reload`, `reset-failed` und `restart` der Units; er wartet, bis sie
   aktiv sind und zehn Sekunden lang aktiv bleiben. Die Units starten bei einem Absturz neu
   (`Restart=always`), eine App, die beim Start abbricht, ist darum kurz aktiv und fällt dann aus.

Scheitert ein Schritt, schreibt er die alten Dateien zurück, legt die alten Secrets wieder an und
startet die Units neu, jeder Schritt mit eigenem Zeitlimit, auch wenn das des Auftrags abgelaufen
ist. Das Ergebnis nennt den Schritt und endet mit „alter Stand wiederhergestellt“ oder
„Wiederherstellung unvollständig: …“. Volumes und Daten fasst er nie an, er zieht kein Image, und
`schritte.einrichten` laufen nicht noch einmal. Das Gedächtnis (Units, Ziel der Prüfung) ändert er
nur, wenn alles gelungen ist. Konfigurationsaufträge laufen in derselben Reihe wie die
Einrichtungsaufträge, einer nach dem anderen. Startet der Agent mitten im Neukonfigurieren neu,
meldet er den Auftrag als gescheitert („Agent neu gestartet“), statt ihn zu wiederholen; der Neustart
der App könnte sonst später kommen, als die Zentrale ihn erlaubt hat.

### Wie es geprüft wird

In der CI (`apps/agent/test/einrichtung.agent.test.ts`) richtet der Agent die Beispiel-App per
Auftrag ein, mit echtem `useradd`, Linger, Quadlet und rootless Podman. Geprüft wird: die App läuft
unter ihrem Nutzer und antwortet auf ihrem Port, ein zweiter Auftrag ändert nichts, ein Secret
landet bei Podman und in keiner Datei, eine Installation kann die Dateien einer anderen nicht lesen,
und ein scheiternder Einrichtungsschritt hinterlässt weder Nutzer noch Home, Units, Prozesse oder
Container. In `apps/agent/test/konfigurieren.agent.test.ts` konfiguriert er die Beispiel-App mit
einem neuen `BEISPIEL_TITEL` neu: der neue Wert ist im Container, ein vorher über HTTP angelegter
Eintrag ist noch da, das Secret hat seinen Wert. Mit einem Titel, bei dem die App beim Start abbricht,
läuft danach wieder der alte Stand mit dem Eintrag.
