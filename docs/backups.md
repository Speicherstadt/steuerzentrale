---
title: Backups
description: >-
  Wie jede Installation täglich in ihr eigenes restic-Repository auf dem S3-Ziel des Betreibers
  gesichert wird: was der Agent auf dem Server einrichtet, wie ein Lauf abläuft und wie die
  Zentrale davon erfährt.
---

# Backups

Jede Installation hat ein eigenes restic-Repository mit eigenem Passwort auf dem S3-Ziel ihres
Betreibers, unter dem Präfix `<bucket>/<betreiber>/<installation>/`, und einen S3-Zugang, der nur
dieses Präfix erreicht. Gesichert wird, was das signierte Manifest der App unter `backup` nennt
([Manifest](manifest.md)): Volumes, Datenbanken mit `pg_dump` und die Ausgabe benannter Befehle.
Jeder Teil wird ein eigener Snapshot mit eigenem Tag. Aufbewahrt werden je Teil 7 tägliche,
4 wöchentliche und 6 monatliche Snapshots.

## Auf dem Server

Ein Backup läuft auf dem Server selbst, als Linux-Nutzer der Installation (`sz-<installation>`),
gestartet von einem systemd-Timer dieses Nutzers. Es braucht die Zentrale nicht: auch wenn die
Verbindung zur Zentrale getrennt ist, wird gesichert, und die Zentrale erfährt die Läufe, sobald der
Agent wieder verbunden ist.

### Einrichten

Die Zentrale schickt den eingebauten Auftrag `installation_backup_einrichten` mit dem signierten
Manifest und dem Feld `backup`: Repository (`s3:https://<host>/<bucket>/<präfix>`), S3-Zugang
(Schlüssel-ID und Geheimnis) und restic-Passwort. Sie setzt diese Werte erst beim Zustellen ein; in
der Datenbank und im Audit-Log stehen sie nicht im Klartext. Der Agent nimmt den Auftrag nur für eine
Installation an, die er selbst fertig eingerichtet hat, und nur, wenn deren Units aus genau dem
Manifest des Auftrags gerendert sind (App und Version in ihren Labels): ein anderes Manifest könnte
andere Volumes oder Befehle nennen. Dann:

1. schreibt er als root `~/.config/steuerzentrale/backup.json` (0600, Eigentum des Nutzers, der
   Ordner 0700), ohne einem Symlink zu folgen. Darin stehen Repository, Zugang, Passwort und die
   Teile, aufgelöst aus dem signierten Manifest: ein Volume mit seinem Podman-Namen
   (`<installation>-<volume>`), ein Befehl mit Container und `argv` aus `befehle`, ein Dump als
   `pg_dump -Fc -U <nutzer> -d <datenbank>`;
2. schreibt er Timer und Service des Nutzers nach `~/.config/systemd/user/`: `sz_backup.timer`
   (täglich, zufällige Verzögerung bis eine Stunde, `Persistent=true`, also nach einem
   ausgeschalteten Server sofort nachgeholt) und `sz_backup.service` (`Type=oneshot`, startet
   `/usr/local/bin/steuerzentrale-agent sichern <installation>`, höchstens vier Stunden);
3. lädt er die Units des Nutzers neu und schaltet den Timer ein;
4. legt er das Repository an, falls es fehlt: das Agent-Binary als Nutzer fragt mit
   `restic cat config`, ob es da ist, und ruft sonst `restic init` auf.

Ein zweites Mal geschickt, etwa mit einem neuen Passwort, schreibt der Auftrag dieselben Dateien neu
und legt kein zweites Repository an. Erfolgreich meldet er
`{ installation, repository: "angelegt" | "vorhanden", teile: [<tags>], timer: "sz_backup.timer" }`.

### Ein Lauf

`steuerzentrale-agent sichern <installation>` läuft nur als Nutzer der Installation, nie als root
(als root würde Podman den Speicher von root benutzen und alle Volumes erreichen). Es liest
`backup.json` und startet restic aus dem Image, dessen Version und Digest in
`packages/manifest/src/system.ts` stehen, mit `podman run --rm` im Netz der Installation, ohne
Shell:

