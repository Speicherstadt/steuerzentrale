---
title: Updates des Agenten
description: >-
  Wie sich der Agent auf jedem Server selbst aktualisiert: im Wartungsfenster, mit Prüfsumme und
  minisign-Signatur wie install.sh, mit Rückkehr zum alten Agenten, und warum die Zentrale Agenten
  einer Protokollversion zurück versteht.
---

# Updates des Agenten

Der Agent auf jedem Server bringt sich selbst auf die Version, die seine Zentrale ausliefert. Die
Zentrale entscheidet, wann; der Agent prüft, was er lädt, genauso streng wie `install.sh` beim
ersten Mal ([Server hinzufügen](server-hinzufuegen.md)). Mit dem Agenten kommen auch die Images der
Pforte (Caddy) und von restic, deren Digests im Agenten stehen.

## Welche Version

Das Verzeichnis der Agent-Dateien (`STEUERZENTRALE_AGENT_DATEIEN`) hält neben den beiden Binaries,
`SHA256SUMS`, `SHA256SUMS.minisig`, `minisign.pub` und `install.sh` die Datei `VERSION`: die Version,
die die Binaries mit `--version` nennen. `scripts/agent-dateien.ts` schreibt sie für einen
Release-Kandidaten; bei einem Release legt sie der Mensch mit den signierten Dateien dorthin. Die
Zentrale liest das Verzeichnis bei jeder Runde neu, ein neuer Release braucht keinen Neustart.

## Wann

Jede Minute vergleicht die Zentrale die Version, die jeder beigetretene, nicht gesperrte Server in
seinem letzten `hallo` gemeldet hat, mit `VERSION`. Sie legt den Auftrag `agent_update` an, wenn

- der Agent eine ältere Version meldet (eine Vorabversion gilt als älter als ihr Release),
- er verbunden ist,
- auf dem Server kein anderer Auftrag offen ist (der Neustart des Agenten würde ihn abbrechen; ein
  Update einer Installation zählt mit, je Server läuft höchstens ein Update),
- das Wartungsfenster des Servers offen ist, und
- diese Version auf dem Server nicht in den letzten 24 Stunden versucht wurde.

Sperrzeiten der Apps zählen nicht: Der Neustart des Agenten lässt die Apps weiterlaufen. Angelegt
wird als `system`, mit dem Grund „Update des Agenten von x auf y“ im Audit-Log.

## Was der Agent tut

Der Auftrag trägt `SHA256SUMS` und dessen Signatur, so wie die Zentrale sie ausliefert, und die
Version; eine Adresse trägt er nicht. Der Agent

1. prüft den Schlüssel aus `/etc/steuerzentrale/manifest.pub` (den öffentlichen Test-Schlüssel nur
   im Testmodus) und die Signatur über `SHA256SUMS`, dann die feste Form des Auftrags;
2. lehnt eine Version ab, die nicht neuer ist als seine eigene: ein alter, signierter Release kommt
   nie zurück;
3. lädt `steuerzentrale-agent-linux-<x64|arm64>` von seiner Zentrale (`<zentrale>/agent/…`, ohne
   Umleitung) und prüft die Prüfsumme gegen die Zeile in `SHA256SUMS`;
4. legt es als `/usr/local/bin/steuerzentrale-agent.neu` ab und startet es mit `--version`: es muss
   die Version des Auftrags und mindestens sein eigenes Protokoll nennen;
5. behält sich selbst als `/usr/local/bin/steuerzentrale-agent.alt`, schreibt die Marke
   `/var/lib/steuerzentrale/agent-update.json` und plant mit `systemd-run` die Prüfung (unten);
6. benennt das neue Binary in einem Schritt um (`rename`), meldet `{ version, vorher }`, nimmt keinen
   Auftrag mehr an und beendet sich; systemd (`Restart=always`) startet den neuen Agenten.

Bis Schritt 6 ändert sich am Agenten nichts: Eine falsche Signatur, Prüfsumme oder fehlende Zeile
lehnt er ab („abgelehnt: …“), ein Fehler beim Laden oder in systemd meldet er als „Agent-Update
gescheitert: …; nichts geändert“, und was er schon geschrieben hatte, räumt er weg.

