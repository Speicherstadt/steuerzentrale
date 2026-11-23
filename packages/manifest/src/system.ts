/*
 * The images of the Steuerzentrale itself (docs/plan.md, "Images der Zentrale selbst"): no app, no
 * manifest, so their version and digest stand here and roll out with the agent. Renovate keeps them
 * current (.github/renovate.json5, the custom manager for this file reads the comment line above
 * each tag). A digest comes from a registry query of scripts/digest.ts, never from memory.
 */

export type SystemImage = {
  /** The image by digest, as a unit writes it */
  image: string;
  tag: string;
  quelle: string;
};

const CADDY = {
  // renovate: datasource=docker depName=docker.io/library/caddy
  tag: "2.11.9-alpine",
  digest: "sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0",
};

/**
 * Caddy for the Pforte, in November 2026 the version Kontext runs (manifeste/kontext/0.1.37/
 * QUELLEN.md); the field names of the Pforte's JSON are checked against its source (caddyserver/caddy
 * v2.11.9). The digest: `bun scripts/digest.ts docker.io/caddy:2.11.9-alpine` on 2026-11-21 (the
 * same as Kontext's query of 2026-11-20), later Renovate's pull requests
 */
export const PFORTE_IMAGE: SystemImage = {
  image: `docker.io/library/caddy@${CADDY.digest}`,
  tag: CADDY.tag,
  quelle: `Registry docker.io, Tag ${CADDY.tag}`,
};

const RESTIC = {
  // renovate: datasource=docker depName=docker.io/restic/restic
  tag: "0.20.0",
  digest: "sha256:93999df80d4ac6cb148e82d2ef1fe6a81996f17ff535e772723538211b31555a",
};

/**
 * restic for the backups (Z-601; docs/plan.md, "Backup auf dem Server"), the official image of
 * restic/restic, in November 2026 its newest release. Flags, environment and exit codes are checked
 * against its source and docs at v0.20.0 (cmd/restic, internal/global/global.go,
 * doc/075_scripting.rst). The digest: `bun scripts/digest.ts docker.io/restic/restic:0.20.0` on
 * 2026-11-23, later Renovate's pull requests
 */
export const RESTIC_IMAGE: SystemImage = {
  image: `docker.io/restic/restic@${RESTIC.digest}`,
  tag: RESTIC.tag,
  quelle: `Registry docker.io, Tag ${RESTIC.tag}`,
};
