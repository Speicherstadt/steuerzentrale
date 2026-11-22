---
title: Aktionen einer Installation
description: >-
  Neustart, Log-Auszug und „nur lesen“: wann eine App sie anbietet, was der Agent auf dem Server
  tut und wie er Geheimnisse aus dem Log-Auszug heraushält.
---

# Aktionen einer Installation

## Auf dem Server

Der Agent führt `installation_neustart` und `installation_log_auszug` nur aus, wenn das signierte
Manifest die Aktion anbietet (`aktionen.neustart` bzw. `aktionen.log_auszug`, Vorgabe
`angeboten`); sonst lehnt er ab („abgelehnt: the manifest does not offer neustart“), ohne etwas
zu starten. Beide nimmt er nur für eine Installation an, die er selbst fertig eingerichtet hat, und
beide laufen nacheinander mit den Einrichtungsaufträgen: ein Neustart trifft nie ein halbes
Einrichten oder Neukonfigurieren. „Nur lesen“ ist ein gewöhnlicher Befehl des Manifests
([Aufträge](auftraege.md)).

### Neustart

Als Linux-Nutzer der Installation setzt der Agent zuerst den Fehlerzähler der Units zurück
(`systemctl --user reset-failed`), startet sie neu (`systemctl --user restart`) und wartet, bis sie
aktiv sind und zehn Sekunden lang aktiv bleiben. Eine App, die beim Start abbricht, fällt so auf,
statt kurz als laufend zu gelten. Erfolgreich meldet er `{ installation, units }`.

Ein Neustart, der lief, als der Agent selbst neu startete, wird nicht wiederholt, sondern als
gescheitert gemeldet („Agent neu gestartet“): er käme sonst vielleicht zu einer Zeit, die die
Zentrale nicht geprüft hat, etwa in einer Sperrzeit der App.

### Log-Auszug

Der Agent liest als root die letzten 500 Zeilen, die der Nutzer der Installation ins Journal
geschrieben hat, mit festen Argumenten:

```sh
journalctl _UID=<uid> -n 500 -o short-iso --no-pager
```

Bevor eine Zeile den Server verlässt, ersetzt er jeden Wert eines Geheimnisses durch `[geheim]`:

- die Werte der Podman-Secrets der Installation (jede Einstellung vom Typ `geheim`);
- die Werte der Einstellungen der Ebene `auto` (erzeugte Schlüssel, Werte des Anmeldedienstes,
  die Adresse), die als `Environment=` in ihren Units stehen.

Die Namen dieser Einstellungen merkt sich der Agent beim Einrichten und beim Neukonfigurieren,
nur die Namen; die Werte liest er bei jedem Auszug neu aus den Units und aus Podman. Er sucht jedes
Vorkommen in der Zeile, auch wenn sich zwei Werte überlappen oder einer im anderen steht, und
ersetzt den ganzen bedeckten Bereich. Erst danach kürzt er jede Zeile auf 2000 Zeichen. Kann er die
Secrets oder Units nicht lesen, liest er das Journal gar nicht und lehnt ab.

Die Zeilen gehen als Nachricht `log_auszug` mit der Auftrags-ID an die Zentrale, unmittelbar vor
dem Ergebnis; das Ergebnis selbst nennt nur ihre Zahl (`{ zeilen: n }`). Der Agent schreibt keine
Zeile in eine Datei oder sein eigenes Log. Ein laufender Log-Auszug wird nach einem Neustart des
Agenten wiederholt. Reißt die Verbindung zwischen beiden Nachrichten ab, bekommt die Zentrale beim
nächsten Zustellen nur das Ergebnis; dann hilft ein neuer Log-Auszug.

!!! note "Was nicht ersetzt wird"
    Ersetzt wird, was jetzt gilt. Ein alter Wert, den „neu konfigurieren“ inzwischen ersetzt hat,
    kann in älteren Zeilen noch stehen. Eine Einstellung der Ebene `auto` mit einem kurzen Wert
    wird überall ersetzt, wo dieser Text vorkommt.
