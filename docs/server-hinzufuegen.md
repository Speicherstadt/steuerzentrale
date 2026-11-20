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

Unter **Server → Server hinzufügen** (Rollen Inhaber und Technik):

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
5. setzt `net.ipv4.ip_unprivileged_port_start=80` (für die Pforte) und legt den öffentlichen
   Schlüssel für Manifeste unter `/etc/steuerzentrale/manifest.pub` ab;
6. lässt den Agenten das Token gegen sein Client-Zertifikat tauschen und richtet ihn als systemd-Dienst
   `steuerzentrale-agent` ein.

Ein zweiter Lauf auf einem Server, der schon beigetreten ist, tauscht kein Token mehr; er
aktualisiert Pakete, Agent und Unit.

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
`minisign.pub`, die beiden Binaries, `SHA256SUMS` und `SHA256SUMS.minisig`.
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

Ist ein Server verloren oder sein Zertifikat in fremden Händen, sperren Inhaber oder Technik es mit
Grund (`POST /api/v1/server/<id>/sperren`). Die Zentrale trennt eine laufende Verbindung sofort und
weist den Agenten ab da bei jedem Versuch ab. Eine Sperre lässt sich nicht aufheben: der Server
kommt nur zurück, indem er neu hinzugefügt wird.

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
