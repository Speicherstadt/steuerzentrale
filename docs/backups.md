---
title: Backups
description: >-
  Wie jede Installation täglich in ihr eigenes restic-Repository auf dem S3-Ziel des Betreibers
  gesichert wird: was der Agent auf dem Server einrichtet, wie ein Lauf abläuft, wie die Zentrale
  davon erfährt, und in der Zentrale S3-Ziel, eigene Zugänge je Installation und „Backup jetzt“.
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

## In der Zentrale

### S3-Ziel

Unter **Einstellungen → Backup** setzen Inhaber und Technik mit Grund:

| Angabe | Bedeutung |
| --- | --- |
| Endpunkt | der MinIO des Betreibers als `https://…` ohne Pfad; `http://` nur auf `localhost`, `127.0.0.1` oder `::1` (ein MinIO neben der Zentrale) |
| Region | wie im MinIO eingestellt, sonst `us-east-1` |
| Bucket | ein Bucket nach den Regeln von S3 (Kleinbuchstaben, Ziffern, Punkt, Bindestrich) |
| Access Key und Secret Key des Admins | ein Zugang, der Service-Accounts anlegen darf (etwa der Root-Zugang des MinIO) |

In 1.0 sind nur MinIO-kompatible Ziele möglich: die Zentrale legt die Zugänge der Installationen
über die Admin-API von MinIO an. Der Zugang des Admins liegt verschlüsselt in der Zentrale
(`geheimnisse`, mit `STEUERZENTRALE_SECRET_KEY`, rotierbar wie jedes Geheimnis). Keine Antwort der API
enthält ihn, die Oberfläche zeigt nur „gesetzt“; beide Felder leer lassen behält ihn. Das Audit-Log
vermerkt ihn nur als geändert. Kein Server bekommt ihn.

Beim ersten Speichern ist der Zugang Pflicht (`422 zugang_fehlt`). Endpunkt und Bucket lassen sich
nur ändern, solange keine Installation dort einen Zugang hat (`409 ziel_in_benutzung`); Region und
Zugang jederzeit. Support sieht die Angaben, ändert sie aber nicht.

### Zugang und Passwort je Installation

Sobald `installation_einrichten` einer Installation gelingt, erzeugt die Zentrale für sie:

| Was | Wie |
| --- | --- |
| Präfix | `<betreiber>/<installation>/` im Bucket |
| Repository | `s3:<endpunkt>/<bucket>/<betreiber>/<installation>` |
| S3-Zugang | ein Service-Account `sz-<installation>` mit eigenem Access Key (im Auftrag `schluesselId`) und Secret Key (`geheim`) |
| restic-Passwort | 48 zufällige Zeichen |

