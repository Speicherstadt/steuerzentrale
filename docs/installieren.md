---
title: Apps installieren
description: >-
  Wie die Steuerzentrale prüft, ob eine App auf einen Server passt (Platzierung), wie sie eine
  Installation anlegt (signiertes Manifest, Name, Ports, Einstellungen, Einrichtungsauftrag) und wie
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

Bis Manifeste importiert werden (Z-501), lädt der Betreiber im Dialog das signierte Manifest hoch:
den Text und die Signatur (`.minisig`). Die Zentrale prüft die Signatur mit demselben öffentlichen
Schlüssel, den sie in `install.sh` einsetzt (`minisign.pub` neben dem Installationsskript), und
lehnt ein Manifest ohne gültige Signatur ab, schon vor der Platzierung. Der Agent prüft sie vor dem
Einrichten noch einmal.

Dann, in dieser Reihenfolge:

1. **Platzierung** mit den neuesten Fakten des Servers, den Installationen darauf und den Werten des
   Betreibers, mit denen, die der Dialog dazu angibt ([Einstellungen](einstellungen.md)). Passt die
   App nicht, lehnt die Zentrale mit jedem Grund ab; fehlt ein Pflichtwert der Ebene `betreiber`,
   steht sein Name im Grund (`betreiberwert_fehlt`).
2. **Host**: eindeutig unter den nicht entfernten Installationen des Betreibers. Den DNS-Eintrag setzt
   die Zentrale erst mit Z-407.
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
sie `gescheitert` und kann noch einmal entfernt werden. Eine eingerichtete Installation entfernt erst
Z-604, nach einem Backup.

## In der Oberfläche

Den Knopf **App installieren** zeigen die Seite „Installationen“ und die Seite eines Kunden, dessen
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
- **Adresse** (Host) und **Grund** fürs Audit-Log.

Sobald Kunde, Server, Manifest und Signatur da sind, fragt der Dialog die **Platzierung** ab und
wiederholt das bei jeder Änderung von Kunde, Server, Manifest, Signatur oder Optionen; nur dieses
Feld wartet auf die Antwort. Es zeigt „Passt“, „Passt, mit Hinweis“ oder „Passt nicht“ und jeden
Grund und Hinweis als Satz; die Codes der Zentrale übersetzt die Oberfläche selbst, einen
unbekannten zeigt sie mit seinem Namen. Lehnt die Zentrale das Anlegen ab, bleibt der Dialog offen
und nennt den Fehler, bei `passt_nicht` mit allen Gründen.

Nach dem Anlegen steht die Installation in der Liste mit dem Zustand **wird eingerichtet**. Die
Liste filtert nach Zustand: eine gescheiterte Einrichtung zählt zu „Rot“, eine laufende zu „Ohne
Zustand“, eine entfernte steht nicht mehr darin. Die Seite einer Installation zeigt Kunde, Server,
Linux-Nutzer, Adresse, HTTP-Port, weitere Ports, Optionen, die Werte dieser Installation (ohne
Geheimnisse) und ihre Aufträge mit Zustand, letztem Schritt und Fehler. Nach einer gescheiterten
Einrichtung bietet sie **Entfernen …** mit Grund an, eine laufende **Einstellungen ändern**
([Einstellungen](einstellungen.md)). Health, Backups und Daten zeigen die Seiten bis
Z-403 und Z-406 nur für Installationen der Demodaten (`bun run dev:demo`).

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

### Wie es geprüft wird

In der CI (`apps/agent/test/einrichtung.agent.test.ts`) richtet der Agent die Beispiel-App per
Auftrag ein, mit echtem `useradd`, Linger, Quadlet und rootless Podman. Geprüft wird: die App läuft
unter ihrem Nutzer und antwortet auf ihrem Port, ein zweiter Auftrag ändert nichts, ein Secret
landet bei Podman und in keiner Datei, eine Installation kann die Dateien einer anderen nicht lesen,
und ein scheiternder Einrichtungsschritt hinterlässt weder Nutzer noch Home, Units, Prozesse oder
Container.
