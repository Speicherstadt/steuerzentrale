---
title: Health und Zustand
description: >-
  Was der Agent alle 30 Sekunden an jeder Installation prüft und meldet (Health nach dem signierten
  Manifest, Zustand der systemd-Units), wie die Zentrale daraus grün, gelb, rot oder unbekannt mit
  Grund macht, den Verlauf hält und nach fünf Minuten Rot eine Störung meldet.
---

# Health und Zustand

Jede Installation hat einen Zustand: **grün**, **gelb**, **rot** oder **unbekannt**, immer mit einem
Grund. Grün heißt geprüft und in Ordnung, sonst nichts: was nicht gemessen ist, ist nie grün.

## Was der Agent prüft

Was er prüft, merkt sich der Agent beim Einrichten im
Gedächtnis der Installationen ([Apps installieren](installieren.md)): die Units der Installation
und das Ziel der Prüfung, gerendert aus dem signierten Manifest und den Ports, die der
Einrichtungsauftrag vergeben hat. Eine spätere Nachricht der Zentrale ändert das Ziel nie.

### Health

Nach `health` im Manifest:

| Art | Prüfung | Grün | Zeitlimit |
| --- | --- | --- | --- |
| `http` | `GET http://127.0.0.1:<Host-Port>/<pfad>`, Weiterleitungen werden nicht verfolgt | Status 200 bis 399 | 5 s |
| `tcp` | Verbindung zu `127.0.0.1:<Host-Port>` | Verbindung steht | 5 s |
| `befehl` | der benannte Befehl mit `podman exec <installation>-<container>` als Nutzer der Installation, Ausgabe verworfen | Code 0 | sein `zeitlimit_s`, höchstens 30 s |
| `keine` | nichts | – | – |

Der Host-Port ist der Port auf 127.0.0.1, den die Zentrale dem Dienst vergeben hat: für den Port
von `netz.http` der HTTP-Port der Installation, für einen Port aus `netz.ports` sein vergebener oder
fester Port. Ohne eigenen `port` prüft `http` den Port von `netz.http`.

Läuft ein Befehl (`befehl`) oder `systemctl show` ins Zeitlimit, beendet der Agent alles, was er
gestartet hat, auch den Befehl im Container unter conmon; nichts bleibt verwaist zurück, obwohl die
Prüfung alle 30 Sekunden läuft. Wie, steht unter [Aufträge](auftraege.md#zeitlimit).

Das Ergebnis ist `gruen`, `rot` oder `unbekannt`, immer mit einem kurzen Grund, etwa „HTTP 200“,
„HTTP 500“, „keine Antwort in 5 s“, „Befehl endete mit Code 1“. Der Grund enthält nie, was ein
Befehl oder die App ausgegeben hat.

`unbekannt` heißt: nicht gemessen. So meldet der Agent

- `keine` mit dem Grund „keine Prüfung“; die Zentrale bewertet die Installation dann nur nach
  ihren Units;
- ein Ziel, das er nicht prüfen kann, mit dem Grund: ein Port, der auf dem Host nicht
  veröffentlicht ist (etwa ein Dienst hinter dem eigenen Proxy einer App), oder ein Befehl, der
  Argumente braucht;
- eine Installation, die vor dieser Prüfung eingerichtet wurde und deren Gedächtnis kein Ziel
  kennt, mit dem Grund „Ziel der Prüfung unbekannt (vor Z-403 eingerichtet)“ und ohne Units;
- einen Befehl, dessen Nutzer fehlt.

### Units

Den `ActiveState` jeder Unit liest der Agent mit `systemctl --user show -p Id,ActiveState` als
Nutzer der Installation, höchstens 10 Sekunden lang. Gemeldet wird der Wert, wie systemd ihn nennt
(`active`, `inactive`, `failed`, `activating`, …). Was er nicht lesen kann (kein Nutzer, keine
Antwort, ein unbekannter Wert), meldet er als `unknown`.

## Was der Agent meldet

Solange die Verbindung zur Zentrale steht, schickt der Agent gleich nach `willkommen` und dann alle
30 Sekunden eine Nachricht `zustand` mit allen fertig eingerichteten Installationen:

```json
{
  "typ": "zustand",
  "protokoll": 1,
  "zeit": 1795000000000,
  "installationen": [
    {
      "installationId": "haben-k7m2",
      "units": [{ "name": "haben-k7m2-app.service", "aktiv": "active" }],
      "health": { "zustand": "gruen", "grund": "HTTP 200" }
    }
  ]
}
```

Eine Installation, die gerade eingerichtet oder abgebaut wird, fehlt darin; wie das ausging, sagt
der Auftrag. Die Installationen werden gleichzeitig geprüft. Dauert eine Runde länger als 30
Sekunden, fällt die nächste aus, statt dieselben Prüfungen doppelt laufen zu lassen. Ist das
Gedächtnis unlesbar, schickt der Agent nichts; die Zentrale hält eine Installation ohne Meldung
seit 90 Sekunden für unbekannt.

## Wie es geprüft wird

Mit Vitest und gefälschtem Spawn, Fetch, Socket und gefälschter Uhr: jede Art, die Zeitlimits,
Weiterleitungen, nicht lesbare Units und ein Gedächtnis ohne Ziel. In der CI
(`apps/agent/test/zustand.agent.test.ts`) richtet der Agent die Beispiel-App per Auftrag mit echtem
Podman und systemd ein und prüft sie: Version 1.0.0 meldet Health grün, die kaputte 2.1.0 rot; mit
der Option `worker` meldet eine gestoppte Worker-Unit nicht `active`; ein Manifest mit
`health: keine` meldet Health ohne Prüfung.

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

Dieselbe Störung entsteht, wenn die Installation **von außen** 5 Minuten durchgehend rot ist, auch
wenn der Agent grün meldet; dann endet sie erst, wenn innen und außen wieder grün sind
([Prüfung von außen und Verfügbarkeit](aussen.md)).

### API und Oberfläche

`GET /api/v1/installationen` und `GET /api/v1/installationen/{id}` liefern an jeder Installation
`health` mit `zustand`, `grund` (`code` und `werte`), `seit`, `gemeldetAm` und den `units` der letzten
Meldung; die Seite einer Installation dazu `verlauf`, die letzten 200 Wechsel, neueste zuerst. Vor der
ersten Meldung ist der Zustand unbekannt mit dem Grund `noch_keine_meldung`.

Die Liste unter „Apps“ sagt den Zustand in Worten, rot als „Störung: “ mit dem Grund, gelb und
unbekannt mit dem Grund ([Installieren](installieren.md)); die Seite einer App sagt ihn im Kopf in
einem Satz, zeigt im Reiter „Technik“ die Karte „Units und Health“ (Zustand mit Grund und seit,
zuletzt gemeldet, jede Unit) und im Reiter „Verlauf“ jeden Wechsel. Bis die Installation läuft,
steht im Kopf ihr Zustand der Einrichtung.
