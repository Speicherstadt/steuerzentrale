---
title: Benachrichtigungen und Webhooks
description: >-
  Wie die Steuerzentrale Ereignisse nach Schwere per Mail und als signierten Webhook meldet, eine
  Nachricht je Störung statt je Prüfung, mit Ruhezeit, Wiederholung und einer Signatur, die der
  Empfänger prüft.
---

# Benachrichtigungen und Webhooks

Was in der Zentrale passiert, steht als Ereignis unter „Ereignisse“: eine Störung einer Installation
und ihre Behebung, ein Befund einer Prüfung, ein stiller Agent, ein gescheitertes Backup oder Update.
Die Zentrale meldet diese Ereignisse an die Empfänger des Betreibers, per Mail oder als Webhook.

## Eine Nachricht je Störung

Die Ereignisse sind schon eine je Störung, nicht eine je Prüfung: eine Installation, die fünf Minuten
rot ist, schreibt einmal `stoerung`, wird sie wieder grün, einmal `stoerung_behoben`; ein Befund einer
Prüfung schreibt beim Beginn, bei einer Verschlechterung von Gelb nach Rot und bei der Behebung je ein
Ereignis ([Health und Zustand](zustand.md), [Prüfungen der Server](pruefungen.md)). Die
Benachrichtigungen folgen den Ereignissen. Eine Störung, die eine Stunde lang besteht, gibt also zwei
Nachrichten: eine, wenn sie beginnt, und eine, wenn sie behoben ist.

## Empfänger und Schwere

Jeder Empfänger bekommt Ereignisse ab einer Schwere:

| Ab Schwere | bekommt |
| --- | --- |
| Störung (`fehler`) | Störungen, rote Befunde, gescheiterte Backups, Updates und Prüf-Restores |
| Warnung (`warn`) | dazu stille Agenten, gelbe Befunde, Fehler bei DNS und Registries, SSH-Anmeldungen |
| Hinweis (`info`) | alles, auch gelungene Wiederherstellungen und Updates |

Eine Behebung (`…_behoben`, und `aussen_gruen` nach `aussen_rot` der Prüfung von außen) hat selbst
die Schwere `info`, geht aber mit der Schwere des Ereignisses raus, das sie behebt: wer die Störung bekam, bekommt auch ihr Ende. Ein neuer Empfänger bekommt keine
Ereignisse, die vor ihm geschrieben wurden.

Empfänger legen Inhaber und Technik unter **Einstellungen → Benachrichtigungen** an, mit Grund;
Support sieht sie nur. „Test senden“ schickt sofort eine Testnachricht an einen Empfänger, auch in der
Ruhezeit, und zeigt, ob sie ankam.

## Mail

Mails gehen über den SMTP-Server des Betreibers: Host, Port, Verschlüsselung, Absender und, wenn der
Server eine Anmeldung will, Benutzer und Passwort. Das Passwort liegt verschlüsselt in der Zentrale,
erscheint nur als „gesetzt“ und geht nur innerhalb von TLS an den Server.

| Verschlüsselung | heißt |
| --- | --- |
| STARTTLS | die Verbindung beginnt unverschlüsselt (meist Port 587) und wird vor allem anderen auf TLS gehoben; bietet der Server kein STARTTLS, geht nichts raus |
| TLS | TLS von Anfang an (meist Port 465) |
| keine | nur für ein Relay auf dem Rechner der Zentrale (`localhost`, `127.0.0.1`, `::1`) |

Das Zertifikat des Servers muss zum Host passen. Ohne SMTP-Server melden nur Webhooks; eine Mail an
einen Empfänger wartet dann, bis einer eingetragen ist. Betreff ist die Art und der Text des
Ereignisses, etwa `[Störung] Störung kanzlei-haben: seit 5 Min. rot; Health: HTTP 503`; die Mail nennt
Zeitpunkt (Europe/Berlin), Schwere, Art und Ziel und verweist auf die Ereignisse der Zentrale.

## Webhooks

Ein Webhook ist ein `POST` mit JSON an eine `https`-Adresse:

```json
{
  "typ": "ereignis",
  "zustellung": "3f0c….a71b…",
  "text": "[Störung] Störung kanzlei-haben: seit 5 Min. rot; Health: HTTP 503",
  "ereignis": {
    "id": "3f0c…",
    "zeitpunkt": 1795434000000,
    "art": "stoerung",
    "schwere": "fehler",
    "ziel": "installation:kanzlei-haben",
    "text": "Störung kanzlei-haben: seit 5 Min. rot; Health: HTTP 503"
  }
}
```

`text` steht oben, damit Chat-Werkzeuge wie Slack, Mattermost oder Rocket.Chat die Nachricht direkt
zeigen. Zeitpunkte sind UTC-Millisekunden. Jede Anfrage trägt zwei Header:

| Header | Inhalt |
| --- | --- |
| `X-Steuerzentrale-Signatur` | `t=<Millisekunden>,v1=<HMAC-SHA256 als Hex>` |
| `X-Steuerzentrale-Zustellung` | die ID der Zustellung, bei jeder Wiederholung dieselbe |

### Signatur prüfen

`v1` ist der HMAC-SHA256 mit dem Signierschlüssel des Empfängers über `<t>.<body>`, also den
Zeitpunkt aus `t`, einen Punkt und den Body genau so, wie er ankam. Ein Empfänger prüft:

