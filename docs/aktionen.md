---
title: Aktionen einer Installation
description: >-
  Neustart, Log-Auszug und „nur lesen“: wann eine App sie anbietet, was der Agent auf dem Server
  tut und wie er Geheimnisse aus dem Log-Auszug heraushält.
---

# Neustart, Log-Auszug, nur lesen

Eine laufende Installation hat bis zu drei Aktionen: **Neustart**, **Log-Auszug** und **nur lesen**.
Welche es gibt, sagt das signierte Manifest der App unter `aktionen` ([Manifest](manifest.md)):
`neustart` und `log_auszug` sind angeboten, solange das Manifest sie nicht als
`nicht_unterstuetzt` markiert; „nur lesen“ gibt es nur, wenn `aktionen.nur_lesen` einen Befehl
nennt. Was das Manifest nicht anbietet, gibt es weder als Knopf noch auf dem Server: Zentrale und
Agent prüfen es mit derselben Funktion (`aktionAngeboten` in `packages/manifest`).

## In der Zentrale

Die Seite einer laufenden App zeigt im Kopf **Neustart** und unter **Mehr …** Log-Auszug und „nur
lesen“, soweit ihr Manifest sie anbietet. Jede Aktion verlangt einen **Grund**; die Zentrale legt einen Auftrag an
und schreibt ihn mit Person ins Audit-Log ([Aufträge](auftraege.md)).

| Aktion | Auftrag | Wer | Wann nicht |
| --- | --- | --- | --- |
| Neustart | `installation_neustart` | Inhaber, Mitglied | in einer Sperrzeit des Manifests; solange ein anderer Auftrag der Installation offen ist |
| Log-Auszug | `installation_log_auszug` | Inhaber, Mitglied | – |
| Nur lesen | der Befehl aus `aktionen.nur_lesen.befehl` | Inhaber | solange ein anderer Auftrag der Installation offen ist |

Alle drei gibt es nur für eine Installation im Zustand „läuft“. Neustart und Log-Auszug sind
eingebaute Aufträge ohne Argumente; „nur lesen“ ist ein gewöhnlicher Befehl des Manifests.

**Neustart in einer Sperrzeit:** die Zentrale lehnt ihn beim Anlegen ab (409). Wurde er vor der
Sperrzeit angelegt und hat der Agent ihn noch nicht bestätigt, schickt die Zentrale ihn während der
Sperrzeit nicht; er bleibt offen bis zur nächsten Verbindung danach, wie ein Auftrag „Neu
konfigurieren“ ([Einstellungen](einstellungen.md)).

**Log-Auszug:** der Agent liest die letzten 500 Zeilen aus journald, ersetzt jeden Wert eines
Geheimnisses durch `[geheim]` und schickt die Zeilen mit der ID des Auftrags. Die Zentrale nimmt sie
nur für einen Log-Auftrag desselben Servers und Betreibers an, einmal je Auftrag; alles andere
verwirft sie und schreibt es ins Log der Zentrale. Sie kürzt jede Zeile auf 2000 Zeichen und hält die
Zeilen 30 Tage in `log_auszuege`; das Audit-Log vermerkt den Auszug, aber nicht seine Zeilen, weil
sie Daten der Kunden enthalten. Der Dialog fragt jede Sekunde nach den Zeilen und zeigt sie, sobald
sie da sind; nach zwei Minuten ohne Antwort hört er auf zu fragen, der Auftrag bleibt offen.

Ein Log-Auszug liest nur: er läuft auch neben einem offenen Auftrag und in einer Sperrzeit. Er
selbst ist aber ein offener Auftrag, bis der Agent ihn erledigt hat; so lange wartet ein Neustart.

### API

| Route | Recht | Antwort |
| --- | --- | --- |
| `POST /api/v1/installationen/:id/neustart` | `installationen:schreiben` | 201 `{ auftrag }` |
| `POST /api/v1/installationen/:id/nur-lesen` | `installationen:schreiben` | 201 `{ auftrag }` |
| `POST /api/v1/installationen/:id/log-auszug` | `installationen:log_auszug` | 201 `{ auftrag }` |
| `GET /api/v1/installationen/:id/log-auszuege/:auftragId` | `installationen:log_auszug` | `{ auftragId, aktion, zustand, fehler, zeilen, zeitpunkt }`; `zeilen` ist `null`, bis der Agent sie geschickt hat |

Jede `POST`-Route nimmt ein freiwilliges `{ grund }` (höchstens 500 Zeichen, Z-1207); ohne ihn steht
der Eintrag im Audit-Log mit leerem Grund. Weitere
Antworten: 404 `keine_installation` (auch für eine Installation eines anderen Betreibers), 409
`laeuft_nicht`, `sperrzeit` (mit dem Grund der Sperrzeit als `detail`) oder `auftrag_offen`, 422
`nicht_angeboten` oder `nicht_ausfuehrbar`. Die Seite einer Installation
(`GET /api/v1/installationen/:id`) nennt unter `aktionen` (`neustart`, `log_auszug`, `nur_lesen`),
was ihr Manifest anbietet.

## Auf dem Server

Der Agent führt `installation_neustart` und `installation_log_auszug` nur aus, wenn das signierte
Manifest die Aktion anbietet (`aktionen.neustart` bzw. `aktionen.log_auszug`, Vorgabe
`angeboten`); sonst lehnt er ab („abgelehnt: the manifest does not offer neustart“), ohne etwas
zu starten. Beide nimmt er nur für eine Installation an, die er selbst fertig eingerichtet hat und
deren Units in ihren Labels genau App und Version dieses Manifests nennen (sonst „abgelehnt: die
Units sind nicht aus … dem Manifest des Auftrags“): ein anderes signiertes Manifest kann einer
Installation keine Aktion leihen, die ihr eigenes nicht anbietet. Beide
laufen nacheinander mit den Einrichtungsaufträgen: ein Neustart trifft nie ein halbes
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
ersetzt den ganzen bedeckten Bereich. Eine lange Zeile schreibt conmon als mehrere Einträge
(ab 8192 Bytes), journald ab `LineMax`; ein Wert kann dabei in zwei Teile fallen. Folgt ein Eintrag
auf einen langen derselben Quelle, ersetzt der Agent deshalb auch den Rest eines Werts am Anfang
seiner Nachricht, beim ersten Eintrag einer Quelle im Auszug ab vier Zeichen. Erst danach kürzt er
jede Zeile auf 2000 Zeichen. Kann er die
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
