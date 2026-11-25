---
title: Server hinzufügen
description: >-
  Wie ein Server zur Steuerzentrale kommt: Einmal-Token in der Oberfläche, install.sh auf dem Server,
  signierter Agent, Token-Tausch gegen ein Client-Zertifikat.
---

# Server hinzufügen

Ein Server kommt mit einem einzigen Befehl zur Zentrale. Der Agent darauf verbindet sich danach von
sich aus; einen offenen Port für ihn gibt es nicht.

## In der Oberfläche

Unter **Server → Server hinzufügen** (nur der Inhaber):

- **Name** des Servers;
- **Art**: gemeinsam (mehrere Kunden), eigen (ein Kunde, unser Server) oder beim Kunden; bei den
  letzten beiden der **Kunde** (einer des eigenen Betreibers mit laufendem Vertrag, aus [Kunden und Verträge](kunden.md));
- **Wartungsfenster**: täglich von–bis, Uhrzeit in Berlin; Neustarts nur dort und nie in einer
  Sperrzeit der Apps auf dem Server;
- **Grund**, der im Audit-Log steht.

Danach zeigt die Zentrale **einmal** den Befehl mit dem Einmal-Token:

```sh
curl -fsSL https://agent.<domain>/install.sh | sudo sh -s -- --token <token>
```

Der Token gilt **24 Stunden** und **einmal**. Die Zentrale speichert nur seinen SHA-256; wer den
Dialog schließt, ohne den Befehl zu kopieren, legt den Server neu an.

## Auf dem Server

Der Befehl läuft als root auf **Debian 13** oder **Ubuntu 24.04** (amd64 oder arm64). `install.sh`
(im Repository unter `install/install.sh`):

1. prüft System, Architektur, cgroup v2 mit den Controllern `cpu`, `memory` und `pids` und die
   Uhrzeit (höchstens 60 Sekunden Abweichung von der Zentrale);
2. installiert Podman (ab 4.9), minisign und unattended-upgrades und schaltet die
   Sicherheitsupdates ein;
3. delegiert `cpu`, `cpuset`, `io`, `memory` und `pids` an die systemd-Dienste der Nutzer (für
   rootless Podman);
4. lädt `SHA256SUMS`, dessen Signatur `SHA256SUMS.minisig` und den Agenten für die Architektur des
   Servers und installiert ihn nur, wenn die Signatur mit dem öffentlichen Schlüssel im Skript gilt
   und die Prüfsumme stimmt;
5. setzt `net.ipv4.ip_unprivileged_port_start=80` (für die Pforte), legt den Linux-Nutzer der
   [Pforte](pforte.md) `sz-pforte` an (ohne Login-Shell, mit Linger) und legt den öffentlichen
   Schlüssel für Manifeste unter `/etc/steuerzentrale/manifest.pub` ab;
6. lässt den Agenten das Token gegen sein Client-Zertifikat tauschen und richtet ihn als systemd-Dienst
   `steuerzentrale-agent` ein.

Ein zweiter Lauf auf einem Server, der schon beigetreten ist, tauscht kein Token mehr; er
aktualisiert Pakete, Agent und Unit.

### Server nur beobachten

Auf einem Server, auf dem schon etwas läuft (ein eigener Caddy auf 80 und 443, ein Cloudflare
Tunnel, Dienste von Hand), bringt `--nur-beobachten` nur den Agenten dazu:

```sh
curl -fsSL https://agent.<domain>/install.sh | sudo sh -s -- --token <token> --nur-beobachten
```

Dann installiert `install.sh` **kein Paket** (kein Podman, kein unattended-upgrades, keine Änderung
an dessen Einstellungen), setzt kein `sysctl`, delegiert keine cgroup-Controller, legt keinen
Nutzer `sz-pforte` an und prüft cgroup v2 nicht. `minisign`, `curl` und `sha256sum` müssen schon da
sein; fehlt eines, bricht es ab, ohne etwas zu ändern. Es prüft und installiert den Agenten wie
oben, legt `/etc/steuerzentrale/nur-beobachten` an und richtet den Dienst ein.

