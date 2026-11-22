---
title: Health und Zustand
description: >-
  Wie die Steuerzentrale aus der Meldung des Agenten (Units und Health-Prüfung) den Zustand einer
  Installation bewertet (grün, gelb, rot, unbekannt mit Grund), den Verlauf jedes Wechsels hält und
  nach fünf Minuten Rot eine Störung meldet.
---

# Health und Zustand

Jede Installation hat einen Zustand: **grün**, **gelb**, **rot** oder **unbekannt**, immer mit einem
Grund. Grün heißt geprüft und in Ordnung, sonst nichts: was nicht gemessen ist, ist nie grün.

## In der Zentrale

### Meldung

Der Agent schickt alle 30 Sekunden die Nachricht `zustand` mit jeder Installation seines Servers: den
`ActiveState` jeder Unit und das Ergebnis der Health-Prüfung aus dem Manifest. Die Zentrale nimmt sie
nur für Installationen **dieses Servers und dieses Betreibers** an, die nicht entfernt sind; die
Meldung für jede andere Installation verwirft sie und schreibt eine Zeile ins Log. Kommen zwei
Meldungen einer Verbindung näher als 5 Sekunden, gilt nur die erste.

### Bewertung

Die Bewertung ist eine reine Funktion (`packages/planung`, `installationBewerten`):

| Zustand | wenn … | Grund |
| --- | --- | --- |
| rot | die Health-Prüfung rot ist | der Text der Prüfung |
| gelb | eine Unit nicht `active` ist (auch `activating` oder `failed`) | die erste solche Unit und ihr `ActiveState` |
| unbekannt | der Agent eine Unit nicht lesen konnte (`unknown`) | die Unit |
| unbekannt | keine Unit gemeldet ist | „keine Units gemeldet“ |
| grün | das Manifest keine Prüfung hat (`health: keine`) und alle Units aktiv sind | „alle Units aktiv, keine Health-Prüfung“ |
| grün oder gelb | die Prüfung grün oder gelb ist und alle Units aktiv sind | der Text der Prüfung |
| unbekannt | sonst (die Prüfung konnte nichts sagen) | der Text der Prüfung |

Ob das Manifest eine Prüfung hat, liest die Zentrale aus dem Manifest der Installation, das sie
gespeichert hat, nicht aus der Meldung: bei `keine` meldet der Agent die Health „unbekannt“ mit dem
Grund „keine Prüfung“. Den Text des Agenten kürzt die Zentrale auf 500 Zeichen.

**Ohne Meldung seit 90 Sekunden** ist eine Installation unbekannt („keine Meldung seit 90 s“), auch
wenn der Agent getrennt oder still ist. Die Zentrale rechnet das beim Lesen und setzt es in der
Prüfung alle 30 Sekunden, mit dem Zeitpunkt, an dem die Meldung fällig war.

### Gespeichert

Der aktuelle Zustand (Bewertung, Grund, seit, zuletzt gemeldet, Units und Health der letzten Meldung)
steht an der Installation. Er ist ein **Messwert** wie Heartbeats und Fakten: er wird nicht ins
Audit-Log geschrieben, weil ein Eintrag alle 30 Sekunden je Installation die Einträge verdecken würde,
die zählen. Jeder **Wechsel** der Bewertung ist eine Zeile in `installation_verlauf` mit Zeitpunkt,
Bewertung und Grund, je Betreiber, 90 Tage aufbewahrt. „Seit“ bleibt, solange die Bewertung bleibt;
der Grund ist immer der neueste.

### Störung

Ist eine Installation **5 Minuten durchgehend rot**, schreibt die Zentrale einmal das Ereignis
`stoerung` (Schwere `fehler`) über das Audit-Log. Wird sie danach **grün**, folgt einmal
`stoerung_behoben` (Schwere `info`). Gelb und unbekannt beenden keine Störung: wer nach einer Stille
wieder rot meldet, bekommt keine zweite. Rot zählt nur, solange Meldungen kommen: ohne Meldung seit
90 Sekunden ist die Installation unbekannt, nicht mehr rot. Ob eine Störung offen ist, sagen die
Ereignisse selbst (das neueste `stoerung` ist jünger als das neueste `stoerung_behoben`), so
wiederholt und vergisst ein Neustart der Zentrale keine.

Geprüft wird bei jeder Meldung und alle 30 Sekunden.

### API und Oberfläche

`GET /api/v1/installationen` und `GET /api/v1/installationen/{id}` liefern an jeder Installation
`health` mit `zustand`, `grund` (`code` und `werte`), `seit`, `gemeldetAm` und den `units` der letzten
Meldung; die Seite einer Installation dazu `verlauf`, die letzten 200 Wechsel, neueste zuerst. Vor der
ersten Meldung ist der Zustand unbekannt mit dem Grund `noch_keine_meldung`.

Die Liste der Installationen zeigt neben dem Zustand den Grund, wenn er nicht grün ist; die Seite einer
Installation zeigt im Reiter „Zustand“ die Karte „Units und Health“ (Zustand mit Grund und seit,
zuletzt gemeldet, jede Unit) und den Verlauf. Bis die Installation läuft, steht im Kopf ihr Zustand
der Einrichtung.
