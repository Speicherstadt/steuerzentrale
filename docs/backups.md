---
title: Backups
description: >-
  Wie jede Installation täglich in ihr eigenes restic-Repository auf dem S3-Ziel des Betreibers
  gesichert wird: was der Agent auf dem Server einrichtet, wie ein Lauf abläuft, wie die Zentrale
  davon erfährt, und in der Zentrale S3-Ziel, eigene Zugänge je Installation, „Backup jetzt“, der
  wöchentliche Prüf-Restore und das Wiederherstellen.
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
bleibt; Repository und Passwort löscht erst die Löschung nach dem Vertragsende: 90 Tage danach löscht
die Zentrale jedes Objekt unter dem Präfix der Installation mit deren eigenem Zugang, dann den
Service-Account und die Zeile mit dem Passwort ([Kunden](kunden.md), „Nach dem Vertragsende“).

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
Backup-Auftrag der Installation offen ist (`409 backup_laeuft`), solange sie wiederhergestellt wird
(`409 auftrag_offen`, siehe unten) oder bevor die Backups eingerichtet sind (`409 nicht_eingerichtet`). Ein Backup startet die App nicht neu und läuft darum auch in einer
Sperrzeit.

### Prüf-Restore

Einmal je Woche zeigt ein Prüf-Restore, dass sich das Backup einer Installation zurückspielen lässt,
ohne die Installation selbst anzufassen. Der Agent richtet dazu auf ihrem Server eine Kopie unter
eigenem Namen `restore-<6 Zeichen>` (Nutzer `sz-restore-…`) mit eigenen Ports und denselben
Einstellungen ein, spielt den neuesten Snapshot jedes Teils zurück, prüft ihre Health und entfernt
sie danach wieder, auch nach einem Fehler.

**Zeitplan.** Die Zentrale prüft jede Stunde jede laufende Installation aller Betreiber. Einen
Prüf-Restore bekommt eine Installation, deren Backups eingerichtet sind, die mindestens einen
gelungenen Lauf hat und deren letzter Prüf-Restore (nach Zeitplan oder „jetzt“, wie er auch ausging)
mindestens 7 Tage zurückliegt. Keinen bekommt sie, solange ein anderer Auftrag der Installation offen
ist oder auf ihrem Server schon ein Prüf-Restore läuft; dann kommt sie in einer der nächsten Stunden
dran.

**Nur der eigene Server.** Die Kopie läuft immer auf dem Server der Installation: kein anderer Server
bekommt je ihren Backup-Zugang. Die Zentrale fragt dafür die Platzierung wie für eine zusätzliche
Installation mit Manifest und Optionen der Installation. Passt sie nicht (zu wenig RAM oder Platte,
feste Ports schon belegt, ein Server für sich, fehlende Fakten), legt die Zentrale keinen Auftrag an
und schreibt das Ereignis `pruef_restore_kein_platz` (Schwere `warn`) mit den Gründen, höchstens
einmal je Woche und Installation.

**Auftrag.** Der eingebaute Auftrag `installation_pruef_restore` nennt die Installation, trägt den
Namen der Kopie im Argument `kopie` und die Daten der Kopie im Feld `einrichtung`: die Einstellungen
der Installation mit den Ports der Kopie. Dieses Feld setzt die Zentrale erst beim Zustellen ein, mit
den Geheimnissen aus der verschlüsselten Spalte, und nur für den Server, auf dem die Installation
steht; in der Datenbank und im Audit-Log steht es nicht. Ein Feld `backup` trägt der Auftrag nicht:
Den Zugang liest der Agent aus der `backup.json` der Installation auf dem Server. Die Ports der Kopie
vergibt die Zentrale aus 20000–29999 wie für eine Installation und hält sie in `installations_ports`
(Zweck `restore-…:http` usw.) fest, bis der Auftrag endet; danach sind sie frei. Die Kopie bekommt
keine Route der Pforte und keinen DNS-Eintrag. Zeitlimit: 30 Minuten Einrichten und so lange wie ein
Backup (vier Stunden).

**Ergebnis.** Endet der Auftrag, schreibt die Zentrale in derselben Transaktion eine Zeile in
`pruef_restores` (13 Monate aufbewahrt): Zeitpunkt, Name der Kopie, gelungen oder Grund, je Teil den
Snapshot, aus dem er zurückgespielt wurde (ein `befehl` wird nicht zurückgespielt und steht mit Grund
da), und die Dauer, wie der Agent sie misst. Ein gescheiterter oder abgebrochener Prüf-Restore
schreibt das Ereignis `pruef_restore_gescheitert` (Schwere `fehler`) mit dem Grund.

