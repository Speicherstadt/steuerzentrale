---
title: Release
description: >-
  Wie ein Release der Steuerzentrale entsteht: Version heben, Image und Agent-Dateien aus der CI,
  SHA256SUMS mit dem Release-Schlüssel signieren und den Entwurf veröffentlichen.
---

# Release

Ein Release entsteht in drei Schritten. Die ersten beiden macht GitHub Actions, den dritten ein
Mensch, weil der Release-Schlüssel offline liegt und nie in die CI kommt.

## 1. Version heben

**Actions → Bump version → Run workflow**, mit:

- `preminor` (oder `prepatch`, `premajor`) für den ersten Release-Kandidaten, z. B. `0.1.0-rc.1`;
- `prerelease` für den nächsten Kandidaten (`0.1.0-rc.2`);
- `patch`, `minor`, `major` für eine Version ohne Zusatz.

Der Workflow hebt die Version in `package.json`, setzt den Tag `vX.Y.Z` und startet damit den
Release. Zentrale und Agent nennen dieselbe Version.

## 2. Release-Workflow

Der Workflow `Release` läuft auf dem Tag:

1. die ganze CI noch einmal, darunter der Release-Kandidat in einer Incus-VM;
2. das Image der Zentrale für amd64 und arm64 nach `ghcr.io/speicherstadt/steuerzentrale`, mit den
   Tags `X.Y.Z`, `X.Y` und `latest` (ein Kandidat: `X.Y.Z-rc.N` und `next`), mit denselben Tags
   und demselben Digest nach Docker Hub als `tristanteu/steuerzentrale` (Secret `DOCKER_PAT`;
   Beschreibung aus `DOCKERHUB.md`, nicht bei einem Kandidaten);
3. ein **Entwurf** des GitHub-Release mit den Agent-Binaries (`linux-x64`, `linux-arm64`),
   `install.sh`, `VERSION`, der Quadlet-Unit `steuerzentrale.container` mit dem Digest des Images,
   `DIGEST` und `SHA256SUMS` über alle Dateien.

`SHA256SUMS` ist im Entwurf **nicht signiert**. `install.sh` und der Agent nehmen ohne gültige
Signatur nichts an, ein Entwurf erreicht also keinen Server.

## 3. Signieren und veröffentlichen

Auf dem Rechner mit dem Release-Schlüssel:

```sh
gh release download vX.Y.Z --repo Speicherstadt/steuerzentrale --dir release
cd release
sha256sum -c SHA256SUMS
bun scripts/release-schluessel.ts minisign.pub   # im Repo: lehnt den Test-Schlüssel ab
minisign -Sm SHA256SUMS
gh release upload vX.Y.Z SHA256SUMS.minisig minisign.pub --repo Speicherstadt/steuerzentrale
```

Dann im Entwurf die Schlüssel-ID in die Notiz schreiben und veröffentlichen. Ein Kandidat bleibt
als Vorabversion markiert.

Wer einen Release testen will, bevor der Release-Schlüssel da ist, startet **Actions → CI → Run workflow**
und nimmt das Artefakt `release-kandidat` dieses Laufs: Es ist mit dem öffentlichen Test-Schlüssel signiert und lässt
sich nur mit `install.sh --testmodus` einrichten, wie in [Installation](installation.md) am Ende
beschrieben.

## Demo und Bilder

Die [Demo](demo/index.html) ist die Oberfläche mit Beispieldaten (`apps/web/src/demo/`), ohne
Zentrale. Der Workflow `Docs` baut sie mit `bun run --cwd apps/web build:demo` bei jeder Änderung an
Oberfläche oder Texten neu und legt sie unter `/demo/` neben die Doku.

Die Bilder in README und Doku (`docs/assets/screenshots/`) entstehen aus derselben Demo:
**Actions → Update screenshots → Run workflow**, lokal `bun run screenshots`.
