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
