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

Welche Versionen es gibt, sagen die importierten Manifeste und die Registries ([Manifeste und
Versionen](manifeste.md)). Die Seite **Updates** zeigt je Installation die Versionen, die sie
bekommen kann (eine Vorabversion nur eine Installation eines internen Kunden), wo der Plan für sie
steht (Welle und nächster Termin oder warum sie wartet) und ihr letztes Update mit seinem Ausgang.
Alle 5 Minuten startet die Zentrale, was nach dem Plan fällig ist; auf jedem Server läuft höchstens
ein Update zugleich, das [Update des Agenten](agent-updates.md) mitgezählt. Geplant wird jede
laufende Installation auf die neueste Version, die ihr angeboten wird.

## Wellen

| Welle | Wer | Wann |
| --- | --- | --- |
| intern | unsere eigenen Installationen jeder App | im nächsten Wartungsfenster |
| alle | alle anderen Installationen | 24 Stunden, nachdem „intern“ ohne Störung fertig war, im nächsten Wartungsfenster |

„Intern“ sind die Installationen der Kunden, die der Inhaber als intern markiert hat
([Kunden](kunden.md)). Gibt es von einer App keine eigene Installation, wartet „alle“ auf eine
Freigabe von Hand: „intern“ ohne Installation wäre kein Test. Eine Vorabversion erreicht nur
„intern“.

Eine **Störung** (Health innen oder außen länger als 5 Minuten rot oder eine Rückkehr nach einem
Update) hält beide Wellen an, auch ein dringendes Update. Apps ohne Health (`health: keine`) werden
in keiner Welle aktualisiert, nur von Hand mit Grund.

## Ein Update

Ein Update besteht aus zwei Aufträgen. Zuerst sichert der Agent den Ist-Zustand
(`installation_backup`, wie „Backup jetzt“). Erst wenn dieses Backup gelingt, bekommt der Auftrag
`installation_update` die Snapshots dieses Laufs und geht zum Agenten, mit dem signierten Manifest
der neuen Version und den Werten der Installation dafür. Scheitert das Backup, wird das Update
abgebrochen und auf dem Server ändert sich nichts.

Der Agent zieht die neuen Images per Digest, schreibt die neuen Units, startet neu, führt die
Schritte nach dem Update aus dem Manifest aus (`schritte.nach_update`) und wartet höchstens 5 Minuten
auf grüne Health. Wird sie nicht grün oder scheitert ein Schritt, nimmt er das Update zurück: die
alten Units und die Daten aus dem Backup unmittelbar davor.

| Ausgang | Was die Zentrale tut |
| --- | --- |
| aktualisiert | die Installation läuft mit der neuen Version, ihrem Manifest und ihren Werten; Ereignis `update_gelungen` |
| zurückgenommen | die Version bleibt die alte; Ereignis `update_zurueckgenommen` (Fehler); die Wellen der Version halten an |
| Rücknahme unvollständig | wie zurückgenommen, Ereignis `update_ruecknahme_unvollstaendig`; die Installation braucht einen Menschen |
| gescheitert | der Agent lehnte ab, brach ab oder meldete keinen Ausgang; wie zurückgenommen, Ereignis `update_gescheitert` |
| abgebrochen | das Backup davor scheiterte; nichts geändert, Ereignis `update_abgebrochen` (Warnung), keine Welle hält an |

Fehlt der neuen Version ein Pflichtwert, den die Installation nicht hat, legt die Zentrale kein
Update an und sagt es; erst die Einstellungen ergänzen. Neue erzeugte Werte (`auto`) macht sie
einmal, die bisherigen behält sie. Nennt die neue Version andere Backup-Teile oder einen anderen
HTTP-Dienst, richtet die Zentrale nach dem Update die Backups bzw. die Route der Pforte neu ein.

## Update von Hand

Inhaber und Technik aktualisieren eine Installation auf der Seite **Updates** mit **Update**: Version
wählen (die neueste steht oben) und einen Grund angeben, der im Audit-Log steht. So auch Apps ohne
Health, die keine Welle aktualisiert. In einer Sperrzeit der App darf nur der Inhaber; das Update
gilt dann als Freigabe und die Zentrale vermerkt es. Über die API: `POST
/api/v1/installationen/:id/update` mit `version` und `grund`.

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
