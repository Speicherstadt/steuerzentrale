---
title: Apps installieren
description: >-
  Wie die Steuerzentrale prüft, ob eine App auf einen Server passt (Platzierung), und wie sie eine
  Installation anlegt: signiertes Manifest, Name, Ports, Einstellungen nach Ebenen, Einrichtungsauftrag
  und Route der Pforte.
---

# Apps installieren

Vor jeder Installation prüft die **Platzierung**, ob die App mit den gewählten Optionen auf den
Server passt. Sie ist eine reine Funktion (`packages/manifest`, `platzieren`) und liefert eines von
drei Ergebnissen:

- **passt**: nichts spricht dagegen;
- **Hinweise**: es passt, aber knapp (RAM oder Platte danach über 80 %);
- **passt nicht**: mit jedem Grund, warum nicht.

## Regeln

| Regel | passt nicht, wenn … |
| --- | --- |
| Architektur | ein Container der App oder einer gewählten Option, oder eine gewählte Option ohne eigene Container, die Architektur des Servers nicht kennt (Kontext mit `documents` läuft nur auf amd64) |
| RAM | die Summe der Grenzen (`ram_mb` der App und der gewählten Optionen und aller Installationen auf dem Server) den RAM des Servers übersteigt |
| Platte | `platte_gb` der App den freien Platz übersteigt oder die Summe der Planwerte (`platte_gb` der App und aller Installationen auf dem Server) die Größe der Platte (in Stufe 1 Planwerte) |
| Feste Ports | ein fester Port (auch in einem Bereich, je Protokoll) schon von einer Installation oder dem Server belegt ist; vergebene Ports (`fest: false`) verteilt die Zentrale |
| Öffentliche IPv4 | die App eine öffentliche IPv4 braucht und der Server nur private Adressen hat |
| Mail | die App Mail verschickt und der öffentlichen Adresse ein PTR-Eintrag fehlt oder Port 25 ausgehend gesperrt oder unbekannt ist |
| Server für sich | die App einen Server für sich braucht (auch `rootful` und ein eigener Proxy) und schon etwas anderes darauf läuft, oder umgekehrt |
| Kunde und Betreiber | der Server einem anderen Betreiber gehört, oder ein eigener Server bzw. einer beim Kunden einem anderen Kunden |
| Abhängigkeiten | die App etwas braucht (`braucht`, z. B. `oidc-anbieter`), das keine Installation des Kunden bietet |
| Werte des Betreibers | ein Pflichtwert auf Ebene `betreiber` (z. B. die Hersteller-ID für ELSTER) fehlt |
| Agent | der Agent des Servers nicht verbunden ist |
| Image | ein Container der App oder einer gewählten Option noch kein Image hat (`noch_nicht_veroeffentlicht`) |
| Fakten | der Agent eine nötige Angabe (Architektur, RAM, Platte unter `/home/sz-*`, IPv4, belegte Ports) noch nicht gemeldet hat (`fakten_fehlen`) |

## Installation anlegen

Bis Manifeste importiert werden (Z-501), lädt der Betreiber im Dialog das signierte Manifest hoch:
den Text und die Signatur (`.minisig`). Die Zentrale prüft die Signatur mit demselben öffentlichen
Schlüssel, den sie in `install.sh` einsetzt (`minisign.pub` neben dem Installationsskript), und
lehnt ein Manifest ohne gültige Signatur ab, schon vor der Platzierung. Der Agent prüft sie vor dem
Einrichten noch einmal.

Dann, in dieser Reihenfolge:

1. **Platzierung** mit den neuesten Fakten des Servers, den Installationen darauf und den Werten des
   Betreibers. Passt die App nicht, lehnt die Zentrale mit jedem Grund ab; fehlt ein Pflichtwert der
   Ebene `betreiber`, steht sein Name im Grund (`betreiberwert_fehlt`).
2. **Host**: eindeutig unter den nicht entfernten Installationen des Betreibers. Den DNS-Eintrag setzt
   die Zentrale erst mit Z-407.
3. **Einstellungen der Ebene `installation`** aus dem Dialog: nur Einstellungen dieser Ebene, die mit
   den gewählten Optionen gelten, mit einem Wert ihres Typs; eine fehlende ohne Vorgabe lehnt das
   Gegenrendern ab.
