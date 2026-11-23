---
title: Zentrale sichern
description: >-
  Wie der Betreiber die Steuerzentrale selbst sichert und auf einem neuen Server wiederherstellt:
  die Datenbank als eine Datei mit restic auf ein S3-Ziel, der Schlüssel getrennt davon, und warum
  sich die Agenten danach ohne Zutun wieder verbinden.
---

# Zentrale sichern

Alles, was die Zentrale weiß, steht in einer Datei: der Datenbank `zentrale.db` in ihrem
Datenverzeichnis (`STEUERZENTRALE_DATA`). Dazu gehören Betreiber, Kunden, Server, Installationen,
Aufträge, das Audit-Log und alle Geheimnisse, auch die CA, an der die Zertifikate der Agenten hängen.
Jedes Geheimnis ist darin mit `STEUERZENTRALE_SECRET_KEY` verschlüsselt. Gesichert werden deshalb
zwei Dinge, und zwar **getrennt**:

| Was | Wohin | Wie oft |
| --- | --- | --- |
| die Datenbank | mit restic in ein eigenes Repository auf einem S3-Ziel | täglich |
| `STEUERZENTRALE_SECRET_KEY` und das restic-Passwort | offline beim Betreiber (Passwortmanager, Ausdruck im Tresor) | einmal, und nach jedem Rotieren |

Der Schlüssel liegt nie im Repository und nie auf dem S3-Ziel. Wer nur die Sicherung bekommt, liest
darin keinen Zugang und kann kein Zertifikat für einen Agenten ausstellen. Ohne den Schlüssel lässt
sich die Sicherung aber auch nicht wiederherstellen: Er gehört an einen Ort, den ein Ausfall des
Servers nicht trifft.

!!! warning "Nach dem Rotieren des Schlüssels"
    Sicherungen von vor dem Rotieren (`steuerzentrale schluessel-rotieren`) öffnet nur der alte
    Schlüssel. Den alten Schlüssel deshalb aufheben, bis die letzte Sicherung mit ihm aus der
    Aufbewahrung gefallen ist, also sechs Monate.

Die Agent-Dateien (`STEUERZENTRALE_AGENT_DATEIEN`) und die übrigen Variablen sind keine Daten der
Zentrale: Die Agent-Dateien kommen aus dem Release, die Variablen aus der Einrichtung des Dienstes.

## Sichern

`steuerzentrale sichern <datei>` schreibt eine konsistente Kopie der Datenbank nach `<datei>`,
während die Zentrale weiterläuft. Der Befehl braucht dieselben Variablen wie der Dienst. Die Datei
ist nur für den Nutzer der Zentrale lesbar (0600). Eine frühere Sicherung an derselben Stelle wird
erst ersetzt, wenn die neue vollständig und geprüft ist.

Danach bringt restic die Datei in ein eigenes Repository mit eigenem Passwort. Dafür am besten ein
anderes S3-Ziel nehmen als das der Installationen, mindestens aber einen eigenen Bucket mit einem
eigenen Zugang. Die Zentrale selbst braucht dafür keinen S3-Zugang; restic läuft als Image mit Digest
wie bei den Installationen (`RESTIC_IMAGE` in `packages/manifest/src/system.ts`).

Ein Beispiel als systemd-Dienst mit Timer auf dem Server der Zentrale. Pfade und Namen sind
Beispiele; `zentrale.env` hält die Variablen des Dienstes, `sicherung.env` den S3-Zugang
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), beide nur für root lesbar:

