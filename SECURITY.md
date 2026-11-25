# Sicherheit

## Unterstützte Versionen

Sicherheitsfixes gibt es nur für das neueste Release von Zentrale und Agent. Bitte vor einer Meldung auf die neueste
Version aktualisieren.

| Version | Unterstützt |
| --- | --- |
| [neuestes Release](https://github.com/Speicherstadt/steuerzentrale/releases/latest) | ja |
| ältere Releases | nein |

## Eine Lücke melden

Bitte **kein öffentliches Issue** für ein Sicherheitsproblem. Melde es privat über GitHub:
[Security › Report a vulnerability](https://github.com/Speicherstadt/steuerzentrale/security/advisories/new).

Eine gute Meldung nennt die Version, den betroffenen Teil (Zentrale, Agent, `install.sh`, Manifest), wie sich das
Problem nachstellen lässt und was ein Angreifer damit erreicht. Keine echten Tokens, Zertifikate, Schlüssel oder
Kundendaten mitschicken. Wir bestätigen die Meldung, arbeiten den Fix in einem privaten Security Advisory aus und
veröffentlichen es mit dem Release, das ihn behebt.

Die Steuerzentrale ist dafür gebaut, dass auch eine übernommene Zentrale keinen fremden Code auf die verwalteten
Server bringt (docs/plan.md, Sicherheit). Besonders wichtig sind deshalb:

- Wege, den Agenten etwas ausführen zu lassen, das kein signiertes Manifest beschreibt;
- alles, womit ein Server, ein Agent-Zertifikat oder ein API-Token an Daten eines anderen Kunden oder Betreibers kommt;
- Geheimnisse im Klartext in Datenbank, Log, API-Antwort oder Oberfläche;
- Lücken in Anmeldung, zweitem Faktor, Rollen und Audit-Log;
- `install.sh` und Agent-Updates ohne Prüfung von Prüfsumme und Signatur.

Probleme in Podman, Caddy, restic, Bun oder anderen eingebundenen Programmen gehören zu diesen Projekten; macht erst die
Art, wie die Steuerzentrale sie einsetzt, sie ausnutzbar, bitte hier melden.

## Abhängigkeiten aktuell halten

Die Abhängigkeiten hält [Renovate](https://github.com/apps/renovate) aktuell, mit den gemeinsamen Einstellungen aus
[firsttris/workflows](https://github.com/firsttris/workflows/blob/main/renovate/default.json5). Jedes Update kommt als
Pull Request und läuft durch die ganze CI; die Pakete, die Signaturen prüfen (`@noble/*`), und Bun mergen nie von
selbst. CI und Images installieren mit `bun install --frozen-lockfile` genau die Versionen aus `bun.lock`. Neue
Laufzeit-Abhängigkeiten brauchen einen Eintrag mit Begründung in `allowed-dependencies.json`.
