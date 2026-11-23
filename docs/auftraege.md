---
title: Aufträge
description: >-
  Wie die Zentrale einem Server etwas aufträgt: Warteschlange mit Zuständen, Aufträge, die auf
  andere warten, und was der Agent prüft, bevor er einen Befehl aus einem signierten Manifest
  ausführt.
---

# Aufträge

Alles, was die Zentrale auf einem Server tun lässt, ist ein Auftrag: der Name eines Befehls aus
dem signierten Manifest einer App und seine Argumente, nie eine Befehlszeile. Die Zentrale
speichert jeden Auftrag mit einer ID; der Agent des Servers bekommt ihn über seine Verbindung,
bestätigt ihn, meldet Fortschritt und Ergebnis.

Installieren, Updates und Backups legen ihre Aufträge mit ihren Punkten selbst an. Die Seite
„Aufträge“ listet alle, die offenen und die gescheiterten, die neuesten zuerst und seitenweise
([Übersicht und Betrieb](uebersicht.md)); einen gescheiterten der letzten sieben Tage nennt auch
die Übersicht.

## Zustände

| Zustand | Bedeutung |
| --- | --- |
| wartend | wartet auf einen oder mehrere andere Aufträge |
| bereit | alle Vorgänger sind erfolgreich; geht an den Agenten, sobald er verbunden ist |
| zugestellt | die Zentrale hat ihn dem Agenten geschickt |
| bestätigt | der Agent hat ihn angenommen |
| läuft | der Befehl läuft; der letzte gemeldete Schritt steht dabei |
| erfolgreich | der Befehl endete mit Code 0 |
| gescheitert | der Befehl endete anders, lief zu lange, oder der Agent hat den Auftrag abgelehnt |
| abgebrochen | ein Vorgänger ist gescheitert oder wurde abgebrochen |

Eine Meldung, die nicht zum Zustand passt (etwa ein Ergebnis für einen Auftrag, der nie zugestellt
wurde), weist die Zentrale ab; eine doppelte Meldung ändert nichts. Jede Änderung des Zustands steht
im Audit-Log, ohne den Text des Manifests (dafür mit seiner SHA-256). Die Schritte eines laufenden
Auftrags sind Messwerte wie die Heartbeats: höchstens einer alle 5 Sekunden, ohne Audit-Eintrag.

## Aufträge, die aufeinander warten

Ein Auftrag kann auf andere Aufträge desselben Betreibers warten, auch auf anderen Servern oder für
andere Installationen, etwa die Anlage eines OIDC-Clients beim Anmeldedienst des Kunden vor dem
Start einer App. Er wird erst bereit, wenn alle Vorgänger erfolgreich sind; scheitert einer, wird er
abgebrochen, und mit ihm alle, die auf ihn warten. Ein Auftrag kann nicht auf sich selbst warten,
auch nicht über andere, und nie auf einen Auftrag eines anderen Betreibers.

## Was der Agent prüft

Bevor der Agent etwas startet, prüft er der Reihe nach:

1. den Schlüssel: nur den öffentlichen Schlüssel aus `/etc/steuerzentrale/manifest.pub`, den
   Test-Schlüssel nur im Testmodus;
2. die minisign-Signatur über die exakten Bytes des Manifests: ein unsigniertes oder um ein Byte
   verändertes Manifest lehnt er ab;
3. dass die Aktion ein Befehl unter `befehle` im Manifest ist;
4. die Argumente gegen die Erklärung des Befehls ([Manifest](manifest.md), „Befehle in
   Aufträgen“).

Die beiden Aufträge der [Pforte](pforte.md) (`pforte_route_setzen`, `pforte_route_entfernen`) sind
in die Steuerzentrale eingebaut und kein Befehl eines Manifests: nach Schlüssel und Signatur prüft der
Agent statt 3. und 4. ihre feste Form (Hostname, Port von 1024 bis 65535, Name der Installation) und
ruft dann nur die Admin-API der Pforte auf, keinen Prozess. Ein Befehl eines Manifests kann nicht so
heißen, weil sein Name keinen Unterstrich haben darf.

