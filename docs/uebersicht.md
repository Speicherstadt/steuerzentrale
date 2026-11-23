---
title: Übersicht und Betrieb
description: >-
  Was die Übersicht nach Schwere zeigt und wohin jeder Eintrag führt, wie Aufträge, Ereignisse und
  das Audit-Log seitenweise aus der Zentrale kommen, wer was lesen darf und was die Oberfläche
  angemeldet zeigt, solange ein späterer Punkt eine Seite noch nicht mit Daten füllt.
---

# Übersicht und Betrieb

Angemeldet liest die Oberfläche alles aus der Zentrale: Übersicht, Server, Installationen, Kunden,
Aufträge, Ereignisse, Audit-Log und Einstellungen. Die Demodaten zeigt nur `bun run dev:demo`
(und die Screenshots); sie antworten dort wie die Zentrale.

## Übersicht

Oben vier Kennzahlen: Server (wie viele verbunden, nach Art), Installationen (grün, gelb, rot, ohne
Zustand, gekündigt), Updates und Backups (bei wie vielen Installationen der letzte Lauf gelang,
[Backups](backups.md)). Für Updates hat die Zentrale noch keine Daten; die Kennzahl sagt, mit welchem
Punkt sie kommen (Z-503).

Darunter **Braucht Aufmerksamkeit**: was die Zentrale unter `GET /api/v1/uebersicht` liefert, das
Schwerste zuerst. Jeder Eintrag führt zu seiner Ursache.

| Eintrag | Schwere | führt zu |
| --- | --- | --- |
| offene Störung einer Installation (5 Minuten rot, siehe [Health und Zustand](zustand.md)) | Störung | Installation |
| Installation rot | Störung | Installation |
| Agent getrennt | Störung | Server |
| Installation gelb | Warnung | Installation |
| Agent still (ab 75 s ohne Heartbeat) | Warnung | Server |
| Auftrag gescheitert in den letzten 7 Tagen | Warnung | Aufträge |
| Ereignis `fehler` oder `warn` der letzten 24 Stunden | Störung bzw. Warnung | Installation oder Server des Ereignisses, sonst Ereignisse |
| Installation ohne Zustand (unbekannt) | Hinweis | Installation |

Innerhalb einer Schwere stehen Störungen vor Installationen, Agenten, Aufträgen und Ereignissen,
und jeweils das Neueste zuerst. Es zählen nur Installationen, die laufen (eine, die eingerichtet
wird oder deren Einrichtung scheiterte, steht als Auftrag da), und nur Server, deren Agent beigetreten
und nicht gesperrt ist. Ein Ereignis, dessen Installation oder Server schon einen Eintrag hat, steht
nicht noch einmal da; das Ereignis `stoerung` selbst auch nicht, weil die offene Störung ihr
eigener Eintrag ist. Von gescheiterten Aufträgen und Ereignissen nimmt die Übersicht höchstens die
neuesten 100; alle stehen auf ihren Seiten.

Daneben die sechs neuesten Ereignisse und unten die offenen Aufträge (wartend, bereit, zugestellt,
bestätigt, läuft).

## Aufträge, Ereignisse, Audit-Log

Die drei Listen kommen seitenweise, die neuesten zuerst; „Mehr laden“ holt die nächste Seite.

| Route | Filter | sortiert nach |
| --- | --- | --- |
| `GET /api/v1/auftraege` | `zustand`, `serverId`, `installationId` | Anlage, dann ID |
| `GET /api/v1/ereignisse` | `schwere`, `art`, `ziel` | Zeitpunkt, dann ID |
| `GET /api/v1/audit` | `akteur`, `aktion`, `ziel` | Nummer des Eintrags |

Jeder Filter lässt sich wiederholen (`?zustand=wartend&zustand=laeuft`). `anzahl` ist die Größe einer
Seite (1 bis 200, Vorgabe 50), `weiter` die Marke, die die Seite davor als `weiter` mitbrachte; ohne
weitere Seite ist sie `null`. Die Marke nennt die letzte Zeile der Seite, nicht eine Zahl übersprungener
Zeilen: kommen zwischen zwei Seiten neue Zeilen hinzu, sind sie neuer als die Marke und verschieben
nichts, jede Zeile kommt genau einmal. Eine Marke, die die Zentrale nicht ausgegeben hat, lehnt sie
mit `400` ab.

Ein Auftrag kommt mit Server, Kunde und Adresse seiner Installation und, wenn er scheiterte, mit dem
Grund; nie mit dem Text oder der Signatur des Manifests und nie mit den Argumenten (dort stehen die
Einstellungen einer Einrichtung). Ein Ereignis und ein Eintrag des Audit-Logs nennen ihr Ziel
(`installation:<id>`, `server:<id>`, im Audit-Log die Tabelle, etwa `installationen:<id>`) und, wo es
eine Seite hat, deren Namen. Ein Eintrag des Audit-Logs nennt, wer handelte: eine Person mit Namen,
den Agenten eines Servers oder die Zentrale selbst (`system`, `einrichtungscode`, `einladung`).

Den Inhalt eines Eintrags zeigt die Zentrale, wie das Audit-Log ihn speichert, und filtert ihn beim
Lesen noch einmal: Text und Signatur eines Manifests, die Zeilen eines Log-Auszugs und der Hash
eines Tokens stehen als „[ausgelassen]“ da, ein verschlüsselter Wert als „[verschlüsselt]“, jeder
Text über 1000 Zeichen als „[ausgelassen]“.

## Wer was liest

| Route | Inhaber | Technik | Support |
| --- | --- | --- | --- |
| Übersicht, Aufträge, Ereignisse | ja | ja | ja |
| Audit-Log | ja | ja | nein |

Jede Route liest nur die Daten des eigenen Betreibers; eine ID eines anderen Betreibers ist
unbekannt, auch als Filter.

## Server- und Kundenseite

Die Seite eines Servers zeigt die Installationen darauf und die Ereignisse des Servers und seiner
Installationen; die Seite eines Kunden seine Installationen, ihre Server und ihre Ereignisse. Beide
nehmen die Installationen aus `GET /api/v1/installationen`.

## Was noch kommt

Angemeldet zeigt keine Seite ein Datum der Demo. Wo die Zentrale noch keine Daten hat, sagt die Seite,
mit welchem Punkt sie kommen:

| Seite oder Teil | kommt mit |
| --- | --- |
| Größe und Prüf-Restore der Backups | Z-602 |
| Updates | Z-501, Z-503 |
| Support-Zugänge, Support-Minuten eines Kunden | Z-802 |
| Leistungen | Z-804 |
| Einstellungen → DNS | Z-407 |
| Einstellungen → Benachrichtigungen | Z-703 |
| Auslastung und Prüfungen eines Servers | Z-701, Z-702 |

Die Beschreibungen der acht Apps (Seite „Apps“, Sperrzeiten in der Seitenleiste) stammen aus
`manifeste/`, bis die Zentrale Manifeste importiert (Z-501). Unter Einstellungen → Konten stehen die
Mitglieder des Betreibers mit Rolle, die Seitenleiste nennt Betreiber und eigenes Konto aus
`GET /api/v1/ich`.