**In der Oberfläche.** Die Seite **Backups** zeigt je Installation den letzten Prüf-Restore und als
Kennzahl, bei wie vielen er gelang; der Reiter **Backups** einer Installation zeigt ihn mit den
zurückgespielten Snapshots und der Dauer. In der **Übersicht** steht eine Installation, deren letzter
Prüf-Restore gescheitert ist (Warnung) oder die seit über 8 Tagen keinen hatte (Hinweis; ohne jeden
Prüf-Restore gezählt ab ihrem ersten gelungenen Backup). Der gescheiterte Auftrag selbst steht dort
nicht noch einmal.

**Prüf-Restore jetzt** startet auf der Seite der Installation einen Prüf-Restore mit Grund (Inhaber und
Technik), unabhängig vom Wochenrhythmus. Dieselben Bedingungen gelten: `409 nicht_eingerichtet`,
`409 kein_backup` (noch kein gelungener Lauf), `409 auftrag_offen`, `409 server_belegt` (ein anderer
Prüf-Restore auf dem Server), `409 kein_platz` (mit den Gründen der Platzierung in `gruende`),
`409 keine_ports`.

#### Auf dem Server

Der Agent nimmt `installation_pruef_restore` nur an, wenn die Kopie `restore-<6 Zeichen a–z 0–9>`
heißt, das Manifest Teile unter `backup` nennt, er die Installation selbst fertig eingerichtet hat,
ihre Units aus genau diesem Manifest gerendert sind (App und Version in ihren Labels), ihr Backup bei
ihm eingerichtet ist und es Nutzer und Home der Kopie noch nicht gibt; sonst meldet er „abgelehnt: …“
und legt nichts an. Dann:

1. richtet er die Kopie wie eine Installation ein ([Apps installieren](installieren.md)): Nutzer
   `sz-restore-<6>`, Units, Secrets, Images; aber ohne `schritte.einrichten`, ohne sie zu starten
   und ohne die Pforte anzufassen;
2. spielt er den neuesten Snapshot jedes Teils der Installation in die Kopie zurück (unten);
3. startet er alle Units der Kopie, wartet, bis sie aktiv sind, und prüft ihre Health nach dem
   Manifest auf den Ports der Kopie, höchstens fünf Minuten lang, bis sie nicht mehr rot ist (ohne
   Prüfung im Manifest zählen die aktiven Units);
4. baut er die Kopie vollständig ab: Units stoppen, Linger aus, `loginctl terminate-user`,
   `userdel --remove`, mit Home, Volumes und Containern. Das geschieht immer, auch nach einem Fehler
   in einem der Schritte oder nach dem Zeitlimit des Auftrags.

Zurückgespielt wird als Nutzer der Kopie, mit dem Agent-Binary:
`steuerzentrale-agent zurueckspielen <kopie>`. Der Agent liest dafür `backup.json` der Installation
als root und nur lesend (ohne einem Symlink zu folgen) und gibt dem Binary Repository, Zugang und
Passwort über seine Standardeingabe, eine Pipe ohne Namen; restic bekommt sie wie beim Sichern als
Deskriptoren 3 und 4. restic läuft im Netz der Kopie und sucht mit
`restic ls --json latest --host <installation> --tag <tag>` den neuesten Snapshot des Teils. Je
Teil:

| Teil | Was zurückgespielt wird |
| --- | --- |
| `volume` | vor dem Start jedes Containers: `restic dump --archive tar <snapshot>:/sicherung/<volume> /` in `podman volume import <kopie>-<volume> -`, danach Eigentümer und Rechte der Wurzel des Volumes wie im Snapshot (`podman unshare chown`, `chmod`) |
| `pg_dump` | nur der Container der Datenbank wird gestartet; sobald `pg_isready -h 127.0.0.1` antwortet (höchstens zwei Minuten), `restic dump <snapshot> /<container>-<datenbank>.dump` in `podman exec -i <kopie>-<container> pg_restore --clean --if-exists -d <datenbank> -U <nutzer>` |
| `befehl` | nichts: die Ausgabe eines Befehls ist ein Export, kein Restore; im Ergebnis mit diesem Grund |

