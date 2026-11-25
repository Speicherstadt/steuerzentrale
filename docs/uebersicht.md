---
title: Übersicht und Betrieb
description: >-
  Was die Übersicht zeigt (zu tun, als Nächstes, von selbst erledigt) und wohin jeder Eintrag führt, wie Aufträge, Ereignisse und
  das Audit-Log seitenweise aus der Zentrale kommen, wer was lesen darf und was die Oberfläche
  angemeldet zeigt, solange ein späterer Punkt eine Seite noch nicht mit Daten füllt.
---

# Übersicht und Betrieb

Angemeldet liest die Oberfläche alles aus der Zentrale: Übersicht, Apps, Server, Kunden, Updates,
Katalog, Protokoll und Einstellungen. Die Demodaten zeigt nur `bun run dev:demo` (und die
Screenshots); sie antworten dort wie die Zentrale.

## Navigation

Die Seitenleiste hat acht Einträge in zwei Gruppen:

| Gruppe | Eintrag | Was dort steht |
| --- | --- | --- |
| Betrieb | Übersicht | ob dich etwas braucht: was zu tun ist, was die Zentrale als Nächstes tut und was sie erledigt hat; der Zähler nennt die Zeilen von „Zu tun“ |
| Betrieb | Apps | jede laufende App (eine Installation) mit Kunde, Zustand, Version, letztem Backup und Server; je App eine Seite mit Reitern ([Apps installieren](installieren.md#die-seite-einer-app)); die Seite **Backups** aller Apps über „Alle Backups“ im Reiter „Backups“ einer App |
| Betrieb | Server | die Server mit Art, Zustand, Platte, Apps und System; je Server eine Seite mit Reitern ([unten](#server-und-kundenseite)) |
| Betrieb | Kunden | Kunden und Verträge, je Kunde eine Seite mit den Reitern Überblick und Verlauf |
| Betrieb | Updates | neue Versionen je App, darunter die Sperrzeiten der Apps; der Zähler nennt die Apps mit einer neueren Version |
| Verwaltung | Katalog | die Apps der Speicherstadt, wie ihre Manifeste sie beschreiben: woher die Apps kommen; Manifest importieren, nach neuen Versionen suchen ([Katalog, Manifeste und Versionen](manifeste.md)) |
| Verwaltung | Protokoll | Reiter „Ereignisse“, „Aufträge“ und „Änderungen“ (das Audit-Log) |
| Verwaltung | Einstellungen | Abschnitte Betriebsart, Werte für Apps, Backup-Ziel, Adressen und DNS, Benachrichtigungen, Konten, Steuerzentrale, Darstellung ([Einstellungen](einstellungen.md#die-seite-einstellungen)) |

Unten in der Seitenleiste stehen das eigene Konto mit Rolle (ein Klick führt zu Einstellungen →
Konten) und die Version der Zentrale. Die Kopfzeile nennt den Bereich und auf einer Seite darunter
die App, den Server oder den Kunden („Server › Studio Lind“). Eigene Einträge für Sperrzeiten,
Backups, Ereignisse, Aufträge oder das Audit-Log gibt es nicht mehr.

Der Reiter des Protokolls steht in der Adresse (`/protokoll?tab=auftraege`); unter den Reitern
stehen gleich die Filter (Ereignisse nach Schwere, Aufträge nach Zustand) und die Liste.
„Änderungen“ sehen beide Rollen. Bei „Nur für mich“ fehlt „Kunden“.
Alte Adressen führen weiter: `/installationen` und `/installationen/<id>` zu `/apps`,
`/ereignisse`, `/auftraege` und `/audit` zum passenden Reiter des Protokolls.

## Übersicht

Die Übersicht beantwortet eine Frage: **Brauche ich gerade etwas zu tun?** Ihre Überschrift ist die
Antwort, „5 Dinge brauchen dich“ oder „Alles läuft“, darunter „Alles andere läuft. Stand: heute
10:42“.

Darunter vier Kacheln:

| Kachel | Zahl | Zeilen |
| --- | --- | --- |
| Server | wie viele; ein Feld je Server, gelb oder rot, wenn sein Agent still oder getrennt ist; „4/5 verbunden“ | nach Art („2 gemeinsam, 2 eigen, 1 beim Kunden“), wie viele sich nicht melden |
| Apps | wie viele; ein Balken mit den Anteilen grün, gelb, rot, ohne Zustand; „12 grün“ | „1 gelb, 2 rot, 1 ohne Zustand“, wie viele davon gekündigt sind |
| Update | die laufende Welle („Update: Belegt 0.0.7“, „1/3“ mit Ring): Apps auf ihrer Version unter denen, die ein Plan hält oder deren Update läuft; läuft keine, wie viele Updates möglich sind | wie viele fertig, wie viele Updates außerdem möglich sind ([Updates](updates.md)) |
| Backups heute Nacht | Apps mit gelungenem Lauf seit gestern 18 Uhr unter denen mit Teilen zum Sichern; ein Feld je App, rot bei gescheitertem Lauf, gelb, wenn der letzte gelungene älter ist | die gescheiterten mit Namen, gescheiterte Prüf-Restores ([Backups](backups.md)) |

Bei „Nur für mich“ nennt keine Kachel einen Kunden: Server nach „gemeinsam“ und „eigen“, statt der
gekündigten Apps die Zahl der verschiedenen Apps, die gescheiterten Backups nur mit dem Namen der
App.

Links **Zu tun**: was die Zentrale nicht selbst lösen kann, das Dringendste zuerst. Jede Zeile ist ein
Ding, eine App oder ein Server, mit Symbol (Störung oder Warnung), einem Titel in Worten („Schreibzeug
bei IT Berger ist gestört“, „Platte auf Server „Studio Lind“ zu 91 % voll“), einer Zeile mit Grund
und Zeit und ihren Knöpfen. Ein stiller oder getrennter Agent und eine volle Platte sind die Ursache
dessen, was die Apps auf dem Server melden: das steht in der Zeile des Servers („dazu: …“), nicht
in eigenen Zeilen. Jede andere Prüfung eines Servers ist es nicht, ihre Apps behalten ihre Zeilen.
Was eine App sonst betrifft (ein gescheiterter Neustart einer gestörten App), steht in ihrer Zeile,
ohne dass „dazu“ es noch einmal nennt: es sagt nur, warum sie gestört ist.
Die Zahl neben „Übersicht“ in der Seitenleiste ist die Zahl dieser Zeilen.

| Zeile | Knöpfe |
| --- | --- |
| App gestört oder rot | „Log ansehen“ und „Neustart“, je mit Grund, für beide Rollen ([Aktionen](aktionen.md)); sonst „App öffnen“ |
| andere Zeile einer App (gelb, Prüf-Restore, gescheiterte Einrichtung, gescheiterter Auftrag) | „App öffnen“ |
| Server (Agent, Prüfung, Auftrag ohne App) | „Server öffnen“ |
| beobachteter Dienst ([Prüfung von außen](aussen.md#beobachtete-dienste)) | „Dienste öffnen“, zur Seite Apps |
| Ereignis ohne App oder Server | „Im Protokoll“ |

Eine Zeile nur aus Hinweisen (ohne Zustand, Prüf-Restore überfällig) wartet: sie steht unten unter
**Ohne Eile** und zählt nicht, ebenso neue Tags der Registries, deren Manifest im Katalog fehlt
(„Haben 0.13.0 und Kontext 0.1.40 sind erschienen, im Katalog fehlen die Manifeste. Zum Katalog“).
Ist nichts zu tun, steht dort eine ruhige Zeile.

Rechts **Als Nächstes**, nach Zeit: was die Zentrale in den nächsten 7 Tagen von selbst tut, und
Fristen bis 30 Tage voraus. Alles kommt aus dem, was die API schon liefert; was keine Quelle hat,
steht nicht da.

| Eintrag | Quelle | Zeitraum |
| --- | --- | --- |
| Update einer App in einer Welle („Update: Belegt 0.0.7 bei Schreinerei Holm“, mit Backup davor) | Plan je Installation, `GET /api/v1/updates` | 7 Tage |
| Neustart eines Servers im Wartungsfenster (neuer Kernel oder wartende Pakete) | Plan des Neustarts, `GET /api/v1/server`; nur einer, der nur auf seine Zeit wartet | 7 Tage |
| Sperrzeit einer App, die läuft, beginnt („7.–12.12.“) | `sperrzeiten` des Manifests | 7 Tage |
| Zertifikat läuft ab, gelb unter 14 Tagen | Zertifikate der Pforte in den Fakten des Servers | 30 Tage |
| Vertrag eines Kunden endet, die Löschung 90 Tage danach | Vertragsende der Kunden ([Kündigung](kunden.md#kundigung)); nicht bei „Nur für mich“ | 30 Tage |

Darunter **Von selbst erledigt** seit gestern 18 Uhr (Berliner Zeit): gelungene Backups und
Prüf-Restores, durch eine Welle eingespielte Updates, Neustarts der Server nach Plan und die
Server, auf denen unattended-upgrades lief; erneuerte Zertifikate nicht, weil die Pforte sie
erneuert, ohne dass es jemand meldet. „Zum Protokoll“ führt zu allem, was geschah. Ereignisse und
Aufträge stehen nicht mehr in der Übersicht, sondern im Protokoll.

Die Ordnung, die 7 Tage und die Berliner Zeit sind reine Funktionen mit Tests
(`apps/web/src/daten/zu-tun.ts`, `als-naechstes.ts`, `von-selbst.ts`, `kennzahlen.ts`;
`sperrzeitBeginne` und `gesternAbend` in `packages/planung`).

### Was die Zentrale liefert

Was „Zu tun“ zeigt, liefert die Zentrale unter `GET /api/v1/uebersicht`, das Schwerste zuerst. Jeder
Eintrag führt zu seiner Ursache und nennt bei einer App den Server, auf dem sie läuft (`serverId`).

| Eintrag | Schwere | führt zu |
| --- | --- | --- |
| offene Störung einer Installation (5 Minuten rot, siehe [Health und Zustand](zustand.md)) | Störung | Installation |
| Installation rot | Störung | Installation |
| offene Störung eines beobachteten Dienstes (5 Minuten außen rot, siehe [Prüfung von außen](aussen.md#beobachtete-dienste)) | Störung | Dienst |
| beobachteter Dienst außen rot | Warnung | Dienst |
| beobachteter Dienst ohne Prüfung seit 3 Minuten | Hinweis | Dienst |
| Agent getrennt | Störung | Server |
| Prüfung eines Servers rot (Platte über 90 %, Zertifikat abgelaufen, siehe [Prüfungen der Server](pruefungen.md)) | Störung | Server |
| Installation gelb | Warnung | Installation |
| Agent still (ab 75 s ohne Heartbeat) | Warnung | Server |
| Prüfung eines Servers gelb (Platte über 80 %, Zertifikat in 14 Tagen, Backup älter als 26 h, ein Port in keinem Manifest, Uhrzeit) | Warnung | Server |
| Prüf-Restore gescheitert (der neueste) | Warnung | Installation |
| Auftrag gescheitert in den letzten 7 Tagen (außer einem Prüf-Restore, der seinen eigenen Eintrag hat) | Warnung | Aufträge |
| Ereignis `fehler` oder `warn` der letzten 24 Stunden | Störung bzw. Warnung | Installation oder Server des Ereignisses, sonst Ereignisse |
| Installation ohne Zustand (unbekannt) | Hinweis | Installation |
| kein Prüf-Restore seit über 8 Tagen (ohne jeden ab dem ersten gelungenen Backup) | Hinweis | Installation |

Innerhalb einer Schwere stehen Störungen vor Installationen, beobachteten Diensten, Agenten, Prüfungen der Server,
Prüf-Restores, Aufträgen und Ereignissen,
und jeweils das Neueste zuerst. Es zählen nur Installationen, die laufen (eine, die eingerichtet
wird oder deren Einrichtung scheiterte, steht als Auftrag da), und nur Server, deren Agent beigetreten
und nicht gesperrt ist. Ein Ereignis, dessen Installation oder Server schon einen Eintrag hat, steht
nicht noch einmal da; das Ereignis `stoerung` selbst auch nicht, weil die offene Störung ihr
eigener Eintrag ist. Von gescheiterten Aufträgen und Ereignissen nimmt die Übersicht höchstens die
neuesten 100; alle stehen im Protokoll.

## Aufträge, Ereignisse, Audit-Log

Die drei Listen, im Protokoll die Reiter „Aufträge“, „Ereignisse“ und „Änderungen“, kommen seitenweise, die neuesten zuerst; „Mehr laden“ holt die nächste Seite.

| Route | Filter | sortiert nach |
| --- | --- | --- |
| `GET /api/v1/auftraege` | `zustand`, `serverId`, `installationId` | Anlage, dann ID |
| `GET /api/v1/ereignisse` | `schwere`, `art`, `ziel` | Zeitpunkt, dann ID |
| `GET /api/v1/audit` | `akteur`, `aktion`, `ziel` | Nummer des Eintrags |

Jeder Filter lässt sich wiederholen (`?zustand=wartend&zustand=laeuft`). `anzahl` ist die Größe einer
Seite (1 bis 200, Vorgabe 50), `weiter` die Marke, die die Seite davor als `weiter` mitbrachte; ohne
weitere Seite ist sie `null`. Die Marke nennt die letzte Zeile der Seite, nicht eine Zahl übersprungener
Zeilen: kommen zwischen zwei Seiten neue Zeilen hinzu, sind sie neuer als die Marke und verschieben
nichts, jede Zeile kommt genau einmal. Eine Marke, die die Zentrale nicht ausgegeben hat, lehnt sie
mit `400` ab.

Ein Auftrag kommt mit Server, Kunde und Adresse seiner Installation und, wenn er scheiterte, mit dem
Grund; nie mit dem Text oder der Signatur des Manifests und nie mit den Argumenten (dort stehen die
Einstellungen einer Einrichtung). Ein Ereignis und ein Eintrag des Audit-Logs nennen ihr Ziel
(`installation:<id>`, `server:<id>`, im Audit-Log die Tabelle, etwa `installationen:<id>`) und, wo es
eine Seite hat, deren Namen. Ein Eintrag des Audit-Logs nennt, wer handelte: eine Person mit Namen,
den Agenten eines Servers oder die Zentrale selbst (`system`, `einrichtungscode`, `einladung`).

Den Inhalt eines Eintrags zeigt die Zentrale, wie das Audit-Log ihn speichert, und filtert ihn beim
Lesen noch einmal: Text und Signatur eines Manifests, die Zeilen eines Log-Auszugs und der Hash
eines Tokens stehen als „[ausgelassen]“ da, ein verschlüsselter Wert als „[verschlüsselt]“, jeder
Text über 1000 Zeichen als „[ausgelassen]“.

## Wer was liest

| Route | Inhaber | Mitglied |
| --- | --- | --- |
| Übersicht, Aufträge, Ereignisse | ja | ja |
| Audit-Log | ja | ja |

Jede Route liest nur die Daten des eigenen Betreibers; eine ID eines anderen Betreibers ist
unbekannt, auch als Filter.

## Server- und Kundenseite

Die Seite **Server** ist eine Tabelle: Name mit der Art in Worten („für mehrere Kunden“, „eigener
Server eines Kunden“, „steht beim Kunden“), Zustand in Worten mit Symbol („Platte fast voll“,
„meldet sich nicht, zuletzt vor 6 Min.“, „Neustart nötig, geplant morgen 03:30“, „verbunden“),
Platte, Apps („4 Apps · 2 Kunden“) und System; eine volle Platte, ein stiller Agent und ein nötiger
Neustart zuerst. Spalten für CPU und RAM gibt es nur, wenn etwas sie gemessen hat; der Agent meldet
sie noch nicht, nur die Demo hat Werte. In „Nur für mich“ nennt die Tabelle weder Art noch Kunden.

Die Seite eines Servers hat im Kopf Name und Art, den Zustand in einem Satz, die erste IPv4 und das
System, daneben **Neu starten** ([Betriebssystem und Neustarts](betriebssystem.md)). Die Reiter
stehen in der Adresse (`?tab=`):

| Reiter | Inhalt |
| --- | --- |
| Überblick | Auslastung (Platte aus den Fakten), Betriebssystem, Wartungsfenster, Prüfungen und Agent mit Zertifikat je in einer Zeile; die ersten vier Apps mit Zustand und „Zuletzt passiert“ |
| Auslastung | wie voll jede Platte war, 24 Stunden, 7 oder 30 Tage, auf einer Skala von 0 bis 100 % (`GET /api/v1/server/<id>/platten`); CPU und Arbeitsspeicher, sobald der Agent sie meldet |
| Apps | die Apps darauf als Tabelle wie auf der Seite „Apps“ |
| Verlauf | die Ereignisse des Servers und seiner Apps |
| Technik | System und Netz aus den Fakten mit dem Zertifikat des Agenten, die Karte „Wartung“, alle Prüfungen und (nur in der Demo) die Pakete, die auf einen Neustart warten |

Die Seite eines Kunden beschreibt [Kunden und Verträge](kunden.md#die-seite-eines-kunden). Beide
nehmen die Installationen aus `GET /api/v1/installationen`.

## Was noch kommt

Angemeldet zeigt keine Seite ein Datum der Demo. Wo die Zentrale noch keine Daten hat, sagt die Seite,
mit welchem Punkt sie kommen:

| Seite oder Teil | kommt mit |
| --- | --- |
| CPU und Arbeitsspeicher eines Servers, Pakete mit Namen; die Platte zeigt der Reiter „Auslastung“, das Betriebssystem seit Z-701 die Karte „Wartung“ | Z-1106 |

Name, Symbol und Kurztext der Apps (Katalog) stehen in `apps/web/src/demo/apps.ts`; alles
Technische (Version, Container, Ports, Health, Backup, Sperrzeiten, Einstellungen) liest die Demo aus
den echten Manifesten in `manifeste/`. Die Demo zeigt nur Apps mit einem veröffentlichten Release. Unter Einstellungen → Konten stehen die
Mitglieder des Betreibers mit Rolle, die Seitenleiste nennt Betreiber und eigenes Konto aus
`GET /api/v1/ich`.
