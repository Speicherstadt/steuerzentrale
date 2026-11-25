---
title: Prüfung von außen und Verfügbarkeit
description: >-
  Wie die Zentrale jede öffentliche Adresse unabhängig vom Agenten prüft (DNS, Zertifikat, Pforte,
  Health), was „Agent grün, außen rot“ auslöst, wie die Verfügbarkeit je Installation und Monat
  berechnet wird, wie beobachtete Dienste geprüft werden und was `/health` der Zentrale einem
  externen Prüfdienst sagt.
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
| DNS | A und AAAA des Hosts, gefragt bei den Nameservern aus `/etc/resolv.conf` (kein lokaler Cache) | der Name nicht auflöst; eine Adresse nicht öffentlich ist (Loopback, privat, Link-Local, CGNAT, `0.0.0.0/8`, Multicast; IPv6 außerhalb von `2000::/3`), dann verbindet sich die Zentrale gar nicht; oder, wenn die Zentrale die Einträge gesetzt hat ([Adressen und DNS](dns.md)), A oder AAAA nicht genau auf die öffentlichen Adressen des Servers zeigen | 5 s |
| Zertifikat | TLS zur ersten Adresse mit dem Host als SNI, gegen die Zertifizierungsstellen des Systems | das Zertifikat abgelaufen, nicht vertrauenswürdig oder für einen anderen Namen ist | 10 s |
| Pforte | dieselbe Verbindung | keine Verbindung zustande kommt | 10 s |
| Health | `GET https://<host><pfad>` an dieselbe Adresse wie das Zertifikat (der Name wird nicht noch einmal aufgelöst), ohne Weiterleitungen zu folgen | der Status nicht 200 bis 399 ist oder keine Antwort kommt | 10 s |

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

`GET /api/v1/installationen/{id}/verfuegbarkeit?tage=90` (alle Rollen, nur Installationen des
eigenen Betreibers) liefert die Verfügbarkeit je Tag aus denselben Stunden, den ältesten Tag zuerst
und heute zuletzt. Ein Tag ist ein Kalendertag in `Europe/Berlin` (am Tag der Zeitumstellung 23 oder
25 Stunden); `tage` ist 1 bis 400, ohne Angabe 90; ein anderer Wert ergibt `400 ungueltig`.

```json
{
  "tage": [
    { "jahr": 2026, "monat": 11, "tag": 24, "von": 1795474800000, "gemessen": 1215, "rot": 0, "anteil": 1 }
  ]
}
```

`anteil` ist `null` an einem Tag ohne Prüfung.

Die Seite einer App zeigt, sobald sie läuft:

- im Reiter „Überblick“ in der Zeile „Erreichbar“ die Antwortzeit von außen und wie lange das
  Zertifikat gilt, in der Zeile „Verfügbarkeit“ diesen und den letzten Monat;
- im Reiter „Messwerte“ die letzten 90 Tage als Balken, einen je Tag: grün bei 100 %, gelb unter
  100 %, rot unter 99 %, grau ohne Messung; darüber den Anteil über die 90 Tage und wie viele Tage
  einen Ausfall hatten, mit den Minuten zusammen (die Stunden zählen rote Prüfungen, nicht wann ein
  Ausfall anfing und aufhörte: einzelne Ausfälle lassen sich daraus nicht zählen);
- im Reiter „Technik“ die Karte „Adresse und Prüfung von außen“: wohin der Name zeigt, das
  Zertifikat, was die Prüfung von außen ergab und die Verfügbarkeit des Monats, darunter jeden
  gemessenen Monat der letzten 13.

## Beobachtete Dienste

Ein beobachteter Dienst ist einer, den die Zentrale nicht installiert hat: ein Wiki hinter
Cloudflare, die Statusseite eines Kunden, ein Dienst auf einem Server, den sie nicht verwaltet. Er
hat einen Namen, eine Adresse, den Pfad der Health-Prüfung (Vorgabe `/`) und auf Wunsch einen
Kunden. Kein Agent, kein Manifest: ohne Version, Backup, Update und Aktionen.

Die Zentrale prüft ihn in derselben Runde wie die Installationen, jede Minute, mit denselben
Schritten: DNS, Zertifikat, Verbindung und Health. Zwei Unterschiede:

