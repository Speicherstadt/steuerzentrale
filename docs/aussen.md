---
title: Prüfung von außen und Verfügbarkeit
description: >-
  Wie die Zentrale jede öffentliche Adresse unabhängig vom Agenten prüft (DNS, Zertifikat, Pforte,
  Health), was „Agent grün, außen rot“ auslöst, wie die Verfügbarkeit je Installation und Monat
  berechnet wird und was `/health` der Zentrale einem externen Prüfdienst sagt.
---

# Prüfung von außen und Verfügbarkeit

Der Agent prüft eine Installation von innen ([Health und Zustand](zustand.md)): auf
`127.0.0.1`, am Port des Containers. Ob Kunden die App erreichen, sagt das nicht: ein falscher
DNS-Eintrag, ein abgelaufenes Zertifikat oder eine Pforte ohne Route fallen innen nicht auf. Deshalb
prüft die Zentrale jede öffentliche Adresse selbst, über das Internet, ohne den Agenten.

## Was geprüft wird

Jede Minute jede Installation, die läuft und deren Manifest einen HTTP-Dienst hat (`netz.http`, die
Pforte leitet ihre Adresse weiter). Höchstens acht gleichzeitig; ist eine Runde nach einer Minute
noch nicht fertig, fällt die nächste aus. Die Schritte gehen der Reihe nach, der erste, der
scheitert, ist der Grund:

| Schritt | Prüfung | Rot, wenn … | Zeitlimit |
| --- | --- | --- | --- |
| DNS | A und AAAA des Hosts, gefragt bei den Nameservern aus `/etc/resolv.conf` (kein lokaler Cache) | der Name nicht auflöst; oder, wenn die Zentrale die Einträge gesetzt hat ([Adressen und DNS](dns.md)), A oder AAAA nicht genau auf die öffentlichen Adressen des Servers zeigen | 5 s |
| Zertifikat | TLS zur ersten Adresse mit dem Host als SNI, gegen die Zertifizierungsstellen des Systems | das Zertifikat abgelaufen, nicht vertrauenswürdig oder für einen anderen Namen ist | 10 s |
| Pforte | dieselbe Verbindung | keine Verbindung zustande kommt | 10 s |
| Health | `GET https://<host><pfad>`, ohne Weiterleitungen zu folgen | der Status nicht 200 bis 399 ist oder keine Antwort kommt | 10 s |

Der Pfad ist der aus `health` im Manifest, wenn die Prüfung `http` auf dem Dienst und Port von
`netz.http` ist, wie der Agent sie innen macht. Sonst (`tcp`, `befehl`, `keine` oder ein anderer
Dienst) fragt die Zentrale `/` und nimmt jede Antwort unter 500 als erreicht: die Pforte hat die App
gefunden. Eine Adresse, die der Betreiber selbst einträgt (außerhalb seiner Domain), prüft die
Zentrale nur auf Auflösung, nicht auf die Adressen.

Das Ergebnis ist **grün** oder **rot** mit Grund: „Health 200 in 48 ms“, „DNS zeigt auf … statt
…“, „Zertifikat abgelehnt: CERT_HAS_EXPIRED“, „Pforte nicht erreicht: ECONNREFUSED“, „Health: HTTP
503“. Kommt drei Minuten keine Prüfung, ist der Zustand von außen **unbekannt**.

Wie lange das Zertifikat noch gilt, steht beim Ergebnis; die Warnung 14 Tage vor dem Ende ist eine
eigene Prüfung des Servers.

## Ereignisse und Störung

- Ist eine Installation **zweimal hintereinander** von außen rot, schreibt die Zentrale einmal das
  Ereignis `aussen_rot` (Schwere `warn`) mit dem Grund und dem, was der Agent innen meldet: „Von außen
  rot: haben-k7m2 (haben.kanzlei.example.de): Health: HTTP 503; Agent meldet grün“. Eine einzelne
  rote Prüfung (ein verlorenes Paket) meldet nichts.
- Ist sie danach wieder grün, folgt einmal `aussen_gruen` (Schwere `info`).
- Ist sie **5 Minuten durchgehend** von außen rot, ist das eine **Störung** wie 5 Minuten rot innen
  (Ereignis `stoerung`, Schwere `fehler`). Behoben ist sie erst, wenn innen und außen wieder grün
  sind; gelb und unbekannt beenden keine.

