<div align="center">

<h1>Deine Apps. Deine Server. Eine Zentrale.</h1>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/uebersicht-dunkel.webp">
  <img src="docs/assets/screenshots/uebersicht-hell.webp" alt="Übersicht der Steuerzentrale: „5 Dinge brauchen dich“, vier Kacheln zu Servern, Apps, Update-Welle und Backups, links was zu tun ist mit seinen Knöpfen, rechts was die Zentrale als Nächstes tut und was sie von selbst erledigt hat" width="900">
</picture>

**Open-Source-Betrieb für die Apps der Speicherstadt: installieren, aktualisieren, sichern und überwachen, auf deinen eigenen Servern.**

Für IT-Dienstleister und Hoster, die Haben, Belegt, Kontext, Schreibzeug, Stellwerk, Fixpunkt, Kennwort und Soll für
sich oder ihre Kunden betreiben: auf gemeinsamen Servern, auf einem Server je Kunde oder beim Kunden im Haus.

![Status: In Entwicklung](https://img.shields.io/badge/Status-In%20Entwicklung-red)
[![CI](https://github.com/Speicherstadt/steuerzentrale/actions/workflows/ci.yml/badge.svg)](https://github.com/Speicherstadt/steuerzentrale/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Speicherstadt/steuerzentrale?logo=github&label=release&include_prereleases)](https://github.com/Speicherstadt/steuerzentrale/releases)
[![Lizenz: AGPL-3.0](https://img.shields.io/badge/Lizenz-AGPL--3.0-blue)](LICENSE)
[![Doku](https://img.shields.io/badge/Doku-online-4f46e5?logo=zensical&logoColor=white)](https://speicherstadt.org/steuerzentrale/)
[![Demo](https://img.shields.io/badge/Demo-im%20Browser-1f6f5c)](https://speicherstadt.org/steuerzentrale/demo/)
[![Podman](https://img.shields.io/badge/Podman-Quadlets%2C%20rootless-892ca0?logo=podman&logoColor=white)](https://speicherstadt.org/steuerzentrale/installation.html)
[![Docker Pulls](https://img.shields.io/docker/pulls/tristanteu/steuerzentrale?logo=docker&logoColor=white)](https://hub.docker.com/r/tristanteu/steuerzentrale)

[Warum?](#warum-die-steuerzentrale) •
[Funktionen](#funktionen) •
[Demo](https://speicherstadt.org/steuerzentrale/demo/) •
[Schnellstart](#schnellstart) •
[FAQ](#faq) •
[Dokumentation](https://speicherstadt.org/steuerzentrale/) •
[Entwicklung](#entwicklung)

<sub>English: self-hosted operations for the open-source apps of Speicherstadt. One control plane with a web UI, one agent per server that connects out by itself and only runs what an app's signed manifest describes: installs, update waves with rollback, restic backups with test restores, health and external checks, customers, contracts and usage reports. The interface comes in German and English; the documentation is in German.</sub>

</div>

> [!WARNING]
> **In Entwicklung:** zum Ausprobieren, noch nicht für den Echtbetrieb. Stufe 1 (eigener Betrieb) ist fertig gebaut und
> läuft in der CI auf echten VMs durch. Vor jedem Update der Zentrale ein Backup machen
> ([Zentrale sichern](https://speicherstadt.org/steuerzentrale/zentrale-sichern.html)); Apps aktualisiert sie ohnehin nur mit Backup davor.

## Warum die Steuerzentrale?

**Wer Apps für andere betreibt, soll nicht jeden Server von Hand pflegen müssen, und auch nicht alles einem fremden Dienst geben.** 🇩🇪 🇪🇺

Die Apps der Speicherstadt laufen auf deinem Server. Sobald es mehr als einer ist, wird das Drumherum zur Arbeit:
Updates zur richtigen Zeit, Backups, die sich auch zurückspielen lassen, Zertifikate, volle Platten, Kunden mit
Verträgen. Die Steuerzentrale macht das an einer Stelle, ohne dass ein Server einen Port für sie öffnet.

- **Nur was das Manifest beschreibt:** der Agent führt keine Shell und keinen freien Befehl aus, nur die Aktionen
  aus dem signierten Manifest einer App; ein Image nur per Digest
- **Der Agent verbindet sich selbst:** ausgehende WSS-Verbindung mit Client-Zertifikat, kein offener Port am Server,
  auch beim Kunden hinter dessen Firewall
- **Updates in Wellen, mit Rückweg:** erst die eigenen Installationen, dann alle; vor jedem Update ein Backup,
  nie in einer Sperrzeit der App, bei roter Health zurück auf die alte Version
- **Backups, die geprüft sind:** restic je Installation auf dein S3-Ziel, mit regelmäßigem Prüf-Restore auf einer Kopie
- **Rootless und getrennt:** jede Installation unter eigenem Linux-Nutzer mit eigenem Netz, Podman Quadlets unter
  systemd, Caddy als Pforte davor
- **Nichts ist eingebaut:** die Zentrale kennt keine App, nur Manifeste; eine neue App braucht keinen neuen Code

## Funktionen

Kurz je Bereich; die Details stehen auf der verlinkten Seite der [Dokumentation](https://speicherstadt.org/steuerzentrale/).

| Bereich | Was die Steuerzentrale kann |
|---|---|
| 🧭 [Übersicht](https://speicherstadt.org/steuerzentrale/uebersicht.html) | Beantwortet „Brauche ich gerade etwas zu tun?“: das Urteil als Überschrift, vier Kacheln, „Zu tun“ mit einer Zeile je App oder Server und ihren Knöpfen (Log ansehen, Neustart, App oder Server öffnen), „Als Nächstes“ (Updates, Neustarts, Sperrzeiten, Zertifikate, Vertragsenden) und „Von selbst erledigt“ seit gestern Abend |
| 🗂️ [Navigation](https://speicherstadt.org/steuerzentrale/uebersicht.html#navigation) | Acht Einträge in zwei Gruppen: Betrieb (Übersicht, Apps, Server, Kunden, Updates) und Verwaltung (Katalog, Protokoll, Einstellungen); laufende Apps heißen Apps, die Manifeste Katalog, Ereignisse, Aufträge und Änderungen stehen im Protokoll; die Einstellungen in Abschnitten mit je einer Zeile, die Werte einer App unter Titeln in Worten |
| 🔌 [Server hinzufügen](https://speicherstadt.org/steuerzentrale/server-hinzufuegen.html) | Ein Befehl mit Einmal-Token; `install.sh` richtet auf Debian 13 oder Ubuntu 24.04 Podman, unattended-upgrades und den signierten Agenten ein; Zertifikat rotiert selbst, sofort sperrbar |
| 📦 [Apps installieren](https://speicherstadt.org/steuerzentrale/installieren.html) | Dialog mit Kunde, Server, App und Version aus dem Katalog und Adresse; Platzierung nach Platz und Art des Servers; Einstellungen als Formular aus dem Manifest, Geheimnisse als Podman-Secrets |
| 🧩 [Apps](https://speicherstadt.org/steuerzentrale/installieren.html#die-seite-apps) | Eine Tabelle mit Zustand in Worten, Version, letztem Backup und Server, was dich braucht zuerst; je App Überblick, Messwerte, Backups, Einstellungen, Verlauf und Technik |
| 📜 [Katalog, Manifeste und Versionen](https://speicherstadt.org/steuerzentrale/manifeste.html) | Der Katalog zeigt die Apps, wie ihre Manifeste sie beschreiben, mit neuen Versionen aus den Registries; signierte Manifeste je App und Version, geprüft mit minisign; was ein Manifest nicht nennt, läuft nicht |
| 🖥️ [Server](https://speicherstadt.org/steuerzentrale/uebersicht.html#server-und-kundenseite) | Eine Tabelle mit Zustand in Worten, Platte, Apps und System, was dich braucht zuerst; je Server Überblick, Auslastung (die Platte über 30 Tage), Apps, Verlauf und Technik |
| 🔄 [Updates](https://speicherstadt.org/steuerzentrale/updates.html) | Wellen „intern“ und „alle“, Wartungsfenster je Server, Sperrzeiten je App, Backup davor, Rückkehr bei roter Health; [Agent](https://speicherstadt.org/steuerzentrale/agent-updates.html) und [Betriebssystem](https://speicherstadt.org/steuerzentrale/betriebssystem.html) mit Neustart im Fenster |
| 💾 [Backups](https://speicherstadt.org/steuerzentrale/backups.html) | restic je Installation auf das S3-Ziel des Betreibers, Prüf-Restore, Wiederherstellen mit Grund; die [Zentrale selbst](https://speicherstadt.org/steuerzentrale/zentrale-sichern.html) getrennt von ihrem Schlüssel |
| 🩺 [Health und Zustand](https://speicherstadt.org/steuerzentrale/zustand.html) | Units und Health alle 30 Sekunden, grün, gelb, rot oder unbekannt, immer mit Grund; nie grün ohne frische Meldung |
| 🌐 [Prüfung von außen](https://speicherstadt.org/steuerzentrale/aussen.html) · [DNS](https://speicherstadt.org/steuerzentrale/dns.html) | DNS, Zertifikat, Pforte und Health über den öffentlichen Namen, unabhängig vom Agenten; Verfügbarkeit je Monat und je Tag der letzten 90 Tage; DNS-Einträge über die Cloudflare-API |
| 🔍 [Prüfungen der Server](https://speicherstadt.org/steuerzentrale/pruefungen.html) | Platte, Zertifikate, Backup-Alter, offene Ports, die kein Manifest nennt, Uhrzeit; SSH-Anmeldungen als Ereignis |
| 🔔 [Benachrichtigungen](https://speicherstadt.org/steuerzentrale/benachrichtigungen.html) | Mail über dein SMTP und signierte Webhooks, eine Nachricht je Störung und eine zur Behebung, Ruhezeit |
| ⚙️ [Aktionen](https://speicherstadt.org/steuerzentrale/aktionen.html) · [Einstellungen](https://speicherstadt.org/steuerzentrale/einstellungen.html) | Neustart, Log-Auszug, nur lesen, Einstellungen ändern, jeweils mit Grund im Audit-Log und nie in einer Sperrzeit |
| 👥 [Kunden und Verträge](https://speicherstadt.org/steuerzentrale/kunden.html) | Ansprechperson, Vertragsbeginn und -ende; je Kunde Überblick und Verlauf; nach der Kündigung letztes Backup, Archiv-Link für den Kunden und Löschung mit Protokoll |
| 🏠 [Nur für mich oder für Kunden](https://speicherstadt.org/steuerzentrale/anmeldung.html#nur-fur-mich-oder-fur-kunden) | Einmal nach der Einrichtung gewählt, später vom Inhaber mit Grund geändert; „Nur für mich“ blendet Kunden und Verträge aus |
| 🔐 [Anmeldung und Rollen](https://speicherstadt.org/steuerzentrale/anmeldung.html) | Passkey oder Passwort mit TOTP, Rollen Inhaber, Technik, Support; Oberfläche nur über WireGuard |
| 🛡️ [Sicherheit](https://speicherstadt.org/steuerzentrale/sicherheit.html) | Bedrohungsmodell mit Test je Bedrohung, Notzugang per SSH, TOMs nach Art. 32 DSGVO |
| 📐 [Manifest für App-Entwickler](https://speicherstadt.org/steuerzentrale/manifest.html) | Ein Schema für Units, Volumes, Secrets, Health, Backup, Aktionen und Einstellungen einer App |

## Screenshots

<table>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/apps-dunkel.webp"><img src="docs/assets/screenshots/apps-hell.webp" alt="Tabelle der Apps mit Kunde, Zustand in Worten, Version, letztem Backup und Server, Filter „Alle“, „Braucht dich“ und „Update möglich“"></picture><br><sub><b>Apps</b>: jede laufende App in einer Tabelle, was dich braucht zuerst</sub></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/app-dunkel.webp"><img src="docs/assets/screenshots/app-hell.webp" alt="Seite einer App mit Zustand und Adresse im Kopf, „Öffnen“, „Neustart“ und „Mehr …“, den Reitern Überblick bis Technik und den Zeilen Erreichbar, Version, Backup, Verfügbarkeit und Server"></picture><br><sub><b>App</b>: Erreichbarkeit, Version, Backup, Verfügbarkeit und Server im Überblick, alles Weitere in Reitern</sub></td>
  </tr>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/server-dunkel.webp"><img src="docs/assets/screenshots/server-hell.webp" alt="Tabelle der Server mit Art und Zustand in Worten, CPU, RAM, Platte, Apps und System"></picture><br><sub><b>Server</b>: gemeinsam, eigen oder beim Kunden, mit Zustand in Worten und voller Platte zuerst</sub></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/server-detail-dunkel.webp"><img src="docs/assets/screenshots/server-detail-hell.webp" alt="Seite eines Servers mit den Reitern Überblick, Auslastung, Apps, Verlauf und Technik und den Zeilen Auslastung, Betriebssystem, Wartungsfenster, Prüfungen und Agent"></picture><br><sub><b>Ein Server</b>: Auslastung, Betriebssystem, Wartungsfenster, Prüfungen und Agent</sub></td>
  </tr>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/kunden-dunkel.webp"><img src="docs/assets/screenshots/kunden-hell.webp" alt="Tabelle der Kunden mit Apps, Server und Vertrag"></picture><br><sub><b>Kunden</b>: Vertrag, Apps und Server je Kunde</sub></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/katalog-dunkel.webp"><img src="docs/assets/screenshots/katalog-hell.webp" alt="Katalog mit einer Kachel je App: Version, wie oft sie läuft, neue Version oder fehlendes Manifest, „Installieren“"></picture><br><sub><b>Katalog</b>: die Apps, wie ihre Manifeste sie beschreiben, mit neuen Versionen</sub></td>
  </tr>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/updates-dunkel.webp"><img src="docs/assets/screenshots/updates-hell.webp" alt="Updates als Tabelle je App mit installierter und neuer Version und dem Stand jeder Installation in der Welle"></picture><br><sub><b>Updates</b>: in Wellen, mit Backup davor und Rückweg</sub></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/backups-dunkel.webp"><img src="docs/assets/screenshots/backups-hell.webp" alt="Backups mit letztem Lauf, Snapshots und Prüf-Restore je Installation"></picture><br><sub><b>Backups</b>: restic je Installation, mit Prüf-Restore</sub></td>
  </tr>
</table>

Alles zum Durchklicken, mit Beispieldaten und ohne Server: die **[Demo](https://speicherstadt.org/steuerzentrale/demo/)**.

## Schnellstart

Die Steuerzentrale läuft als ein Container (`tristanteu/steuerzentrale` oder `ghcr.io/speicherstadt/steuerzentrale`,
amd64 und arm64) rootless unter Podman, mit Caddy als Pforte davor. Du brauchst einen Server mit Debian 13 oder
Ubuntu 24.04, zwei DNS-Namen (Oberfläche und `agent.`) und WireGuard, denn die Oberfläche antwortet nur im VPN.

### 1. Von einem Agenten aufsetzen lassen

Gib Claude Code oder einem anderen Coding-Agenten dieses Repository und SSH-Zugang zu deinem Server und sag:
„Setz die Steuerzentrale auf meinem Server auf, nach der [Installationsanleitung](https://speicherstadt.org/steuerzentrale/installation.html).“

### 2. Manuell

Die [Installation](https://speicherstadt.org/steuerzentrale/installation.html) geht Schritt für Schritt durch: Release-Dateien laden und gegen die
Signatur prüfen, die Zentrale als Quadlet unter eigenem Nutzer starten, die Pforte davorsetzen, den ersten Inhaber
mit dem Einrichtungscode aus dem Log anlegen und den Agenten desselben Servers beitreten lassen. Genau diese
Schritte geht die CI mit jedem Release-Kandidaten in einer VM durch.

Danach in der Oberfläche: [Server hinzufügen](https://speicherstadt.org/steuerzentrale/server-hinzufuegen.html), im Katalog das Manifest einer App importieren,
[App installieren](https://speicherstadt.org/steuerzentrale/installieren.html).

> [!IMPORTANT]
> Sichere `STEUERZENTRALE_SECRET_KEY` an einem zweiten Ort, getrennt vom Backup der Datenbank. Ohne ihn sind die
> Geheimnisse aller Installationen nach einer Wiederherstellung nicht mehr lesbar
> ([Zentrale sichern](https://speicherstadt.org/steuerzentrale/zentrale-sichern.html)).

## FAQ

<details>
<summary><b>Was kostet die Steuerzentrale?</b></summary>

Die Software ist kostenlos (AGPL). Du brauchst einen Server für die Zentrale und die Server für deine Apps; die
Zentrale kann auch auf einem Server laufen, der selbst Apps betreibt.
</details>

<details>
<summary><b>Für wen ist das?</b></summary>

Für alle, die mehr als eine Installation der Speicherstadt-Apps betreuen: IT-Dienstleister und Hoster mit Kunden,
aber auch eine Firma mit mehreren Standorten. Wer die Apps nur für sich betreibt, wählt nach der Einrichtung „Nur für
mich“: dann gibt es keine Kunden und Verträge. Für eine einzelne App auf einem Server reicht deren
eigene Anleitung.
</details>

<details>
<summary><b>Läuft auch eine App, die nicht aus der Speicherstadt kommt?</b></summary>

Technisch braucht die Zentrale nur ein Manifest ([Manifest](https://speicherstadt.org/steuerzentrale/manifest.html)), keine App ist eingebaut. Ein
Manifest muss aber mit dem Schlüssel des Betreibers signiert sein, und die Werte darin stammen aus den Quellen der App.
</details>

<details>
<summary><b>Muss ich beim Kunden einen Port öffnen?</b></summary>

Nein. Der Agent verbindet sich von sich aus zur Zentrale (`agent.<domain>`, mTLS). Am Server sind nur 80 und 443
für die Apps selbst offen.
</details>

<details>
<summary><b>Was darf die Zentrale auf meinem Server?</b></summary>

Nur die Aktionen, die das signierte Manifest einer App beschreibt, mit festen Argumenten: kein Shell-Befehl, kein
freies `podman exec`, kein Image ohne Digest. Eine übernommene Zentrale mit einem fremden Manifest bringt keinen Code
auf einen Server; das prüft ein Test ([Sicherheit](https://speicherstadt.org/steuerzentrale/sicherheit.html)).
</details>

<details>
<summary><b>Docker oder Podman?</b></summary>

Podman, rootless, mit Quadlets unter systemd. Jede Installation bekommt einen eigenen Linux-Nutzer, ein eigenes Netz
und eigene Volumes; das Image der Zentrale gibt es trotzdem auch auf Docker Hub.
</details>

<details>
<summary><b>Wird die Steuerzentrale mit KI entwickelt?</b></summary>

Ja, mit Coding-Agenten in einem festen Ablauf: ein Punkt der [Bauliste](BAULISTE.md) je Pull Request, Tests zuerst,
für Sicherheitsrelevantes ein unabhängiges Review, das nur meldet, was ein fehlschlagender Test belegt. Wie das
abläuft, steht unter [Mitwirken](https://speicherstadt.org/steuerzentrale/mitwirken.html).
</details>

## Dokumentation

Alles im Detail, mit Suche: **https://speicherstadt.org/steuerzentrale/**. Jede Funktion oben verlinkt ihre Seite; dazu kommen:

- **Einstieg:** [Installation](https://speicherstadt.org/steuerzentrale/installation.html), [Server hinzufügen](https://speicherstadt.org/steuerzentrale/server-hinzufuegen.html),
  [Apps installieren](https://speicherstadt.org/steuerzentrale/installieren.html)
- **Hintergrund:** [Projektplan](https://speicherstadt.org/steuerzentrale/plan.html) (Architektur, Entscheidungen, Datenmodell), [Pforte](https://speicherstadt.org/steuerzentrale/pforte.html),
  [Aufträge](https://speicherstadt.org/steuerzentrale/auftraege.html), [Release](https://speicherstadt.org/steuerzentrale/release.html)

## Entwicklung

[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white)](https://bun.sh)
[![Solid](https://img.shields.io/badge/Solid-2.0-2c4f7c?logo=solid&logoColor=white)](https://www.solidjs.com)
[![TanStack](https://img.shields.io/badge/TanStack-Router-ff4154?logo=reactquery&logoColor=white)](https://tanstack.com/router)
[![Hono](https://img.shields.io/badge/Hono-e36002?logo=hono&logoColor=white)](https://hono.dev)
[![Vite](https://img.shields.io/badge/Vite-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![SQLite](https://img.shields.io/badge/SQLite-Drizzle-003b57?logo=sqlite&logoColor=white)](https://orm.drizzle.team)

Voraussetzungen: Bun in der Version aus `packageManager` in `package.json` und Git. Für die Tests des Agenten
Podman mit systemd; die CI hat beides.

```sh
bun install
bun run dev:demo          # Oberfläche mit Beispieldaten, ohne Zentrale: http://localhost:5181
bun run dev:zentrale      # Zentrale auf Port 18300
bun run dev:web           # Oberfläche auf Port 5181
bun run check             # Typen, Lint, Tests, Build
bun run e2e               # Playwright gegen Zentrale und Oberfläche
```

Aufbau und Entscheidungen stehen im [Projektplan](https://speicherstadt.org/steuerzentrale/plan.html), alles Weitere unter [Mitwirken](https://speicherstadt.org/steuerzentrale/mitwirken.html).

| Paket | Inhalt |
|---|---|
| `apps/zentrale` | Hono-Server: API, Datenbank (SQLite mit Drizzle), Aufträge, Prüfungen, Verbindung zu den Agenten |
| `apps/web` | Oberfläche (Solid 2, TanStack Router), Demo mit Beispieldaten |
| `apps/agent` | Agent für jeden Server, mit `bun build --compile` zu einem Binary |
| `packages/manifest` | Schema der Manifeste, Platzierung, Quadlet-Units, Podman-Secrets und Caddy-Snippets, ohne I/O |
| `packages/planung` | Update-Wellen, Sperrzeiten, Wartungsfenster, Prüfungen der Server, ohne I/O |
| `packages/protokoll` | Nachrichten zwischen Zentrale und Agent, versioniert |
| `packages/ui` | Bausteine der Oberfläche, Texte auf Deutsch und Englisch (Paraglide) |
| `install/install.sh` | Richtet einen Server ein und lässt den Agenten beitreten |

## Mehr von uns

Die Apps, die die Steuerzentrale betreibt, und weitere Open-Source-Apps für deinen eigenen Server: **[speicherstadt.org](https://speicherstadt.org)**

## Mitwirken

Fehler und Ideen gern als Issue. Was vor einem Pull Request laufen muss und was er enthält, steht unter
[Mitwirken](https://speicherstadt.org/steuerzentrale/mitwirken.html); Beiträge mit Developer Certificate of Origin (`git commit -s`), kein CLA.
Sicherheitslücken bitte vertraulich melden, wie in [SECURITY.md](SECURITY.md) beschrieben.

## Sterne im Verlauf

<a href="https://www.star-history.com/#Speicherstadt/steuerzentrale&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Speicherstadt/steuerzentrale&type=Date&theme=dark">
    <img alt="Verlauf der GitHub-Sterne der Steuerzentrale" src="https://api.star-history.com/svg?repos=Speicherstadt/steuerzentrale&type=Date">
  </picture>
</a>

---

<div align="center">

⭐ **Gefällt dir die Steuerzentrale?** Ein [Stern auf GitHub](https://github.com/Speicherstadt/steuerzentrale) hilft anderen, sie zu finden.

[Fehler melden](https://github.com/Speicherstadt/steuerzentrale/issues/new) &nbsp;·&nbsp; [Demo](https://speicherstadt.org/steuerzentrale/demo/) &nbsp;·&nbsp; [Dokumentation](https://speicherstadt.org/steuerzentrale/)

<sub>Lizenz: <a href="LICENSE">AGPL-3.0</a> · © Tristan Teufel und Mitwirkende<br>
Wer eine veränderte Fassung der Steuerzentrale für andere übers Netz betreibt, muss ihnen den Quellcode anbieten (§ 13 AGPL).<br>
Cloudflare, Docker und GitHub sind Marken ihrer Inhaber; die Steuerzentrale steht mit diesen Unternehmen nicht in Verbindung.</sub>

</div>