- Die Adresse ist nur `https://<host>`, ohne Port, Pfad, Nutzer oder IP-Adresse; geprüft wird auf
  Port 443. Ein Name ohne Punkt (`localhost`) ist keine Adresse. Eine Adresse, die auf eine nicht
  öffentliche Adresse auflöst, fragt die Zentrale nie an (wie bei einer Installation).
- Die Einträge im DNS vergleicht sie mit keinem Server: der Dienst darf hinter Cloudflare oder
  einem anderen Proxy liegen. Gesund ist ein Status von 200 bis 399, wie beim Health-Pfad einer
  Installation; „Pforte“ heißt bei einem Dienst „Keine Verbindung“.

Danach gilt dasselbe wie für eine Installation, nur ohne die Seite innen: nach der zweiten roten
Prüfung `aussen_rot`, wieder grün `aussen_gruen`, nach 5 Minuten rot die Störung `stoerung`, grün
danach `stoerung_behoben`. Die Ereignisse tragen das Ziel `dienst:<id>` und gehen wie jedes
Ereignis an die [Empfänger](benachrichtigungen.md). Jede Prüfung zählt in ihre Stunde
(`dienst_verfuegbarkeit`, 13 Monate aufbewahrt). Für einen beobachteten Dienst entsteht nie ein
Auftrag an einen Agenten.

Auf der Seite **Apps** stehen die beobachteten Dienste unter den Apps in einer eigenen Tabelle, mit
der Marke „beobachtet“, dem Kunden (nicht in „Nur für mich“), dem Zustand von außen in Worten und
der Verfügbarkeit des Monats; was rot ist, zuerst. In der **Übersicht** steht ein Dienst mit offener
Störung unter „Zu tun“, einer, der rot ist, als Warnung, einer ohne Prüfung seit 3 Minuten unter
„Ohne Eile“; die Zeile führt zur Seite Apps. Das Protokoll nennt ihn mit seinem Namen.

Anlegen, Ändern und Entfernen darf nur der Inhaber, sehen alle Rollen. Gefragt wird kein Grund; im
Audit-Log steht `dienst.anlegen`, `dienst.aendern` oder `dienst.entfernen`. Ein entfernter Dienst
wird nicht mehr geprüft und nicht mehr gezeigt; seine Ereignisse und Messwerte bleiben bis zum Ende
ihrer Aufbewahrung.

| Methode und Pfad | Wer | Was |
| --- | --- | --- |
| `GET /api/v1/dienste` | jede Rolle | die Dienste des Betreibers mit Zustand von außen (`aussen`, `null` vor der ersten Prüfung) und Verfügbarkeit des laufenden Monats |
| `POST /api/v1/dienste` | Inhaber | `{ name, adresse, pfad?, kundeId? }`; `201` mit dem Dienst, `400` bei einer anderen Adresse als `https://<host>`, `404 kein_kunde` |
| `PUT /api/v1/dienste/:dienstId` | Inhaber | dieselben Felder; `404 kein_dienst` für einen fremden oder entfernten |
| `DELETE /api/v1/dienste/:dienstId` | Inhaber | `204`; `404 kein_dienst` |

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
- Vitest in `packages/planung`: die Verfügbarkeit je Tag über das Monatsende und die Tage der
  Zeitumstellung.
- Vitest der Routen: jeder Betreiber sieht nur seine Installationen, auch die Tage.
- Playwright: die Karte auf der Seite einer laufenden App, die Balken im Reiter „Messwerte“.
- Beobachtete Dienste: Vitest in `apps/zentrale/src/modules/dienste` (grün gegen einen Test-Server
  mit Test-Zertifikat, `aussen_rot` nach zwei roten Prüfungen, Störung nach 5 Minuten, Zählung je
  Stunde, Zustellung an Empfänger, kein Auftrag, eine nicht öffentliche Adresse wird nie angefragt,
  entfernt nicht mehr geprüft), der Routen (Adresse, Rollen, je Endpunkt kein fremder Betreiber) und
  Playwright für Anlegen, Ändern und Entfernen (Desktop und `@phone`).
