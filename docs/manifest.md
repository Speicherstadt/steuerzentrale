---
title: Manifest
description: >-
  Das Manifest einer App für die Steuerzentrale: Felder, Regeln, Signatur mit minisign und das JSON
  Schema, für Entwicklerinnen und Entwickler der Apps.
---

# Manifest

Jede App beschreibt sich in einem Manifest, einer YAML-Datei je App und Version
(`manifeste/<app>/<version>/manifest.yml`). Die Steuerzentrale kennt nur das Manifest; keine App ist
fest eingebaut. Der Agent auf einem Server führt nur aus, was ein Manifest mit gültiger Signatur
beschreibt.

Geprüft wird ein Manifest mit dem Zod-Schema aus `packages/manifest`. Für Editoren gibt es das
[JSON Schema](https://github.com/Speicherstadt/steuerzentrale/blob/main/packages/manifest/manifest.schema.json);
es beschreibt die Struktur, die Regeln über mehrere Felder (unten) prüft erst die Zentrale beim Import.
Jede Meldung nennt das Feld und den Grund, z. B.
`container.0.image: an image needs registry, name and digest (…@sha256:<64 hex digits>), never a tag`.

## Felder

| Feld | Inhalt |
| --- | --- |
| `schema` | immer `1` |
| `id`, `version` | Name der App (Kleinbuchstaben, Ziffern, Bindestrich) und Version (`1.9.0`, Vorabversion mit `-…`) |
| `lizenz`, `quelle` | Lizenz und URL des Quellcodes |
| `container` | Container der App: `name`, `image` (nur per Digest, oder `{ noch_nicht_veroeffentlicht: … }`), `architektur` (übersteuert die der App), `braucht` (andere Container), `volumes` (`name`, `pfad`), `argv`, `env` (Namen aus `env`), `feste_env`, `ram_mb` |
| `architektur` | `amd64`, `arm64` |
| `ressourcen` | `ram_mb` als Grenze (`MemoryMax`), `platte_gb` als Planwert |
| `netz` | `http` (`dienst`, `port`, `websocket`, `sse`, `max_body_mb`, `timeout_s`), `ports` (`dienst`, `port`, `bis`, `proto`, `fest`), `oeffentliche_ipv4`, `mail`, `server_fuer_sich` |
| `proxy` | `geteilt` (die Pforte des Servers) oder `eigen` (nur mit `server_fuer_sich`) |
| `rootful` | `true` nur mit `server_fuer_sich` |
| `optionen` | zuschaltbar: `id`, `name`, eigene `container`, `architektur`, zusätzliches `ram_mb`, `standard` |
| `braucht`, `bietet` | Dienste zwischen den Apps eines Kunden, z. B. `oidc-anbieter`, `smtp` |
| `anmeldung` | `oidc`, `eigen` oder `anbieter` |
| `health` | `http` (`dienst`, `pfad`, `port`), `tcp` (`dienst`, `port`), `befehl` (Name aus `befehle`) oder `keine` (mit `hinweis`, z. B. dem Issue) |
| `befehle` | benannte Befehle: `{ name: { container, argv: [...] } }` |
| `schritte` | `einrichten`, `nach_update`: nur Namen aus `befehle` |
| `backup` | Teile: `pg_dump` (`container`, `datenbank`, `nutzer`), `volume` (`volume`), `befehl` (`befehl`) |
| `aktionen` | `nur_lesen`, `export`: `nicht_unterstuetzt`, `{ nicht_unterstuetzt: <Issue> }` oder `{ befehl: <Name> }`; `neustart`, `log_auszug`: `angeboten` (Vorgabe) oder nicht unterstützt |
| `sperrzeiten` | `{ monatlich: "07-12", grund: … }`: keine Updates und Neustarts an diesen Tagen jedes Monats (Berliner Kalendertage); `28-03` reicht über den Monatswechsel |
| `dns` | Einträge der App (`typ`, `name`, `wert`, `prioritaet`), z. B. MX und SPF für Mail |
| `env` | Einstellungen: `name`, `ebene` (`betreiber`, `installation`, `auto`), `typ` (`text`, `zahl`, `ja_nein`, `geheim`), `pflicht`, `vorgabe`, `beschreibung`; ein `auto`-Wert hat genau eines von `erzeugen` (`zufall_32`, `zufall_64`), `aus` (`oidc-anbieter`, `adresse`) oder `vorlage` |
| `dringend` | `true`: das Update läuft sofort durch alle Wellen |
| `hinweis` | ein Satz für die Installation, z. B. Lizenz und Website |

Unbekannte Felder sind ein Fehler, damit ein Tippfehler nicht still übergangen wird.

## Regeln über mehrere Felder

- Jeder Verweis zeigt auf etwas, das es gibt: Container in `braucht`, `netz`, `health`, `befehle` und
  `backup`; Befehle in `schritte`, `health`, `backup` und `aktionen`; Volumes in `backup`; Namen in
  `container.env`.
- Ein Schritt ist der Name eines Befehls, nie Shell-Text. Ein Befehl startet keine Shell (`sh`,
  `bash`, `env`, …), auch nicht über ein vorangestelltes Programm (`timeout 60 sh -c …`): kein
  Element von `argv` ist eine Shell, `argv` wird ohne Shell ausgeführt. Dasselbe gilt für das `argv`
  eines Containers, auch in Optionen.
- Images nur per Digest und mit Registry (`docker.io/…`, `ghcr.io/…`, `localhost:5000/…`); ein Tag
  kann unter demselben Namen ein anderes Image meinen.
- `rootful` und ein eigener Proxy nur mit `netz.server_fuer_sich: true`; der geteilte Proxy braucht
  `netz.http`.
- Namen von Containern, Optionen und Einstellungen sind eindeutig.

## Signatur

Ein Manifest gilt nur mit einer [minisign](https://jedisct1.github.io/minisign/)-Signatur des
Betreibers über die exakten Bytes der Datei (`manifest.yml.minisig` daneben); die Signatur wird vor
dem Lesen des YAML geprüft. Der private Schlüssel liegt offline beim Inhaber, nie auf der Zentrale
oder einem Server:

```sh
minisign -S -s ~/.minisign/steuerzentrale.key -m manifeste/haben/1.9.0/manifest.yml
```

Für Tests gibt es ein öffentlich bekanntes Schlüsselpaar unter `test/schluessel/`; ein Release lehnt
es ab.