```ini
# /etc/systemd/system/steuerzentrale-sichern.service
[Unit]
Description=Sicherung der Steuerzentrale

[Service]
Type=oneshot
EnvironmentFile=/etc/steuerzentrale/zentrale.env
EnvironmentFile=/etc/steuerzentrale/sicherung.env
Environment=RESTIC_REPOSITORY=s3:https://s3.example.de/zentrale-sicherung/steuerzentrale
Environment=RESTIC_PASSWORD_FILE=/etc/steuerzentrale/restic-passwort
Environment=RESTIC=docker.io/restic/restic@sha256:…
ExecStart=/usr/local/bin/steuerzentrale sichern /var/lib/steuerzentrale/sicherung/zentrale.sicherung.db
ExecStart=/bin/sh -c 'podman run --rm --network host \
  -v /var/lib/steuerzentrale/sicherung:/sicherung:ro \
  -v "$RESTIC_PASSWORD_FILE:/passwort:ro" -e RESTIC_PASSWORD_FILE=/passwort \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  "$RESTIC" --no-cache --repo "$RESTIC_REPOSITORY" backup --host steuerzentrale /sicherung'
ExecStart=/bin/sh -c 'podman run --rm --network host \
  -v "$RESTIC_PASSWORD_FILE:/passwort:ro" -e RESTIC_PASSWORD_FILE=/passwort \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  "$RESTIC" --no-cache --repo "$RESTIC_REPOSITORY" \
  forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune'

# /etc/systemd/system/steuerzentrale-sichern.timer
[Timer]
OnCalendar=*-*-* 02:17
Persistent=true

[Install]
WantedBy=timers.target
```

Das Repository legt einmal `restic init` an. Aufbewahrt wird wie bei den Installationen: 7 tägliche,
4 wöchentliche und 6 monatliche Snapshots ([Backups](backups.md)).

## Wiederherstellen auf einem neuen Server

1. Den neuen Server so einrichten wie den alten: die Zentrale mit **denselben Adressen**
   (`STEUERZENTRALE_URL`, `STEUERZENTRALE_AGENT_URL`) und ihre Pforte. Den Dienst noch nicht starten.
2. `STEUERZENTRALE_SECRET_KEY` vom getrennten Ort eintragen.
3. Die Datei aus restic holen: mit dem restic-Image wie oben, den Ordner
   `/var/lib/steuerzentrale/sicherung` als `/sicherung` eingehängt (ohne `:ro`), und
   `restore latest --target /`.
4. `steuerzentrale wiederherstellen /var/lib/steuerzentrale/sicherung/zentrale.sicherung.db` mit den
   Variablen des Dienstes ausführen.
5. Die DNS-Einträge der Oberfläche, von `agent.` und `api.` auf die IP des neuen Servers zeigen lassen
   und den Dienst starten.

`wiederherstellen` schreibt nur in ein leeres Datenverzeichnis. Liegt dort schon eine Datenbank,
lehnt der Befehl ab; auf demselben Server das alte Verzeichnis vorher beiseitelegen. Er prüft die
Datei auf Schäden, öffnet sie mit dem Schlüssel (ein falscher Schlüssel wird abgelehnt) und spielt
neuere Migrationen ein, wenn die Zentrale inzwischen neuer ist als die Sicherung. Scheitert etwas,
bleibt im Datenverzeichnis nichts liegen.

## Die Agenten

Auf den verwalteten Servern ist nichts zu tun. Jeder Agent baut seine Verbindung selbst wieder auf,
sobald `agent.<domain>` auf den neuen Server zeigt: nach einer Unterbrechung versucht er es immer
wieder, mit wachsendem Abstand bis höchstens fünf Minuten. Sein Client-Zertifikat hängt an der CA
seines Betreibers, und die kommt mit der Datenbank zurück; die Pforte prüft gegen genau diese CA. Das
Server-Zertifikat der Pforte für `agent.<domain>` stellt eine öffentliche CA neu aus, dem vertraut der
Agent ohnehin. Auch Passkeys gelten weiter, weil sie an die Domain der Oberfläche gebunden sind.

Verloren ist, was nach der letzten Sicherung geschah: Heartbeats und Fakten schicken die Agenten
gleich neu; Aufträge, Einstellungen oder Anmeldungen aus dieser Zeit fehlen und sind bei Bedarf noch
einmal anzustoßen.

## Wie es geprüft ist

Die CI sichert im Job `server` die laufende Zentrale mit einem verbundenen Agenten in einer VM,
bringt die Datei mit restic auf ein S3-Ziel, prüft, dass der Snapshot nur die Datenbank und nicht den
Schlüssel enthält, stoppt Zentrale und Pforte, stellt die Sicherung in ein neues Datenverzeichnis
wieder her und startet beide dort. Danach muss der Agent wieder Heartbeats schicken, und Server,
Fingerabdruck und Ereignisse müssen da sein.
