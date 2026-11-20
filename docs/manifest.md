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
| `container` | Container der App: `name`, `image` (nur per Digest, oder `{ noch_nicht_veroeffentlicht: … }`), `architektur` (übersteuert die der App), `braucht` (andere Container), `volumes` (`name`, `pfad`), `dateien` (Konfigurationsdateien: `pfad`, `inhalt`, nur lesbar eingehängt), `argv`, `env` (Namen aus `env`), `feste_env`, `ram_mb`. Im Netz der Installation ist jeder Container unter seinem `name` erreichbar |
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
| `dns` | Einträge der App (`typ`, `name`, `wert`, `prioritaet`), z. B. MX und SPF für Mail; `name` und `wert` mit Platzhaltern wie eine `vorlage` |
| `env` | Einstellungen: `name`, `ebene` (`betreiber`, `installation`, `auto`), `typ` (`text`, `zahl`, `ja_nein`, `geheim`), `pflicht`, `vorgabe`, `beschreibung`; ein `auto`-Wert hat genau eines von `erzeugen` (`zufall_32`, `zufall_64`: Zufallsbytes in Base64; `zufall_hex_32`: 32 Zufallsbytes als Hex, für Werte in einer URL), `aus` (`oidc-anbieter`, `adresse`) oder `vorlage` (unten); `option`: der Wert gilt nur, solange diese Option an ist |
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
  eines Containers, auch in Optionen. Ein Element im `argv` eines Containers ist nie leer und
  enthält kein Steuerzeichen (Zeilenumbruch, Tabulator, …): Quadlet verliert ein leeres Wort, wenn es
  `ExecStart=` schreibt (unten, „Quadlets“).
- Images nur per Digest und mit Registry (`docker.io/…`, `ghcr.io/…`, `localhost:5000/…`); ein Tag
  kann unter demselben Namen ein anderes Image meinen.
- `rootful` und ein eigener Proxy nur mit `netz.server_fuer_sich: true`; der geteilte Proxy braucht
  `netz.http`.
- Namen von Containern, Optionen und Einstellungen sind eindeutig.
- Eine Einstellung mit `option` nennt eine Option des Manifests; eine `vorlage` nennt sie nur mit
  derselben `option`.
- Eine `vorlage` und ein DNS-Eintrag nutzen nur die Platzhalter unten.
- Eine `vorlage`, die eine geheime Einstellung nennt, ist selbst `typ: geheim`; ein DNS-Eintrag ist
  öffentlich und nennt keine geheime Einstellung.

## Vorlagen

Eine `vorlage` ist ein Text mit Platzhaltern, den die Zentrale je Installation füllt; alles andere,
auch geschweifte Klammern ohne `$`, bleibt Text:

| Platzhalter | Wert |
| --- | --- |
| `${adresse}` | die Adresse der Installation, z. B. `https://haben.kunde.example` |
| `${host}` | ihr Hostname, z. B. `haben.kunde.example` |
| `${ipv4}` | die öffentliche IPv4 des Servers |
| `${port:<dienst>:<port>}` | der Port, den die Zentrale für diesen Port aus `netz` vergeben hat |
| `${env:<NAME>}` | der Wert einer anderen Einstellung, die selbst keine Vorlage ist |

```yaml
env:
  - { name: POSTGRES_PASSWORD, ebene: auto, typ: geheim, erzeugen: zufall_hex_32 }
  - { name: DATABASE_URL, ebene: auto, typ: geheim, vorlage: "postgres://haben:${env:POSTGRES_PASSWORD}@db:5432/haben" }
  - { name: STELLWERK_HUB_ADDRESS, ebene: auto, vorlage: "tcp://${host}:${port:zentrale:22001}" }
```

## Quadlets

