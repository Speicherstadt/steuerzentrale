# Neustart, Log-Auszug, nur lesen

Eine laufende Installation hat bis zu drei Aktionen: **Neustart**, **Log-Auszug** und **nur lesen**.
Welche es gibt, sagt das signierte Manifest der App unter `aktionen` ([Manifest](manifest.md)):
`neustart` und `log_auszug` sind angeboten, solange das Manifest sie nicht als
`nicht_unterstuetzt` markiert; „nur lesen“ gibt es nur, wenn `aktionen.nur_lesen` einen Befehl
nennt. Was das Manifest nicht anbietet, gibt es weder als Knopf noch auf dem Server: Zentrale und
Agent prüfen es mit derselben Funktion (`aktionAngeboten` in `packages/manifest`).

## In der Zentrale

Die Seite einer laufenden Installation zeigt neben „Einstellungen ändern“ die Knöpfe der Aktionen,
die ihr Manifest anbietet. Jede Aktion verlangt einen **Grund**; die Zentrale legt einen Auftrag an
und schreibt ihn mit Grund und Person ins Audit-Log ([Aufträge](auftraege.md)).

| Aktion | Auftrag | Wer | Wann nicht |
| --- | --- | --- | --- |
| Neustart | `installation_neustart` | Inhaber, Technik | in einer Sperrzeit des Manifests; solange ein anderer Auftrag der Installation offen ist |
| Log-Auszug | `installation_log_auszug` | Inhaber, Technik, Support | – |
| Nur lesen | der Befehl aus `aktionen.nur_lesen.befehl` | Inhaber, Technik | solange ein anderer Auftrag der Installation offen ist |

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

Jede `POST`-Route nimmt `{ grund }` (1 bis 500 Zeichen); ohne Grund antwortet sie 400. Weitere
Antworten: 404 `keine_installation` (auch für eine Installation eines anderen Betreibers), 409
`laeuft_nicht`, `sperrzeit` (mit dem Grund der Sperrzeit als `detail`) oder `auftrag_offen`, 422
`nicht_angeboten` oder `nicht_ausfuehrbar`. Die Seite einer Installation
(`GET /api/v1/installationen/:id`) nennt unter `aktionen` (`neustart`, `log_auszug`, `nur_lesen`),
was ihr Manifest anbietet.
