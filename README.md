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
([Server hinzufügen](docs/server-hinzufuegen.md)). Danach hält der Agent eine WSS-Verbindung mit
Heartbeat alle 30 Sekunden; jeder Server zeigt „verbunden“, „seit x min still“ oder „getrennt“, nach
3 Minuten Stille entsteht ein Ereignis, und ein Zertifikat rotiert vor Ablauf von selbst und lässt
sich sofort sperren. Der Agent meldet die Fakten seines Servers (CPU, RAM, Platten, OS, Kernel,
„Neustart nötig“, ausstehende Updates, Podman, Adressen, PTR, Ports, Port 25, Uhrzeit) alle 15
Minuten, die Server-Seiten zeigen sie, und jede SSH-Anmeldung wird ein Ereignis.

**Apps installieren:** im Dialog „App installieren“ (Installationen oder Kundenseite) wählt der
Betreiber Kunde und Server, lädt das signierte Manifest mit seiner `.minisig` hoch, wählt die Optionen,
füllt die Einstellungen der Installation aus dem Manifest aus und gibt Adresse und Grund an; die
Platzierung zeigt bei jeder Änderung, ob die App passt, mit jedem Grund. Die Installationen-Seiten
zeigen die Installationen der Zentrale mit Zustand und Aufträgen; eine gescheiterte Einrichtung lässt
sich mit Grund entfernen ([Apps installieren](docs/installieren.md)).

**Einstellungen:** die Einstellungen jeder App entstehen als Formular aus ihrem Manifest. Unter
Einstellungen → Apps pflegt der Betreiber seine Werte je App; ein Geheimnis erscheint nur als
„gesetzt“, ein leeres geheimes Feld behält den Wert. Fehlt beim Installieren ein Pflichtwert des
Betreibers, fragt der Dialog ihn ab. Eine laufende Installation bekommt neue Werte mit
„Einstellungen ändern“ und Grund: der Agent konfiguriert sie neu, nie in einer Sperrzeit, und die
Werte gelten erst nach seinem Erfolg ([Einstellungen](docs/einstellungen.md)).

**Neustart, Log-Auszug, nur lesen:** die Seite einer laufenden Installation zeigt die Aktionen, die
ihr Manifest anbietet, jede mit Grund im Audit-Log. Ein Neustart wartet auf offene Aufträge und läuft
nie in einer Sperrzeit; ein Log-Auszug zeigt die letzten 500 Zeilen aus journald mit ersetzten
Werten der Geheimnisse, auch für Support ([Neustart, Log-Auszug, nur lesen](docs/aktionen.md)).

**Health und Zustand:** der Agent meldet alle 30 Sekunden Units und Health jeder Installation; die
Zentrale bewertet sie grün, gelb, rot oder unbekannt, immer mit Grund (ohne Meldung seit 90 Sekunden
unbekannt, nie grün), hält jeden Wechsel im Verlauf und meldet nach 5 Minuten Rot eine Störung. Liste
und Seite einer Installation zeigen Zustand, Grund und Verlauf ([Health und Zustand](docs/zustand.md)).

**Stand:** in Planung. Plan und Bauliste: [`docs/plan.md`](docs/plan.md), [`BAULISTE.md`](BAULISTE.md).

Lizenz: AGPL-3.0 ([`NOTICE`](NOTICE)). Beiträge mit Developer Certificate of Origin (`git commit -s`), kein CLA;
wie ein Beitrag aussieht, steht unter [Mitwirken](docs/mitwirken.md). Sicherheitslücken bitte privat melden
([`SECURITY.md`](SECURITY.md)).
