/*
 * The reboot of a server (BAULISTE.md Z-701; docs/plan.md, "Neustart als Auftrag"): built into the
 * Steuerzentrale like the update of the agent, with a fixed shape. No manifest describes it and
 * there is nothing to sign, so `manifest` and `signatur` each hold KEIN_MANIFEST. Its one argument
 * is the boot id the Zentrale knew from the server's facts: the agent reboots only out of that boot,
 * so a job left over never reboots a server twice, and after the reboot the new boot id proves it.
 * Pure: the Zentrale checks the shape when it makes one, the agent after the key it trusts.
 */

/** A command's name has no underscore (schema.ts, `name`), so no manifest can name it */
export const SERVER_NEUSTART_AKTION = "server_neustart";

/** What a job without a manifest carries in the place of manifest and signature */
export const KEIN_MANIFEST = "-";

/** What the job's row names as its app and version (the jobs table keeps both) */
export const SERVER_NEUSTART_APP = "betriebssystem";

/** `systemctl reboot` and five minutes for the server to go down */
export const SERVER_NEUSTART_ZEITLIMIT_S = 600;

/** /proc/sys/kernel/random/boot_id: a random UUID in lower case (proc(5)) */
export const BOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ServerNeustartAnfrage = {
  aktion: string;
  installationId: string | null;
  argumente: Readonly<Record<string, unknown>>;
  manifest: string;
  signatur: string;
  einrichtung?: unknown;
  backup?: unknown;
};

export type ServerNeustartAuftrag = { art: "server_neustart"; bootId: string };

export type ServerNeustartGeprueft =
  | { ok: true; auftrag: ServerNeustartAuftrag }
  | { ok: false; grund: string };

const nein = (grund: string): ServerNeustartGeprueft => ({ ok: false, grund });

export const serverNeustartAuftragPruefen = (a: ServerNeustartAnfrage): ServerNeustartGeprueft => {
  if (a.aktion !== SERVER_NEUSTART_AKTION) return nein(`${a.aktion} is not the reboot`);
  if (a.installationId !== null) return nein("the reboot belongs to no installation");
  if (a.einrichtung !== undefined || a.backup !== undefined)
    return nein("the reboot carries no installation or backup data");
  if (a.manifest !== KEIN_MANIFEST || a.signatur !== KEIN_MANIFEST)
    return nein("the reboot carries no manifest");
  const fremd = Object.keys(a.argumente).filter((n) => n !== "bootId");
  if (fremd.length > 0) return nein(`unknown argument ${fremd.join(", ")}`);
  const { bootId } = a.argumente;
  if (typeof bootId !== "string" || !BOOT_ID.test(bootId))
    return nein("argument bootId: a boot id as /proc/sys/kernel/random/boot_id");
  return { ok: true, auftrag: { art: "server_neustart", bootId } };
};