Zuerst die Volumes, dann die Datenbanken; der erste Teil, der scheitert, beendet das Zurückspielen.
Ein Grund nennt den Schritt und einen Exit-Code, nie Ausgabe von restic, Podman oder der App.
Gelungen meldet der Agent `{ teile: [{ tag, snapshot, zurueckgespielt, grund }], dauerMs }`,
gescheitert nur den Grund („Prüf-Restore gescheitert: Zurückspielen: volume:daten: …“, dazu
„Abbau unvollständig: …“, falls auch der Abbau scheiterte).

Die Kopie steht während des Laufs als `angelegt` im Gedächtnis der Installationen, eingetragen vor
`useradd`, und wird nach dem Abbau vergessen; `fertig` wird sie nie, also sehen Health-Prüfung,
Backups und Aktionen sie nicht. Startet der Agent mitten in einem Prüf-Restore neu, bleibt sie
`angelegt`: beim Start des Agenten und vor jedem Prüf-Restore baut er jede Kopie ab, die noch
`angelegt` ist. Ein Prüf-Restore läuft nach einem Neustart des Agenten noch einmal, denn die
Installation wird nur gelesen. Prüf-Restores laufen auf einem Server nacheinander, neben den
Einrichtungsaufträgen, denn einer kann Stunden dauern. Einen Einrichtungsauftrag für einen Namen
`restore-<6>` lehnt der Agent ab.

### Wiederherstellen

Wiederherstellen spielt die Daten eines gewählten gelungenen Laufs in die Installation selbst zurück.
Die Zentrale legt dafür zuerst „Backup jetzt“ an, ein Backup vom Ist-Zustand, und danach den
eingebauten Auftrag `installation_wiederherstellen`, der darauf wartet; scheitert das Backup, wird
nichts zurückgespielt. Der Auftrag nennt die Installation und je Teil, der zurückgespielt wird, den
Snapshot des gewählten Laufs als Argument `snapshot:<tag>` mit der vollen ID (64 Zeichen), etwa
`snapshot:volume:daten` oder `snapshot:pg_dump:db:app`. Ein `befehl` bekommt keines, denn seine
Ausgabe ist ein Export. Ein Feld `einrichtung` oder `backup` trägt der Auftrag nicht. Zeitlimit: so
lange wie ein Backup (vier Stunden) und 30 Minuten für Stoppen, Starten und Health.

#### In der Zentrale

Im Reiter **Backups** einer Installation steht neben jedem gelungenen Lauf **Wiederherstellen**
(Inhaber und Technik). Der Dialog „Lauf wiederherstellen?“ nennt Installation und Stand des Laufs,
sagt deutlich, dass vorher der Ist-Zustand gesichert wird, und verlangt einen Grund. Angeboten wird es
nur für eine laufende Installation mit eingerichteten Backups und nur, solange weder ein
Wiederherstellen noch ein Prüf-Restore läuft. Auch in einer Sperrzeit ist es erlaubt: Es ist eine
Reparatur auf Anfrage, kein Update.

**Ablauf.** Die Zentrale prüft, dass der Lauf zu dieser Installation und diesem Betreiber gehört und
gelungen ist, und dass kein anderer Auftrag der Installation offen ist. Dann legt sie in einer Änderung
des Audit-Logs (`installation.wiederherstellen`, mit Grund) zwei Aufträge an:

1. `installation_backup`, ein Backup vom Ist-Zustand wie „Backup jetzt“; es geht sofort an den Agenten;
2. `installation_wiederherstellen` mit dem Snapshot jedes zurückgespielten Teils aus dem gewählten
   Lauf (`snapshot:<tag>`, 64 Hex; ein `befehl` wird nicht zurückgespielt), der auf das Backup
   wartet.

Dazu kommt eine Zeile in `wiederherstellungen` mit beiden Aufträgen und dem gewählten Lauf. Scheitert
das Backup vom Ist-Zustand, bricht die Zentrale das Wiederherstellen ab, bevor es den Agenten
erreicht: Es wird nichts zurückgespielt. So lässt sich auch ein falsch gewählter Lauf mit dem Backup
davor rückgängig machen.