Ebenso eingebaut sind die beiden Einrichtungsaufträge einer Installation
([Apps installieren](installieren.md)): `installation_einrichten` und `installation_entfernen`, mit
dem signierten Manifest und dem Namen der Installation, ohne Argumente, Zeitlimit 30 Minuten. Die
Zentrale legt `installation_einrichten` mit der Installation an und dazu, wenn die App hinter der
Pforte liegt, `pforte_route_setzen`, der darauf wartet: die Route kommt erst, wenn das Einrichten
gelungen ist, und wird abgebrochen, wenn es scheitert. Nur `installation_einrichten` trägt das Feld
`einrichtung` mit Installation (Kunde, Optionen, Ports, Host, IPv4) und Einstellungen nach Ebenen;
die Zentrale setzt es erst beim Zustellen aus der Zeile der Installation ein, mit den entschlüsselten
geheimen und erzeugten Werten, sodass der Auftrag in der Datenbank und das Audit-Log keine
Geheimnisse enthalten. Der Agent rendert die Units daraus und aus dem Manifest selbst. Das Ergebnis
setzt den Zustand der Installation in derselben Transaktion: erfolgreich `laeuft`, gescheitert
`gescheitert`; ein erfolgreiches `installation_entfernen` setzt `entfernt` und gibt die Ports frei.

Der dritte Einrichtungsauftrag, `installation_konfigurieren`, bringt geänderte Einstellungen auf den
Server: dieselbe Form wie `installation_einrichten`, mit dem Feld `einrichtung`; der Agent nimmt ihn
nur für eine Installation an, die er fertig eingerichtet hat, und nur, wenn ihre Units gleich
bleiben. Er schreibt Units, Slice, Dateien und Secrets neu, startet die Units neu und stellt bei
einem Fehler den alten Stand wieder her ([Apps installieren](installieren.md), „Neu
konfigurieren“). Erfolgreich meldet er `{ installation, geaendert: "konfiguriert", units }`.

Die Aktionen einer Installation ([Aktionen](aktionen.md)) sind zwei weitere eingebaute Aufträge:
`installation_neustart` und `installation_log_auszug` (Zeitlimit höchstens 5 Minuten), mit
dem signierten Manifest und dem Namen der Installation, ohne Argumente und ohne Feld
`einrichtung`. Nach Schlüssel und Signatur prüft der Agent, dass das Manifest die Aktion anbietet
(`aktionen.neustart` bzw. `aktionen.log_auszug`), sonst lehnt er ab. Beide laufen nacheinander mit
den Einrichtungsaufträgen und nur für eine Installation, die er fertig eingerichtet hat. Der
Neustart meldet `{ installation, units }`; der Log-Auszug schickt zuerst die Nachricht `log_auszug`
mit den Zeilen und der Auftrags-ID und meldet dann `{ zeilen: n }`. Nach einem Neustart des Agenten
wird ein laufender Log-Auszug wiederholt, ein Neustart nicht.

Der Prüf-Restore (`installation_pruef_restore`, siehe [Backups](backups.md)) ist
eingebaut wie ein Einrichtungsauftrag: Er nennt die Installation, trägt den Namen der Kopie im Argument
`kopie` (`restore-<6 Zeichen>`) und ihre Daten im Feld `einrichtung`, das die Zentrale erst beim
Zustellen einsetzt; Units, Secrets und Dateien der Kopie rendert der Agent aus dem signierten Manifest.
Ein Feld `backup` trägt er nie. Beide Seiten prüfen ihn mit `pruefRestoreAuftragPruefen` in
`packages/manifest`.
Der Agent prüft außerdem, dass die Units der Installation aus genau diesem Manifest gerendert sind
(Labels), lässt Prüf-Restores nacheinander neben den Einrichtungsaufträgen laufen und lehnt einen
Einrichtungsauftrag für einen Namen `restore-<6>` ab.

Die beiden Aufträge der [Backups](backups.md) sind ebenfalls eingebaut:
`installation_backup_einrichten` (Zeitlimit höchstens 30 Minuten) und `installation_backup`
(„Backup jetzt“, höchstens vier Stunden und zwei Minuten), mit dem signierten Manifest und dem Namen
der Installation, ohne Argumente und ohne Feld `einrichtung`. Nur `installation_backup_einrichten`
trägt das Feld `backup` mit Repository, S3-Zugang und restic-Passwort der Installation; die Zentrale
setzt es erst beim Zustellen ein, und jeden anderen Auftrag mit diesem Feld lehnt der Agent ab. Er
prüft die Form (nur ein S3-Repository, Zugang und Passwort aus Zeichen, die die Dateien für restic
halten können) und dass das Manifest Teile unter `backup` nennt, und nimmt beide Aufträge nur für
eine Installation an, die er fertig eingerichtet hat. Das Einrichten läuft nacheinander mit den
Einrichtungsaufträgen und meldet `{ installation, repository, teile, timer }`; „Backup jetzt“ läuft
daneben und meldet `{ installation, lauf, teile }`. Beide werden nach einem Neustart des Agenten
wiederholt.

