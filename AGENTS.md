# Hinweise für Coding-Agenten

Steuerzentrale: installiert, aktualisiert, sichert und überwacht die Apps der Speicherstadt (Haben, Belegt, Kontext,
Schreibzeug, Stellwerk, Fixpunkt, Kennwort, Soll) auf den eigenen Servern des Betreibers. Eine Zentrale (API und
Oberfläche) und ein Agent auf jedem verwalteten Server, der sich von dort zu ihr verbindet und nur die Aktionen
ausführt, die das Manifest einer App beschreibt. Keine App ist eingebaut: Die Zentrale kennt nur Manifeste. Open
Source (AGPL), Beiträge unter dem DCO.

Die Regeln stehen einmal, in [`docs/mitwirken.md`](docs/mitwirken.md) (Beitragen) und
[`docs/entwicklung.md`](docs/entwicklung.md) (Bauen), auf Deutsch, für Menschen und Agenten. Diese Datei sagt, wo was
steht und was nie passieren darf. Sie gilt für jeden Agenten; `CLAUDE.md` verweist nur hierher. Vor dem Start die
Abschnitte lesen, die die Änderung berühren.

## Wo was steht

| Was | Wo |
| --- | --- |
| Was als Nächstes gebaut wird, Akzeptanzkriterien, wie der Loop arbeitet | `BAULISTE.md` |
| Warum: Ziele, Architektur, die Apps, Manifest, Entscheidungen, Stack, Datenmodell, Sicherheit, Tests | `docs/plan.md` |
| Aussehen und Verhalten der Oberfläche | `DESIGN.md`, das Mockup in `design/mockup/` (den Bildschirm lesen, bevor er gebaut wird) |
| Das Manifest jeder App und die Quelle jedes Werts | `manifeste/<app>/` |
| Umgebung, Befehle, Konventionen, Besonderheiten, Quellen | `docs/entwicklung.md` |
| Pull Request, Review, wer mergt, was CI und PR-Regeln prüfen | `docs/mitwirken.md` |
| Laufzeit-Pakete, die ein Workspace nutzen darf, mit Grund | `allowed-dependencies.json` |

