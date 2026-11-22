import type { Manifest } from "../schema.ts";

/**
 * The settings whose values never leave the server in a log excerpt (BAULISTE.md Z-405;
 * docs/plan.md, "Log-Auszug"): those of typ `geheim` and those of ebene `auto` (a generated value
 * is a key even without `geheim`); sorted names only, never a value. Pure: the agent keeps these
 * names in its record at setup and reconfiguring.
 */
export const geheimeEinstellungen = (m: Manifest): string[] =>
  m.env
    .filter((e) => e.typ === "geheim" || e.ebene === "auto")
    .map((e) => e.name)
    .sort();
