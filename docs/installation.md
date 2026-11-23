---
title: Installation
description: >-
  Die Zentrale im Ein-Server-Betrieb einrichten: Image und Agent-Dateien prüfen, die Zentrale als
  rootless Podman-Quadlet unter einem eigenen Nutzer starten, die Pforte davorsetzen, den ersten
  Inhaber anlegen und den Agenten desselben Servers beitreten lassen.
---

# Installation

Diese Seite richtet die Steuerzentrale im **Ein-Server-Betrieb** ein: Zentrale, Pforte und Agent
laufen auf demselben Server, der danach auch Apps aufnehmen kann. Die CI geht genau diese Schritte
mit jedem Release-Kandidaten in einer Incus-VM durch (Job `release-kandidat`); was der Test anders
macht, steht am Ende.

Was ein Release enthält:

| Teil | Wo | Geprüft mit |
| --- | --- | --- |
| Image der Zentrale für amd64 und arm64 | `ghcr.io/speicherstadt/steuerzentrale@sha256:…` | Digest im Release, `SHA256SUMS` |
| Quadlet-Unit der Zentrale | `steuerzentrale.container` im Release | `SHA256SUMS` |
| Agent-Binaries, `install.sh`, `VERSION` | Agent-Dateien im GitHub-Release | `SHA256SUMS` und `SHA256SUMS.minisig` |
| öffentlicher Schlüssel | `minisign.pub` | Schlüssel-ID aus der Release-Notiz |

Die Zentrale läuft als Container, ihr Image enthält das Binary und die gebaute Oberfläche. Die
Agent-Dateien liegen daneben in einem Verzeichnis des Servers: Die Zentrale liefert sie an neue
Server aus und aktualisiert mit ihnen die Agenten ([Updates des Agenten](agent-updates.md)).

## Voraussetzungen

- ein Server mit Debian 13 oder Ubuntu 24.04 (amd64 oder arm64), 2 GB RAM für Zentrale, Pforte und
  Agent, dazu was die Apps brauchen;
- zwei DNS-Namen auf die öffentliche Adresse des Servers, etwa `zentrale.example.de` für die
  Oberfläche und `agent.example.de` für die Agenten; Port 80 und 443 offen (Zertifikate per
  HTTP-01);
- WireGuard zum Server: Die Oberfläche antwortet nur Adressen aus dem WireGuard-Netz (im Beispiel
  `10.8.0.0/24`). Auf dem Rechner des Betreibers führt die WireGuard-Verbindung die öffentliche
  Adresse des Servers mit (`AllowedIPs = 10.8.0.0/24, <öffentliche Adresse>/32`), damit
  `zentrale.example.de` durch den Tunnel geht;
- Root auf dem Server. Alle Befehle unten laufen als Root.

Befehle als ein anderer Nutzer laufen über eine kleine Funktion, die dessen systemd und Podman
erreicht (der Nutzer hat keine Login-Shell; `cd /`, weil er `/root` nicht lesen darf):

```sh
als() (
  u="$1"; shift; uid="$(id -u "$u")"
  cd / && runuser -u "$u" -- env -i HOME="$(getent passwd "$u" | cut -d: -f6)" \
    XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" \
    PATH=/usr/local/bin:/usr/bin:/bin "$@"
)
```

## 1. Pakete

```sh
apt-get update && apt-get install -y podman curl ca-certificates minisign
```

Podman 4.9 ist das Minimum (Ubuntu 24.04 bringt es mit, Debian 13 eine neuere Version).

## 2. Nutzer und Ports

Die Zentrale läuft unter `sz-zentrale`, die Pforte unter `sz-pforte`, beide rootless und mit
Lingering, damit ihre Units beim Start des Servers ohne Anmeldung laufen. `install.sh` legt
`sz-pforte` später genauso an und lässt einen vorhandenen Nutzer stehen.

```sh
printf 'net.ipv4.ip_unprivileged_port_start=80\n' > /etc/sysctl.d/90-steuerzentrale.conf
sysctl -p /etc/sysctl.d/90-steuerzentrale.conf
useradd --create-home --home-dir /home/sz-zentrale --shell /usr/sbin/nologin \
  --comment "Zentrale der Steuerzentrale" sz-zentrale
useradd --create-home --home-dir /home/sz-pforte --shell /usr/sbin/nologin \
  --comment "Pforte der Steuerzentrale" sz-pforte
loginctl enable-linger sz-zentrale
loginctl enable-linger sz-pforte
```

## 3. Agent-Dateien prüfen