Ein Ereignis je Wechsel, nicht je Prüfung. Welches zuletzt kam, sagen die Ereignisse selbst; ein
Neustart der Zentrale wiederholt und vergisst keins. Alle gehen über das Audit-Log.

## Verfügbarkeit

Jede Prüfung zählt in die Stunde (UTC), in der sie lief: wie viele, wie viele rot. Die
**Verfügbarkeit eines Monats** ist der Anteil der grünen an allen Prüfungen des Monats. Jede Prüfung
steht für eine Minute.

- Ein Monat ist ein Kalendermonat in `Europe/Berlin`, von Mitternacht am Ersten bis Mitternacht am
  Ersten des nächsten. Weil Berlin immer ganze Stunden von UTC entfernt ist, liegt jede Stunde in
  genau einem Monat; der März hat 743 Stunden, der Oktober 745.
- Minuten ohne Prüfung (die Zentrale war aus, eine Runde fiel aus) zählen weder grün noch rot. Neben
  dem Anteil steht, wie viele Minuten gemessen sind.
- Der laufende Monat zählt bis jetzt.
- Wartungsfenster werden nicht abgezogen: ein Update, das die App kurz stoppt, zählt mit.

Die Stunden werden 13 Monate aufbewahrt, wie die Ereignisse: so steht der Monat vor einem Jahr noch
zum Vergleich da.

## API und Oberfläche

`GET /api/v1/installationen/{id}/aussen` (alle Rollen, nur Installationen des eigenen Betreibers)
liefert:

```json
{
  "aussen": {
    "zustand": "gruen",
    "grund": { "code": "erreichbar", "werte": { "status": "200", "ms": "48" } },
    "seit": 1795000000000,
    "geprueftAm": 1795003600000,
    "ergebnis": {
      "dns": { "ok": true, "a": ["203.0.113.10"], "aaaa": [] },
      "tls": { "ok": true, "gueltigBis": 1800000000000 },
      "http": { "ok": true, "status": 200, "ms": 48 }
    }
  },
  "verfuegbarkeit": [
    { "jahr": 2026, "monat": 11, "minuten": 31680, "gemessen": 31675, "rot": 12, "anteil": 0.99962 }
  ]
}
```

`aussen` ist `null` vor der ersten Prüfung, `verfuegbarkeit` hat 13 Monate, den laufenden zuerst;
`anteil` ist `null` ohne Prüfung im Monat.

Die Seite einer Installation zeigt im Reiter „Zustand“, sobald sie läuft, die Karte „Adresse und
Prüfung von außen“: wohin der Name zeigt, das Zertifikat, was die Prüfung von außen ergab und die
Verfügbarkeit des Monats, darunter jeden gemessenen Monat der letzten 13.

## `/health` der Zentrale

Die Zentrale selbst prüft ein externer Dienst. `GET /health` braucht keine Anmeldung und sagt nur,
ob die Zentrale und ihre Datenbank antworten:

- `200 {"status":"ok","version":"…"}`
- `503 {"status":"fehler","version":"…"}`, wenn die Datenbank keine Leseabfrage beantwortet; den
  Grund schreibt die Zentrale nicht in die Antwort.

## Einstellung

`STEUERZENTRALE_AUSSEN_PRUEFUNG=aus` schaltet die Prüfung ab; gedacht nur für Tests, deren Adressen
erfunden sind (die E2E-Tests). Ohne die Variable (oder mit `an`) läuft sie.

## Wie es geprüft wird

- Vitest in `packages/planung`: Bewertung jedes Schritts, Wechsel und Meldungen, Störung innen und
  außen, die Verfügbarkeit aus einer Testreihe mit bekannten Ausfällen, auch über das Monatsende und
  die Nächte der Zeitumstellung.
- Vitest in `apps/zentrale/src/modules/aussen`: „Agent grün, außen rot“ ergibt ein Ereignis, nach
  5 Minuten eine Störung, die erst grün außen behebt; die Zählung je Stunde; die Schritte gegen eine
  Pforte mit Test-Zertifikat auf `127.0.0.1` (gültig, fremde Zertifizierungsstelle, abgelaufen,
  falscher Name, kein Port) und einen gefälschten Resolver: kein Test fragt einen echten Nameserver.
- Vitest der Route: jeder Betreiber sieht nur seine Installationen.
- Playwright: die Karte auf der Seite einer laufenden Installation.
