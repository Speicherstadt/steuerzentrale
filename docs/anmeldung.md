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
Konto ein Passwort, gehört die Authenticator-App dazu, auch wenn es schon Passkeys hat: sonst käme man
mit dem Passwort allein hinein. Die App verbindet man mit dem QR-Code oder dem angezeigten Schlüssel;
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
einmal; offene Einladungen lassen sich zurückziehen. Wer ihn öffnet, legt ein Konto an (Name,
E-Mail-Adresse, wahlweise Passwort) und richtet danach den zweiten Faktor ein.

## Rollen

| Recht | Inhaber | Technik | Support |
| --- | --- | --- | --- |
| Betreiber und eigenes Konto sehen | ja | ja | ja |
| Mitglieder sehen | ja | ja | ja |
| einladen, Rollen ändern, Mitglieder entfernen | ja | – | – |

Die Rollen sind die Zugriffssteuerung des Organization-Plugins von Better Auth; jeder Betreiber ist
dort eine Organisation mit derselben ID. Ein Betreiber behält immer einen Inhaber: der letzte kann
seine Rolle nicht abgeben und nicht entfernt werden. Wer entfernt wird, verliert den Zugang sofort.
Weitere Rechte (Server, Installationen, Support-Zugänge) kommen mit ihren Punkten der Bauliste.

Jede Mitgliedschaft, jede Rolle und jede Einladung steht im Audit-Log, mit dem, der sie angelegt
oder geändert hat.

## API

| Route | Wer |
| --- | --- |
| `GET`, `POST /api/v1/erster-inhaber` | alle (der Einrichtungscode ist der Schlüssel) |
| `POST /api/v1/einladung/ansehen`, `…/annehmen` | alle (der Token im Körper ist der Schlüssel) |
| `GET /api/v1/einrichtung` | jede Sitzung, auch ohne zweiten Faktor |
| `GET /api/v1/ich`, `GET /api/v1/mitglieder` | alle Rollen |
| `PATCH`, `DELETE /api/v1/mitglieder/:nutzerId` | Inhaber |
| `GET`, `POST /api/v1/einladungen`, `DELETE …/:einladungId` | Inhaber |

Von Better Auth unter `/api/auth` sind nur Anmeldung (`sign-in/email`, Passkey, TOTP, Ersatzcode),
Abmelden, die Sitzung und das Einrichten von Passkey und TOTP erreichbar; Registrieren, die Routen der
Organisationen und das Abschalten von TOTP antworten `404`.