**Ergebnis.** Endet das Wiederherstellen (oder scheitert das Backup davor), schreibt die Zentrale in
derselben Transaktion das Ergebnis in die Zeile: gelungen oder Grund, je Teil den Snapshot, aus dem er
zurückgespielt wurde, und die Dauer, wie der Agent sie misst. Ein gescheitertes oder abgebrochenes
Wiederherstellen schreibt das Ereignis `wiederherstellen_gescheitert` (Schwere `fehler`), ein
gelungenes `wiederherstellen_gelungen` (Schwere `info`); beide stehen bei den Ereignissen der
Installation. Die Zeilen in `wiederherstellungen` bleiben dauerhaft wie das Audit-Log.

**Stand.** Unter „Wiederherstellen“ zeigt der Reiter den neuesten Vorgang: „läuft: Backup vom
Ist-Zustand“, „läuft: Stand … wird zurückgespielt“, „gelungen: Stand …“ oder „gescheitert: Grund“.

#### Auf dem Server

Der Agent nimmt `installation_wiederherstellen` nur an, wenn er die Installation selbst fertig
eingerichtet hat, ihre Units aus genau dem Manifest des Auftrags gerendert sind (App und Version in
ihren Labels), ihr Backup bei ihm eingerichtet ist (`backup.json`) und der Auftrag für jeden Teil
`volume` und `pg_dump` genau einen Snapshot nennt; sonst meldet er „abgelehnt: …“ und fasst nichts
an. Dann, als Nutzer der Installation und nacheinander mit den Einrichtungsaufträgen:

1. stoppt er `sz_backup.timer`; läuft gerade ein Backup (`sz_backup.service`), scheitert der Auftrag
   (der Agent liest den Zustand mit `systemctl --user is-active`: ein laufender `oneshot` steht auf
   `activating`, nur `inactive` und `failed` gelten als kein Lauf);
2. stoppt er die Units: alle, wenn ein Volume zurückgespielt wird, sonst alle außer den
   Datenbank-Containern der Dumps;
3. leert er jedes Volume eines Teils: `podman volume rm --force <installation>-<volume>`, dann legt
   `systemctl --user restart` seiner Volume-Unit es leer neu an;
4. spielt er jeden Teil aus dem Snapshot des Auftrags zurück, wie beim Prüf-Restore (oben): zuerst
   die Volumes, dann die Datenbanken, `pg_restore --clean --if-exists` mit `datenbank` und `nutzer`
   aus dem Manifest, nachdem nur der Datenbank-Container läuft und antwortet;
5. startet er alle Units, wartet, bis sie aktiv sind, und prüft die Health nach dem Manifest,
   höchstens fünf Minuten lang;
6. startet er `sz_backup.timer` wieder.

Jeden Teil spielt das Agent-Binary in einer vorübergehenden Unit des Nutzers zurück:

```
systemd-run --user --unit sz_wiederherstellen.service --quiet --wait --collect --pipe \
  -p RuntimeMaxSec=<Sekunden bis zum Ende des Auftrags> -p TimeoutStopSec=15 -p Delegate=yes \
  -- steuerzentrale-agent zurueckspielen <installation>
```

Repository, Zugang und Passwort bekommt es wie beim Prüf-Restore über die Standardeingabe, nie in
`argv`. restic startet es dort mit `podman run --cgroups split`, so bleiben conmon und restic in der
cgroup der Unit. Endet die Unit, endet alles, was in ihr lief: nach `RuntimeMaxSec` durch systemd
selbst, auch wenn der Agent nicht mehr läuft, und nach einem Fehler oder dem Zeitlimit des Auftrags,
weil der Agent sie über ihren festen Namen stoppt. Den Snapshot sucht das Binary mit
`restic ls --json <id>` und spielt nur zurück, wenn er zum Host der Installation und zum Tag des
Teils gehört; restic selbst prüft das bei einer ID nicht.

Scheitert ein Schritt oder läuft das Zeitlimit ab, stoppt der Agent die vorübergehende Unit, setzt
die Units zurück (`reset-failed`), startet sie neu, wartet, bis sie aktiv bleiben, und startet den
Timer; jeder dieser Schritte hat ein eigenes Zeitlimit von 60 Sekunden und läuft auch, wenn einer
davor scheiterte. Das Backup vom Ist-Zustand liegt bereit. Gelungen meldet der Agent wie beim
Prüf-Restore `{ teile: [{ tag, snapshot, zurueckgespielt, grund }], dauerMs }`, gescheitert nur den
Grund, etwa „Wiederherstellen gescheitert: volume:daten: Zeitlimit des Auftrags überschritten; Units
wieder gestartet“ oder „…; Units nicht wieder gestartet: …“.

