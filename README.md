# Steuerzentrale

Installiert, aktualisiert, sichert und überwacht die Apps der Speicherstadt auf eigenen Servern,
auf einem Server je Kunde oder beim Kunden. Eine Zentrale mit Oberfläche, ein Agent auf jedem
Server, der sich selbst verbindet und nur ausführt, was das Manifest einer App beschreibt.

**Oberfläche:** nur für Betreiber (Kunden sehen das Portal). Übersicht mit allem, was Aufmerksamkeit
braucht, Server, Installationen, Updates in Wellen, Backups, Aufträge, Kunden, Support-Zugänge,
Leistungen, die Apps mit ihren Manifesten, Ereignisse, Audit-Log und Einstellungen; hell und dunkel, auf
Deutsch und Englisch, auch auf dem Handy. Kunden mit Ansprechperson und Vertrag (SLA, Vertragsende)
legt der Betreiber an, ändert und kündigt sie, jedes Mal mit Grund im Audit-Log
([Kunden und Verträge](docs/kunden.md)). Was noch keine API hat, zeigt Demodaten mit den acht Apps der
Speicherstadt (`bun run dev:demo`).

**Anmeldung:** mit Passkey oder mit Passwort und Authenticator-App (TOTP); ohne zweiten Faktor erreicht
ein Konto nur dessen Einrichtung. Den ersten Inhaber legt ein Einrichtungscode aus dem Log der Zentrale
an, weitere Personen kommen per Einladungslink mit den Rollen Inhaber, Technik oder Support
([Anmeldung](docs/anmeldung.md)).

**Server hinzufügen:** die Oberfläche zeigt einen Befehl mit Einmal-Token (24 Stunden, einmal nutzbar);
`install.sh` richtet auf Debian 13 oder Ubuntu 24.04 Podman, unattended-upgrades und den signierten Agenten
als systemd-Dienst ein, und der Agent tauscht das Token gegen sein Client-Zertifikat
([Server hinzufügen](docs/server-hinzufuegen.md)).

**Stand:** in Planung. Plan und Bauliste: [`docs/plan.md`](docs/plan.md), [`BAULISTE.md`](BAULISTE.md).

Lizenz: AGPL-3.0 ([`NOTICE`](NOTICE)). Beiträge mit Developer Certificate of Origin (`git commit -s`), kein CLA;
wie ein Beitrag aussieht, steht unter [Mitwirken](docs/mitwirken.md). Sicherheitslücken bitte privat melden
([`SECURITY.md`](SECURITY.md)).
