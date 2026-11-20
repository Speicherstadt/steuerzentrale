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

## Was zu einem Kunden gehört

| Angabe | Bedeutung |
| --- | --- |
| Name | Name des Kunden, wie er in Listen und Installationen steht |
| Ansprechperson | Name, E-Mail-Adresse und wahlweise Telefon |
| Notiz | freier Text für den Betreiber, wahlweise |
| Vertrag | SLA, Vertragsbeginn und, nach einer Kündigung, Vertragsende |

Jeder Kunde hat in Stufe 1 genau einen Vertrag, der mit ihm angelegt wird. Sein SLA ist **Basis**:
Updates kommen mit allen anderen, nach der internen Welle ([Updates](updates.md)). Plus (frühe
Welle) und Ruhe (späte Welle) kennt die Datenbank schon; angeboten werden sie erst mit Z-505.

Vertragsbeginn und Vertragsende sind Tage. Die Zentrale speichert den Beginn dieses Tages in
`Europe/Berlin` als Zeitpunkt in UTC-Millisekunden; die Oberfläche zeigt ihn als TT.MM.JJJJ. Das
Vertragsende liegt nie vor dem Beginn.

## Kündigung

Eine Kündigung ist das Vertragsende. Bis dahin läuft alles normal; danach folgen 30 Tage nur lesen
und Export, soweit die Apps es anbieten, sonst bekommt der Kunde das letzte Backup. Gelöscht werden
Installationen, Backups und DNS-Einträge 90 Tage nach dem Vertragsende, vorher ein Backup. Der Dialog
zeigt den Tag der Löschung, sobald ein Vertragsende gewählt ist. Eine Kündigung lässt sich mit Grund
zurücknehmen; der Vertrag läuft dann weiter, die Löschung entfällt.

Was nach dem Vertragsende geschieht (nur lesen, Export, Löschung, Löschprotokoll), bauen spätere
Punkte der Bauliste; bis dahin trägt die Zentrale das Datum ein und zeigt es an.

## Grund und Audit-Log

Jede schreibende Aktion fragt nach dem Grund („Vertrag vom 20.11.“, „Kündigung per Mail vom
18.11.“). Er steht mit Person, Zeitpunkt, Aktion und dem, was sich geändert hat, im Audit-Log:

| Aktion | Wann |
| --- | --- |
| `kunde.anlegen` | Kunde und Vertrag angelegt |
| `kunde.aendern` | Angaben oder Vertragsbeginn geändert; nur geänderte Felder, ohne Änderung kein Eintrag |
| `vertrag.kuendigen` | Vertragsende gesetzt |
| `vertrag.zuruecknehmen` | Kündigung zurückgenommen |

## Rollen

| Recht | Inhaber | Technik | Support |
| --- | --- | --- | --- |
| Kunden und Verträge sehen | ja | ja | ja |
| Kunden anlegen, ändern, kündigen, Kündigung zurücknehmen | ja | ja | – |

Jeder Betreiber sieht nur seine eigenen Kunden; eine fremde ID antwortet wie eine unbekannte mit
`404`.

## API

Jede schreibende Route verlangt `grund` im Körper.

| Route | Wer | Körper |
| --- | --- | --- |
| `GET /api/v1/kunden` | alle Rollen | – |
| `GET /api/v1/kunden/:kundeId` | alle Rollen | – |
| `POST /api/v1/kunden` | Inhaber, Technik | `name`, `kontakt` (`name`, `email`, `telefon`?), `notiz`?, `vertrag` (`sla: "basis"`, `beginn`), `grund` |
| `PUT /api/v1/kunden/:kundeId` | Inhaber, Technik | `name`, `kontakt`, `notiz`?, `beginn`, `grund`; ersetzt die Angaben, ein fehlendes Feld mit `?` wird leer |
| `PUT /api/v1/kunden/:kundeId/kuendigung` | Inhaber, Technik | `ende`, `grund` |
| `DELETE /api/v1/kunden/:kundeId/kuendigung` | Inhaber, Technik | `grund` |

Die Antwort ist der Kunde:

```json
{
  "id": "1f0c…",
  "name": "Atelier Nord",
  "kontakt": { "name": "Anna Nord", "email": "buero@atelier-nord.de", "telefon": null },
  "notiz": null,
  "angelegtAm": 1795167720000,
  "vertrag": { "sla": "basis", "beginn": 1773442800000, "ende": null }
}
```

Fehler: `400 ungueltig` (Feld fehlt oder passt nicht, auch ohne Grund), `404 kein_kunde`,
`409 ende_vor_beginn`.

## Was noch fehlt

Die Kundenseite zeigt die Installationen eines Kunden erst mit Z-406; bis dahin kommen
Installationen, Ereignisse und Support-Zugänge aus den Demodaten, und ein Kunde der Zentrale hat
noch keine. `bun run dev:demo` zeigt Kunden aus den Demodaten; was man dort anlegt oder ändert,
bleibt bis zum Neuladen der Seite im Browser.