Nach Schlüssel und Signatur prüft der Agent die feste Form der Einrichtungsaufträge (Name der Installation, Ports von 1024 bis 65535, nur Optionen des
Manifests, keine Argumente) und rendert die Units selbst aus dem signierten Manifest. Die Angaben
zur Installation (Feld `einrichtung`) trägt nur ein Einrichtungsauftrag; jeden anderen Auftrag mit
diesem Feld lehnt der Agent ab.

Erst dann führt er `argv` aus dem Manifest aus, als feste Argumente ohne Shell, mit
`podman exec <installation>-<container>`, und zwar als Linux-Nutzer der Installation
(`sz-<installation>`, mit `runuser` und fester Umgebung). Einen Befehl führt er nur für eine
Installation aus, die er selbst fertig eingerichtet hat; für jede andere lehnt er ihn ab. Läuft der
Befehl länger als sein Zeitlimit (aus dem Manifest, sonst 900 Sekunden; die Zentrale kann es nur
kürzen), beendet ihn der Agent und meldet den Auftrag als gescheitert. Einen abgelehnten Auftrag
meldet er als gescheitert mit dem Grund („abgelehnt: …“), ohne etwas zu starten.

## Zeitlimit

Nach dem Zeitlimit läuft nichts mehr weiter, was der Befehl gestartet hat. `runuser` startet sein
Kind (`env`, dann `podman exec`) ohne eigene Sitzung und wartet darauf; den Befehl im Container
startet aber nicht `podman exec`, sondern conmon, in einer eigenen Prozessgruppe, und Podman 4.9
beendet ihn nicht, wenn `podman exec` stirbt. Deshalb tut der Agent zweierlei:

- Er startet jeden Befehl in einer eigenen Sitzung (`setsid`) und schickt nach dem Zeitlimit
  `SIGKILL` an deren ganze Prozessgruppe: `runuser`, `env` und `podman exec`.
- Er gibt jedem Lauf eine eigene Marke mit, `podman exec --env STEUERZENTRALE_LAUF=<uuid> …`. Nach
  dem Zeitlimit beendet er (als root) jeden Prozess, dessen Umgebung genau diesen Eintrag trägt: den
  Befehl im Container und die Kinder, die ihn geerbt haben. Er sucht danach noch drei Sekunden lang
  alle 100 ms weiter, denn conmon startet den Befehl auch dann noch, wenn `podman exec` schon vorher
  beendet wurde. Die Umgebung eines Prozesses vergleicht er nur, er speichert und schreibt sie
  nirgends.

Endet der Befehl vor dem Zeitlimit von selbst, beendet der Agent nichts. Dasselbe gilt für die
Schritte `schritte.einrichten` beim [Installieren](installieren.md).

## Doppelt zugestellt, Neustart

Die Zentrale schickt einem Agenten bei jeder Verbindung alle Aufträge, die bereit sind oder bei ihm
liegen. Der Agent merkt sich jeden Auftrag in `/var/lib/steuerzentrale/auftraege.json` (atomar
geschrieben): als „läuft“, bevor der Befehl startet, und mit Ergebnis, bevor er es schickt. Ein
zweites Mal zugestellt, schickt er das gespeicherte Ergebnis noch einmal, statt den Befehl wieder
auszuführen.

Lief ein Auftrag, als der Agent neu startete, meldet er ihn nach dem Neustart als gescheitert
(„Agent neu gestartet“): der Befehl kann einen Teil seiner Arbeit getan haben. Nur einen Befehl, den
das Manifest als `idempotent` markiert, führt er dann noch einmal aus, ebenso die Aufträge der
Pforte und einen Einrichtungsauftrag (der erkennt am Gedächtnis der Installationen, was schon
eingerichtet ist, [Apps installieren](installieren.md)) und einen Prüf-Restore (die Kopie, die
der Neustart zurückließ, baut der Agent beim Start ab); `installation_konfigurieren` nicht, er
startet die App neu und gilt nach einem Neustart des Agenten als gescheitert. Ist die Datei unlesbar,
führt der Agent keinen Auftrag aus, weil er einen doppelten nicht mehr erkennen könnte. Erledigte
Aufträge vergisst er nach 30 Tagen.

Log-Auszüge gehören zu einem Auftrag `installation_log_auszug`: der Agent schickt die Zeilen mit
ersetzten Werten der Geheimnisse, die Zentrale hält sie 30 Tage ([Neustart, Log-Auszug, nur
lesen](aktionen.md)).
