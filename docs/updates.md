---
title: Updates
description: >-
  Wie die Steuerzentrale Updates plant: Wellen „intern“ und „alle“, Wartungsfenster der Server,
  Sperrzeiten der Apps, dringende Updates und was eine Störung anhält.
---

# Updates

Eine neue Version einer App erreicht die Installationen in Wellen. Den Plan rechnet eine reine
Funktion (`packages/planung`) aus den Installationen, dem Update, dem Stand der Wellen und dem
Zeitpunkt; alle Zeiten gelten in `Europe/Berlin`.

## Wellen

| Welle | Wer | Wann |
| --- | --- | --- |
| intern | unsere eigenen Installationen jeder App | im nächsten Wartungsfenster |
| alle | alle anderen Installationen | 24 Stunden, nachdem „intern“ ohne Störung fertig war, im nächsten Wartungsfenster |

Gibt es von einer App keine eigene Installation, wartet „alle“ auf eine Freigabe von Hand: „intern“
ohne Installation wäre kein Test. Eine Vorabversion erreicht nur „intern“.

Eine **Störung** (Health innen oder außen länger als 5 Minuten rot oder eine Rückkehr nach einem
Update) hält beide Wellen an, auch ein dringendes Update. Apps ohne Health (`health: keine`) werden
in keiner Welle aktualisiert, nur von Hand mit Grund.

## Wartungsfenster

Jeder Server hat Wartungsfenster: Wochentage und eine Uhrzeit von–bis, z. B. täglich 02:00–04:00.
Endet ein Fenster vor seinem Beginn (23:00–03:00), läuft es über Mitternacht. Bei der Umstellung auf
die Sommerzeit gibt es 02:00–03:00 nicht; ein Fenster in dieser Stunde fällt an diesem Tag aus. Bei
der Umstellung auf die Winterzeit beginnt es mit dem ersten 02:00.

## Sperrzeiten

Eine App kann Tage jedes Monats sperren (`sperrzeiten` im Manifest), z. B. Haben vom 7. bis 12. für
die Umsatzsteuer-Voranmeldung. An diesen Tagen beginnt kein Update. Endet die Sperrzeit vor ihrem
Anfang (`28-03`), reicht sie über den Monatswechsel. Eine Sperrzeit übergeht nur der Inhaber mit
Grund, für eine Installation.

## Dringende Updates

Ein als `dringend` markiertes Update (Sicherheitslücke, Mindestversion von ERiC) läuft sofort durch
beide Wellen, ohne die 24 Stunden und ohne auf ein Wartungsfenster zu warten. Eine Sperrzeit hält es
trotzdem auf, bis sie endet, außer der Inhaber gibt die Installation mit Grund frei.
