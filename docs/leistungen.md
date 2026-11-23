---
title: Leistungen
description: >-
  Was jeder Kunde in einem Monat genutzt hat: Installationen, Speicher, Support-Zeit und
  Verfügbarkeit, berechnet aus dem, was geschah, und als CSV nach RFC 4180.
---

# Leistungen

Die Seite **Leistungen** zeigt für einen Monat jeden Kunden mit seinen Installationen, ihrer
Verfügbarkeit, der Größe ihrer Daten und der Support-Zeit. Rechnungen schreibt das Portal; die
Zentrale liefert die Zahlen. Alle Rollen sehen die Seite, wie sie Kunden sehen.

## Monat und Kunden

Ein Monat ist ein Kalendermonat in `Europe/Berlin`, von Mitternacht am Ersten bis Mitternacht am
Ersten des nächsten Monats, auch über die Zeitumstellung (der Oktober hat eine Stunde mehr, der März
eine weniger). Die Seite bietet den laufenden Monat und die zwölf davor; der laufende zählt bis jetzt.

Ein Kunde erscheint, wenn sein Vertrag im Monat lief: begonnen vor dem Ende des Monats und nicht vor
seinem Anfang geendet. Eigene Kunden (intern) erscheinen nicht.

## Was gezählt wird

Jede Zahl entsteht beim Lesen aus dem, was geschah; einen Zähler daneben gibt es nicht.

| Spalte | Woraus |
| --- | --- |
| Installationen | jede Installation des Kunden, deren Einrichtung erfolgreich endete, bevor der Monat vorbei war; eine gescheiterte zählt nie |
| Daten (Speicher) | je Installation die Bytes, die restic beim neuesten erfolgreichen Backup des Monats gelesen hat (alle Teile zusammen, `total_bytes_processed`); der Kunde ist die Summe der bekannten; ohne erfolgreiches Backup im Monat oder von einem Agenten vor dieser Version unbekannt („–“) |
| Support | die Minuten der [Support-Zugänge](support.md), die im Monat begannen, jeder bis zu seinem Ende (oder bis jetzt), je Zugang gerundet, wie auf der Kundenseite |
| Verfügbarkeit | je Installation der Anteil grüner [Prüfungen von außen](aussen.md) an den gemessenen Minuten des Monats; beim Kunden die schlechteste Installation, damit eine gute keine schlechte verdeckt; ohne Messung „nicht gemessen“ |

Speicher ist die Größe der Daten, nicht der Platz im Bucket: restic dedupliziert und komprimiert,
der Platz im S3-Ziel ist kleiner und hängt an den aufbewahrten Snapshots. Die Größe der Daten ist,
was ein Kunde versteht und vergleicht.

## Export als CSV

**CSV herunterladen** lädt den gewählten Monat als `leistungen-JJJJ-MM.csv`, ein Datensatz je Kunde,
nach RFC 4180: UTF-8 ohne BOM, Komma als Trenner, CRLF nach jedem Datensatz, die erste Zeile mit den
Spaltennamen; ein Feld mit Komma, Anführungszeichen oder Zeilenumbruch steht in Anführungszeichen,
ein Anführungszeichen darin verdoppelt. Die Spaltennamen sind fest, in jeder Sprache der Oberfläche:

```text
monat,kunde,kuerzel,installationen,apps,speicher_bytes,support_minuten,verfuegbarkeit_prozent,gemessene_minuten,minuten
2026-11,Kanzlei Weber,kanzlei-weber,2,haben kontext,5368709120,45,99.95,43200,43200
```

- `speicher_bytes` in Bytes, `support_minuten`, `gemessene_minuten` und `minuten` (des Monats bis
  jetzt) als ganze Zahlen; leer, wo nichts bekannt ist;
- `verfuegbarkeit_prozent` mit Punkt und zwei Stellen, abgeschnitten, nicht gerundet: 99,899 %
  erscheint als `99.89`, nie als die 99,90 % des SLA;
- `apps` die Apps der Installationen, mit Leerzeichen getrennt.

Ein Text, den eine Tabellenkalkulation als Formel ausführen würde (beginnend mit `=`, `+`, `-`, `@`,
Tabulator oder Wagenrücklauf), bekommt ein Apostroph davor (`'=…`): der Name eines Kunden kommt von
einer Person und läuft so nie in der Tabelle des Betreibers.

## API

`GET /api/v1/leistungen?monat=2026-11` liefert den Monat als JSON (ohne `monat` den laufenden),
`&format=csv` dasselbe als CSV (`text/csv; charset=utf-8; header=present`, als Download). Ein Monat,
der keiner ist, oder ein anderes Format ist `400`. Recht `kunden:lesen` (alle Rollen); jeder
Betreiber sieht nur seine Kunden.