Aus Manifest, Installation und Einstellungen rendert die Zentrale die Units einer Installation mit
einer reinen Funktion (`quadletsRendern` in `packages/manifest`); der Agent schreibt sie nur. Gleiche
Eingabe ergibt gleiche Ausgabe: Die Funktion erzeugt nichts, auch kein Geheimnis. Werte mit
`erzeugen` erzeugt die Zentrale einmal, speichert sie verschlüsselt und gibt sie hinein.

| Datei | Ort beim Nutzer `sz-<installation>` | Inhalt |
| --- | --- | --- |
| `<installation>-<container>.container` | `~/.config/containers/systemd/` | je laufendem Container, auch aus eingeschalteten Optionen |
| `<installation>-<volume>.volume` | `~/.config/containers/systemd/` | je Volume, geteilt von allen Containern, die es nennen |
| `<installation>.network` | `~/.config/containers/systemd/` | das eigene Netz der Installation |
| `<installation>.slice` | `~/.config/systemd/user/` | `MemoryMax` aus `ressourcen.ram_mb` plus dem RAM eingeschalteter Optionen; alle Container laufen darin (`Slice=`), ein Container mit eigenem `ram_mb` hat zusätzlich sein eigenes `MemoryMax` |
| `<container><pfad>` | `~/.config/steuerzentrale/dateien/` | die `dateien` eines Containers, nur lesbar eingehängt (`Volume=%h/…:<pfad>:ro`) |
| Podman-Secrets | `podman secret create` | je geheimer Einstellung ein Secret `<installation>-<name>` (`DATABASE_URL` → `…-database-url`), eingebunden per `Secret=…,type=env,target=DATABASE_URL` |
| Route der Pforte | Admin-API der Pforte | JSON für Caddy (unten) |

Regeln:

- Jeder Name trägt den Namen der Installation vorn; zwei Installationen derselben App teilen keinen
  Namen und, mit den Ports der Zentrale, keinen Port.
- Jeder Container ist im Netz der Installation unter seinem Namen aus dem Manifest erreichbar
  (`Network=<installation>.network:alias=<name>`).
- Der HTTP-Dienst wird nur auf `127.0.0.1` veröffentlicht
  (`PublishPort=127.0.0.1:<Port der Zentrale>:<netz.http.port>`); Ports mit `fest: true` unter ihrer
  eigenen Nummer, Ports mit `fest: false` unter dem Port, den die Zentrale vergeben hat.
- `Image=` nur per Digest; ein laufender Container mit `noch_nicht_veroeffentlicht` lehnt die
  Installation mit Grund ab, statt eine kaputte Unit zu liefern.
- Nie `AutoUpdate`; nur Schlüssel, die Podman 4.9 kennt (`supportedContainerKeys`,
  `supportedVolumeKeys`, `supportedNetworkKeys` in `pkg/systemd/quadlet/quadlet.go` am Tag `v4.9.0`,
  übernommen in `packages/manifest/src/quadlet/schluessel.ts`). In der CI läuft jede Unit durch
  `quadlet --user --dryrun` von Podman 4.9 (ubuntu-24.04) und 5.x (Debian 13).
- Eine Einstellung mit `option` gilt nur bei eingeschalteter Option; fehlt ein Pflichtwert oder ein
  erzeugter Wert, wird nicht gerendert. Vorlagen werden mit den Platzhaltern oben gefüllt.
- Nicht geheime Werte stehen als `Environment=` in der Unit, ein Wert mit Steuerzeichen wird dort
  abgelehnt; geheime Werte stehen nur in Podman-Secrets, nie in einer Unit.

### `argv` und `Exec=`

Das `argv` eines Containers wird `Exec=`. Quadlet hängt diese Wörter hinter dem Image an
`podman run` an (`ConvertContainer` in `pkg/systemd/quadlet/quadlet.go`), und Podman behandelt sie
wie bei `podman run IMAGE ARG…`: Sie **ersetzen das `CMD`** des Images und werden an seinen
**`ENTRYPOINT` angehängt**, der bleibt (`makeCommand` in `pkg/specgen/generate/oci.go`). Ein Image
mit `ENTRYPOINT ["livekit-server"]` bekommt also nur die Optionen (`[--config, /etc/livekit.yaml]`),
ein Image, dessen Einstiegsskript `"$@"` ausführt (Redis), das ganze Programm
(`[redis-server, --appendonly, "no"]`). Den `ENTRYPOINT` ändert ein Manifest nicht.

