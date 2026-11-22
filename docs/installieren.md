---
title: Apps installieren
description: >-
  Wie die Steuerzentrale prüft, ob eine App auf einen Server passt (Platzierung): Architektur, RAM,
  Platte, Ports, IPv4, Mail, Server für sich, Kunde und Betreiber, Abhängigkeiten; und wie der Agent
  eine Installation auf dem Server einrichtet und bei einem Fehler wieder abbaut.
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
   Argument (das sähe jeder Nutzer in der Prozessliste) und nie in einer Datei.
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
- Ist die Datei unlesbar, richtet er nichts ein, entfernt nichts und führt keinen Befehl aus, bis
  sie repariert ist.

### Wie es geprüft wird

In der CI (`apps/agent/test/einrichtung.agent.test.ts`) richtet der Agent die Beispiel-App per
Auftrag ein, mit echtem `useradd`, Linger, Quadlet und rootless Podman. Geprüft wird: die App läuft
unter ihrem Nutzer und antwortet auf ihrem Port, ein zweiter Auftrag ändert nichts, ein Secret
landet bei Podman und in keiner Datei, eine Installation kann die Dateien einer anderen nicht lesen,
und ein scheiternder Einrichtungsschritt hinterlässt weder Nutzer noch Home, Units, Prozesse oder
Container.
