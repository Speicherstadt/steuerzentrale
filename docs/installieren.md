---
title: Apps installieren
description: >-
  Wie die Steuerzentrale prüft, ob eine App auf einen Server passt (Platzierung): Architektur, RAM,
  Platte, Ports, IPv4, Mail, Server für sich, Kunde und Betreiber, Abhängigkeiten.
---

# Apps installieren

Vor jeder Installation prüft die **Platzierung**, ob die App mit den gewählten Optionen auf den
Server passt. Sie ist eine reine Funktion (`packages/manifest`, `platzieren`) und liefert eines von
drei Ergebnissen:

- **passt**: nichts spricht dagegen;
- **Hinweise**: es passt, aber knapp (RAM oder Platte danach über 80 %);
- **passt nicht**: mit jedem Grund, warum nicht.

## Regeln

| Regel | passt nicht, wenn … |
| --- | --- |
| Architektur | ein Container der App oder einer gewählten Option, oder eine gewählte Option ohne eigene Container, die Architektur des Servers nicht kennt (Kontext mit `documents` läuft nur auf amd64) |
| RAM | die Summe der Grenzen (`ram_mb` der App und der gewählten Optionen und aller Installationen auf dem Server) den RAM des Servers übersteigt |
| Platte | `platte_gb` der App den freien Platz übersteigt (in Stufe 1 ein Planwert) |
| Feste Ports | ein fester Port (auch in einem Bereich, je Protokoll) schon von einer Installation oder dem Server belegt ist; vergebene Ports (`fest: false`) verteilt die Zentrale |
| Öffentliche IPv4 | die App eine öffentliche IPv4 braucht und der Server nur private Adressen hat |
| Mail | die App Mail verschickt und der öffentlichen Adresse ein PTR-Eintrag fehlt oder Port 25 ausgehend gesperrt oder unbekannt ist |
| Server für sich | die App einen Server für sich braucht (auch `rootful` und ein eigener Proxy) und schon etwas anderes darauf läuft, oder umgekehrt |
| Kunde und Betreiber | der Server einem anderen Betreiber gehört, oder ein eigener Server bzw. einer beim Kunden einem anderen Kunden |
| Abhängigkeiten | die App etwas braucht (`braucht`, z. B. `oidc-anbieter`), das keine Installation des Kunden bietet |
| Werte des Betreibers | ein Pflichtwert auf Ebene `betreiber` (z. B. die Hersteller-ID für ELSTER) fehlt |
| Agent | der Agent des Servers nicht verbunden ist |
| Image | ein Container der App oder einer gewählten Option noch kein Image hat (`noch_nicht_veroeffentlicht`) |
