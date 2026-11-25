---
title: Betriebssystem und Neustarts
description: >-
  Was die Zentrale über das Betriebssystem jedes Servers weiß (unattended-upgrades, ausstehende
  Pakete, „Neustart nötig“) und wie sie einen Server neu startet: im Wartungsfenster, nie in einer
  Sperrzeit, mit Backup davor.
---

# Betriebssystem und Neustarts

Die Sicherheitsupdates des Betriebssystems spielt unattended-upgrades ein, das `install.sh` auf
jedem Server einrichtet ([Server hinzufügen](server-hinzufuegen.md)). Viele Updates wirken sofort,
ein neuer Kernel aber erst nach einem Neustart. Den plant die Zentrale: nur im Wartungsfenster des
Servers, nie in einer Sperrzeit einer App auf ihm und nie ohne Backup davor.

## Was die Seite eines Servers zeigt

Im Reiter **Überblick** fasst die Zeile „Betriebssystem“ zusammen: System, ob Sicherheitsupdates
offen sind und ob ein Neustart nötig ist. Im Reiter **Technik** zeigt die Karte **Wartung**, was der
Agent mit seinen Fakten meldet (beim Verbinden und alle 15 Minuten):

| Zeile | Woher |
| --- | --- |
| unattended-upgrades | installiert (`/usr/bin/unattended-upgrade`), an oder aus (`APT::Periodic::Unattended-Upgrade` aus `apt-config dump`), letzter Lauf (Änderungszeit von `/var/lib/apt/periodic/unattended-upgrades-stamp`) |
| Ausstehende Pakete | `apt-get -s -q upgrade`: was `upgrade` einspielen würde und was es zurückhält |
| Neustart nötig | `/var/run/reboot-required` (Ubuntu) oder ein neuerer Kernel in `/boot` als der laufende (Debian) |
| Läuft seit | `btime` aus `/proc/stat` |

Darunter stehen Wartungsfenster und Sperrzeiten, was die Planung gerade für den Neustart entscheidet
(„jetzt“, der nächste Termin oder warum er wartet) und wie der letzte Neustart ausging. Die API
liefert dasselbe an jedem Server unter `fakten` (`unattendedUpgrades`, `bootId`, `gestartetAm`) und
`neustart` (`noetig`, `plan`, `letzter`).

## Wann ein Server neu startet

Jede Minute prüft die Zentrale jeden beigetretenen, nicht gesperrten Server. Sie startet ihn neu,
wenn

- seine Fakten „Neustart nötig“ sagen und die Boot-ID nennen,
- sein Agent verbunden ist,
- auf ihm kein Auftrag offen ist (ein Update, ein Update des Agenten oder ein Neustart: je Server
  einer),
- jede laufende Installation, deren Manifest Daten sichert, eingerichtete Backups hat,
- sein letzter Neustart vor mehr als 24 Stunden endete, gleich wie,
- sein Wartungsfenster offen ist und
- keine Sperrzeit einer App auf dem Server läuft (aus dem Manifest jeder Installation und dem neuen
  Manifest eines offenen Updates).

Sonst wartet der Neustart, und die Seite nennt den Grund und, wo er feststeht, den nächsten Termin.
Fällt eine Sperrzeit in das Fenster, kommt der Neustart in der ersten Nacht danach; die
Zeitumstellung verschiebt das Fenster nicht, eine Uhrzeit, die es in der Nacht der Umstellung nicht
gibt, rückt um die Lücke vor. Die 24 Stunden halten einen Server, der nach dem Neustart weiter
„nötig“ meldet (etwa ein Kernel, den der Bootloader nicht wählt), davon ab, jede Nacht neu zu
starten.

## Ablauf

1. **Backup davor**: In einer Änderung des Audit-Logs legt die Zentrale „Backup jetzt“
   (`installation_backup`) für jede laufende Installation des Servers an, deren Manifest Teile
   sichert, und den Neustart (`server_neustart`), der auf alle wartet. Scheitert ein Backup, wird
   der Neustart abgebrochen und ein Ereignis nennt die Installation.
2. **Zustellen**: Der Neustart geht erst zum Agenten, wenn keine Sperrzeit läuft und, wenn ihn die
   Planung anlegte, das Wartungsfenster noch offen ist. Liefen die Backups darüber hinaus, bricht
   die Planung ihn ab, statt ihn später mit einem alten Backup davor zu schicken.
3. **Neustart**: Der Agent prüft den Auftrag (unten), merkt ihn sich als „läuft“, nimmt keinen
   weiteren an und ruft `systemctl reboot`. Startet der Server nicht binnen 5 Minuten neu, meldet er
   den Auftrag gescheitert.
4. **Zurück**: Nach dem Start verbindet sich der Agent, die Zentrale schickt ihm den offenen Auftrag
   noch einmal, und er meldet ihn erfolgreich, weil seine Boot-ID jetzt eine andere ist. Startete
   nur der Agent neu, nicht der Server, meldet er „Neustart nicht erfolgt“.

Jedes Ende wird ein Ereignis des Servers: `server_neu_gestartet` (Info), `server_neustart_gescheitert`
(Fehler) oder `server_neustart_abgebrochen` (Warnung).

## Der Auftrag

`server_neustart` ist ein eingebauter Auftrag wie das [Update des Agenten](agent-updates.md): kein
Manifest beschreibt ihn, und es gibt nichts zu signieren. An der Stelle von Manifest und Signatur
steht je `-`, das einzige Argument ist `bootId`, die Boot-ID aus den Fakten, als die Zentrale ihn
anlegte; keine Installation, kein Feld `einrichtung` oder `backup`. Der Agent prüft nach dem
Schlüssel, dem er vertraut, die feste Form (dieselbe Funktion wie die Zentrale beim Anlegen) und
startet nur neu, wenn seine Boot-ID die des Auftrags ist: Ein liegengebliebener Auftrag startet einen
Server nie ein zweites Mal. Läuft gerade ein anderer Auftrag bei ihm, lehnt er ab.

## Neustart von Hand

Der Inhaber startet einen Server auf seiner Seite mit **Neu starten** neu (Recht
`server:neustart`, `POST /api/v1/server/:serverId/neustart`). Das geht auch außerhalb des
Wartungsfensters und wenn kein Neustart nötig ist, mit denselben Backups davor, aber nie in einer
Sperrzeit einer App auf dem Server, auch nicht für den Inhaber: ein Neustart des Servers trifft jede
App darauf. Abgelehnt wird er auch, solange auf dem Server ein Auftrag offen ist, eine laufende
Installation keine eingerichteten Backups hat oder die Fakten noch keine Boot-ID nennen. Ein Mitglied
sieht den Stand, startet aber nichts neu.

## Geprüft

Die Planung (Sperrzeit, Wartungsfenster, Zeitumstellung, einer am Tag) testet `packages/planung`,
die feste Form des Auftrags `packages/manifest`, den Agenten mit Boot-ID und `systemctl reboot`
`apps/agent`, Backups davor, Zustellen und Abbrechen `apps/zentrale`, den Neustart von Hand
Playwright. In der CI startet eine Incus-VM wirklich neu: `/var/run/reboot-required` angelegt,
Wartungsfenster geöffnet, danach eine neue Boot-ID und der Agent wieder verbunden.