## Rückkehr zum alten Agenten

Die Prüfung läuft in einem eigenen, vorübergehenden Timer von systemd
(`steuerzentrale-agent-pruefen.timer`) 5 Minuten nach dem Tausch, als root, mit dem **alten** Binary:
`steuerzentrale-agent.alt agent-update-pruefen`. Sie hängt also nicht vom neuen ab.

- Der neue Agent bestätigt die Marke, sobald seine Zentrale ihn mit `willkommen` begrüßt hat. Ist sie
  bestätigt, entfernt die Prüfung nur die Marke.
- Ist sie es nicht, legt die Prüfung das alte Binary zurück, entfernt die Marke und startet den
  Dienst neu.

Ein Neustart des Servers in diesen 5 Minuten verliert den vorübergehenden Timer; dann bleibt der neue
Agent, und `steuerzentrale-agent.alt` liegt für eine Rückkehr von Hand bereit.

## Was die Zentrale sieht

| Was | Ereignis des Servers |
| --- | --- |
| der Agent lehnt ab oder scheitert (Signatur, Prüfsumme, Laden, ein anderer Auftrag läuft) | `agent_update_gescheitert` (Fehler), mit dem Grund; der Agent bleibt |
| der neue Agent meldet sich mit der höheren Version | `agent_aktualisiert` (Info) |
| ein Agent meldet sich mit einer niedrigeren Version als zuvor (Rückkehr) | `agent_zurueckgekehrt` (Fehler) |

Ein gelungener Auftrag sagt nur, dass das neue Binary liegt; ob es läuft, zeigt das nächste `hallo`.
Nach einem Fehlschlag oder einer Rückkehr versucht die Zentrale dieselbe Version 24 Stunden später
wieder, im nächsten Wartungsfenster; eine neuere Version sofort.

## Eine Protokollversion zurück

Nach einem Update der Zentrale sind ihre Agenten bis zu ihrem eigenen Update eine Version zurück.
Jede Nachricht trägt die Protokollversion ihres Absenders; Versionen fügen nur hinzu.

- Die Zentrale liest Nachrichten der eigenen und der vorigen Version und wertet ältere schrittweise
  auf (`AUFWERTUNGEN`). Je Version liegt ein eingefrorenes Beispiel jeder Nachricht im Code
  (`packages/protokoll`, `beispiele-v1.ts`); die Tests lesen die Beispiele der vorigen Version mit der
  aktuellen Zentrale.
- Der Agent liest nur die Version seiner Zentrale. Darum schreibt die Zentrale jedem Agenten in der
  Version aus seinem `hallo` (`fuerVersion`): eine Nachricht der neueren Version ohne ihre neuen
  Felder, die der ältere Agent ohnehin verwirft. Eine Nachrichtenart oder einen Auftrag, den die
  ältere Version nicht kennt, schickt die Zentrale ihm nicht.
- `agent_update` gehört zu Protokoll 1 und behält seine Form, damit jeder Agent sich aktualisieren
  kann; sein eingefrorenes Beispiel steht unter den Beispielen von Protokoll 1.

## In der CI

Der Job `server` (Incus-VMs mit Debian 13 und Ubuntu 24.04) baut nach `install.sh` einen zweiten
Agenten mit Version 0.0.1 (`STEUERZENTRALE_BAU_VERSION`, `scripts/compile.ts`), legt ihn mit
`scripts/agent-dateien.ts` signiert ab, öffnet das Wartungsfenster und wartet, bis der Agent in der VM
0.0.1 meldet: das alte Binary liegt als `.alt` daneben, der neue Agent hat sich bestätigt, die
Prüfung lässt ihn stehen, und die Zentrale hat `agent_aktualisiert`. Danach liefert sie 0.0.2 aus,
dessen `SHA256SUMS` ein in der CI erzeugter fremder Schlüssel signiert hat: der Agent lehnt ab, läuft
weiter mit 0.0.1, und die Zentrale hat `agent_update_gescheitert`.