Zugang und Passwort liegen verschlüsselt in `backup_zugaenge`, bevor MinIO sie kennt. Dann legt die
Zentrale den Service-Account mit dieser Policy an:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::<bucket>"],
      "Condition": { "StringLike": { "s3:prefix": ["<betreiber>/<installation>/", "<betreiber>/<installation>/*"] } }
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::<bucket>/<betreiber>/<installation>/*"]
    }
  ]
}
```

Der Zugang einer Installation kann also nur ihr eigenes Präfix auflisten, lesen, schreiben und
löschen, keines einer anderen Installation, auch keines mit gleichem Anfang (`haben-abc` und
`haben-abcd`), und nichts am Bucket selbst.

Die Anfragen an MinIO signiert die Zentrale selbst (AWS Signature V4); den Körper von
`add-service-account` verschlüsselt sie mit dem Secret Key des Admins, wie MinIO es verlangt
(PBKDF2-SHA256 und AES-256-GCM). Gelingt das Anlegen, schickt sie dem Server der Installation den
Auftrag `installation_backup_einrichten`. Erst beim Zustellen setzt sie das Feld `backup` ein
(Repository, Zugang, Passwort), und nur, wenn die Installation auf genau diesem Server steht: ein
Server bekommt nie Zugang oder Passwort einer fremden Installation. In der Datenbank steht der Auftrag
ohne diese Werte.

Scheitert das Anlegen (kein S3-Ziel, MinIO nicht erreichbar, falscher Zugang des Admins), versucht die
Zentrale es wieder: nach 1, 2, 4, 8 … Minuten, höchstens stündlich, und sofort nach neuen
Einstellungen. Ein Versuch nach einem Fehlschlag löscht den Service-Account erst, falls der vorige ihn
schon angelegt hatte. Der erste Fehlschlag einer Reihe schreibt das Ereignis `backup_fehler`
(Schwere `warn`) an die Installation, ein anhaltender höchstens eines am Tag. Der Grund enthält nie
ein Geheimnis.

Nach erfolgreichem `installation_entfernen` löscht die Zentrale den Service-Account (ein schon
fehlender zählt als gelöscht). Die Zeile mit dem restic-Passwort bleibt, damit das Repository lesbar
bleibt; Repository und Passwort löscht erst die Kündigung (Z-604).

### Läufe

Jeden Lauf meldet der Agent als `backup_stand` (siehe oben): seine ID `lauf`, Beginn und Ende,
jeden Teil mit Tag und Snapshot oder Grund, Erfolg oder Grund des Laufs. Die Zentrale nimmt eine
Meldung nur für eine Installation dieses Servers und Betreibers an; jede andere verwirft sie und
schreibt das ins Log. Jeder Lauf wird eine Zeile in `backups` (13 Monate aufbewahrt), mit seinem Ende
als Zeitpunkt, höchstens dem Zeitpunkt der Ankunft. Den neuesten Lauf, den der Agent bei jeder neuen
Verbindung noch einmal schickt, erkennt sie an `lauf`: er bleibt eine Zeile. Ein gescheiterter Lauf
schreibt das Ereignis `backup_gescheitert` (Schwere `fehler`) mit seinem Grund, einmal je Lauf.

Die Seite **Backups** zeigt jede Installation mit ihren Teilen, dem letzten Lauf (gescheitert mit
Grund und dem letzten Erfolg), den Snapshots des letzten Laufs und dem Stand: Zugang wird angelegt,
wird auf dem Server eingerichtet, eingerichtet. Die Übersicht zählt, bei wie vielen Installationen der
letzte Lauf gelang. Der Reiter **Backups** einer Installation zeigt die letzten 100 Läufe mit jedem
Snapshot.

### Backup jetzt

Auf der Seite einer laufenden Installation, deren Backups eingerichtet sind, startet **Backup jetzt**
mit Grund einen Lauf sofort (Auftrag `installation_backup`, Inhaber und Technik). Nicht, solange ein
Backup-Auftrag der Installation offen ist (`409 backup_laeuft`) oder bevor die Backups eingerichtet sind
(`409 nicht_eingerichtet`). Ein Backup startet die App nicht neu und läuft darum auch in einer
Sperrzeit.

### API

| Route | Wer | Körper | Antwort |
| --- | --- | --- | --- |
| `GET /api/v1/backup-ziel` | alle Rollen | – | `{ endpunkt, region, bucket, zugangGesetzt }` |
| `PUT /api/v1/backup-ziel` | Inhaber, Technik | `endpunkt`, `region`, `bucket`, `accessKey`?, `secretKey`?, `grund` | wie `GET` |
| `GET /api/v1/backups` | alle Rollen | – | `{ installationen: [{ installationId, app, kundeName, serverName, teile, zugang, eingerichtet, letzter, letzterErfolg, … }] }` |
| `GET /api/v1/installationen/:id/backups` | alle Rollen | – | `{ installationId, teile, zugang, eingerichtet, laeufe }` |
| `POST /api/v1/installationen/:id/backup` | Inhaber, Technik | `grund` | `201 { auftrag }` |

Fehler: `400 ungueltig`, `404 keine_installation`, `409 laeuft_nicht`, `409 nicht_eingerichtet`,
`409 backup_laeuft`, `409 ziel_in_benutzung`, `422 zugang_fehlt`. Keine Antwort enthält einen Zugang,
ein Passwort oder ein Repository. Jeder Betreiber sieht und ändert nur seine eigenen Backups und sein
eigenes S3-Ziel.

Audit-Log:

| Aktion | Wann |
| --- | --- |
| `backup.ziel` | S3-Ziel oder Zugang des Admins gesetzt |
| `backup.zugang-angelegt` | Zugang einer Installation angelegt, mit ihrem Auftrag (Akteur `system`) |
| `backup.zugang-geloescht` | Zugang einer entfernten Installation gelöscht (Akteur `system`) |
| `backup.zugang-fehler` | ein Versuch gescheitert, mit dem nächsten Zeitpunkt |
| `backup.stand` | ein Lauf gemeldet (Akteur `server:<id>`) |
| `installation.backup` | „Backup jetzt“, mit Grund |

### Tests

Die Admin-API von MinIO wird in den Tests der Zentrale nachgebaut
(`apps/zentrale/src/testhilfen/minio.ts`, ein Bun-Server im Speicher): er prüft die Signatur, öffnet
den verschlüsselten Körper mit dem Secret Key des Admins und antwortet wie MinIO. Die Playwright-Tests
setzen ihn als S3-Ziel. Ob ein Zugang wirklich nur sein Präfix erreicht, prüft die CI gegen ein echtes
MinIO mit dem Agenten.
