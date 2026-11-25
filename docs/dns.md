---
title: Adressen und DNS
description: >-
  Wie die Steuerzentrale Adressen der Form <app>.<kürzel>.<domain> vorschlägt und ihre A- und
  AAAA-Einträge über die Cloudflare-API setzt und wieder löscht; der API-Token bleibt verschlüsselt in
  der Zentrale und erreicht nie einen Server.
---

# Adressen und DNS

Jede Installation antwortet unter einer Adresse (Host). Die Zentrale schlägt sie im Dialog „App
installieren“ als `<app>.<kürzel>.<domain>` vor, z. B. `haben.kanzlei-west.apps.speicherstadt.de`:

| Teil | Woher |
| --- | --- |
| `<app>` | die ID der App aus dem Manifest |
| `<kürzel>` | das Kürzel des Kunden ([Kunden und Verträge](kunden.md#kurzel)) |
| `<domain>` | die Domain des Betreibers aus den DNS-Einstellungen |

Liegt der Host unter dieser Domain, setzt die Zentrale seine DNS-Einträge bei Cloudflare und löscht
sie wieder, wenn die Installation entfernt ist. Ein anderer Host bleibt erlaubt; seine Einträge setzt
der Betreiber selbst.

## DNS-Einstellungen

Unter **Einstellungen → Adressen und DNS** setzt der Inhaber mit Grund:

| Angabe | Bedeutung |
| --- | --- |
| Domain | die Domain der Adressen, Kleinbuchstaben mit Punkt, z. B. `apps.speicherstadt.de` |
| Zone-ID | die ID der Cloudflare-Zone, die die Domain enthält (32 Zeichen aus 0–9 und a–f, in Cloudflare auf der Übersicht der Zone) |
| API-Token | ein Token nur mit dem Recht *Zone · DNS · Bearbeiten* dieser einen Zone |

Der Token liegt verschlüsselt in der Zentrale (`geheimnisse`, mit `STEUERZENTRALE_SECRET_KEY`, rotierbar
wie jedes Geheimnis). Keine Antwort der API enthält ihn, die Oberfläche zeigt nur „gesetzt“; ein leeres
Feld behält ihn. Das Audit-Log vermerkt ihn nur als geändert. Kein Server und kein Agent bekommt ihn
je: ein übernommener Server soll keinen Kunden umleiten können.

Domain und Zone lassen sich nur ändern, solange keine Installation dort Einträge hat oder bekommt
(`409 dns_in_benutzung`): die Zentrale löscht Einträge in der Zone, in der sie sie gesetzt hat. Den
Token kann der Betreiber jederzeit tauschen.

## Was die Zentrale setzt

Beim Anlegen einer Installation entscheidet die Zentrale, ob sie deren Einträge setzt: nur wenn eine
Domain eingestellt ist und der Host ein Name darunter ist (nicht die Domain selbst). Dann, gleich nach
dem Anlegen:

| Eintrag | Inhalt |
| --- | --- |
| A | die erste öffentliche IPv4 des Servers aus seinen Fakten |
| AAAA | die erste öffentliche IPv6 (2000::/3) des Servers, falls er eine meldet |

Beide mit `proxied: false` (nur DNS, kein Proxy; die Pforte holt das Zertifikat per HTTP-01), TTL 300
und dem Kommentar `steuerzentrale:<installation>`. Nach erfolgreichem `installation_entfernen` löscht
sie die Einträge wieder.

Die Zentrale ändert und löscht nur Einträge mit genau ihrem Kommentar. Steht unter dem Host schon ein
A-, AAAA- oder CNAME-Eintrag ohne diesen Kommentar, etwa von Hand gesetzt, setzt sie nichts daneben
und meldet einen Fehler; den fremden Eintrag lässt sie, wie er ist. Andere Einträge (TXT, MX) unter
demselben Namen stören nicht und bleiben.

## Fehler und Wiederholung

Die Installation läuft, auch wenn das DNS nicht klappt. Scheitert ein Versuch (Cloudflare antwortet
mit einem Fehler, ist nicht erreichbar, der Token fehlt oder ein fremder Eintrag steht im Weg),
versucht die Zentrale es wieder: nach 1, 2, 4, 8 … Minuten, höchstens stündlich. Sie prüft alle 30
Sekunden, welche Einträge fällig sind, und sofort nach dem Anlegen, nach einem Entfernen und nach
neuen DNS-Einstellungen; neue Einstellungen machen jeden wartenden Versuch sofort fällig, so wirkt ein
nachgetragener Token gleich. Scheitert ein Versuch, während neue Einstellungen gespeichert werden,
zählt er nicht: er lief noch mit den alten, die Installation bleibt fällig.

Der erste Fehlschlag einer Reihe schreibt das Ereignis `dns_fehler` (Schwere `warn`) mit Host, Versuch
und Grund an die Installation, ein anhaltender Fehler höchstens eines am Tag. Der Grund enthält nie den
Token.

## API

| Route | Wer | Körper | Antwort |
| --- | --- | --- | --- |
| `GET /api/v1/dns` | alle Rollen | – | `{ domain, zoneId, tokenGesetzt }` |
| `PUT /api/v1/dns` | Inhaber | `domain`, `zoneId`, `token`?, `grund` | wie `GET` |

Ohne `token` bleibt der gesetzte. Fehler: `400 ungueltig` (Domain, Zone-ID oder Token in falscher
Form, kein Grund), `409 dns_in_benutzung`. Jeder Betreiber sieht und setzt nur seine eigenen
Einstellungen.

Audit-Log:

| Aktion | Wann |
| --- | --- |
| `dns.einstellungen` | Domain, Zone oder Token gesetzt |
| `dns.setzen`, `dns.loeschen` | die Einträge einer Installation gesetzt bzw. gelöscht (Akteur `system`) |
| `dns.fehler` | ein Versuch gescheitert, mit dem nächsten Zeitpunkt |

## Tests

Die Cloudflare-API wird in den Tests nachgebaut (`apps/zentrale/src/testhilfen/cloudflare.ts`, ein
Bun-Server im Speicher); `STEUERZENTRALE_CLOUDFLARE_API` lenkt die Zentrale dorthin. Die Variable nimmt
nur eine Adresse auf `localhost`, `127.0.0.1` oder `::1` an, sonst startet die Zentrale nicht; ohne sie
spricht die Zentrale mit `https://api.cloudflare.com/client/v4`.
