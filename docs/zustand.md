---
title: Health und Zustand
description: >-
  Was der Agent alle 30 Sekunden an jeder fertig eingerichteten Installation prüft (Health nach
  dem signierten Manifest, Zustand der systemd-Units) und wie er es der Zentrale meldet.
---

# Health und Zustand

Der Agent prüft jede Installation, die er fertig eingerichtet hat, alle 30 Sekunden auf ihrem
Server und schickt das Ergebnis als Nachricht `zustand` an die Zentrale. Bewertet wird dort: aus
Health und Units wird grün, gelb, rot oder unbekannt.

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