Startet der Agent mitten im Wiederherstellen neu, meldet er den Auftrag als gescheitert („Agent neu
gestartet“) und wiederholt ihn nicht: er weiß nicht, wie weit er kam, und Daten sollen nicht zu einer
Zeit ersetzt werden, die niemand gewählt hat. Beim Start räumt er aber auf, vor jedem neuen Auftrag:
für jede Installation, die er fertig eingerichtet hat und deren Backup bei ihm eingerichtet ist
(`backup.json`), stoppt er als ihr Nutzer eine noch laufende `sz_wiederherstellen.service`, damit
kein Zurückspielen neben der wieder gestarteten App weiterschreibt (eine nicht geladene Unit gilt als
gestoppt), und startet `sz_backup.timer`, damit weiter Backups laufen. Die App-Units startet er nicht
von selbst; die Health zeigt die gestoppte App, und die Aktion „Neustart“ startet sie. Scheitert das
Aufräumen bei einer Installation, schreibt der Agent das ins Log und macht mit den anderen weiter.

### API

| Route | Wer | Körper | Antwort |
| --- | --- | --- | --- |
| `GET /api/v1/backup-ziel` | alle Rollen | – | `{ endpunkt, region, bucket, zugangGesetzt }` |
| `PUT /api/v1/backup-ziel` | Inhaber, Technik | `endpunkt`, `region`, `bucket`, `accessKey`?, `secretKey`?, `grund` | wie `GET` |
| `GET /api/v1/backups` | alle Rollen | – | `{ installationen: [{ installationId, app, kundeName, serverName, teile, zugang, eingerichtet, letzter, letzterErfolg, pruefRestore, … }] }` |
| `GET /api/v1/installationen/:id/backups` | alle Rollen | – | `{ installationId, teile, zugang, eingerichtet, laeufe, pruefRestore, wiederherstellen }` |
| `POST /api/v1/installationen/:id/backup` | Inhaber, Technik | `grund` | `201 { auftrag }` |
| `POST /api/v1/installationen/:id/pruef-restore` | Inhaber, Technik | `grund` | `201 { auftrag }` |
| `POST /api/v1/installationen/:id/wiederherstellen` | Inhaber, Technik | `lauf`, `grund` | `201 { backup, wiederherstellen }` |

`pruefRestore` ist `{ letzter, laeuft }`: `letzter` der neueste Prüf-Restore als `{ zeitpunkt, ok,
grund, kopie, teile: [{ tag, snapshot, zurueckgespielt, grund }], dauerMs }` oder `null`, `laeuft`, ob
gerade einer offen ist. Jeder Lauf in `laeufe` trägt seine Kennung `id`, die `lauf` beim
Wiederherstellen nennt. `wiederherstellen` ist `{ letzter, laeuft }`: `letzter` das neueste
Wiederherstellen als `{ angefordertAm, laufZeitpunkt, phase, endeAm, fehler, teile, dauerMs }` mit
`phase` `sichern`, `zurueckspielen`, `gelungen` oder `gescheitert`, oder `null`.

Fehler: `400 ungueltig`, `404 keine_installation`, `409 laeuft_nicht`, `409 nicht_eingerichtet`,
`409 backup_laeuft`, `409 kein_backup`, `409 auftrag_offen`, `409 server_belegt`, `409 kein_platz`,
`409 keine_ports`, `409 ziel_in_benutzung`, `422 zugang_fehlt`, `422 lauf_unbekannt` (ein Lauf
einer anderen Installation oder eines anderen Betreibers ist so unbekannt wie einer, den es nicht
gibt), `422 lauf_gescheitert`, `422 nicht_ausfuehrbar`. Keine Antwort enthält einen Zugang,
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
| `installation.pruef-restore` | Prüf-Restore angelegt, mit den Ports der Kopie (Akteur `system` nach Zeitplan, sonst wer „jetzt“ wählte, mit Grund) |
| `ereignis.pruef-restore-kein-platz` | kein Platz auf dem Server (Akteur `system`) |
| `installation.wiederherstellen` | Wiederherstellen angelegt: Backup vom Ist-Zustand, Wiederherstellen und die Zeile in `wiederherstellungen`, mit Grund |

### Tests

