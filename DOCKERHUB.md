# Steuerzentrale

Die Zentrale der [Steuerzentrale](https://github.com/Speicherstadt/steuerzentrale): installiert,
aktualisiert, sichert und überwacht die Apps der Speicherstadt auf eigenen Servern. Ein Agent auf
jedem Server verbindet sich selbst und führt nur aus, was das signierte Manifest einer App beschreibt.

- **Image:** amd64 und arm64, distroless, läuft als Nutzer `nonroot` (65532); dasselbe Image wie
  `ghcr.io/speicherstadt/steuerzentrale`.
- **Tags:** `X.Y.Z`, `X.Y`, `latest`; Vorabversionen `X.Y.Z-rc.N` und `next`.
- **Einrichten:** rootless als Podman-Quadlet mit der Unit aus dem
  [GitHub-Release](https://github.com/Speicherstadt/steuerzentrale/releases), per Digest, nicht per
  Tag: [Installation](https://speicherstadt.github.io/steuerzentrale/installation.html).
- **Demo:** [im Browser](https://speicherstadt.github.io/steuerzentrale/demo/), ohne Server.

Lizenz: AGPL-3.0.
