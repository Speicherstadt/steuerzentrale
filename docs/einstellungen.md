---
title: Einstellungen
description: >-
  Wie die Steuerzentrale die Einstellungen einer App aus ihrem Manifest als Formular anbietet, die
  Werte des Betreibers je App speichert, fehlende Pflichtwerte im Dialog „App installieren“ abfragt
  und eine laufende Installation mit neuen Werten neu konfiguriert.
---

# Einstellungen

Welche Einstellungen eine App hat, steht nur in ihrem Manifest (`env`, siehe [Manifest](manifest.md)).
Die Steuerzentrale kennt keine App beim Namen: Formulare, Prüfungen und Texte entstehen aus dem
Schema. Es gibt drei Ebenen:

| Ebene | Wer setzt den Wert | Wo |
| --- | --- | --- |
| `betreiber` | der Betreiber, einmal je App; gilt für jede Installation dieser App | Einstellungen, Abschnitt „Werte für Apps“, und im Dialog „App installieren“, wenn ein Pflichtwert fehlt |
| `installation` | der Betreiber je Installation | Dialog „App installieren“ und „Einstellungen ändern“ unter „Mehr …“ auf der Seite der App |
| `auto` | die Zentrale (Zufallswerte, Adresse, Vorlagen) | nirgends; erzeugte Werte zeigt sie nie |

## Das Formular

Eine reine Funktion in `packages/manifest`, `einstellungsFormular(manifest, ebene, optionen)`, liefert
die Felder einer Ebene: Name, Titel (`titel` aus dem Manifest, sonst der Name), Typ (`text`,
`zahl`, `ja_nein`, `geheim`), Pflicht, Vorgabe, Beschreibung, ob der Wert geheim ist, und die Option, zu der er gehört. Eine Einstellung einer
Option gilt nur, solange die Option an ist; das Formular der Ebene `betreiber` zeigt die
Einstellungen aller Optionen, weil die Werte des Betreibers jeder Installation dienen. Oberfläche und
Zentrale nutzen dieselbe Funktion, und die Zentrale prüft jeden geschriebenen Wert mit
`einstellungenPruefen`:

- ein Name, den das Manifest nicht kennt, eine Einstellung einer anderen Ebene und eine Einstellung
  einer Option, die aus ist, werden abgelehnt;
- ein Wert muss zum Typ passen (Text, Zahl, Ja/Nein); geheim ist Text;
- ein Pflichtfeld ohne Vorgabe braucht einen Wert;
- ein Feld, das nicht mitkommt, bleibt, wie es war; ein leeres Textfeld nimmt den Wert weg (dann gilt
  die Vorgabe); ein **leeres geheimes Feld behält den alten Wert**, denn die Oberfläche zeigt ein
  Geheimnis nie und kann es darum auch nicht vorbelegen. Ein geheimer Wert lässt sich so ändern,
  aber nicht löschen.

Die Ablehnung kommt als `einstellung_ungueltig` mit `detail`, das jedes Feld nennt, z. B.
`PROBE_LIZENZ: a value of another type`.

## Werte des Betreibers

Die Werte des Betreibers stehen je Betreiber und App in der Tabelle `app_einstellungen`, ein
geheimer verschlüsselt (Spalte `wert_verschluesselt`, an Betreiber, App und Namen gebunden). Geprüft
wird gegen das **neueste importierte Manifest der App** ([Katalog, Manifeste und Versionen](manifeste.md)):
das mit der höchsten Version, die keine Vorabversion ist, sonst die höchste Vorabversion. Ohne
importiertes Manifest gibt es kein Formular (`kein_manifest`, 404).

Ein Wert eines Namens, den das neueste Manifest nicht mehr kennt, bleibt stehen: eine ältere
Installation kann ihn noch brauchen.

In der Oberfläche zeigt **Einstellungen → Werte für Apps** die Apps mit Werten des Betreibers zum
Umschalten, daneben, für wie viele Installationen die Werte gelten und wie viele gesetzt sind
(„Gilt für alle 9 Installationen von Haben · 3 von 4 Werten gesetzt“). Jeder Wert steht unter seinem
Titel in Worten (`titel` aus dem Manifest, sonst der Name), mit „Pflicht“, dem Namen klein daneben
und der Beschreibung darunter. Ein Geheimnis erscheint nur als „gesetzt“ mit „Ändern“, das ein leeres
Feld öffnet (leer behält den Wert), oder als leeres Feld, solange es nicht gesetzt ist. Der Inhaber
speichert alle Werte einer App, ein Mitglied sieht die Werte nur. Ein geänderter Wert kommt **nicht von
selbst** an laufende Installationen: jede hält fest, womit sie eingerichtet wurde, und bekommt neue
Werte des Betreibers erst mit „Einstellungen ändern“.

### Im Dialog „App installieren“

Fehlt ein Pflichtwert der Ebene `betreiber`, meldet die Platzierung `betreiberwert_fehlt` mit dem
Namen. Der Dialog zeigt dann unter der Platzierung die Felder dieser Werte („Fehlende Werte des
Betreibers“); was dort steht, schickt er als `betreiberWerte` mit. Die Zentrale prüft sie gegen das
gewählte Manifest, rechnet sie für Platzierung und Gegenrendern zu den gespeicherten Werten und
schreibt sie **in derselben Transaktion wie die Installation** nach `app_einstellungen`. Scheitert
das Anlegen, bleibt nichts gespeichert. Fehlt danach noch ein Pflichtwert, lehnt die Zentrale die
Installation wie bisher mit `passt_nicht` und dem Namen ab.

