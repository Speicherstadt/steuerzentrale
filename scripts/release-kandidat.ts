/**
 * The release candidate of the Zentrale (BAULISTE.md Z-1004, docs/installation.md):
 *
 *   bun scripts/release-kandidat.ts kontext <ordner>      the image's build context with its Containerfile
 *   bun scripts/release-kandidat.ts unit <image@digest> <ordner>   the Quadlet unit for that image
 *   bun scripts/release-kandidat.ts signieren <ordner> <datei>…   SHA256SUMS signed with the test key
 *
 * after `bun run build`. CI builds the image from the context for amd64 and arm64 with
 * `podman build --platform`; the Containerfile runs nothing (only COPY), so no emulation is needed.
 * The binary is the one `bun build --compile` made for each architecture (scripts/compile.ts).
 * A release is the same, built by a person from a tag and signed with the real key
 * (docs/plan.md, "Release").
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IMAGE } from "@steuerzentrale/manifest";
import { testSignieren } from "./agent-dateien.ts";

const ROOT = join(import.meta.dirname, "..");

/**
 * distroless cc (glibc and libstdc++, what a compiled Bun binary links) with the user nonroot
 * (65532), by digest: registry gcr.io, tag nonroot, queried 2026-11-23 with scripts/digest.ts
 * (linux/amd64, linux/arm64 among its platforms)
 */
export const BASIS_IMAGE =
  "gcr.io/distroless/cc-debian12@sha256:9dac0a79194e45a7da0158a9c6da57b217585af0786db3845d1f0ec1a0dd182f";
const NUTZER = "65532:65532";
export const ZENTRALE_DATEN = "/var/lib/steuerzentrale";
const WEB = "/usr/share/steuerzentrale/web";
/** The port on 127.0.0.1 the Pforte of the server passes requests on to */
export const ZENTRALE_PORT = 8300;

/** Podman's TARGETARCH and the target of scripts/compile.ts it takes the binary of */
export const ARCHITEKTUREN = { amd64: "linux-x64", arm64: "linux-arm64" } as const;

const containerfile = (): string =>
  [
    "# The Zentrale's image (BAULISTE.md Z-1004), made by scripts/release-kandidat.ts; only COPY, so",
    "# `podman build --platform linux/amd64,linux/arm64` needs no emulation",
    `FROM ${BASIS_IMAGE}`,
    "ARG TARGETARCH",
    "COPY $TARGETARCH/steuerzentrale /usr/local/bin/steuerzentrale",
    `COPY web/ ${WEB}/`,
    // a named volume takes the owner of the folder it is mounted over (copy-up)
    `COPY --chown=${NUTZER} daten/ ${ZENTRALE_DATEN}/`,
    `ENV STEUERZENTRALE_DATA=${ZENTRALE_DATEN} STEUERZENTRALE_WEB=${WEB} STEUERZENTRALE_HOST=127.0.0.1 STEUERZENTRALE_PORT=${ZENTRALE_PORT}`,
    `USER ${NUTZER}`,
    'ENTRYPOINT ["/usr/local/bin/steuerzentrale"]',
    "LABEL org.opencontainers.image.source=https://github.com/Speicherstadt/steuerzentrale org.opencontainers.image.licenses=AGPL-3.0-only",
    "",
  ].join("\n");

/** The build context: one binary per architecture, the built interface, an empty data folder */
export const kontextAnlegen = (quelle: { zentrale: string; web: string }, ziel: string): void => {
  const fehlend = Object.values(ARCHITEKTUREN)
    .map((target) => join(quelle.zentrale, `steuerzentrale-${target}`))
    .filter((pfad) => !existsSync(pfad));
  if (fehlend.length > 0) throw new Error(`missing (bun run build): ${fehlend.join(", ")}`);
  if (!existsSync(join(quelle.web, "index.html")))
    throw new Error(`missing (bun run build): ${quelle.web}/index.html`);
  for (const [arch, target] of Object.entries(ARCHITEKTUREN)) {
    mkdirSync(join(ziel, arch), { recursive: true });
    copyFileSync(
      join(quelle.zentrale, `steuerzentrale-${target}`),
      join(ziel, arch, "steuerzentrale"),
    );
  }
  cpSync(quelle.web, join(ziel, "web"), { recursive: true });
  mkdirSync(join(ziel, "daten"), { recursive: true });
  writeFileSync(join(ziel, "Containerfile"), containerfile());
};

/**
 * The Zentrale under its own Linux user (sz-zentrale, rootless, lingering), podman-systemd.unit(5) of
 * Podman 4.9: the host's network, so it listens on 127.0.0.1 for the Pforte and sees the Pforte's
 * requests from loopback (the fingerprint header counts only from there); the key as a Podman
 * secret; the server's addresses in an environment file; the agent files read-only. No AutoUpdate:
 * a person updates the Zentrale (docs/installation.md).
 */
export const zentraleUnit = (image: string): string => {
  if (!IMAGE.test(image)) throw new Error("the image by digest: <registry>/<name>@sha256:…");
  return `# The Zentrale of the Steuerzentrale (docs/installation.md)
[Unit]
Description=Steuerzentrale (Zentrale)
Wants=network-online.target
After=network-online.target

[Container]
ContainerName=steuerzentrale
Image=${image}
Network=host
NoNewPrivileges=true
Secret=steuerzentrale-secret-key,type=env,target=STEUERZENTRALE_SECRET_KEY
EnvironmentFile=%h/steuerzentrale.env
Environment=STEUERZENTRALE_AGENT_DATEIEN=/agent-dateien
Volume=steuerzentrale-daten:${ZENTRALE_DATEN}
Volume=%h/agent-dateien:/agent-dateien:ro

[Service]
Restart=always
TimeoutStartSec=900

[Install]
WantedBy=default.target
`;
};

if (import.meta.main) {
  const [befehl, a, b] = process.argv.slice(2);
  if (befehl === "kontext" && a) {
    kontextAnlegen(
      { zentrale: join(ROOT, "apps/zentrale/dist"), web: join(ROOT, "apps/web/dist") },
      a,
    );
    console.log(`image context in ${a}`);
  } else if (befehl === "unit" && a && b) {
    mkdirSync(b, { recursive: true });
    writeFileSync(join(b, "steuerzentrale.container"), zentraleUnit(a));
    console.log(`steuerzentrale.container for ${a} in ${b}`);
  } else if (befehl === "signieren" && a && b) {
    // the public test key only (scripts/minisign.ts); a release is signed by a person
    testSignieren(a, process.argv.slice(4), "steuerzentrale release candidate (test key)");
    console.log(`SHA256SUMS in ${a}, signed with the public test key`);
  } else {
    console.error(
      "usage: bun scripts/release-kandidat.ts kontext <ordner> | unit <image@digest> <ordner> | signieren <ordner> <datei>…",
    );
    process.exit(2);
  }
}