Die Admin-API von MinIO wird in den Tests der Zentrale nachgebaut
(`apps/zentrale/src/testhilfen/minio.ts`, ein Bun-Server im Speicher): er prüft die Signatur, öffnet
den verschlüsselten Körper mit dem Secret Key des Admins und antwortet wie MinIO. Die Playwright-Tests
setzen ihn als S3-Ziel. Ob ein Zugang wirklich nur sein Präfix erreicht, prüft die CI gegen ein echtes
MinIO im Agent-Test (`apps/agent/test/backup.agent.test.ts`): Der Admin-Client der Zentrale legt
zwei Zugänge A und B mit der Policy aus `packages/manifest` an. A legt mit restic sein Repository an
und sichert dorthin; `snapshots` und `forget` auf B's Repository, ein `DELETE` auf jedes Objekt von
B und das Auflisten von B's Präfix, des übergeordneten Präfixes und des ganzen Buckets werden
verweigert, und B's Objekte stehen danach unverändert da.

Den Zeitplan des Prüf-Restores prüfen die Tests der Zentrale (`modules/pruef-restore/`): ein Server
ohne Platz wird nicht gewählt (Ereignis, kein Auftrag), höchstens einer je Woche, keiner neben einem
offenen Auftrag, einer je Server zugleich, das Feld `einrichtung` geht nur an den eigenen Server und nie
ein Zugang, die Ports sind nach dem Ende frei, ein gescheiterter schreibt sein Ereignis; je Endpunkt
die Trennung der Betreiber und die Rollen (`routes/pruef-restore.test.ts`).

Das Wiederherstellen in der Zentrale prüfen `modules/wiederherstellen/` und
`routes/wiederherstellen.test.ts`: ein Lauf einer anderen Installation, eines anderen Betreibers und
ein gescheiterter werden abgelehnt, ohne dass ein Auftrag entsteht; das Backup kommt zuerst, und
scheitert es, wird das Wiederherstellen abgebrochen und nie zugestellt; der Audit-Eintrag trägt den
Grund; ein gescheitertes schreibt sein Ereignis; es ist auch in einer Sperrzeit erlaubt; je Endpunkt
die Trennung der Betreiber und die Rollen. Playwright wählt einen Lauf und stellt ihn wieder her; der
Stellvertreter-Agent meldet Backup und Wiederherstellen als gelungen. Playwright lässt den
Stellvertreter des Agenten einen Prüf-Restore melden, den die Seite dann zeigt.

Die Seite des Agenten prüft die CI gegen Podman, systemd und MinIO
(`apps/agent/test/pruef-restore.agent.test.ts`): die Beispiel-App mit einem Eintrag wird gesichert,
der Prüf-Restore gelingt, und solange die Kopie läuft, steht der Eintrag in ihr (über HTTP auf ihrem
Port gelesen, über einen Haken im Ablauf, den nur der Test setzt); danach gibt es weder Nutzer noch
Home, Prozesse oder Laufzeitordner der Kopie, und die Installation läuft mit ihrem Eintrag weiter.
Mit dem Admin-Zugang überschriebene Packdateien ergeben einen gescheiterten Prüf-Restore mit Grund,
nach dem ebenfalls alles abgebaut ist.

Das Wiederherstellen auf dem Server prüft die CI ebenso (`apps/agent/test/wiederherstellen.agent.test.ts`):
Die Beispiel-App bekommt Eintrag A, Lauf 1, Eintrag B, Lauf 2; nach dem Wiederherstellen mit den
Snapshots von Lauf 1 steht A da und B nicht mehr (über HTTP gelesen), und die App ist gesund. Eine
App mit Postgres-Container (per Digest) verliert eine Zeile, die nach Lauf 1 eingefügt wurde. Ist
MinIO weg, hängt restic in der vorübergehenden Unit, bis das Zeitlimit des Auftrags abläuft; danach
läuft kein `restic`, kein `zurueckspielen` und kein `systemd-run` des Nutzers mehr, und App und
Timer laufen wieder. Die Unit-Tests des Agenten (`apps/agent/test/wiederherstellen*.test.ts`)
prüfen die Ablehnungen, den Ablauf je Art, den Neustart der Units nach jedem Fehler und nach dem
Zeitlimit, das Aufräumen beim Start des Agenten, `RuntimeMaxSec` und dass kein Geheimnis in
`argv`, Ergebnis oder Log steht.