Den Modus hält der Agent: steht die Datei da, nimmt er keinen Auftrag an außer seinem eigenen
Update. Einrichten, Pforte, Neustart einer App, Log-Auszug, Backup, Prüf-Restore, Wiederherstellen,
Update, Abwicklung, Neustart des Servers und jeder Befehl eines Manifests enden mit „abgelehnt: der
Server wird nur beobachtet“, auch wenn die Zentrale sie schickt. Die Zentrale kann den Modus nicht
aufheben; sie erfährt ihn aus den Fakten (`nurBeobachten`), stellt für den Server keinen solchen
Auftrag aus (`409 nur_beobachten`), plant keinen Neustart, und die Platzierung lehnt ihn ab
(`nur_beobachten`). Die Prüfung „offene Ports, die kein Manifest nennt“ meldet auf ihm nichts: was
dort lauscht, ist nicht ihres. Heartbeat, Fakten, die übrigen Prüfungen und SSH-Anmeldungen kommen
wie von jedem Server. Die Seite des Servers zeigt „nur beobachtet“ und bietet keinen Neustart an.

Ein zweiter Lauf behält den Modus, mit oder ohne Schalter. Einen Server, der als verwalteter
beigetreten ist, stellt `--nur-beobachten` nicht um (Abbruch, nichts geändert). Wer einen
beobachteten Server später verwalten will, löscht die Datei auf dem Server selbst und lässt
`install.sh` ohne den Schalter laufen.

## Token-Tausch

