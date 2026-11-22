import { INSTALLATIONS_NAME } from "./quadlet/eingabe.ts";
import type { Manifest } from "./schema.ts";

/*
 * The actions of an installation (BAULISTE.md Z-405; docs/plan.md, "Aktionen einer Installation"):
 * restart and log excerpt are jobs built into the Steuerzentrale, offered only when the manifest's
 * `aktionen.neustart` or `aktionen.log_auszug` is `angeboten` (the default); "nur lesen" is the
 * command `aktionen.nur_lesen.befehl` names, an ordinary job. Pure: the Zentrale checks with these
 * functions what it offers and makes, the agent again before it runs anything.
 */

/** The actions a manifest can offer for an installation */
export type InstallationsAktion = "neustart" | "log_auszug" | "nur_lesen";

/** A command's name has no underscore (schema.ts, `name`), so no manifest can name these */
export const AKTIONS_AUFTRAEGE = {
  neustart: "installation_neustart",
  log_auszug: "installation_log_auszug",
} as const;

/** A restart waits until the units are active and stay so for 10 s; reading the journal is quick */
export const AKTION_ZEITLIMIT_S = 300;

/** Whether the manifest offers the action for its installations */
export const aktionAngeboten = (m: Manifest, aktion: InstallationsAktion): boolean => {
  if (aktion === "nur_lesen") return nurLesenBefehl(m) !== undefined;
  return m.aktionen[aktion] === "angeboten";
};

/** The command "nur lesen" runs, if the manifest names one */
export const nurLesenBefehl = (m: Manifest): string | undefined => {
  const a = m.aktionen.nur_lesen;
  return typeof a === "object" && "befehl" in a ? a.befehl : undefined;
};

export const istAktionsAuftrag = (aktion: string): boolean =>
  Object.values<string>(AKTIONS_AUFTRAEGE).includes(aktion);

export type AktionsAnfrage = {
  aktion: string;
  installationId: string | null;
  argumente: Readonly<Record<string, unknown>>;
  einrichtung?: unknown;
};

export type AktionsGeprueft =
  | { ok: true; auftrag: { art: "neustart" | "log_auszug"; name: string } }
  | { ok: false; grund: string };

const nein = (grund: string): AktionsGeprueft => ({ ok: false, grund });

/**
 * A built-in job of an installation's action: for a named installation, without arguments and
 * without installation data, and only for an action its manifest offers
 */
export const aktionsAuftragPruefen = (m: Manifest, a: AktionsAnfrage): AktionsGeprueft => {
  const art = (Object.keys(AKTIONS_AUFTRAEGE) as (keyof typeof AKTIONS_AUFTRAEGE)[]).find(
    (k) => AKTIONS_AUFTRAEGE[k] === a.aktion,
  );
  if (!art) return nein(`${a.aktion} is not a job of an installation's action`);
  const name = a.installationId;
  if (name === null || !INSTALLATIONS_NAME.test(name))
    return nein("an action belongs to a named installation");
  const fremd = Object.keys(a.argumente);
  if (fremd.length > 0) return nein(`unknown argument ${fremd.join(", ")}`);
  if (a.einrichtung !== undefined)
    return nein("an action takes no installation data (einrichtung)");
  if (!aktionAngeboten(m, art)) return nein(`the manifest does not offer ${art}`);
  return { ok: true, auftrag: { art, name } };
};
