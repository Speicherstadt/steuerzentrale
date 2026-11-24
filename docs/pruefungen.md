---
title: Prüfungen der Server
description: >-
  Was die Zentrale an jedem Server prüft (Platte, Zertifikate, Backups, offene Ports, Uhrzeit), mit
  welchen Grenzen, woher die Werte kommen, wann daraus ein Ereignis wird und wo das Ergebnis steht.
---

# Prüfungen der Server

Die Zentrale prüft jeden Server, dessen Agent beigetreten und nicht gesperrt ist, **jede Minute**.
Jede Prüfung ist **grün**, **gelb**, **rot** oder **unbekannt**: grün heißt gemessen und in Ordnung,
was nicht gemessen ist, ist nie grün. Die Prüfungen sind reine Funktionen (`packages/planung`,
`pruefungen.ts`); sie lesen die neuesten Fakten des Agenten ([Server hinzufügen](server-hinzufuegen.md),
„Fakten des Servers“), die Installationen auf dem Server mit ihren signierten Manifesten und deren
Backups, immer innerhalb des Betreibers des Servers.

| Prüfung | gelb | rot | Quelle |
| --- | --- | --- | --- |
| Platte | eine Platte über 80 % belegt | über 90 % | Platten des Agenten (`statfs`) |
| Zertifikate | ein Zertifikat einer Installation läuft in 14 Tagen oder früher ab | abgelaufen | Zertifikate der Pforte |
| Backups | der letzte gelungene Lauf einer Installation ist älter als 26 Stunden | – | Läufe in der Zentrale |
| Offene Ports | ein Port ist von außen erreichbar, den kein Manifest und nicht das System nennt | – | offene Ports des Agenten |
| Uhrzeit | Abweichung von 500 ms oder mehr, oder der Zeitdienst ist nicht synchron | – | Messung an `willkommen`, `timedatectl` |

Die Grenzen selbst gehören zur besseren Seite: genau 80 % ist grün, genau 90 % gelb, ein Zertifikat,
das in genau 14 Tagen abläuft, gelb, ein Backup von genau 26 Stunden grün, eine Abweichung von genau
500 ms gelb.

## Im Einzelnen

**Platte.** Es zählt die vollste Platte. Belegt ist, was ein Nutzer nicht mehr schreiben kann: der
Anteil, den nur root nutzen darf, zählt als belegt, weil jede Installation unter einem eigenen Nutzer
läuft.

**Zertifikate.** Caddy, die [Pforte](pforte.md), legt jedes Zertifikat unter
`certificates/<Aussteller>/<Host>/<Host>.crt` in seinem Datenverzeichnis ab, beim Rootless-Nutzer
`sz-pforte` im Volume `sz-pforte-daten`. Der Agent liest dort das Ende jedes Zertifikats (nur lesen,
als root). Die Zentrale beurteilt nur die Hosts der Installationen auf dem Server, je Host das neueste
Zertifikat; alte Zertifikate entfernter Installationen zählen nicht. Ein Host ohne Zertifikat fällt
hier nicht auf; ob eine Adresse von außen erreichbar ist, prüft die Überwachung von außen.

**Backups.** Für jede laufende Installation, deren Backups eingerichtet sind: das Alter des letzten
gelungenen Laufs, ohne einen solchen die Zeit seit dem Einrichten.

**Offene Ports.** Der Agent meldet jeden Port, auf dem ein Dienst lauscht, außer auf Loopback
(`127.0.0.0/8`, `::1`) und auf den Brücken von Podman (dort lauscht der DNS-Dienst eines Netzes).
Erlaubt sind die Ports, die die Manifeste der Installationen auf dem Server veröffentlichen (feste wie
vergebene, ein Bereich Port für Port, nur mit den gewählten Optionen), und die des Systems: 22/tcp
(SSH), 80/tcp, 443/tcp und 443/udp (Pforte) sowie 68/udp und 546/udp (DHCP). Der HTTP-Port einer
Installation liegt nur auf `127.0.0.1` und ist darum nie erlaubt, wenn er von außen erreichbar ist.

**Uhrzeit.** Die Abweichung misst der Agent beim Verbinden gegen die Uhr der Zentrale; dazu meldet er
`NTPSynchronized` aus `timedatectl show`.

**Unbekannt.** Sind die Fakten älter als 45 Minuten (drei Meldungen verpasst) oder hat der Agent einen
Wert nicht gemeldet (auch ein älterer Agent ohne die Felder dieser Prüfungen), ist die Prüfung
unbekannt. Die Backups prüft die Zentrale selbst, sie sind auch ohne Agent bekannt.

## Ereignisse

Aus einer Prüfung wird ein Ereignis je Befund, nicht je Lauf: wird eine Prüfung gelb oder rot,
schreibt die Zentrale `pruefung_<name>` (Schwere `warn` bei Gelb, `fehler` bei Rot), wird sie danach
rot, noch eines mit `fehler`; wird sie wieder grün, `pruefung_<name>_behoben` (`info`). Rot, das zu
Gelb wird, und Unbekannt ändern nichts. Ob ein Befund offen ist, sagen die Ereignisse selbst; ein
Neustart der Zentrale wiederholt und vergisst keinen. Jedes Ereignis nennt den Server
(`server:<id>`) und in seinem Text, was auffiel, etwa „Platte auf srv-1: / zu 92 % belegt“.

## Wo das Ergebnis steht

- **Übersicht**: jede rote Prüfung als Störung, jede gelbe als Warnung, mit dem Server und was
  auffiel; der Eintrag führt zum Server ([Übersicht und Betrieb](uebersicht.md)). Unbekannte Prüfungen
  stehen dort nicht: meist ist der Agent still oder getrennt, und das hat seinen eigenen Eintrag.
- **Server-Seite**: im Reiter „Überblick“ die Zeile „Prüfungen“, „9 von 9 in Ordnung“ mit den Namen
  oder jede auffällige Prüfung mit ihrem Messwert; im Reiter „Technik“ die Karte „Prüfungen“ mit
  jeder Prüfung, ihrem Messwert und „OK“ oder „Prüfen“. Ist der Agent still, steht nur der letzte
  bekannte Stand da, ohne Urteil. Was der Agent über das Betriebssystem meldet (unattended-upgrades,
  ausstehende Pakete, „Neustart nötig“), steht in der Karte „Wartung“ daneben
  ([Betriebssystem und Neustarts](betriebssystem.md)).
- **Seite „Server“**: der Zustand jedes Servers in Worten, eine volle Platte zuerst.
- **API**: `GET /api/v1/server/<id>` liefert `pruefungen`, je Prüfung Ergebnis, Messwerte und `seit`
  (der Beginn des offenen Befunds oder `null`).
