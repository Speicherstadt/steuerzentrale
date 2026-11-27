---
title: "Mitwirken an der Steuerzentrale: Branches, Prüfungen, Review"
description: >-
  Wie ein Beitrag zur Steuerzentrale entsteht: Aufgabe übernehmen, Branches, Titel, Commits mit DCO, Arbeit
  mit KI-Agenten und dem Loop der Bauliste, automatische Prüfungen, Issues, Beiträge annehmen und Review.
---

<!--
  Vorlage aus https://github.com/Speicherstadt/werkbank (vorlagen/mitwirken.md). Abschnitte mit „Projekt:“
  ergänzen, was nur hier gilt. Der Rest gilt für alle Projekte der Speicherstadt gleich; eine Verbesserung daran
  gehört auch in die Vorlage.
-->

# Mitwirken

**Programmieren musst du nicht.** Fehler melden, die Doku korrigieren und neue Versionen testen hilft genauso. Ein [Issue](#issues-schreiben) genügt.

Vor jedem Push dieselben Prüfungen wie in der CI; die Befehle stehen im Skill [`checks`](https://github.com/Speicherstadt/steuerzentrale/blob/main/.agents/skills/checks/SKILL.md), Umgebung und Konventionen unter [Entwicklung](entwicklung.md). Was übersprungen wurde, gehört in die Beschreibung des Pull Requests.

- Ein Pull Request, ein Thema; er trägt nur seine eigenen Commits.
- **Aufräumen gehört dazu (Pfadfinder-Regel):** Was beim Arbeiten in den berührten Dateien auffällt, etwa ein wackeliger Test, eine zu lange Funktion oder toter Code, wird im selben Pull Request mit verbessert und in der Beschreibung unter „Aufgeräumt“ genannt. Das Verhalten ändert sich dabei nicht, die Tests zeigen es; ein wackeliger Test wird an der Ursache behoben, nicht abgeschwächt. Nicht über die berührten Dateien hinaus.
- **Tests für das, was sich ändert.** Ein Bugfix beginnt mit einem Test, der fehlschlägt (bei unklarer Ursache Skill `fehler-eingrenzen`). Der erwartete Wert kommt aus einer Quelle, die unabhängig vom Code ist, etwa einem Beispiel aus der Norm oder einem von Hand gerechneten Fall; ein Test, der ihn genauso berechnet wie der Code, kann nie fehlschlagen.
- **Die Doku in `docs/`**, die das Verhalten beschreibt, im selben Pull Request, kurz und für Menschen; Schritte für Agenten gehören in einen Skill, Interna eines Skripts in seine Kommentare. Das README nur, wenn ein Bereich dazukommt oder wegfällt.
- **Änderungen am Aussehen** mit Screenshots vorher und nachher in der Beschreibung; die Bilder für „vorher“ entstehen vor der ersten Änderung.
- Projekt: die Texte der Oberfläche in `messages/de.json` und `messages/en.json` im selben Pull Request. Jeder Commit trägt `Signed-off-by` ([Developer Certificate of Origin](https://developercertificate.org/)): `git commit -s`. Ein CLA gibt es nicht.

## Etwas übernehmen { #etwas-uebernehmen }

Ein Board gibt es für die Steuerzentrale noch nicht; was gebaut wird, steht in der [Bauliste](https://github.com/Speicherstadt/steuerzentrale/blob/main/BAULISTE.md), die der [Agenten-Loop](#agenten-loop) abarbeitet. Wer selbst mitbauen will, schlägt im Issue vor, was er übernimmt; ein Vorschlag ohne Issue bekommt zuerst ein Issue. Sobald das Board da ist, gilt:

1. **Aussuchen:** eine Karte aus „Geplant“, am liebsten weit oben, denn die Reihenfolge ist die Priorität. Für den Einstieg eignen sich Issues mit dem Label `einstieg`. Ein Vorschlag ohne Issue bekommt zuerst ein Issue.
2. **Übernehmen:** im Issue eine Zeile `/übernehmen` kommentieren, gern mit einem kurzen Plan darunter. Der Workflow „Übernehmen“ weist dir das Issue zu, schiebt die Karte nach „In Arbeit“ und bestätigt es im Issue; Schreibrecht brauchst du dafür nicht. Er lehnt mit Begründung ab, wenn das Issue schon vergeben ist, noch keine Karte hat oder schon umgesetzt ist.
3. **Nachfragen und Freigeben:** Kommt 14 Tage lang weder ein Pull Request mit `Refs` oder `Umgesetzt` noch ein Kommentar von dir, fragt der Workflow im Issue nach; kommt danach sieben Tage nichts, hebt er die Zuweisung auf, und die Karte geht zurück nach „Geplant“. Wer aufhören will, kommentiert `/freigeben`.
4. **Bauen:** wie im Folgenden beschrieben, mit `Umgesetzt #…` in der Beschreibung und vor „Ready for review“ mit der [Selbstprüfung](#beitraege-annehmen).

## Branches, Titel und Commits { #branches }

- **Branch:** Wer Schreibrecht hat, legt den Branch im Repository an, alle anderen in ihrem Fork. Direkt auf `main` wird nicht gepusht, außer zur Reparatur eines roten `main` ([Wer mergt was](#wer-mergt-was)). Vor jedem Push prüfen, ob der Pull Request des Branches noch offen ist; ist er gemergt, neu von `origin/main` und mit einem **neuen** Pull Request.
- **Entwurf:** Ein Pull Request bleibt Entwurf, solange noch an ihm gearbeitet wird. Commits sammeln und gemeinsam pushen; die Runner teilt sich die ganze Organisation.
- **Titel:** `Bereich: was sich ändert (#Issue)`, etwa „Export: PDF mit Lesezeichen (#104)“; die Nummer nur, falls es ein Issue gibt, jede aus `Umgesetzt #…` gehört hinein. Der Bereich ist ein bis drei Wörter, groß geschrieben, ohne Punkt am Ende. Pull Requests werden per **Squash** gemergt; der Titel wird der Commit auf `main`. Projekt: Für einen Punkt der [Bauliste](https://github.com/Speicherstadt/steuerzentrale/blob/main/BAULISTE.md) heißt der Titel `Z-xxx: was gebaut wird`.
- **Beschreibung:** Beim Squash wird sie die Nachricht des Commits auf `main` (Einstellung des Repositorys: „Default to pull request title and description“). Sie passt deshalb bis zum Merge zum Stand: Ändert ein Push, was der Pull Request tut oder wie er geprüft wurde, ändert sie sich mit. Sie beschreibt das Ergebnis, nicht den Weg. Projekt: Sie folgt `.github/pull_request_template.md`.
- **Abschnitte der Beschreibung**, wo sie zutreffen: `## Aufgeräumt` (Pfadfinder-Regel), `## Neue Abhängigkeiten` (je Paket: wofür, warum eigener Code nicht reicht, Lizenz, wie viele Pakete es mitbringt), `## Für das Release` (was jemand beim Update wissen oder tun muss).
- **Issues in der Beschreibung:** `Umgesetzt #…`, wenn der Pull Request das Issue fertig macht, sonst `Refs #…`. Mehrere als Liste: `Umgesetzt #12, #13`. Nie `Closes` oder `Fixes`: GitHub schlösse das Issue schon beim Merge, die Nutzer haben es aber erst mit dem Release.
- **Commits im Pull Request:** gern im Stil von [Conventional Commits](https://www.conventionalcommits.org/de/) (Empfehlung, keine Prüfung). Projekt: auf Englisch, wie Code und Kommentare, jeder mit `Signed-off-by`.

### Vom Issue zum Release { #vom-issue-zum-release }

Das Board zieht die Karte mit, nie zurück: Issue zugewiesen oder Pull Request mit `Refs`/`Umgesetzt` geöffnet → „In Arbeit“; mit `Umgesetzt` gemergt → „Im nächsten Release“; eine fertige Version (kein Release Candidate) schließt das Issue mit Link auf das Release → „Erledigt“. Was die Automatik nicht sieht, erledigt der Skill `board-pflegen`. Projekt: Bis das Board da ist, schließt nur der Release die Issues ([Release](release.md)).

## Mit KI-Werkzeugen { #ki-werkzeuge }

Mit KI-Agenten zu arbeiten ist ausdrücklich in Ordnung, mit jedem Werkzeug. Der Transparenz halber wird es gekennzeichnet: im Commit mit `Co-Authored-By: <Werkzeug oder Modell> <Adresse>`, in der Beschreibung mit einer Zeile wie „🤖 Generated with <Werkzeug>“. Verantwortlich für den Inhalt bleibt, wer den Pull Request einreicht.

Die Regeln für Agenten stehen in [`AGENTS.md`](https://github.com/Speicherstadt/steuerzentrale/blob/main/AGENTS.md), die Schritte für wiederkehrende Aufgaben in den Skills unter `.agents/skills/`. Die meisten davon kommen aus der [Werkbank](https://github.com/Speicherstadt/werkbank) und sind in allen Projekten gleich; Änderungen daran gehören dorthin.

### Den Agenten-Loop starten { #agenten-loop }

Projekt: Wer als Maintainer weiterbaut, startet eine Session (z. B. Claude Code) mit diesem Prompt; der Stand
steht in `BAULISTE.md` (Häkchen, Abschnitt „Übergabe“) und in den offenen Pull Requests:

```text
Arbeite BAULISTE.md im Repo Speicherstadt/steuerzentrale ab, wie sie es beschreibt (Stufe 1),
beginnend mit Schritt 0 (offene Pull Requests und „Übergabe“). Lies vorher AGENTS.md,
docs/plan.md, docs/mitwirken.md und docs/entwicklung.md; vor jeder Arbeit an Solid-Code den Skill
solid-2.
Git: deine eigene Identität als Maintainer, jeder Commit mit `git commit -s`, Claude als
Co-Authored-By. Pull Requests gegen main, nie direkt auf main pushen; Pflicht-Checks sind check,
pr-regeln / pr-regeln und projekt. Actions-Minuten sind knapp: lokal `bun run check` grün vor
jedem Push.
Pro Punkt: Draft-PR zur Reservierung, Tests zuerst, bei grüner CI selbst squash-mergen und den Punkt
im selben PR abhaken; ein unabhängiges Review (tdd-review) nur bei sicherheitsrelevanten Änderungen
(Liste in docs/mitwirken.md, Review). Nicht auf Menschen warten; offene Fragen entscheidet
docs/plan.md („Entscheidungen“). Mach weiter, bis Stufe 1 fertig ist oder nur noch Punkte offen
sind, die von Schritten für Menschen abhängen, und fasse jeden gemergten Punkt in einer Zeile
zusammen.
```

Hört eine Session auf, bevor ihr Pull Request gemergt ist, trägt sie unter „Übergabe“ in
`BAULISTE.md` ein, was offen ist (auf `main`, über einen eigenen kleinen Pull Request), damit die
nächste dort weitermacht.

## Automatische Prüfungen der Regeln { #automatische-pruefungen }

Der Workflow „PR-Regeln“ aus der Werkbank prüft jeden Pull Request, auch Entwürfe, und schreibt das Ergebnis als einen Kommentar, der sich mit jedem Push ändert. Eingestellt wird er in `.github/werkbank.json`.

| Regel | Wirkung |
| --- | --- |
| Titel `Bereich: was sich ändert`, `(#Issue)` für jedes Issue aus `Umgesetzt` | Fehler |
| Issues mit `Umgesetzt #…` oder `Refs #…`, nicht `Closes` oder `Fixes` | Fehler |
| Neue Abhängigkeit in einer `package.json` | Hinweis, ohne Begründung unter `## Neue Abhängigkeiten` Fehler |
| Skills: Beschreibung höchstens 320 Zeichen, Hauptteil höchstens 1.500 Wörter, jede Datei unter `references/` genannt; `AGENTS.md` nennt jeden Skill | Fehler |
| Code ohne Änderung in `docs/`, `fix`-Commit ohne Test | Hinweis |
| Funktion über der Grenze neu oder gewachsen, alte große Datei wächst deutlich, Doku-Seite zu lang | Hinweis |
| Fachlich heikle Pfade (`heikel`): Merge erst nach „OK“ des Maintainers | Hinweis |
| Pull Request von außen: Selbstprüfung und unabhängiges Review mitbringen | Hinweis |
| Projekt, Job `projekt` in `pr-regeln.yml` (`scripts/pr-regeln/`): `Signed-off-by` an jedem Commit; der Punkt der Bauliste aus dem Titel ist in `BAULISTE.md` abgehakt (nicht im Entwurf) | Fehler |
| Projekt, Job `projekt`: `packages/manifest` geändert, `docs/manifest.md` nicht | Hinweis |

Vor dem Push meldet `bun <werkbank>/werkzeug/pr-regeln/pruefen.ts --titel "…" --beschreibung <datei>` dasselbe in unter einer Sekunde (Skill `beitrag`).

### Wenn eine Prüfung anschlägt { #wenn-eine-pruefung-anschlaegt }

Titel, Issue-Verweise und Abhängigkeiten sagen in der Meldung selbst, was zu tun ist. Eine neue oder über die Grenze gewachsene Funktion wird vor dem Merge geteilt; ein Grund in der Beschreibung reicht dort nicht. Bei den übrigen Hinweisen (Code ohne Doku, Fix ohne Test, große Datei, lange Seite): beheben, oder der Grund steht in der Beschreibung.

### Was die CI prüft { #ci }

Projekt: Neben den Regeln am Pull Request laufen diese Prüfungen:

| Prüfung | Was | Workflow |
| --- | --- | --- |
| Unit | Typen, Biome, erlaubte Abhängigkeiten, keine Muster aus Solid 1.x (`scripts/solid-muster.ts`), Dateigröße, Funktionslänge, Zyklen, Texte und Seiten (`checks.json`: jede Route steht in `e2e/accessibility.spec.ts`), Vitest, Build, `bun audit` | `ci.yml` |
| Agent | der Agent gegen Podman mit systemd (`bun run test:agent`) | `ci.yml` |
| E2E | Playwright, Desktop und Handy; jede Seite hell und dunkel ohne Befund von axe und ohne seitliches Scrollen; jede Route im Demo-Build ohne Fehlerseite | `ci.yml` |
| Doku | `zensical build --strict`, jede Seite mit `description`, Demo unter `/demo/` | `docs.yml` |

Agent, Server und E2E laufen nur, wenn ein Pull Request (oder ein Push auf `main`) ihre Dateien ändert; das entscheidet der Job `changes` in `ci.yml`. Die Tests des Agenten laufen auf vier Runnern nebeneinander. Nicht am Pull Request: der Release-Kandidat in einer Incus-VM (Job `release-kandidat`) läuft nur auf einem Tag nach „Bump version“ oder von Hand (**Actions → CI → Run workflow**).

## Issues schreiben { #issues-schreiben }

Ein Issue behandelt ein Thema und passt auf ein bis zwei Bildschirme. Fragen gehören in die Discussions, bestätigte Fehler und konkrete Wünsche in Issues; sie kommen ins Board. Größere Vorhaben und Issues von Agenten gliedern sich in **Anlass**, **Stand** (auf dem aktuellen `main` geprüft, mit Links), **Vorschlag** (mit Grenzen), **Akzeptanzkriterien** (drei bis sechs prüfbare Punkte als `- [ ]`) und **Bezug** (verwandte Issues, Quellen). Agenten legen Issues nur auf Anweisung an; die Schritte stehen im Skill `issue-schreiben`.

Labels: der Typ (`fehler`, `wunsch`, `frage`, `technik`, `doku`) und `einstieg` für Kleines und Abgegrenztes.

## Beiträge annehmen { #beitraege-annehmen }

Bevor ein Pull Request ins [Review](#review) geht, egal von wem, beantwortet jemand, der ihn nicht geschrieben hat, vier Fragen, jede mit Beleg (Stelle im Diff, Satz aus der Quelle, Regel):

1. **Wollen wir das?** Es passt zum Projekt, hat ein Issue (sonst entscheidet der Maintainer zuerst), und der Nutzen ist größer als die dauerhafte Last jeder Einstellung, Abhängigkeit und jedes Sonderfalls.
2. **Nach den Quellen gebaut und richtig?** Jedes Detail, das eine Quelle entscheidet (Norm, Format, Referenzimplementierung), steht mit Quelle im Kommentar. Wer prüft, liest die Quelle selbst und rechnet einen typischen und einen Randfall gegen die Tests nach.
3. **Die einfachste und beste Lösung?** Jeder Teil des Diffs dient einem Akzeptanzkriterium oder ist Aufräumen; keine Abstraktion mit einem Nutzer, keine Einstellung auf Vorrat. Ersetzt ein Umbau einen Weg, fällt der alte weg, außer ein benannter Grund spricht dagegen. Befund ist das nur mit konkret benanntem besseren Weg.
4. **Nach unseren Regeln?** Diese Seite und die [Konventionen](entwicklung.md#konventionen) des Projekts.

**Selbstprüfung:** Beitragende beantworten die vier Fragen vor „Ready for review“ selbst (Skill `beitrag-pruefen`), in einem frischen Agenten oder durch jemand anderen, und posten das Ergebnis als Kommentar. Danach bringen sie auch das unabhängige Review mit. Bei Beitragenden ohne Schreibrecht prüfen wir erst, wenn beides vorliegt. Alle offenen Pull Requests nacheinander arbeitet der Skill `prs-abarbeiten` ab.

## Review { #review }

Jeder Pull Request mit Code bekommt vor dem Merge ein unabhängiges **TDD-Review** (Skill `tdd-review`), jeder mit Markdown eine **Doku-Prüfung** (Skill `doku-pruefen`); bei beidem laufen beide nebeneinander.

1. **Unabhängig:** Wer den Code geschrieben hat, reviewt ihn nicht. Ein Agent, der mitgeschrieben hat, startet einen neuen ohne diesen Verlauf.
2. **Nur mit rotem Test:** Nur ein Test, der auf dem Stand des Pull Requests fehlschlägt, ist ein Befund. Stil und Namen sind keiner.
3. **Red → Green:** Test und Fix als eigene Commits auf den Branch des Pull Requests. Keine Tests abschwächen, keine Commits von Beitragenden umschreiben.
4. **Grün:** Lokal gezielt, die volle Suite in der CI. Einen Job neu starten nur bei einem erkannten Fehler der Infrastruktur, höchstens einmal.

Projekt: Für die Pull Requests des [Agenten-Loops](#agenten-loop) ist das unabhängige Review nur bei einer **sicherheitsrelevanten** Änderung Pflicht, alles andere mergt der Loop, sobald die CI grün ist (`BAULISTE.md`, Schritte 5 und 6). Sicherheitsrelevant ist, was der Agent ausführen darf (Manifeste, Signaturen, Aufträge, argv), Anmeldung, Rollen und Rechte, Geheimnisse und Schlüssel, die Trennung der Betreiber (`betreiber_id`), das Audit-Log, die Verbindung des Agenten und seine Zertifikate, die Pforte und die Trennung der Netze sowie `install.sh`. Die Pfade dazu stehen unter `heikel` in `.github/werkbank.json`.

### Runden { #runden }

Eine; eine zweite nur, wenn die erste Fixes am Code gebracht hat. Höchstens vier, und weitere nur nach einem schweren Befund.

### Doku-Prüfung { #doku-pruefung }

Für Markdown gibt es keinen roten Test: Ein Befund braucht ein Zitat und den Beleg dagegen (Code, Quelle, andere Stelle). Geprüft wird, ob es stimmt, kurz ist und jede Regel nur an einem Ort steht.

### Wer mergt was { #wer-mergt-was }

| Änderung | Gemergt wird |
| --- | --- |
| Alles nach Review bei grüner CI | per Squash vom Maintainer oder, mit dessen Zustimmung, von einem Collaborator |
| Fachlich heikel (`heikel` in `.github/werkbank.json`) | erst nach einem „OK“ des Maintainers auf eine kurze Zusammenfassung mit Quelle |
| Projekt: ein Punkt der Bauliste aus dem Agenten-Loop | per Squash vom Loop selbst bei grüner CI; sicherheitsrelevant erst, wenn das unabhängige Review keine offenen Befunde mehr hat |
| Ohne Issue, grundsätzliche Entscheidung, Ablehnen | entscheidet der Maintainer zuerst |
| Release | nur nach ausdrücklichem „OK“ des Maintainers (Skill `release`) |
| Reparatur eines roten `main` | direkt auf `main`, vom Maintainer oder auf seine Anweisung: nur was den Check wieder grün macht, kein Test abgeschwächt |
| Rote CI durch den Pull Request, Code ohne TDD-Review, Markdown ohne Doku-Prüfung | nicht |

## Sicherheitslücken { #sicherheitsluecken }

Bitte nicht als Issue, sondern privat melden: [SECURITY.md](https://github.com/Speicherstadt/steuerzentrale/blob/main/SECURITY.md).
