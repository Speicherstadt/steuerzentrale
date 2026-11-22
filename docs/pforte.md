---
title: Pforte
description: >-
  Der Caddy jedes Servers: wie er läuft, wie die Steuerzentrale Adressen ohne Neustart setzt und
  entfernt, welche Werte aus dem Manifest kommen und was die App von der Client-Adresse sieht.
---

# Pforte

Jeder Server hat genau einen Caddy, die **Pforte**. Sie nimmt die Ports 80 und 443 an, holt die
Zertifikate (Let's Encrypt, HTTP-01) und leitet jede Adresse an den lokalen Port ihrer Installation.
Eine App mit eigenem Proxy (`proxy: eigen`, nur mit einem Server für sich) bekommt keine Route.

## Wie sie läuft

- **Linux-Nutzer `sz-pforte`**, angelegt von `install.sh` (ohne Login-Shell, mit Linger, damit ihre
  Unit beim Start des Servers läuft).
- **Rootless Podman mit `Network=host`**: Caddy bindet 80 und 443 selbst
  (`net.ipv4.ip_unprivileged_port_start=80`) und erreicht jede Installation unter
  `127.0.0.1:<port>`.
- **Image per Digest** aus `packages/manifest/src/system.ts` (Caddy 2.11.9). Die Pforte hat kein
  Manifest; ihr Image kommt mit dem Update des Agenten, Renovate hält es aktuell. Nie `AutoUpdate`.
- **Unit** `sz-pforte.container` (`pforteUnit`): nur Schlüssel, die Podman 4.9 kennt; Zertifikate in
  `sz-pforte-daten`, die zuletzt gespeicherte Konfiguration in `sz-pforte-konfig`. Nach einem
  Neustart lädt Caddy seine letzte Konfiguration wieder (`caddy run --resume`).
- **Admin-API nur über einen Unix-Socket** unter `/home/sz-pforte/pforte/admin.sock`, nie auf einem
  TCP-Port. Den Socket erreichen nur `sz-pforte` und der Agent (root); kein anderer Nutzer des
  Servers und kein Container einer Installation.

Die Unit der Pforte schreibt und startet der Agent mit dem Punkt „Installieren“ (Z-402), auf dem
gleichen Weg wie die Units einer Installation.

## Adressen setzen und entfernen

Adressen ändert die Zentrale mit zwei Aufträgen, die in die Steuerzentrale eingebaut sind und in
keinem Manifest stehen:

| Auftrag | Argumente | Was der Agent tut |
| --- | --- | --- |
| `pforte_route_setzen` | `host` (ein Hostname in Kleinbuchstaben mit Punkt), `port` (1024 bis 65535) | setzt die Route mit der Installation als `@id`; gibt es sie schon, ersetzt er sie |
| `pforte_route_entfernen` | keine | entfernt die Route der Installation; fehlt sie, ändert sich nichts |

Beide tragen wie jeder Auftrag das signierte Manifest der App und den Namen der Installation. Der
Agent prüft Schlüssel und Signatur wie bei jedem [Auftrag](auftraege.md), dann die feste Form des
Auftrags; die Route rendert er selbst aus dem Manifest, sie steht nie im Auftrag. Er ruft keinen
Prozess auf, nur die Admin-API. Jede Änderung ist ein Neuladen von Caddy ohne Neustart: laufende
Verbindungen zu anderen Installationen laufen weiter, und eine Änderung, die Caddy nicht laden kann,
nimmt Caddy zurück. Ein Auftrag der Pforte hat höchstens 60 Sekunden; nach einem Neustart des
Agenten führt er ihn noch einmal aus, weil beide Aufträge wiederholbar sind.

Gehört der Hostname oder der Port (`127.0.0.1:<port>`) schon zur Route einer anderen Installation,
lehnt der Agent `pforte_route_setzen` ab, bevor sich etwas ändert: Eine Installation nimmt der
anderen weder ihre Anfragen weg noch bedient sie sie unter fremder Adresse. Aufträge der Pforte
führt der Agent nacheinander aus, damit kein zweiter zwischen Prüfen und Setzen dieselbe Adresse
belegt.

Findet der Agent eine leere Pforte vor, lädt er zuerst ihre Grundkonfiguration: einen HTTPS-Server
auf 443 (Weiterleitung von 80) und als letzte Route eine Antwort 404 für jeden Host ohne eigene
Route. Neue Routen stehen davor.

## Was aus dem Manifest kommt

Aus `netz.http` des Manifests ([Manifest](manifest.md), „Route der Pforte“):

| Feld | in Caddy | Standard, wenn das Manifest nichts sagt |
| --- | --- | --- |
| `max_body_mb` | `request_body` mit `max_size`; ein größerer Upload bekommt 413 | 10 MB |
| `timeout_s` | `response_header_timeout` zur App | 60 s |
| `sse` | `flush_interval: -1`, jede Zeile geht sofort an den Client | aus |
| `websocket` | `stream_close_delay` von 5 Minuten, damit eine Änderung an der Pforte offene WebSockets nicht trennt; weitergereicht werden WebSockets immer | aus |

## Client-Adresse

Die App bekommt im Header `X-Forwarded-For` genau die Adresse, von der die Pforte die Verbindung
bekam. Einen `X-Forwarded-For`, den der Client selbst schickt, reicht die Pforte nicht weiter;
`Forwarded` und `X-Real-IP` entfernt sie. Eine App liest also den letzten (und einzigen) Eintrag.

## Getrennte Installationen

Jede Installation läuft unter ihrem eigenen Linux-Nutzer in ihrem eigenen Podman-Netz und
veröffentlicht ihren HTTP-Dienst nur auf `127.0.0.1:<port>`. Ein Container einer Installation
erreicht den Port einer anderen weder über das Netz der anderen noch über `127.0.0.1` oder die
Adresse des Servers; der Weg führt nur über die Pforte.

## Wie es geprüft wird

In der CI (`apps/agent/test/pforte.agent.test.ts`) läuft ein echter Caddy aus der gerenderten Unit
mit lokaler CA (`tls internal`) auf hohen Ports, dazu zwei Installationen der Beispiel-App unter
zwei Linux-Nutzern. Geprüft wird: beide antworten unter ihrem Hostnamen, die Client-Adresse kommt
an und eine gefälschte nicht, die Upload-Grenze gilt, A erreicht den Port von B nicht, und das
Entfernen von B unterbricht weder eine laufende Verbindung noch neue Anfragen an A.