1. den Header lesen und `t` und `v1` herausnehmen; fehlt einer, ablehnen;
2. `t` darf höchstens 5 Minuten von der eigenen Uhr abweichen, sonst ablehnen (eine mitgeschnittene
   Anfrage lässt sich so später nicht wiederholen);
3. den HMAC selbst bilden und in konstanter Zeit mit `v1` vergleichen;
4. eine Zustellung, deren ID er schon verarbeitet hat, nur bestätigen, nicht noch einmal ausführen.

In TypeScript, wie die Zentrale es in ihren Tests tut (`signaturPruefen` in
`apps/zentrale/src/modules/benachrichtigung/signatur.ts`):

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const pruefen = (schluessel: string, header: string | null, body: string, jetzt: number) => {
  const teile = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!teile || Math.abs(jetzt - Number(teile[1])) > 5 * 60_000) return false;
  const erwartet = createHmac("sha256", schluessel).update(`${teile[1]}.${body}`).digest();
  return timingSafeEqual(erwartet, Buffer.from(teile[2], "hex"));
};
```

Den Signierschlüssel erzeugt die Oberfläche im Browser (32 Zufallsbytes, 43 Zeichen) und zeigt ihn
nur im Dialog „Empfänger hinzufügen“, vor dem Speichern; er gehört beim Empfänger hinterlegt. Die
Zentrale speichert Adresse und Schlüssel verschlüsselt und zeigt danach nur den Host der Adresse: der
Pfad eines Chat-Webhooks ist selbst ein Schlüssel. Ein neuer Schlüssel heißt: Empfänger entfernen und
neu anlegen.

### Nur öffentliche Adressen

Die Adresse eines Webhooks gibt der Betreiber ein; die Zentrale soll damit nicht ihr eigenes Netz
erreichen. Sie nimmt nur `https` ohne Zugangsdaten in der Adresse, löst den Host einmal auf, und jede
Adresse muss öffentlich sein: kein Loopback, kein privates Netz, kein CGNAT, kein Link-Local (auch
nicht `169.254.169.254`), kein `0.0.0.0/8`, kein Multicast, bei IPv6 nur `2000::/3`. Die Anfrage geht
an die geprüfte Adresse, mit dem Host als `Host`-Header und TLS-Name, sodass eine zweite Antwort des
DNS nicht woanders hinzeigen kann. Weiterleitungen folgt sie nicht; nur eine Antwort `2xx` gilt als
zugestellt.

## Ruhezeit

Die Ruhezeit gilt täglich, in der Uhrzeit von Berlin, etwa 22:00 bis 07:00. In ihr gehen nur
Störungen raus (Schwere `fehler`, auch deren Behebung); Warnungen und Hinweise warten bis zu ihrem
Ende und gehen dann gesammelt raus. Bei der Zeitumstellung zählt die Uhr: die Nacht auf die Sommerzeit
ist eine Stunde kürzer, die Nacht zurück eine länger. Ohne Ruhezeit geht alles sofort.

## Zustellung und Wiederholung

Alle 15 Sekunden schreibt die Zentrale für jedes neue Ereignis eine Zustellung je passendem
Empfänger und schickt, was fällig ist. Die Zustellung hat die ID `<ereignis>.<empfänger>`: ein Ereignis
erreicht einen Empfänger einmal, auch nach einem Neustart der Zentrale. Scheitert eine Zustellung
(der Empfänger antwortet nicht mit `2xx`, der SMTP-Server lehnt ab, die Verbindung bricht), versucht
die Zentrale es nach 1, 2, 4, 8, 16, 32 Minuten und danach stündlich wieder, insgesamt zehnmal; dann
gibt sie auf. Bricht die Zentrale genau zwischen Senden und Speichern ab, sendet sie noch einmal: der
Empfänger erkennt die Wiederholung an `X-Steuerzentrale-Zustellung`, eine Mail an derselben
`Message-ID`.

Unter Einstellungen → Benachrichtigungen stehen die 20 neuesten Zustellungen mit Zustand (wartet,
zugestellt, aufgegeben), Versuchen und dem letzten Fehler. Jede Zustellung und jeder Versuch steht im
Audit-Log, ohne Passwort, Adresse oder Schlüssel eines Webhooks. Zustellungen bleiben 30 Tage.

Dieselbe Zustellung nutzt später das Portal (Z-903): es ist ein Webhook-Empfänger wie jeder andere.

## API

| Route | Rolle | Wirkung |
| --- | --- | --- |
| `GET /api/v1/benachrichtigungen` | alle | SMTP-Server (Passwort nur als `passwortGesetzt`), Ruhezeit, Empfänger (Webhook nur als Host), die 20 neuesten Zustellungen |
| `PUT /api/v1/benachrichtigungen` | Inhaber, Technik | `smtp` (oder `null`) und `ruhezeit` (oder `null`) mit `grund`; ein fehlendes `passwort` behält das alte, solange Host und Benutzer gleich bleiben; mit einem anderen Host oder Benutzer ist es weg |
| `POST /api/v1/benachrichtigungen/empfaenger` | Inhaber, Technik | `art` `mail` mit `adresse` oder `webhook` mit `url` und `schluessel` (32 bis 200 Zeichen), `abSchwere`, `grund` |
| `DELETE /api/v1/benachrichtigungen/empfaenger/:id` | Inhaber, Technik | mit `grund`; wartende Zustellungen enden |
| `POST /api/v1/benachrichtigungen/empfaenger/:id/test` | Inhaber, Technik | sendet sofort eine Testnachricht; `502` mit dem Grund, wenn sie nicht ankam |
