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
Versionen](manifeste.md)). Die Seite **Updates** zeigt von oben nach unten:

- **Sperrzeiten**: ein Hinweis nur, wenn heute eine gilt oder in den nächsten 7 Tagen eine beginnt,
  sonst eine kurze Zeile; in einer Sperrzeit beginnt nie ein Update.
- **Läuft gerade**: welche Version gerade verteilt wird, in einem Satz mit „x von y Installationen
  aktualisiert“, und die beiden Wellen als nummerierte Schritte („Eigene Installationen (intern)“,
  „Alle anderen“) mit ihren Installationen und deren Stand (fertig, läuft, wartet); sonst „Gerade
  läuft kein Update.“
- **Updates verfügbar**, je App: die Installationen, denen eine neuere Version angeboten wird (eine
  Vorabversion nur einer Installation eines internen Kunden, deutlich markiert), mit installierter
  und angebotener Version, wo der Plan für sie steht (Welle und nächster Termin oder warum sie
  wartet), ihrem letzten Update mit seinem Ausgang (z. B. zurückgenommen mit Grund) und **Update**.
- **Auf dem neuesten Stand**: eingeklappt, die Zahl im Titel, darin die übrigen Installationen mit
  ihrem letzten Update.
- **So läuft ein Update**: eingeklappt, die Schritte des Agenten in Worten.

Alle 5 Minuten startet die Zentrale, was nach dem Plan fällig ist; auf jedem Server läuft höchstens
ein Update zugleich, das [Update des Agenten](agent-updates.md) und ein
[Neustart des Servers](betriebssystem.md) mitgezählt. Geplant wird jede
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
abgebrochen und auf dem Server ändert sich nichts. Ebenso, wenn das Backup erst in einer Sperrzeit
der App endet, außer der Inhaber hat sie für dieses Update übergangen; die Planung versucht es
danach mit einem neuen Backup wieder. Nennt die neue Version einen Backup-Teil, den es vorher nicht
gab, hat er keinen Snapshot: Er hielt noch keine Daten der alten Version.

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

## In der CI mit echten Apps

Die CI aktualisiert Schreibzeug und Haben mit ihren echten Images von GHCR
(`apps/agent/test/echte-apps.agent.test.ts`): Schreibzeug 0.1.25 und Haben 0.12.0-rc.1 werden aus
`manifeste/` eingerichtet (Haben mit der Test-Hersteller-ID `74931`), gesichert und aus dem ersten
von zwei Backup-Läufen wiederhergestellt. Danach geht Schreibzeug auf 0.1.26, wie seine Welle es
startet (der Plan der Zentrale nennt den Termin), und Haben von Hand auf 0.12.0, als App ohne Health,
die keine Welle aktualisiert; der Agent bewertet sie nach ihren Units. Daten bleiben bei beiden
erhalten.