Die Agent-Dateien des Releases kommen nach `/home/sz-zentrale/agent-dateien`. Vor allem anderen wird
die Signatur geprüft, mit dem öffentlichen Schlüssel aus der Release-Notiz (nicht mit der
`minisign.pub`, die neben den Dateien liegt):

```sh
mkdir -p /home/sz-zentrale/agent-dateien && cd /home/sz-zentrale/agent-dateien
# die Dateien des Releases hierher laden: install.sh, steuerzentrale-agent-linux-x64,
# steuerzentrale-agent-linux-arm64, VERSION, SHA256SUMS, SHA256SUMS.minisig, minisign.pub
minisign -Vm SHA256SUMS -P '<öffentlicher Schlüssel aus der Release-Notiz>'
sha256sum -c SHA256SUMS
chmod -R a+rX /home/sz-zentrale/agent-dateien
```

Derselbe Schlüssel prüft später die Agent-Binaries auf jedem Server und die Manifeste der Apps
([Server hinzufügen](server-hinzufuegen.md)).

## 4. Schlüssel, Adressen, Unit

`STEUERZENTRALE_SECRET_KEY` verschlüsselt jedes Geheimnis der Zentrale. Er liegt nur als
Podman-Secret auf dem Server und eine Kopie **offline** beim Betreiber, getrennt von jeder Sicherung
([Zentrale sichern](zentrale-sichern.md)):

```sh
head -c 32 /dev/urandom | base64 > /root/steuerzentrale-schluessel   # offline sichern, dann löschen
als sz-zentrale podman secret create steuerzentrale-secret-key - < /root/steuerzentrale-schluessel
```

Die Adressen stehen in einer Datei neben der Unit:

```sh
cat > /home/sz-zentrale/steuerzentrale.env <<'EOF'
STEUERZENTRALE_URL=https://zentrale.example.de
STEUERZENTRALE_AGENT_URL=https://agent.example.de
EOF
```

Die Unit `steuerzentrale.container` aus dem Release nennt das Image mit seinem Digest; sie kommt in
die Quadlet-Units des Nutzers:

```sh
install -D -m 0644 steuerzentrale.container \
  /home/sz-zentrale/.config/containers/systemd/steuerzentrale.container
chown -R sz-zentrale: /home/sz-zentrale && chmod 600 /home/sz-zentrale/steuerzentrale.env
```

Die Unit startet das Image mit `Network=host`: Die Zentrale hört nur auf `127.0.0.1:8300`, und die
Pforte erreicht sie dort. Ihre Daten liegen im Volume `steuerzentrale-daten`, die Agent-Dateien sind
nur lesbar eingehängt. `AutoUpdate` ist nicht gesetzt: Die Zentrale aktualisiert ein Mensch (unten).

## 5. Starten

```sh
als sz-zentrale systemctl --user daemon-reload
als sz-zentrale systemctl --user start steuerzentrale
curl -fsS http://127.0.0.1:8300/health
```

Der erste Start lädt das Image und legt die Datenbank an. `/health` antwortet mit
`{"status":"ok","version":"…"}`.

## 6. Pforte davorsetzen

Die Pforte (Caddy) beendet TLS für beide Namen. Ihre Unit ist dieselbe, die der Agent schreibt; die
Zentrale gibt sie aus, weil die Pforte hier laufen muss, bevor der Agent beitreten kann:

```sh
als sz-zentrale podman exec steuerzentrale steuerzentrale pforte-unit > /root/sz-pforte.container
install -D -m 0644 /root/sz-pforte.container /home/sz-pforte/.config/containers/systemd/sz-pforte.container
chown -R sz-pforte: /home/sz-pforte/.config
als sz-pforte systemctl --user daemon-reload
als sz-pforte systemctl --user start sz-pforte
```

Dann setzt `steuerzentrale pforte` die Routen der Zentrale in die Konfiguration der Pforte. Der
Befehl liest die laufende Konfiguration über die Admin-API, ersetzt nur seine eigenen Routen (die der
Installationen bleiben) und gibt das Ergebnis für `POST /load` aus; Caddy übernimmt es ohne
Neustart oder lehnt es ganz ab. Die Argumente sind die Netze, aus denen die Oberfläche erreichbar ist:

```sh
pforte_laden() {
  sock=/home/sz-pforte/pforte/admin.sock
  curl -fsS --unix-socket "$sock" http://localhost/config/ |
    als sz-zentrale podman exec -i steuerzentrale steuerzentrale pforte 10.8.0.0/24 > /root/pforte.json &&
    curl -fsS --unix-socket "$sock" -H 'content-type: application/json' \
      --data-binary @/root/pforte.json http://localhost/load
}
pforte_laden
```

