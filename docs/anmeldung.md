---
title: Anmeldung und Rollen
description: >-
  Wie Betreiber sich an der Steuerzentrale anmelden: erster Inhaber mit dem Einrichtungscode,
  Passkey oder Passwort mit Authenticator-App, Einladungen per Link, Rollen Inhaber, Technik und
  Support.
---

# Anmeldung und Rollen

Wer die Zentrale hat, hat alle Kunden. Deshalb braucht jedes Konto einen zweiten Faktor, und jede
Route der Zentrale prüft die Rolle dessen, der sie aufruft. Kunden melden sich nie an der Zentrale
an; ihren Zustand sehen sie im Portal.

## Erster Inhaber

Startet die Zentrale, ohne dass jemand Mitglied eines Betreibers ist, schreibt sie einmal einen
**Einrichtungscode** in ihr Log:

```json
{"msg":"setup code for the first owner","code":"…","gueltigBis":"…","url":"https://zentrale.example.de/erster-inhaber"}
```

Der Code ist das einzige Geheimnis, das je im Log steht. Er gilt 24 Stunden und nur einmal; in der
Datenbank steht nur sein SHA-256. Auf der Seite **Zentrale einrichten** (`/erster-inhaber`) legt man
damit den Betreiber und seinen ersten Inhaber an: Name des Betreibers, Name, E-Mail-Adresse und
wahlweise ein Passwort. Danach geht es direkt zur Einrichtung des zweiten Faktors.

### Nur für mich oder für Kunden

Nach dem zweiten Faktor fragt die Zentrale den Inhaber einmal, wofür sie da ist (Seite
`/betriebsart`):

- **Nur für mich**: eigene Apps auf eigenen Servern. Kunden, Verträge, Kündigung, Support-Zugänge
  und Leistungen verschwinden aus Seitenleiste (der Eintrag „Kunden“), Übersicht und Dialogen; „App installieren“ fragt keinen
  Kunden. Alle Installationen gehören einem festen internen Kunden des Betreibers, den die Zentrale
  dabei anlegt (`kunden.intern`), also gibt es nur eine Welle.
- **Für Kunden**: Hosting für andere, mit allem, was dazugehört.