Die Doku liegt in `docs/`, nur auf Deutsch. Links in README und Doku zeigen auf die Website
(<https://speicherstadt.org/steuerzentrale/>), nicht auf `docs/*.md`.

Der Agenten-Loop arbeitet `BAULISTE.md` ab, wie sie es unter „So arbeitet der Loop“ beschreibt; dort steht auch,
wann er selbst mergt und dass er nie auf einen Menschen wartet.

## Skills

Die Schritte für wiederkehrende Aufgaben stehen in [`.agents/skills`](.agents/skills); jeder Agent folgt denselben
Dateien. Aus der [Werkbank](https://github.com/Speicherstadt/werkbank) (gleich in allen Projekten, Änderungen dort):
`beitrag` (Branch, Commits, Pull Request als Entwurf, dann Selbstprüfung und Review), `beitrag-pruefen` (gewollt,
Quellen, einfachste Lösung, Regeln), `doku-pruefen` (Review des Markdowns), `design-pruefen` (Oberfläche gegen `DESIGN.md`, Screenshots und Barrierefreiheit prüfen), `fork-pushen` (Push auf den Fork einer
anderen Person), `prs-abarbeiten` (alle offenen Pull Requests, vom einfachsten Merge an), `issue-schreiben`,
`board-pflegen` (das Board auf GitHub), `release`, `fehler-eingrenzen` (Ursache eines Fehlers über eine rote
Prüfung finden) und `vorhaben-klaeren` (einen Plan vor dem Bauen mit der Person durchfragen).
Aus diesem Projekt: `checks` (alle Prüfungen, auch Agent gegen Podman, E2E und Doku), `solid-2` (vor jeder Arbeit an
Solid-Code) und `tdd-review` (unabhängiges Review, ein Befund braucht einen fehlschlagenden Test; die eigene Fassung
der Steuerzentrale statt der aus der Werkbank).

## Nie

- Den Agenten etwas ausführen lassen, das das Manifest einer App nicht beschreibt, oder ein Manifest ohne gültige
  Signatur: keine Shell, kein freies `podman exec`, kein Befehl als String, kein Image ohne Digest.
- Den echten Signierschlüssel der Manifeste auf die Zentrale, einen Server oder in die CI legen (die CI signiert nur
  mit dem öffentlichen Test-Schlüssel in `test/schluessel/`, den Release-Builds ablehnen); einem Server ein DNS-Token
  oder den Backup-Schlüssel einer Installation geben, die nicht auf ihm läuft.
- Auf einem verwalteten Server einen Port für den Agenten öffnen; der Agent verbindet sich immer nach außen.
- Ein Geheimnis außerhalb einer verschlüsselten Spalte speichern, über die API zurückgeben oder in ein Log schreiben
  (einzige Ausnahme: der einmalige Einrichtungscode für den ersten Inhaber, `docs/plan.md`, „Anmeldung“).
- Eine App fest einbauen: kein `if (app === "haben")`; was sich unterscheidet, gehört ins Schema des Manifests.
- In der Sperrzeit einer App (`sperrzeiten`) aktualisieren oder neu starten, oder ohne Backup vorher.
- Die Daten eines Kunden vor Ende der Kündigungsfrist oder ohne Backup löschen.
- Aus dem Loop ein anderes Repository der Speicherstadt ändern; die Apps sind Quellen zum Lesen.
- Tests auf einen echten Server oder echte Kundendaten richten; einen Test oder ein Gate überspringen, abschwächen
  oder löschen, um grün zu werden; einen übersprungenen Test als bestanden melden.
- Eine Laufzeit-Abhängigkeit ohne Eintrag mit Grund in `allowed-dependencies.json` hinzufügen, mit einer Version, die
  nicht exakt ist oder außerhalb von `major` des Eintrags liegt, oder ein Paket aus dessen `forbidden`-Liste
  (`bun add` mit Version: `docs/entwicklung.md`, Abhängigkeiten). Jede neue Abhängigkeit erst nach dem Versuch mit
  eigenem Code und mit dem Grund je Paket unter „## Neue Abhängigkeiten“ im Pull Request.
- Auf `main` pushen (Ausnahme: Reparatur eines roten `main` durch oder auf Anweisung des Maintainers), Commits von
  Beitragenden umschreiben, eigenen Code reviewen. Mergen nur der Maintainer, ein Collaborator mit dessen Zustimmung
  oder der Loop nach `BAULISTE.md`; eine sicherheitsrelevante Änderung nie ohne das unabhängige Review
  (`docs/mitwirken.md`, Review).
- Issues und Pull Requests ohne Auftrag anlegen oder kommentieren.
- Prozesse oder Container der Nutzerin oder des Nutzers stoppen; `sudo` umgehen. Befehle als root (`sudo`, `pkexec`)
  auf ihrem Rechner führen sie selbst aus; in Workflows der CI ist `sudo` erlaubt (Linux-Nutzer, Lingering, Incus).

## Bei jeder Änderung

Mitziehen, was die Änderung berührt, im selben Pull Request, und nur das:

- die Tests: Vitest neben dem Code, Datenbank-Tests neben dem Modul, Tests des Agenten gegen Podman mit systemd in
  der CI, Playwright für das, was ein Nutzer tut (Desktop und `@phone`); ein Bugfix beginnt mit einem fehlschlagenden
  Test;
- die Doku in `docs/`, die es beschreibt, kurz und für Menschen; `docs/manifest.md` bei jeder Änderung am Schema;
- `README.md`, wenn eine Funktion, die Nutzer sehen, dazukommt, sich ändert oder wegfällt;
- die Texte in `messages/de.json` und `messages/en.json`;
- die Demodaten in `apps/web/src/demo/`, wenn sich die API ändert;
- nach einer Änderung am Aussehen die Screenshots: **Actions → Update screenshots → Run workflow**, dann die neuen
  Bilder ansehen.

Dazu: jede berührte Datei sauberer hinterlassen, ohne das Verhalten zu ändern, und unter „Aufgeräumt“ nennen; Issues
mit `Umgesetzt #…` oder `Refs #…`, nie `Closes`/`Fixes`; Prüfungen grün vor jedem Push (Skill `checks`),
übersprungene nennen, danach die CI prüfen; die Beschreibung des Pull Requests wird die Squash-Nachricht und wird bei
jedem Push nachgezogen, der etwas daran ändert. Das unabhängige Review durch einen eigenen Agenten (`tdd-review` für
Code, `doku-pruefen` für Markdown) nach `docs/mitwirken.md`, Review.

## Arbeitsweise

- Sprache: Code, Kommentare und Commits auf Englisch; `README.md` und die Doku auf Deutsch; die Oberfläche über
  Paraglide mit `messages/de.json` und `messages/en.json`.
- Funktional, keine Klassen; Clean Code, Technik und die Grenzen für Dateien und Funktionen nach
  `docs/entwicklung.md`, Konventionen. Dort stehen auch die Besonderheiten (Manifest, Aufträge, Quadlets, Pforte,
  Betreiber, Geheimnisse, Zeiten); vor einer Änderung daran lesen.
- Details stützen sich auf die Quellen, nicht auf das Gedächtnis (`docs/entwicklung.md`, Quellen): Repositories flach
  (`git clone --depth 1`) in ein temporäres Verzeichnis klonen und die Quelle in Kommentaren, Tests, `QUELLEN.md` und
  Commit-Nachrichten nennen, wo sie ein Detail entscheidet.
- Die Oberfläche ist Solid 2.0, dessen API sich stark von 1.x unterscheidet: vor jeder Arbeit an Solid-Code den Skill
  `solid-2` laden.
- Für Tests andere Ports und eigene Nutzer und Unit-Namen (`sz-test-*`) nehmen; die Ports stehen im Skill `checks`.
- Fremde, nicht committete Änderungen gehören jemand anderem (oft einem anderen Agenten): beim eigenen Umfang bleiben.
