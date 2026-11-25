---
title: Katalog, Manifeste und Versionen
description: >-
  Wie signierte Manifeste in die Steuerzentrale kommen (Import über die Oberfläche oder den Befehl),
  warum eine importierte Version unveränderlich ist, wie die Zentrale die Registries nach neuen
  Versionen fragt und welche Version eine Installation angeboten bekommt.
---

# Katalog, Manifeste und Versionen

Die Zentrale kennt eine App nur über ihr Manifest ([Manifest](manifest.md)). Jede Version einer App
hat ein eigenes, vom Inhaber offline signiertes Manifest; die Zentrale kann selbst nicht signieren.
Ein Manifest kommt per **Import** in die Zentrale und gilt dort für alle Betreiber. Der Dialog „App
installieren“ wählt App und Version aus den importierten Manifesten ([Apps
installieren](installieren.md)); ein Hochladen im Dialog gibt es nicht mehr.

## Import

Ein Manifest besteht aus zwei Dateien: `manifest.yml` und `manifest.yml.minisig`. Die Zentrale
prüft beim Import

1. die **Signatur** über die exakten Bytes, mit dem öffentlichen Schlüssel, den sie auch in
   `install.sh` einsetzt (`minisign.pub` neben dem Installationsskript);
2. das **Schema** und die **Regeln** des Manifests, wie der Agent sie prüft.

Schlägt eine Prüfung fehl, wird nichts gespeichert (`422 signatur_ungueltig` oder
`422 manifest_ungueltig` mit dem Befund).

Eine importierte Version ist **unveränderlich**: derselbe Text noch einmal ändert nichts, ein
anderer Text für dieselbe App und Version wird abgelehnt (`409 version_vergeben`). Auch die Datenbank
lehnt jede Änderung und jedes Löschen eines Manifests ab. Eine korrigierte Fassung braucht eine neue
Version.

### Über die Oberfläche

Der **Katalog** (in der Seitenleiste unter „Verwaltung“, `/katalog`) zeigt je App eine Kachel:
Symbol, Name, ein Satz Beschreibung, die neueste importierte Version, wie oft sie läuft und
höchstens einen Hinweis (eine Sperrzeit, die
gerade gilt; eine neue Version, deren Manifest noch fehlt; Installationen hinter der neuesten
Version). „Installieren“ auf der Kachel öffnet den Dialog „App installieren“ mit dieser App. Ein Klick
auf die Kachel öffnet die Seite der App im Katalog (`/katalog/<app>`) mit den Abschnitten Versionen, Betrieb (Ressourcen, Netz,
Anmeldung, Health, Backup), Sperrzeiten, Aktionen, Einstellungen (Anzahl je Ebene) und
Installationen.

Im **Katalog** öffnet „Manifest importieren“ einen Dialog mit beiden Dateien und dem Grund.
Importieren darf der Inhaber; der Import steht mit Grund im Audit-Log des Betreibers
(`manifest.importieren`, Text und Signatur nur als „[ausgelassen]“).

### Über den Befehl

Auf dem Server der Zentrale:

```sh
steuerzentrale manifest importieren /pfad/zu/manifest.yml
```

Der Befehl liest `manifest.yml` und `manifest.yml.minisig` daneben und prüft wie die Oberfläche, mit
dem Schlüssel aus `STEUERZENTRALE_AGENT_DATEIEN`. Weil die Person am Befehl kein Mitglied eines
Betreibers ist und ein Manifest für alle gilt, steht der Import im Audit-Log jedes Betreibers
(Akteur `befehl`). Vor dem ersten Inhaber gibt es kein Audit-Log; der Befehl lehnt dann ab. Exit-Code
0 heißt importiert oder schon vorhanden, 1 abgelehnt (mit Grund), 2 ohne Pfad.

### Installationen von vor dem Import

Installationen, die vor dem Import angelegt wurden, behalten ihr eigenes Manifest. Fehlt ihre
Version in den importierten Manifesten, übernimmt die Zentrale es beim Start, wenn seine Signatur
mit ihrem Schlüssel gilt (Akteur `system`); bei zwei Installationen derselben Version mit
verschiedenem Text gilt das der zuerst angelegten, die andere behält ihr eigenes.

## Versionen aus den Registries