Der Agent erzeugt seinen Schlüssel (ECDSA P-256) selbst; er verlässt den Server nie
(`/var/lib/steuerzentrale/agent.key`, nur für root lesbar). An die Zentrale geht nur eine
Zertifikatsanfrage (PKCS#10) mit dem Token, an `https://agent.<domain>/api/v1/agent/beitreten`. Die
Zentrale stellt das Zertifikat aus der **Agent-CA ihres Betreibers** aus (Inhaber: die ID des
Servers, Verwendung: nur Client-Authentifizierung, ein Jahr gültig) und speichert davon nur den
SHA-256-Fingerabdruck; Zertifikat und CA legt der Agent neben seinen Schlüssel. Ein benutzter, ein
abgelaufener oder ein unbekannter Token wird abgelehnt, ebenso eine Anfrage ohne gültige Signatur.

Mit dem Zertifikat verbindet sich der Agent über WSS mit mTLS an `agent.<domain>`
([Verbindung und Heartbeat](#verbindung-und-heartbeat)). Je Adresse sind zehn Versuche in zehn
Minuten erlaubt; eine IPv6-Adresse zählt mit ihrem ganzen /64.

## Was `agent.<domain>` ausliefert

| Pfad | Inhalt |
| --- | --- |
| `/install.sh` | das Skript, mit der Adresse für Agenten und dem öffentlichen Schlüssel eingesetzt |
| `/agent/steuerzentrale-agent-linux-x64`, `…-linux-arm64` | der Agent |
| `/agent/SHA256SUMS`, `/agent/SHA256SUMS.minisig` | Prüfsummen und ihre minisign-Signatur |
| `/api/v1/agent/beitreten` | der Token-Tausch |
| `/api/v1/agent/verbindung` | die Verbindung des Agenten (WebSocket, nur mit Client-Zertifikat) |

Die Dateien liegen in einem Verzeichnis, das `STEUERZENTRALE_AGENT_DATEIEN` nennt: `install.sh`,
`minisign.pub`, die beiden Binaries, `SHA256SUMS` und `SHA256SUMS.minisig`, dazu `VERSION` mit der
Version der Binaries, auf die die Zentrale ältere Agenten bringt ([Updates des
Agenten](agent-updates.md); `VERSION` liefert sie nicht aus).
`STEUERZENTRALE_AGENT_URL` ist die Adresse, unter der die Agenten die Zentrale erreichen
(`https://agent.<domain>`); sie steht im Befehl und im Skript und ist Pflicht.

## Verbindung und Heartbeat

Der Dienst `steuerzentrale-agent` öffnet einen WebSocket an
`wss://agent.<domain>/api/v1/agent/verbindung`, mit seinem Client-Zertifikat. Er meldet sich mit
`hallo` (Version, Architektur), die Zentrale antwortet mit `willkommen`, und danach schickt der Agent
alle **30 Sekunden** einen Heartbeat. Die Zentrale speichert die Heartbeats 30 Tage.

In der Oberfläche und in der API (`GET /api/v1/server`) hat jeder Server einen dieser Zustände:

| Zustand | Bedeutung |
| --- | --- |
| verbunden | die Verbindung ist offen, der letzte Heartbeat ist höchstens 75 Sekunden alt |
| seit x min still | die Verbindung ist offen, aber seit x Minuten kam kein Heartbeat |
| getrennt | keine Verbindung |

Kommt **3 Minuten** lang kein Heartbeat, legt die Zentrale ein Ereignis an („Agent … still“), einmal
je Stille. Bricht die Verbindung ab, verbindet sich der Agent von selbst wieder: zuerst nach etwa
einer Sekunde, dann mit jeder vergeblichen Wiederholung doppelt so lange, höchstens nach fünf
Minuten, mit etwas Zufall, damit nach einem Neustart der Zentrale nicht alle Agenten gleichzeitig
kommen.

### TLS an der Pforte

TLS beendet Caddy, die Pforte auf dem Server der Zentrale. Auf `agent.<domain>` prüft sie ein
Client-Zertifikat, wenn eines kommt (`install.sh` und der Token-Tausch kommen ohne), gegen die
Agent-CAs der Betreiber und gibt seinen SHA-256-Fingerabdruck an die Zentrale auf `127.0.0.1`
weiter. Auf allen anderen Hostnamen löscht sie den Header, damit niemand einen Fingerabdruck
erfinden kann. Die Zentrale glaubt ihn nur vom Loopback:

```text
agent.example.de {
	tls {
		client_auth {
			mode verify_if_given
			trust_pool file /var/lib/steuerzentrale/agent-cas.pem
		}
	}
	reverse_proxy 127.0.0.1:8300 {
		header_up X-SZ-Client-Fingerabdruck {http.request.tls.client.fingerprint}
	}
}

zentrale.example.de {
	reverse_proxy 127.0.0.1:8300 {
		header_up -X-SZ-Client-Fingerabdruck
	}
}
```

### Zertifikat rotieren

Das Zertifikat gilt ein Jahr. In seinen letzten **30 Tagen** erzeugt der Agent einen neuen
Schlüssel und holt über die bestehende Verbindung ein neues Zertifikat. Bis er sich damit verbunden
hat, gelten altes und neues; danach nur das neue. Beides steht im Audit-Log.

### Zertifikat sperren

Ist ein Server verloren oder sein Zertifikat in fremden Händen, sperrt der Inhaber es mit
Grund (`POST /api/v1/server/<id>/sperren`). Die Zentrale trennt eine laufende Verbindung sofort und
weist den Agenten ab da bei jedem Versuch ab. Eine Sperre lässt sich nicht aufheben: der Server
kommt nur zurück, indem er neu hinzugefügt wird.

## Fakten des Servers

Nach jedem `willkommen` und danach alle **15 Minuten** schickt der Agent die Fakten seines Servers.
Was er nicht lesen kann, meldet er als leer („unbekannt“), nie geschätzt. Er liest nur Dateien und
startet nur Befehle mit festen Argumenten, keine Shell:

| Fakt | Quelle |
| --- | --- |
| CPU-Kerne, Arbeitsspeicher | `/proc/cpuinfo`, `/proc/meminfo` |
| Platte je Mount | `/proc/mounts` (beschreibbare Dateisysteme auf Platten und `/`), `statfs` |
| Architektur | `uname` (`x86_64` → amd64, `aarch64` → arm64) |
| Betriebssystem | `NAME` und `VERSION_ID` aus `/etc/os-release` |
| Kernel | läuft: `/proc/sys/kernel/osrelease`; installiert: der neueste in `/boot`, sonst `/lib/modules` |
| Neustart nötig | `/var/run/reboot-required` oder ein neuerer installierter Kernel als der laufende |
| ausstehende Updates | `apt-get -s -q upgrade` (simuliert nur): die Pakete, die es aktualisieren würde, und die zurückgehaltenen, etwa ein neuer Kernel |
| Boot | Boot-ID aus `/proc/sys/kernel/random/boot_id`, Startzeit aus `btime` in `/proc/stat` ([Betriebssystem und Neustarts](betriebssystem.md)) |
| unattended-upgrades | installiert (`/usr/bin/unattended-upgrade`), an (`APT::Periodic::Unattended-Upgrade` aus `apt-config dump`), letzter Lauf (Änderungszeit von `/var/lib/apt/periodic/unattended-upgrades-stamp`) |
| Podman | `podman --version` |
| IPv4, IPv6 | die Adressen der Netzwerkschnittstellen ohne Loopback, Link-Local und Podmans Netze |
| PTR | Rückwärtsauflösung jeder öffentlichen Adresse |
| belegte Ports | `/proc/net/tcp`, `tcp6`, `udp`, `udp6` |
| offene Ports | dieselben Tabellen, ohne Loopback und Podmans Brücken ([Prüfungen](pruefungen.md)) |
| Zertifikate | Ende jedes Zertifikats der Pforte, aus Caddys Speicher im Volume `sz-pforte-daten` |
| ausgehender Port 25 | eine TCP-Verbindung zu `gmail-smtp-in.l.google.com:25`, höchstens 5 Sekunden, ohne SMTP |
| Uhrzeit | Abweichung von der Uhr der Zentrale, gemessen an `willkommen` |
| Zeitdienst synchron | `timedatectl show --property=NTPSynchronized --value` |

Die Zentrale zeigt die neuesten Fakten am Server (Oberfläche und `GET /api/v1/server`) und bewahrt
ihren Verlauf 30 Tage auf. Aus diesem Verlauf zeigt der Reiter „Auslastung“ eines Servers, wie voll
jede Platte war (`GET /api/v1/server/<id>/platten?tage=30`: je Stunde und Mountpunkt der höchste
Wert, 1 bis 30 Tage, für jede Rolle, die Server liest). Die Platzierung und die [Prüfungen](pruefungen.md) rechnen mit genau
diesen Werten; für die Platzierung zählt als Platte die, auf der die Home-Verzeichnisse der
Installationen liegen. Zum Nachsehen auf dem Server zeigt `steuerzentrale-agent fakten` dieselben
Fakten.

### SSH-Anmeldungen

Der Agent folgt dem Journal des SSH-Dienstes (`journalctl --unit=ssh.service --unit=sshd.service
--output=json --follow`) und meldet jede angenommene Anmeldung mit Nutzer, Adresse und Verfahren.
Die Zentrale legt daraus ein Ereignis am Server an („SSH-Anmeldung auf …“). Nach einem Neustart
des Agenten liest er ab der letzten gemeldeten Anmeldung weiter, eine Anmeldung in der Zwischenzeit
geht also nicht verloren.

## Schlüssel

Agent-Binaries und Manifeste signiert derselbe Schlüssel; der private liegt offline beim Inhaber.
Für ein Release signiert ein Mensch `SHA256SUMS` mit `minisign -Sm SHA256SUMS` und legt den
öffentlichen Schlüssel als `minisign.pub` daneben. Die CI legt das Verzeichnis mit
`bun scripts/agent-dateien.ts <verzeichnis>` an und signiert mit dem öffentlich bekannten
Test-Schlüssel aus `test/schluessel/`. Diesen Schlüssel nehmen `install.sh` und der Agent nur mit
`--testmodus` an, und nur im Testmodus darf die Zentrale über HTTP statt HTTPS erreichbar sein.

Den Schlüssel im Skript setzt die Zentrale ein, von der das Skript kommt. Einem neuen Server bleibt
ohnehin nichts, als dieser Zentrale beim ersten Mal zu vertrauen (`curl … | sh`); wer sichergehen
will, vergleicht die Schlüssel-ID in `/etc/steuerzentrale/manifest.pub` mit der veröffentlichten.
Ein Server, der schon beigetreten ist, behält seinen Schlüssel.
