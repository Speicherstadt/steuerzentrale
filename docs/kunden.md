---
title: Kunden und Verträge
description: >-
  Kunden mit Ansprechperson und Vertrag (SLA, Beginn, Vertragsende) anlegen, ändern und kündigen;
  jede Änderung mit Grund im Audit-Log.
---

# Kunden und Verträge

Ein Kunde ist, wem eine Installation gehört. Er meldet sich nie an der Zentrale an; was er sieht,
zeigt später das Portal. Unter **Kunden** legt der Betreiber Kunden an, die nicht über das Portal
kommen, ändert ihre Angaben und trägt eine Kündigung ein.

Die Seite **Kunden** ist eine Tabelle: Kunde mit E-Mail-Adresse, SLA, Apps, Server und Vertrag
(„seit …“, „intern“ oder „Gekündigt zum …“), mit Suche und **Kunde anlegen**. Darüber führen
**Support-Zugänge** ([Support-Zugang](support.md)) und **Leistungen** ([Leistungen](leistungen.md))
zu den Seiten derselben Dinge für alle Kunden. Ein Klick auf einen Kunden öffnet
[seine Seite](#die-seite-eines-kunden).

## Was zu einem Kunden gehört

| Angabe | Bedeutung |
| --- | --- |
| Name | Name des Kunden, wie er in Listen und Installationen steht |
| Kürzel | Teil der Adressen seiner Installationen, `<app>.<kürzel>.<domain>` ([DNS](dns.md)) |
| Ansprechperson | Name, E-Mail-Adresse und wahlweise Telefon |
| Notiz | freier Text für den Betreiber, wahlweise |
| Vertrag | SLA, Vertragsbeginn und, nach einer Kündigung, Vertragsende |

Jeder Kunde hat in Stufe 1 genau einen Vertrag, der mit ihm angelegt wird. Sein SLA ist **Basis**:
Updates kommen mit allen anderen, nach der internen Welle ([Updates](updates.md)). Plus (frühe
Welle) und Ruhe (späte Welle) kennt die Datenbank schon; angeboten werden sie erst mit Z-505.

Vertragsbeginn und Vertragsende sind Tage. Die Zentrale speichert den Beginn dieses Tages in
`Europe/Berlin` als Zeitpunkt in UTC-Millisekunden; die Oberfläche zeigt ihn als TT.MM.JJJJ. Einen
Zeitpunkt, der nicht der Beginn eines Tages in Berlin ist, lehnt die API mit `400 ungueltig` ab. Das
Vertragsende liegt nie vor dem Beginn.

## Kürzel

Das Kürzel besteht aus Kleinbuchstaben, Ziffern und Bindestrichen (nicht am Anfang oder Ende), höchstens
30 Zeichen, und ist unter den Kunden eines Betreibers eindeutig. Bleibt das Feld beim Anlegen leer,
schlägt die Zentrale eines aus dem Namen vor: Umlaute ausgeschrieben, Akzente weggelassen, jedes andere
Zeichen ein Bindestrich, also „Praxis Dr. Müller & Söhne“ → `praxis-dr-mueller-soehne`; ist es schon
vergeben, folgt `-2`, `-3` usw. Ein angegebenes Kürzel, das ein anderer Kunde hat, lehnt die API mit
`409 kuerzel_vergeben` ab. Kunden, die es vor dem Kürzel schon gab, bekamen beim Update eines auf die
gleiche Weise; bei gleichem Vorschlag hängt die Zentrale den Anfang der Kunden-ID an.

Solange eine Installation des Kunden läuft oder eingerichtet wird, bleibt das Kürzel fest (`409
kuerzel_fest`); der Dialog zeigt das Feld dann gesperrt. Die Adresse einer bestehenden Installation
ändert sich mit dem Kürzel ohnehin nicht, das Kürzel ist nur der Vorschlag für neue.

## Interne Kunden

Ein Kunde kann **intern** sein: das sind wir selbst, mit einer eigenen Installation jeder App. Seine
Installationen bilden die Welle „intern“ ([Updates](updates.md)) und bekommen als einzige eine
Vorabversion angeboten ([Katalog, Manifeste und Versionen](manifeste.md)). Markieren oder die Markierung
aufheben darf nur der Inhaber, mit Grund, auf der Kundenseite unter „Mehr …“ („Als intern
markieren“, „Nicht mehr intern“). Die Kundenseite bietet einem internen Kunden keine Kündigung an.

## Kündigung

Eine Kündigung ist das Vertragsende. Bis dahin läuft alles normal; danach folgen 30 Tage nur lesen
und Export, soweit die Apps es anbieten, sonst bekommt der Kunde das letzte Backup. Gelöscht werden
Installationen, Backups und DNS-Einträge 90 Tage nach dem Vertragsende, vorher ein Backup. Der Dialog
zeigt den Tag der Löschung, sobald ein Vertragsende gewählt ist. Eine Kündigung lässt sich mit Grund
zurücknehmen; der Vertrag läuft dann weiter, die Löschung entfällt.

### Nach dem Vertragsende

Die Fristen sind Kalendertage in `Europe/Berlin`, vom Vertragsende an gezählt: eine Umstellung auf
Sommer- oder Winterzeit dazwischen verschiebt sie um keine Stunde. Alle 30 Sekunden und sofort nach
einer Kündigung oder dem Ende eines Auftrags prüft die Zentrale jede laufende Installation eines
gekündigten Kunden:

1. **Am Vertragsende** schickt sie „nur lesen“, wenn das Manifest es anbietet, dann ein letztes
   Backup und danach das **Archiv für den Kunden** (`installation_archiv`), jeder Auftrag wartet auf
   den vorigen. Der Agent schreibt als Nutzer der Installation den neuesten Snapshot jedes Teils als
   eine Datei (ein Volume als tar, ein Dump oder Export so, wie er gesichert wurde) und lädt sie mit
   dem eigenen S3-Zugang der Installation neben ihr Repository (`<präfix>archiv/`). Ohne
   eingerichtetes Backup gibt es kein Archiv. Scheitert es, versucht die Zentrale es später wieder
   und meldet `archiv_gescheitert` (Schwere `fehler`).
2. **30 Tage lang** erzeugen Inhaber und Technik auf der Seite der App (Reiter „Backups“,
   Karte „Vertragsende“) mit Grund einen **Link für den Kunden**: je Datei ein vorsignierter
   S3-Link, signiert mit dem Zugang der Installation, gültig höchstens 7 Tage und nie über die 30
   Tage hinaus. Er erscheint nur in dieser Antwort; die Zentrale speichert ihn nicht und schreibt ihn
   in kein Log, das Audit-Log hält den Grund und die Gültigkeit fest. Nach seiner Frist lehnt S3 ihn
   ab.
3. **90 Tage nach dem Vertragsende** schickt sie ein letztes Backup und danach
   `installation_loeschen`. Der Agent baut die Installation ab wie ein gescheitertes Einrichten
   (Units, Linger, Linux-Nutzer mit Home), aber nur, wenn in den letzten zwei Stunden ein Lauf
   ihres Backups gelang oder ihr Manifest nichts zu sichern nennt. Nennt es Teile und ist das Backup
   nicht eingerichtet, löscht weder Zentrale noch Agent etwas; die Zentrale meldet
   `loeschung_gescheitert`, bis das Backup eingerichtet ist. Danach löscht die Zentrale jedes Objekt unter dem Präfix
   der Installation (Repository und Archiv) mit deren eigenem Zugang, dann den S3-Zugang samt
   restic-Passwort, dann die DNS-Einträge. Scheitert ein Schritt, wartet sie (1, 2, 4 … Minuten,
   höchstens stündlich) und meldet `loeschung_gescheitert` (Schwere `fehler`).
4. Zuletzt schreibt sie das **Löschprotokoll** als Ereignis `installation_geloescht` (Schwere
   `warn`): jeder Schritt mit Zeitpunkt. Es geht wie jedes Ereignis an die Empfänger des Betreibers,
   per Mail und als signierter Webhook ([Benachrichtigungen](benachrichtigungen.md)).

Vor Ablauf der 90 Tage löscht die Zentrale nichts; jeder Schritt der Löschung prüft die Frist
erneut. Eine Kündigung lässt sich zurücknehmen oder in die Zukunft verschieben, solange die Löschung
nicht begonnen hat; dann verwirft die Zentrale, was nach dem Vertragsende entstand. Als begonnen
gilt sie auch, wenn `installation_loeschen` auf dem Server gescheitert ist (ein Teil kann schon fehlen). „Nur lesen“
bleibt, wie die App es gesetzt hat. Hat die Löschung begonnen, antwortet die API mit
`409 loeschung_laeuft`.

## Grund und Audit-Log

Jede schreibende Aktion fragt nach dem Grund („Vertrag vom 20.11.“, „Kündigung per Mail vom
18.11.“). Er steht mit Person, Zeitpunkt, Aktion und dem, was sich geändert hat, im Audit-Log:

| Aktion | Wann |
| --- | --- |
| `kunde.anlegen` | Kunde und Vertrag angelegt |
| `kunde.aendern` | Angaben oder Vertragsbeginn geändert; nur geänderte Felder, ohne Änderung kein Eintrag |
| `vertrag.kuendigen` | Vertragsende gesetzt |
| `vertrag.zuruecknehmen` | Kündigung zurückgenommen |
| `kunde.intern`, `kunde.nicht-intern` | als intern markiert oder Markierung aufgehoben; unverändert kein Eintrag |
| `abwicklung.*` | ein Schritt nach dem Vertragsende (Akteur `system`) |
| `installation.archiv-link` | Link für den Kunden erzeugt; mit Grund und Gültigkeit, ohne den Link |

## Rollen

| Recht | Inhaber | Technik | Support |
| --- | --- | --- | --- |
| Kunden und Verträge sehen | ja | ja | ja |
| Kunden anlegen, ändern, kündigen, Kündigung zurücknehmen | ja | ja | – |
| Kunden als intern markieren | ja | – | – |

Jeder Betreiber sieht nur seine eigenen Kunden; eine fremde ID antwortet wie eine unbekannte mit
`404`.

## API

Jede schreibende Route verlangt `grund` im Körper.

| Route | Wer | Körper |
| --- | --- | --- |
| `GET /api/v1/kunden` | alle Rollen | – |
| `GET /api/v1/kunden/:kundeId` | alle Rollen | – |
| `POST /api/v1/kunden` | Inhaber, Technik | `name`, `kontakt` (`name`, `email`, `telefon`?), `notiz`?, `kuerzel`?, `vertrag` (`sla: "basis"`, `beginn`), `grund`; ohne `kuerzel` schlägt die Zentrale eines vor |
| `PUT /api/v1/kunden/:kundeId` | Inhaber, Technik | `name`, `kontakt`, `notiz`?, `kuerzel`?, `beginn`, `grund`; ersetzt die Angaben, ein fehlendes Feld mit `?` wird leer, ein fehlendes `kuerzel` bleibt |
| `PUT /api/v1/kunden/:kundeId/kuendigung` | Inhaber, Technik | `ende`, `grund` |
| `DELETE /api/v1/kunden/:kundeId/kuendigung` | Inhaber, Technik | `grund` |
| `PUT /api/v1/kunden/:kundeId/intern` | Inhaber | `intern` (`true` oder `false`), `grund` |
| `GET /api/v1/installationen/:installationId/abwicklung` | alle Rollen | – |
| `POST /api/v1/installationen/:installationId/archiv-link` | Inhaber, Technik | `grund` |

`GET …/abwicklung` nennt `phase` (`laeuft`, `nur_lesen`, `wartet`, `loeschen`), `vertragsende`,
`nurLesenBis`, `loeschenAb`, `schritt` (`archiv`, `warten`, `loeschen`, `repository`, `zugang`,
`dns`, `geloescht` oder `null`), `archiv` (`am`, `objekte` mit `tag`, `datei`, `bytes`), `linkBis`,
`geloeschtAm` und `protokoll`. `POST …/archiv-link` antwortet `{ gueltigBis, links: [{ tag, datei,
bytes, url }] }` mit `Cache-Control: no-store`; Fehler `409 kein_archiv`, `409 frist_abgelaufen`
(nach den 30 Tagen), `409 kein_zugang`.

Die Antwort ist der Kunde:

```json
{
  "id": "1f0c…",
  "name": "Atelier Nord",
  "kontakt": { "name": "Anna Nord", "email": "buero@atelier-nord.de", "telefon": null },
  "notiz": null,
  "kuerzel": "atelier-nord",
  "kuerzelAenderbar": true,
  "intern": false,
  "angelegtAm": 1795167720000,
  "vertrag": { "sla": "basis", "beginn": 1773442800000, "ende": null }
}
```

Fehler: `400 ungueltig` (Feld fehlt oder passt nicht, auch ohne Grund oder mit einem Tag, der
nicht um 00:00 in Berlin beginnt), `404 kein_kunde`,
`409 ende_vor_beginn`.

## Die Seite eines Kunden

Im Kopf stehen Name, die Apps in einem Satz („3 Apps, alle laufen“) und der Vertrag („Basis-Vertrag
seit 14.03.2026“), daneben **App installieren**, **Ändern** und unter **Mehr …** „Kündigen …“ und
„Als intern markieren“. Nach einer Kündigung steht darunter das Vertragsende mit dem Tag der
Löschung und **Kündigung zurücknehmen**. Die Reiter stehen in der Adresse (`?tab=`):

| Reiter | Inhalt | Woher |
| --- | --- | --- |
| Überblick | die Apps mit Adresse, Version, Server und Zustand; „Dieser Monat“ (Apps, Daten, Verfügbarkeit, Support); Vertrag und Kontakt | `GET /api/v1/installationen`, `/leistungen` des laufenden Monats, der Kunde |
| Support | die Support-Zugänge zu seinen Apps, laufend und beendet, und „Zugang starten“ | `GET /api/v1/support-zugaenge?kundeId=…` |
| Leistungen | die Verfügbarkeit jeder App und aller zusammen in den letzten sechs Monaten, unter 99,9 % gelb, ein Monat ohne Prüfung leer; was der Vertrag enthält mit Support und Daten des Monats | `GET /api/v1/installationen/<id>/aussen` je App, `/leistungen` |
| Verlauf | die Ereignisse seiner Apps | `GET /api/v1/ereignisse` |

„Alle zusammen“ ist der Anteil aller gemessenen Minuten der Apps, so zählt eine App mit wenigen
Minuten weniger. In der Betriebsart „Nur für mich“ fehlt „Kunden“ in der Seitenleiste, und mit ihm Support-Zugänge und Leistungen.
`bun run dev:demo` zeigt Kunden aus den Demodaten; was man dort anlegt oder ändert, bleibt bis zum
Neuladen der Seite im Browser.