Was die Pforte damit tut:

| Name | Wer | Was |
| --- | --- | --- |
| `zentrale.example.de` | nur Adressen aus den angegebenen Netzen | die Oberfläche und ihre API |
| `agent.example.de` | alle | nur `/install.sh`, `/agent/*`, `/api/v1/agent/*` und `/health`; ein Client-Zertifikat wird gegen die CA jedes Betreibers geprüft und sein Fingerabdruck an die Zentrale weitergegeben |

Solange es noch keinen Betreiber gibt, fehlt `agent.example.de` (noch keine CA); Schritt 7 lädt die
Pforte deshalb noch einmal.

## 7. Erster Inhaber

Beim ersten Start schreibt die Zentrale einen Einrichtungscode in ihr Log, einmal, 24 Stunden gültig
([Anmeldung und Rollen](anmeldung.md)):

```sh
journalctl _UID="$(id -u sz-zentrale)" -o cat | grep '"setup code for the first owner"'
```

Über WireGuard `https://zentrale.example.de/erster-inhaber` öffnen, den Code eingeben, Betreiber und
Inhaber anlegen und den zweiten Faktor einrichten. Danach hat der Betreiber seine CA für die Agenten:

```sh
pforte_laden
```

`pforte_laden` läuft wieder, wenn ein weiterer Betreiber dazukommt. Ein Agent, dessen CA die Pforte
nicht kennt, kommt nicht durch.

## 8. Der Agent desselben Servers

In der Oberfläche unter Server einen Server anlegen (Art „gemeinsam“ oder „eigen“) und den
angezeigten Befehl auf diesem Server ausführen ([Server hinzufügen](server-hinzufuegen.md)). Der
Agent holt sich sein Zertifikat, verbindet sich über `agent.example.de` mit der Zentrale und erscheint
in der Oberfläche als verbunden. Von da an ist der Server ein Server wie jeder andere: Apps darauf
setzt die Pforte daneben, an den Routen der Zentrale ändert das nichts.

## Betrieb

- **Sichern**: wie in [Zentrale sichern](zentrale-sichern.md), nur im Container:
  `als sz-zentrale podman exec steuerzentrale steuerzentrale sichern /var/lib/steuerzentrale/sicherung/zentrale.sicherung.db`;
  die Datei liegt im Volume `steuerzentrale-daten` (`als sz-zentrale podman volume inspect steuerzentrale-daten`
  nennt den Pfad auf dem Server), restic nimmt sie von dort.
- **Aktualisieren**: das neue Release prüfen wie in Schritt 3, die Agent-Dateien ersetzen, die neue
  `steuerzentrale.container` einsetzen, `daemon-reload` und `restart`. Die Zentrale wendet beim Start
  ihre Migrationen an; die Agenten folgen im Wartungsfenster ihres Servers.
- **Log**: `journalctl _UID="$(id -u sz-zentrale)"`, ohne Geheimnisse bis auf den Einrichtungscode.

## Was der Test in der CI anders macht

Der Job `release-kandidat` baut den Kandidaten und geht diese Seite in einer Incus-VM (Debian 13)
durch. Er weicht nur hier ab:

| Echtes Release | Release-Kandidat in der CI |
| --- | --- |
| Image `ghcr.io/speicherstadt/steuerzentrale`, ein Mensch setzt den Tag und pusht | Image nur in einer lokalen Registry auf dem Runner, per HTTP |
| `SHA256SUMS` signiert mit dem echten Schlüssel, offline | signiert mit dem öffentlichen Test-Schlüssel (`test/schluessel/`), den ein Release-Build ablehnt |
| `install.sh` ohne Zusatz | `install.sh --testmodus`, weil nur er den Test-Schlüssel annimmt |
| Zertifikate per ACME | Caddys lokale CA (`steuerzentrale pforte … --intern`), der VM und dem Agenten bekannt gemacht |
| Oberfläche über WireGuard | Oberfläche von der Adresse des Runners auf der Brücke der VM |
| erster Inhaber und Server in der Oberfläche | dieselben API-Aufrufe aus `testhilfen/erster-server.ts` |

Der Kandidat liegt als Workflow-Artefakt `release-kandidat` vor: Image als OCI-Archiv, Quadlet-Unit,
Digest und Agent-Dateien, jeweils mit `SHA256SUMS` und Signatur des Test-Schlüssels. Er ist nur zum
Testen: Kein Server außerhalb der CI nimmt den Test-Schlüssel ohne `--testmodus`.