Die Zentrale fragt beim Start, danach **alle 6 Stunden** und auf Knopfdruck („Nach neuen Versionen suchen“
im Katalog, nur der Inhaber) die Registry jeder App nach ihren Tags: das Image des HTTP-Dienstes, sonst des
ersten Containers, aus dem neuesten importierten Manifest. Sie spricht die OCI-Distribution-API
(`GET /v2/<name>/tags/list`, Seite für Seite über den `Link`-Kopf) und holt sich ein anonymes Token,
wenn die Registry danach fragt (`WWW-Authenticate: Bearer`, wie ghcr.io und Docker Hub). Nur Tags in
SemVer zählen, ein führendes `v` ist erlaubt; `latest` oder `sha-…` sind keine Versionen.

Die Seite einer App im **Katalog** zeigt im Abschnitt „Versionen“ jede Version mit ihrem Zustand:

| Zustand | Bedeutung |
| --- | --- |
| verfügbar | das Manifest ist importiert; die Version kann installiert und aktualisiert werden |
| Manifest fehlt | die Registry hat sie, ein signiertes Manifest fehlt noch; nichts geschieht, bis es importiert ist |

Als „neu“ gilt ein Tag, der neuer ist als die neueste importierte Version (eine Vorabversion verglichen
mit allen, eine andere mit den übrigen); einen älteren hat man bewusst übersprungen. Dazu steht an jeder
Version **dringend**, wenn ihr Manifest `dringend: true` trägt, und **Vorabversion** bei einem
Pre-Release (`2.0.0-rc.1`).

Die Registry ist nie die Freigabe: angeboten wird jede importierte Version, auch wenn die Registry
gerade nicht antwortet. Antwortet sie mit einem Fehler, entsteht das Ereignis `registry_fehler`
(Schwere „Warnung“) bei jedem Betreiber, höchstens einmal am Tag (Europe/Berlin) je App. Das Ergebnis
der letzten Abfrage hält die Zentrale im Speicher; nach einem Neustart fragt sie sofort neu.

## Welche Version eine Installation bekommt

Eine Installation bekommt jede importierte Version angeboten, die neuer ist als ihre. Eine
**Vorabversion** nur, wenn ihr Kunde **intern** ist ([Kunden](kunden.md)): sonst nie, auch nicht
von Hand im Dialog (`409 nur_intern`). Die Regel ist eine reine Funktion in `packages/planung`
(`versionAngeboten`, `angeboteneVersionen`), die auch das Update (Z-503) nutzt. Die Seite
**Updates** zeigt je Installation die angebotenen Versionen, den Plan und das letzte Update
([Updates](updates.md)).

## Rollen

| Recht | Inhaber | Mitglied |
| --- | --- | --- |
| Apps, Versionen und Manifeste sehen | ja | ja |
| Manifest importieren, nach neuen Versionen suchen | ja | – |
| Kunden als intern markieren | ja | – |

Wer ein Manifest importiert hat, erfährt nur der eigene Betreiber; bei einem anderen steht
„von einem anderen Betreiber“.

## API

| Route | Wer | Körper, Antwort |
| --- | --- | --- |
| `GET /api/v1/apps` | alle Rollen | `{ apps: [{ app, versionen: [{ version, zustand, dringend, vorabversion, sha256, importiert }], registry }] }` |
| `GET /api/v1/manifeste/:app/:version` | alle Rollen | Text des Manifests mit `dringend`, `vorabversion`, `importiert`; `404 kein_manifest` |
| `POST /api/v1/manifeste` | Inhaber | `manifest` (Text), `signatur` (`.minisig`), `grund`; `201` neu, `200` schon vorhanden; `409 version_vergeben`, `422 signatur_ungueltig`, `422 manifest_ungueltig`, `503 kein_schluessel` |
| `POST /api/v1/versionen/abfragen` | Inhaber | fragt alle Registries und antwortet wie `GET /api/v1/apps` |
| `GET /api/v1/updates` | alle Rollen | `{ installationen: [{ installationId, kundeId, app, version, intern, angeboten }] }` der eigenen Installationen |

`importiert` ist `{ am, durch }` mit `durch` `mitglied` (dann mit `nutzerId`), `befehl`,
`uebernommen` oder `anderer_betreiber`; `registry` ist `null` vor der ersten Abfrage, sonst
`{ abgefragtAm, image, versionen, fehler }`.

## In Tests

`STEUERZENTRALE_REGISTRY_HTTP` lenkt jede Registry auf eine Adresse auf `localhost` ohne TLS: in den
e2e-Tests auf die nachgebaute Registry (`apps/zentrale/src/testhilfen/registry.ts`), im Agent-Job der
CI auf die echte lokale Registry mit den Beispiel-Images 1.0.0, 2.0.0 und 2.1.0
(`apps/agent/test/versionen.agent.test.ts`). Jeder andere Host wird beim Start abgelehnt.
