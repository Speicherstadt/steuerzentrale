/*
 * Versions of an app (BAULISTE.md Z-501; docs/plan.md, "Versionen aus den Registries (Z-501)",
 * "Interne Kunden und Vorabversionen (Z-501)"): reading a registry's tag as a version, ordering
 * versions, and which versions an installation is offered. Pure, so the Zentrale's pages and the
 * update of Z-503 decide the same.
 */

// SemVer 2.0.0 without build metadata, as the manifest's `version` (packages/manifest, schema.ts);
// no leading zero in a number of the core
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

/** A registry tag as a version: SemVer, a leading `v` allowed; any other tag is none */
export const tagAlsVersion = (tag: string): string | undefined => {
  const ohneV = tag.startsWith("v") ? tag.slice(1) : tag;
  return VERSION.test(ohneV) ? ohneV : undefined;
};

/** A version with a pre-release part, such as `2.0.0-rc.1` */
export const istVorabversion = (version: string): boolean => version.includes("-");

const teile = (version: string): [number[], string | undefined] => {
  const [kern = "", vor] = version.split(/-(.*)/s);
  return [kern.split(".").map(Number), vor];
};

/** Semantic versions compared: major, minor, patch, and a pre-release before its release */
export const versionVergleichen = (a: string, b: string): number => {
  const [ka, va] = teile(a);
  const [kb, vb] = teile(b);
  for (let i = 0; i < 3; i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d !== 0) return d;
  }
  if (va === vb) return 0;
  if (va === undefined) return 1;
  if (vb === undefined) return -1;
  return va.localeCompare(vb, "en", { numeric: true });
};

/**
 * Whether a version may be offered to an installation: a pre-release only to one of an internal
 * customer (the wave "intern"), to every other never, not even by hand
 */
export const versionAngeboten = (version: string, intern: boolean): boolean =>
  intern || !istVorabversion(version);

export type ManifestVersion = { version: string; dringend: boolean };
export type AngeboteneVersion = ManifestVersion & { vorabversion: boolean };

/**
 * The versions an installation is offered: every imported manifest newer than the version it runs
 * that it may get (`versionAngeboten`), newest first
 */
export const angeboteneVersionen = (
  installation: { version: string; intern: boolean },
  manifeste: readonly ManifestVersion[],
): AngeboteneVersion[] =>
  manifeste
    .filter(
      (m) =>
        versionVergleichen(m.version, installation.version) > 0 &&
        versionAngeboten(m.version, installation.intern),
    )
    .sort((a, b) => versionVergleichen(b.version, a.version))
    .map((m) => ({
      version: m.version,
      dringend: m.dringend,
      vorabversion: istVorabversion(m.version),
    }));
