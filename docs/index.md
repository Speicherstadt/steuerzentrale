---
title: Steuerzentrale
description: >-
  Die Steuerzentrale installiert, aktualisiert, sichert und überwacht die Apps der Speicherstadt auf
  Servern: eine Zentrale, ein Agent je Server, signierte Manifeste.
---

# Steuerzentrale

Die Steuerzentrale betreibt die Apps der Speicherstadt auf Servern: Sie installiert sie, spielt Updates
in Wellen ein, sichert sie und prüft sie von innen und außen. Eine Zentrale mit Oberfläche steuert einen
Agenten auf jedem Server; der Agent verbindet sich von sich aus und führt nur aus, was das signierte
Manifest einer App beschreibt.

![Übersicht der Steuerzentrale](assets/screenshots/uebersicht-hell.webp#only-light)
![Übersicht der Steuerzentrale](assets/screenshots/uebersicht-dunkel.webp#only-dark)

**Ausprobieren:** die [Demo](demo/index.html) zeigt die Oberfläche mit Beispieldaten im Browser, ohne
Server. **Einrichten:** [Installation](installation.md).

**Stand:** Stufe 1 (Selbstbetrieb) ist gebaut, ein Release-Kandidat entsteht in der CI
([Release](release.md)). Was gebaut wird und warum, steht im [Projektplan](plan.md); die Reihenfolge
in der [Bauliste](https://github.com/Speicherstadt/steuerzentrale/blob/main/BAULISTE.md).

Die Steuerzentrale ist Open Source unter der AGPL. Beiträge sind willkommen, siehe [Mitwirken](mitwirken.md).