4. **Name** `<app>-<6 Zeichen a–z, 0–9>`, z. B. `haben-x7k2p9`; er ist das Präfix der Units und der
   Linux-Nutzer `sz-<name>`.
5. **Ports** aus 20000–29999 auf dem Server: der HTTP-Port auf 127.0.0.1 und jeder Port mit
   `fest: false` (ein Bereich als zusammenhängender Block), jeweils der niedrigste freie, ohne die
   Ports, die der Server laut Fakten schon belegt. Kein Port wird auf einem Server zweimal vergeben.
6. **Erzeugte Werte** (`erzeugen: zufall_32`, `zufall_64`, `zufall_hex_32`) für die Einstellungen der
   Ebene `auto`.
7. **Gegenrendern**: die Zentrale rendert die Units mit derselben Funktion wie der Agent und lehnt ab,
   was nicht rendert.

Erst dann schreibt sie in einer Transaktion mit dem Audit-Log die Installation (Zustand
`wird_eingerichtet`), ihre Ports, den Auftrag `installation_einrichten` und, wenn die App hinter der
Pforte liegt, `pforte_route_setzen`, der auf das Einrichten wartet ([Aufträge](auftraege.md)).

### Geheimnisse

Geheime Werte (Typ `geheim`, verschlüsselt gespeicherte Werte des Betreibers) und alle erzeugten
Werte stehen nur verschlüsselt in der Spalte `geheim` der Installation. Die Werte, die nicht geheim
sind, stehen lesbar daneben und kommen in der API zurück; ein Geheimnis gibt die API nie zurück, auch
nicht seinen verschlüsselten Wert. Erst beim Zustellen des Einrichtungsauftrags setzt die Zentrale
die Werte entschlüsselt in die Nachricht an den Agenten ein; im Auftrag in der Datenbank und im
Audit-Log stehen sie nicht. Die Werte des Betreibers gelten so, wie sie beim Anlegen waren; ändern
lassen sie sich mit „neu konfigurieren“ (Z-404).

### Zustände

| Zustand | Bedeutung |
| --- | --- |
| wird_eingerichtet | angelegt, der Einrichtungsauftrag läuft oder wartet auf den Agenten |
| laeuft | der Agent hat sie eingerichtet; die Route der Pforte geht jetzt an ihn |
| gescheitert | das Einrichten ist gescheitert; der Agent hat aufgeräumt, die Route wurde abgebrochen |
| entfernt | nach einem gescheiterten Einrichten mit `installation_entfernen` entfernt |

Entfernt wird hier nur eine Installation im Zustand `gescheitert`. Scheitert das Entfernen, bleibt
sie `gescheitert` und kann noch einmal entfernt werden. Eine eingerichtete Installation entfernt erst
Z-604, nach einem Backup.

## API

Alle Rollen lesen, Inhaber und Technik schreiben. Jede schreibende Route verlangt einen `grund`, der
ins Audit-Log geht.

| Route | Körper | Antwort |
| --- | --- | --- |
| `POST /api/v1/installationen/platzierung` | `kundeId`, `serverId`, `manifest`, `signatur`, `optionen` | `{ platzierung }` mit `art` `passt`, `hinweise` oder `passt_nicht` und den Codes |
| `POST /api/v1/installationen` | wie oben, dazu `host`, `einstellungen` (Ebene `installation`), `grund` | `201` mit der Installation |
| `GET /api/v1/installationen` | – | `{ installationen }` |
| `GET /api/v1/installationen/:installationId` | – | die Installation mit ihren Aufträgen (Zustand, letzter Schritt, Fehler) |
| `DELETE /api/v1/installationen/:installationId` | `grund` | die Installation mit dem neuen Auftrag `installation_entfernen` |

Fehler kommen als `{ fehler }` mit einem Code, bei `passt_nicht` mit `gruende`, bei einem
ungültigen Manifest oder einem Wert, der nicht rendert, mit `detail`: `signatur_ungueltig`,
`manifest_ungueltig`, `nicht_einrichtbar` (422), `kein_kunde`, `kein_server`, `keine_installation`
(404), `server_gesperrt`, `passt_nicht`, `host_vergeben`, `keine_ports`, `nicht_gescheitert`,
`entfernen_laeuft` (409), `einstellung_ungueltig`, `ungueltig` (400), `kein_schluessel` (503, kein
öffentlicher Schlüssel neben `install.sh`).