| Teil | Tag | Was restic sichert |
| --- | --- | --- |
| `volume` | `volume:<volume>` | das Volume, nur lesend eingehängt unter `/sicherung/<volume>` |
| `pg_dump` | `pg_dump:<container>:<datenbank>` | die Ausgabe von `podman exec <installation>-<container> pg_dump -Fc …` auf seiner Standardeingabe (`restic backup --stdin`), Datei `<container>-<datenbank>.dump` |
| `befehl` | `befehl:<name>` | die Ausgabe des Befehls aus `befehle`, ebenso, Datei `<name>` |

Jeder Snapshot trägt die Installation als Host (`--host`), weil sich der Hostname eines Containers
mit jedem Lauf ändert. Sind alle Teile gelungen, folgt
`restic forget --host <installation> --group-by host,tags --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`.
Scheitert ein Teil, laufen die übrigen trotzdem, die Aufbewahrung aber nicht: ein kaputter Teil soll
die älteren Snapshots nicht ausdünnen. Endet die Quelle eines Dumps oder Befehls mit einem Fehler,
vergisst restic den Snapshot, den es daraus gemacht hat, wieder: er sähe sonst aus wie ein ganzer.

Passwort und S3-Zugang bekommt restic weder in `argv` noch in seiner Umgebung: das Agent-Binary
schreibt beide in je eine Datei im Laufzeitordner des Nutzers (`/run/user/<uid>`, nur im
Arbeitsspeicher, 0700), öffnet sie und löscht sie, bevor restic startet. Podman reicht die beiden
offenen Dateien als Deskriptoren 3 und 4 in den Container (`--preserve-fds 2`), restic liest das
Passwort aus `RESTIC_PASSWORD_FILE=/dev/fd/3` und den Zugang als AWS-Zugangsdatei aus
`AWS_SHARED_CREDENTIALS_FILE=/dev/fd/4`. Die Ausgaben von restic und der Befehle gehen in keinen
Grund und kein Log.

Das Ergebnis jedes Laufs hängt `sichern` an `~/.config/steuerzentrale/backup-stand.json` an
(atomar, 0600, die letzten 14 Läufe): eine eigene ID, Beginn, Ende, gelungen oder nicht, je Teil Tag
und Snapshot, bei einem Fehler der Grund. Ein Grund nennt den Teil und, was restic mit seinem
Exit-Code sagt (`falsches Passwort des Repositorys`, `das Repository fehlt`, `das Repository ist
gesperrt`, `restic endete mit Code 1`, `die Quelle endete mit Code 2`, `Zeitlimit von 600 s
überschritten`), nie Ausgabe. Ein gescheiterter Lauf endet mit Code 1, so dass systemd den Service
als gescheitert zeigt.

Ein Befehl läuft höchstens sein `zeitlimit_s`; der ganze Lauf hört fünf Minuten vor dem Zeitlimit
des Service auf, damit er seinen Stand noch schreiben kann; den Container von restic, den Podman
nach dem Abbruch weiterlaufen ließe, entfernt er dann. Ist S3 nicht erreichbar, wiederholt restic
jede Anfrage bis zu 15 Minuten, bevor es aufgibt.

### Backup jetzt

„Backup jetzt“ ist der eingebaute Auftrag `installation_backup`, ohne Argumente und ohne Feld
`backup`. Der Agent startet damit `sz_backup.service` des Nutzers (läuft gerade einer, wartet er auf
diesen) und wartet auf sein Ende. Dann liest er den Stand: gelungen meldet er
`{ installation, lauf, teile }`, gescheitert den Grund des Laufs. Dieser Auftrag wartet nicht hinter
den Einrichtungsaufträgen des Servers, weil ein Backup Stunden dauern kann; das Einrichten eines
Backups schon.

### Was die Zentrale erfährt

Solange der Agent verbunden ist, liest er jede Minute die Stände aller Installationen, die er
eingerichtet hat, und schickt jeden Lauf, den er noch nicht gemeldet hat, als Nachricht
`backup_stand` – auch die Läufe, die während einer Trennung entstanden sind. Was er gemeldet hat,
merkt er sich in `/var/lib/steuerzentrale/backup-gemeldet.json`. Zu Beginn jeder Verbindung schickt
er den neuesten Lauf jeder Installation noch einmal, denn eine Nachricht, die beim Abbruch einer
Verbindung unterwegs war, kann verloren sein; die Zentrale nimmt einen Lauf an seiner ID nur einmal.
Den Stand liest der Agent als Nutzer der Installation, denn die Datei gehört dem Nutzer.

Wird eine Installation entfernt, gehen Timer, Service und beide Dateien mit ihrem Home
(`userdel --remove`).