Solange die Frage offen ist, führt jede Seite der Oberfläche den Inhaber wieder dorthin; andere
Rollen können sie nicht beantworten und sehen die Oberfläche wie „Für Kunden“. Die erste Antwort
braucht keinen Grund (im Audit-Log steht „Erste Einrichtung“). Ändern lässt sie sich später nur vom
Inhaber unter [Einstellungen](einstellungen.md#betriebsart), mit Grund. Betreiber aus der Zeit vor
dieser Frage gelten als „Für Kunden“.

Ist der Code abgelaufen, erzeugt ein Neustart der Zentrale einen neuen; ältere Codes gelten dann
nicht mehr. Sobald es einen Inhaber gibt, schreibt die Zentrale keinen Code mehr und nimmt auch keinen
mehr an.

## Zweiter Faktor

| Anmeldung | Was dazugehört |
| --- | --- |
| Passkey | genügt allein (Fingerabdruck, Gesicht, Sicherheitsschlüssel) |
| Passwort | nur zusammen mit dem Code einer Authenticator-App (TOTP) |

Ein Konto ohne zweiten Faktor erreicht nur die Seite **Zweiter Faktor** (`/einrichtung`) und in der
API nur `GET /api/v1/einrichtung`; jede andere Route antwortet `403 zweiter_faktor_fehlt`. Hat ein
Konto ein Passwort, gehört die Authenticator-App dazu, und einen Passkey legt es erst danach an: sonst
käme man mit dem Passwort allein hinein, oder wer es kannte, hätte sich vorher einen Passkey angelegt.
Sitzungen, die nur mit dem Passwort angemeldet wurden, enden, sobald die App bestätigt ist. Die App verbindet man mit dem QR-Code oder dem angezeigten Schlüssel;
dabei erscheinen einmal zehn Ersatzcodes für den Fall, dass das Telefon fehlt. Ein Gerät als
„vertrauenswürdig“ zu merken, das den Code beim nächsten Mal überspringt, gibt es nicht.

Eine Sitzung gilt zwölf Stunden und verlängert sich, solange sie genutzt wird. Anmeldeversuche sind
begrenzt: fünf je Minute und Adresse für das Passwort und für den Code, zehn für Passkeys. Die
Adresse kommt von der Pforte (`X-Forwarded-For` nur von `127.0.0.1`), nie aus einem Header, den der
Browser selbst schickt.

## Einladungen

Der Inhaber lädt weitere Personen mit einer Rolle ein und bekommt einen Link
`https://zentrale.example.de/einladung#…`. Der Teil nach `#` ist der Schlüssel: er erreicht weder ein
Server-Log noch einen Referer, in der Datenbank steht nur sein SHA-256. Ein Link gilt sieben Tage und
einmal; offene Einladungen lassen sich zurückziehen. Wird ein Mitglied entfernt oder verliert es das
Recht einzuladen, ziehen sich seine offenen Einladungen von selbst zurück. Wer ihn öffnet, legt ein Konto an (Name,
E-Mail-Adresse, wahlweise Passwort) und richtet danach den zweiten Faktor ein.

## Rollen

| Recht | Inhaber | Technik | Support |
| --- | --- | --- | --- |
| Betreiber und eigenes Konto sehen | ja | ja | ja |
| Mitglieder sehen | ja | ja | ja |
| einladen, Rollen ändern, Mitglieder entfernen | ja | – | – |
| Kunden und Verträge sehen | ja | ja | ja |
| Kunden anlegen, ändern, kündigen | ja | ja | – |
| Kunden als intern markieren | ja | – | – |
| Apps, Versionen und Manifeste sehen | ja | ja | ja |
| Manifest importieren, nach neuen Versionen suchen | ja | ja | – |
| Server hinzufügen | ja | ja | – |
| Installationen und Platzierung sehen | ja | ja | ja |
| Installationen anlegen, gescheiterte entfernen | ja | ja | – |
| „nur lesen“ einer Installation | ja | ja | – |
| Neustart, Log-Auszug anfordern und lesen | ja | ja | nur mit Support-Zugang |
| Support-Zugänge sehen, eigenen starten und beenden | ja | ja | ja |
| fremden Support-Zugang beenden | ja | ja | – |
| Übersicht, Aufträge und Ereignisse sehen | ja | ja | ja |
| Audit-Log lesen | ja | ja | – |
| Backups und S3-Ziel sehen | ja | ja | ja |
| S3-Ziel setzen, „Backup jetzt“ | ja | ja | – |

Die Rollen sind die Zugriffssteuerung des Organization-Plugins von Better Auth; jeder Betreiber ist
dort eine Organisation mit derselben ID. Ein Betreiber behält immer einen Inhaber: der letzte kann
seine Rolle nicht abgeben und nicht entfernt werden. Wer entfernt wird, verliert den Zugang sofort.
Ein [Support-Zugang](support.md) gilt für eine Installation, ist zeitlich begrenzt und steht mit
Grund im Audit-Log und in den Ereignissen des Kunden.
Technik legt Kunden an und pflegt ihre Verträge, weil eine Installation von ihnen ausgeht; Support
sieht sie nur ([Kunden und Verträge](kunden.md)).

Jede Mitgliedschaft, jede Rolle und jede Einladung steht im Audit-Log, mit dem, der sie angelegt
oder geändert hat.

## API

| Route | Wer |
| --- | --- |
| `GET`, `POST /api/v1/erster-inhaber` | alle (der Einrichtungscode ist der Schlüssel) |
| `POST /api/v1/einladung/ansehen`, `…/annehmen` | alle (der Token im Körper ist der Schlüssel) |
| `GET /api/v1/einrichtung` | jede Sitzung, auch ohne zweiten Faktor |
| `PUT /api/v1/betriebsart` | Inhaber |
| `GET /api/v1/ich`, `GET /api/v1/mitglieder` | alle Rollen |
| `PATCH`, `DELETE /api/v1/mitglieder/:nutzerId` | Inhaber |
| `GET`, `POST /api/v1/einladungen`, `DELETE …/:einladungId` | Inhaber |
| `GET /api/v1/kunden`, `GET …/:kundeId` | alle Rollen ([Kunden und Verträge](kunden.md)) |
| `POST /api/v1/kunden`, `PUT …/:kundeId`, `PUT`, `DELETE …/:kundeId/kuendigung` | Inhaber, Technik |
| `PUT /api/v1/kunden/:kundeId/intern` | Inhaber |
| `GET /api/v1/apps`, `GET /api/v1/manifeste/:app/:version`, `GET /api/v1/updates` | alle Rollen ([Katalog, Manifeste und Versionen](manifeste.md)) |
| `POST /api/v1/manifeste`, `POST /api/v1/versionen/abfragen` | Inhaber, Technik |
| `GET /api/v1/installationen`, `GET …/:installationId`, `POST …/platzierung` | alle Rollen ([Apps installieren](installieren.md)) |
| `POST /api/v1/installationen`, `DELETE …/:installationId` | Inhaber, Technik |

Von Better Auth unter `/api/auth` sind nur Anmeldung (`sign-in/email`, Passkey, TOTP, Ersatzcode),
Abmelden, die Sitzung und das Einrichten von Passkey und TOTP erreichbar; Registrieren, die Routen der
Organisationen und das Abschalten von TOTP antworten `404`.