Es gibt keine Shell: Jedes Element ist ein Wort. Die Zentrale schreibt jedes Wort in doppelte
Anführungszeichen, maskiert `\` und `"` und verdoppelt `%` und `$`, weil systemd in `ExecStart=`
Spezifizierer und Variablen ersetzt; im Container kommt das Element unverändert an. Ein leeres
Element lehnt schon die Prüfung des Manifests ab: Quadlet schreibt ein leeres Wort als nichts
(`escapeWords` in `pkg/systemd/parser/split.go`), und mit dem Generator von 4.9 endet `Exec=` an
dieser Stelle sogar. Steuerzeichen sind ebenso abgelehnt. Ein Element, das nur `;` ist, lehnt das
Rendern ab: Quadlet schreibt es ohne Anführungszeichen in `ExecStart=`, und systemd liest es dort als
Ende des Befehls und verweigert den Dienst.

### Route der Pforte

Eine App hinter der Pforte (`proxy: geteilt`) bekommt eine Route für die Admin-API von Caddy, mit der
Installation als `@id` (Entfernen mit `DELETE /id/<installation>`): der Hostname der Installation an
`127.0.0.1:<Port>`, `request_body` mit `max_size` aus `max_body_mb`, `response_header_timeout` aus
`timeout_s` und `X-Forwarded-For` mit der Adresse, die die Pforte sah (`Forwarded` und `X-Real-IP`
entfernt); bei `sse: true` dazu `flush_interval: -1`, bei `websocket: true` `stream_close_delay`,
damit eine Änderung an der Pforte offene WebSockets nicht trennt. Eine App mit eigenem Proxy bekommt
keine Route.

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

## Die Manifeste der Speicherstadt

Unter `manifeste/<app>/<version>/` liegen die Manifeste von Haben, Belegt, Kontext, Schreibzeug,
Stellwerk, Fixpunkt, Kennwort und Soll, je mit `QUELLEN.md`: Datei und Commit im Repository der App
für jede Angabe und für jedes Image Registry, Tag und Datum der Abfrage. Die Container stammen aus
`deploy/quadlet/` der App oder, wo es keine gibt, aus ihrer Compose-Datei bzw. Doku; der eigene
Caddy und die Backup-Container einer App entfallen, weil Pforte und Steuerzentrale das übernehmen.
Ein Image ohne veröffentlichte Version steht als `noch_nicht_veroeffentlicht` im Manifest, eine
Aktion, die eine App nicht kann, als `nicht_unterstuetzt`.

Bis der Inhaber sie mit dem echten Schlüssel signiert, liegt neben jedem Manifest die Signatur des
Test-Schlüssels (`bun run manifeste:signieren`, `scripts/manifeste-signieren.ts`).

### Digests aus der Registry

Ein App-Repository nennt Tags, ein Manifest nur Digests. `scripts/digest.ts` fragt die Registry
über ihre HTTP-API (OCI Distribution Spec, mit Token für `docker.io` und `ghcr.io`) und gibt das Image
per Digest mit seiner Quelle aus:

```sh
bun scripts/digest.ts ghcr.io/speicherstadt/haben:0.12.0
# ghcr.io/speicherstadt/haben@sha256:9b6a… | Registry ghcr.io, Tag 0.12.0, abgefragt am 2026-11-20 | linux/arm64, linux/amd64
```

Die Zeile kommt mit Digest und Quelle in `QUELLEN.md`. Docker Hub zählt nur `GET` gegen seine
Grenze für anonyme Abfragen; das Skript fragt den Digest darum per `HEAD` ab. Schlägt die Abfrage
fehl, gibt es keinen Digest, nur die Meldung.