## Neu konfigurieren

Auf der Seite einer laufenden App öffnet **Einstellungen ändern** unter „Mehr …“ (nur der Inhaber)
das Formular der Ebene `installation` mit den Optionen der Installation und ihren aktuellen Werten. Die Zentrale

1. nimmt das nur für eine Installation im Zustand `laeuft` an (`laeuft_nicht`, 409), nie in einer
   Sperrzeit ihres Manifests (`sperrzeit`, 409, der Grund der Sperrzeit im `detail`; geprüft mit
   `sperrzeitAm` in `Europe/Berlin`) und nie, solange ein anderer Auftrag der Installation offen ist
   (`auftrag_offen`, 409);
2. prüft die neuen Werte gegen das Formular und nimmt die aktuellen Werte des Betreibers dazu;
   Optionen, Ports und erzeugte Werte bleiben;
3. rendert die Units mit `einrichtungAuftragPruefen` gegen (`nicht_einrichtbar`, 422);
4. legt in einer Transaktion mit dem Audit-Log den Auftrag `installation_konfigurieren` an und
   hält die angefragten Werte in einer eigenen Zeile fest (Tabelle `installation_konfigurationen`,
   Geheimnisse verschlüsselt und an den Auftrag gebunden).

Verbindet der Agent erst in einer Sperrzeit wieder, sendet die Zentrale ihm den Auftrag nicht,
solange er ihn noch nicht bestätigt hat; er geht mit der nächsten Verbindung nach der Sperrzeit.

### Angefragt und gültig

Die Spalten der Installation (`einstellungen`, `geheim`) halten immer die Werte, mit denen sie
läuft. Die angefragten Werte stehen bis zum Ende des Auftrags nur in seiner Zeile; beim Zustellen
setzt die Zentrale das Feld `einrichtung` des Auftrags aus ihr zusammen, so bekommt ein zweites
Zustellen dieselben Werte. Meldet der Agent **Erfolg**, werden die angefragten Werte in derselben
Transaktion, die das Ergebnis festhält, die der Installation; jedes andere Ende (abgelehnt,
gescheitert mit wiederhergestelltem oder unvollständig wiederhergestelltem Stand, „Agent neu
gestartet“, abgebrochen) lässt die alten Werte gültig. In beiden Fällen wird die Zeile gelöscht,
damit kein Geheimnis eines erledigten Auftrags liegen bleibt. Was der Agent dabei auf dem Server
tut, steht im Projektplan unter „Neu konfigurieren“.

## Die Seite „Einstellungen“

Links stehen die Abschnitte, je mit einer Zeile, was darin steht: Werte für Apps,
Backup-Ziel, Adressen und DNS, Benachrichtigungen, Konten, Steuerzentrale und Darstellung. Der
gewählte Abschnitt steht in der Adresse (`/einstellungen?tab=backup|dns|melden|konten|zentrale|darstellung`),
ohne Angabe „Werte für Apps“; auf dem Handy sind die Abschnitte eine Zeile zum Wischen.

## API

| Route | Recht | Körper | Antwort |
| --- | --- | --- | --- |
| `GET /api/v1/apps/:app/einstellungen` | alle Rollen | – | `{ app, version, felder, werte, gesetzt }`: das Formular, die Werte, die nicht geheim sind, und die Namen der gesetzten Geheimnisse |
| `PUT /api/v1/apps/:app/einstellungen` | Inhaber | `werte`, `grund`? | wie `GET` |
| `POST /api/v1/installationen` | Inhaber | wie bisher, dazu `betreiberWerte` | `201` mit der Installation |
| `PUT /api/v1/installationen/:installationId/einstellungen` | Inhaber | `einstellungen`, `grund`? | die Seite der Installation mit dem neuen Auftrag |

`GET /api/v1/installationen/:installationId` liefert dazu `formular` (`felder` der Ebene
`installation`, `gesetzt`: die Namen ihrer gesetzten Geheimnisse). Kein Betreiber erreicht die
Werte eines anderen; die Installation eines anderen ist `keine_installation` (404). Kein Geheimnis
steht in einer Antwort, im Audit-Log (dort nur `[verschlüsselt]`) oder im Klartext in der
Datenbank.

## Wie es geprüft wird

- `packages/manifest/src/einstellungen/formular.test.ts`: das Formular entsteht für jede der acht
  Apps unter `manifeste/` und jede Ebene aus dem Manifest allein, im Code steht kein App-Name; Typ,
  Pflicht, Ebene, unbekannter Name, leeres Geheimnis.
- `apps/zentrale/src/modules/installationen/konfigurieren.test.ts`: Sperrzeit, offener Auftrag,
  Schema-Fehler, die Werte gelten erst nach Erfolg, kein Geheimnis in Datenbankdatei und Audit-Log.
- `apps/zentrale/src/routes/einstellungen.test.ts`: jede Route über HTTP, Rollen, die Trennung der
  Betreiber je Endpunkt, der fehlende Pflichtwert blockiert die Installation, der Dialog speichert
  in der Transaktion der Installation, kein Geheimnis in Antwort, Audit-Log oder Datenbankdatei.
- `e2e/einstellungen.spec.ts` (Desktop und Handy, axe): Werte des Betreibers im Dialog und neu
  konfigurieren; der Stellvertreter des Agenten meldet den Auftrag als erfolgreich. Den Agenten
  selbst prüft die CI gegen Podman.
