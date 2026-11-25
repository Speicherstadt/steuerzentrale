---
title: Support-Zugang
description: >-
  Wozu ein Support-Zugang da ist: Support liest das Log einer App eines Kunden und startet sie neu,
  nur bei dieser App, zeitlich begrenzt und mit einem Grund, den der Kunde sieht; wo man ihn startet
  und wo er steht.
---

# Support-Zugang

Mit einem **Support-Zugang** darf eine Person mit der Rolle **Support** bei einer App eines Kunden
das Log lesen und die App neu starten: nur bei dieser einen App (Installation), nur für eine
begrenzte Zeit und nur mit einem Grund, den der Kunde sieht. Danach endet der Zugang von selbst.

Ein Beispiel: Ein Kunde meldet, dass seine App langsam ist. Die Person im Support startet einen
Zugang für zwei Stunden mit dem Grund „Anfrage aus dem Portal: Anmeldung langsam“, liest das Log,
startet die App neu und beendet den Zugang. Der Kunde sieht, wer wann warum auf seine App zugegriffen
hat.

Ohne Zugang sieht Support Kunden, Server, Apps, Aufträge und Ereignisse, greift aber auf keine App
zu. Ein Zugang erlaubt [Log-Auszug und Neustart](aktionen.md) dieser einen Installation; Start und
Ende stehen im Audit-Log und in den Ereignissen des Kunden. Den Zugang gibt es nur in der
Betriebsart „Für Kunden“ ([Anmeldung](anmeldung.md#nur-fur-mich-oder-fur-kunden)).

## Zugang starten

Wer hilft, startet den Zugang selbst, an einer dieser Stellen:

- auf der Seite der App: „Zugang starten“ unter **Mehr …** oder im Kasten „Support-Zugang“ im Reiter
  **Technik**;
- auf der Seite des Kunden im Reiter **Support**, mit Wahl einer seiner Apps;
- unter **Kunden → Support-Zugänge**, mit Wahl der App.

Der Dialog fragt

- die **Dauer**: 1, 2 oder 4 Stunden, Vorgabe 2 Stunden (die API nimmt 15 bis 240 Minuten),
- den **Grund**, etwa „Anfrage aus dem Portal: Anmeldung langsam“; er steht im Audit-Log und im
  Ereignis, das der Kunde sieht.

Jede Rolle kann einen Zugang starten, immer nur für sich selbst. Inhaber und Technik brauchen keinen,
um Logs zu lesen oder neu zu starten; ein Zugang macht ihre Arbeit für den Kunden sichtbar. Je Person
und Installation läuft höchstens ein Zugang zugleich; eine andere Person kann daneben ihren eigenen
haben.

## Was ein Zugang erlaubt

| Während eines eigenen Zugangs | Support | Inhaber, Technik |
| --- | --- | --- |
| Log-Auszug anfordern und lesen | ja, nur diese Installation | immer |
| Neustart | ja, nur diese Installation | immer |
| „Nur lesen“, Backups, Updates, Einstellungen | nie | immer |

Die Zentrale prüft den Zugang bei **jeder Anfrage** mit der Uhr der Anfrage, sobald sie ganz
angekommen ist: ab der Millisekunde, in der er endet, lehnt sie Log-Auszug, das Lesen seiner Zeilen
und Neustart mit `403 keine_berechtigung` ab, auch einen Log-Auszug, der während des Zugangs
angefordert wurde. Die Seite der App zeigt Support „Neustart“ und unter „Mehr …“ den Log-Auszug nur,
solange der eigene Zugang läuft.

## Ende

Ein Zugang endet von selbst, wenn seine Dauer um ist. Vorher beendet ihn die Person, die ihn hält
(„Zugang beenden“); Inhaber und Technik können auch den Zugang einer anderen Person beenden.

Start und Ende stehen im **Audit-Log** (`support.starten`, `support.beenden`,
`support.abgelaufen`) mit Person und Grund, und als **Ereignis** an der Installation, das die
Kundenseite und später das Portal zeigen:

- „Support-Zugang gestartet: Ole Kamp, 2 h, „Backup schlägt fehl““
- „Support-Zugang beendet: Ole Kamp nach 45 Min.“ (von Hand)
- „Support-Zugang abgelaufen: Ole Kamp nach 2 h“ (die Zentrale prüft jede Minute, ob einer
  abgelaufen ist, und schreibt das Ereignis einmal mit dem Zeitpunkt des Ablaufs)

Der Reiter **Support** auf der Seite eines Kunden zeigt die laufenden Zugänge zu seinen Apps mit
Restzeit und die beendeten mit Dauer und dem, was geschah (Log-Auszug, Neustart oder kein
Eingriff). Dieselbe Liste für alle Kunden steht unter **Kunden → Support-Zugänge** (`/support`).
Während des eigenen Zugangs zeigt der Kasten „Support-Zugang“ im Reiter „Technik“ der App die
Restzeit, den Grund und „Zugang beenden“; „Zugang beenden“ steht dann auch unter „Mehr …“.

## API

| Route | Recht | Wer |
| --- | --- | --- |
| `GET /api/v1/support-zugaenge` | `support:lesen` | alle Rollen |
| `POST /api/v1/support-zugaenge` | `support:starten` | alle Rollen, für sich selbst |
| `POST /api/v1/support-zugaenge/:zugangId/beenden` | `support:starten`; einen fremden Zugang nur mit `support:verwalten` | die Person des Zugangs; Inhaber, Technik |

`GET` nimmt die Filter `kundeId` und `installationId` und liefert die neuesten 200 Zugänge nach
Beginn: Installation, Kunde, Person, Grund, `beginn`, `ende`, `beendetAm`, `endetAm`, `aktiv`,
`eigen` (die anfragende Person hält ihn) und `aktionen` (`log_auszug`, `neustart`, die sie in der
Zeit auf der Installation auslöste). Zeitpunkte sind UTC-Millisekunden.

`POST /api/v1/support-zugaenge` nimmt `installationId`, `grund` (Pflicht, höchstens 500 Zeichen)
und `dauerMinuten` (ganze Zahl, 15 bis 240, ohne Angabe 120). Fehler: `400 ungueltig`,
`404 keine_installation` (auch für eine entfernte oder die eines anderen Betreibers),
`409 zugang_aktiv`.

`POST …/beenden` nimmt einen freiwilligen `grund` (sonst „Support-Zugang von Hand beendet“).
Fehler: `403 keine_berechtigung` (fremder Zugang ohne `support:verwalten`), `404 kein_zugang`,
`409 zugang_beendet`.

Kein Betreiber sieht oder beendet die Zugänge eines anderen.
