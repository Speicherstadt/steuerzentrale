import { join } from "node:path";
import { type OeffentlicherSchluessel, schluesselLesen } from "@steuerzentrale/manifest";

/*
 * What `agent.<domain>` hands out before an agent has a certificate (BAULISTE.md Z-302): the install
 * script, the agent binaries and their checksums with the minisign signature. They lie in one
 * directory (STEUERZENTRALE_AGENT_DATEIEN), as `scripts/agent-dateien.ts` lays it out for a release
 * candidate (signed with the test key) and a person for a release (signed with the real key).
 */
export const DATEIEN = [
  "steuerzentrale-agent-linux-x64",
  "steuerzentrale-agent-linux-arm64",
  "SHA256SUMS",
  "SHA256SUMS.minisig",
] as const;
export type Datei = (typeof DATEIEN)[number];

export const istDatei = (name: string): name is Datei =>
  (DATEIEN as readonly string[]).includes(name);

const ZENTRALE = "@ZENTRALE@";
const SCHLUESSEL = "@SCHLUESSEL@";
// An origin only: the value lands inside single quotes of a shell script
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
const SCHLUESSEL_ZEILE = /^RW[A-Za-z0-9+/]{54}$/;

/** The key line of a minisign public key file ("RW…", 56 characters) */
export const schluesselZeile = (datei: string): string | undefined =>
  datei
    .split("\n")
    .map((zeile) => zeile.trim())
    .find((zeile) => SCHLUESSEL_ZEILE.test(zeile));

/**
 * The install script with the agents' address of this Zentrale and the public key that signs the
 * agent binaries and the manifests filled in; undefined when either does not fit its form, so no
 * value can break out of the script's quotes
 */
export const skriptAusfuellen = (
  vorlage: string,
  werte: { zentrale: string; schluessel: string },
): string | undefined => {
  if (!ORIGIN.test(werte.zentrale) || !SCHLUESSEL_ZEILE.test(werte.schluessel)) return undefined;
  if (!vorlage.includes(ZENTRALE) || !vorlage.includes(SCHLUESSEL)) return undefined;
  return vorlage.replaceAll(ZENTRALE, werte.zentrale).replaceAll(SCHLUESSEL, werte.schluessel);
};

export type Auslieferung = {
  skript: () => Promise<string | undefined>;
  datei: (name: Datei) => Bun.BunFile | undefined;
  /**
   * The public key install.sh hands the agents (`minisign.pub`), which the Zentrale checks an
   * uploaded manifest with (docs/plan.md, "Manifest beim Installieren"); undefined without one
   */
  manifestSchluessel: () => Promise<OeffentlicherSchluessel | undefined>;
};

/** Reads from `verzeichnis` on every request, so a new release there needs no restart */
export const auslieferung = (verzeichnis: string | undefined, zentrale: string): Auslieferung => {
  const zeileLesen = async (): Promise<string | undefined> => {
    if (!verzeichnis) return undefined;
    const schluessel = Bun.file(join(verzeichnis, "minisign.pub"));
    return (await schluessel.exists()) ? schluesselZeile(await schluessel.text()) : undefined;
  };
  return {
    skript: async () => {
      if (!verzeichnis) return undefined;
      const vorlage = Bun.file(join(verzeichnis, "install.sh"));
      if (!(await vorlage.exists())) return undefined;
      const zeile = await zeileLesen();
      return zeile
        ? skriptAusfuellen(await vorlage.text(), { zentrale, schluessel: zeile })
        : undefined;
    },
    datei: (name) => (verzeichnis ? Bun.file(join(verzeichnis, name)) : undefined),
    manifestSchluessel: async () => {
      const zeile = await zeileLesen();
      return zeile ? schluesselLesen(zeile) : undefined;
    },
  };
};
