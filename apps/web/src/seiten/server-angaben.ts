import type { Art } from "../daten/typen.ts";

/*
 * What the dialog "Server hinzufügen" sends (BAULISTE.md Z-302): the API names the server at the
 * customer `beim_kunden`, and the maintenance window is daily (every weekday, 0 Sunday) as in the
 * mockup. Pure, so it is tested without a page.
 */
const API_ART: Record<Art, string> = {
  gemeinsam: "gemeinsam",
  eigen: "eigen",
  kunde: "beim_kunden",
};
const ALLE_TAGE = [0, 1, 2, 3, 4, 5, 6];

export const ARTEN: readonly Art[] = ["gemeinsam", "eigen", "kunde"];

export const istArt = (wert: string): wert is Art => (ARTEN as readonly string[]).includes(wert);

/** The request body from the form's fields; a shared server has no customer */
export const serverAngaben = (felder: Record<string, string>) => {
  const art = istArt(felder.art ?? "") ? (felder.art as Art) : "gemeinsam";
  return {
    name: felder.name ?? "",
    art: API_ART[art],
    ...(art === "gemeinsam" ? {} : { kundeId: felder.kunde ?? "" }),
    wartungsfenster: { tage: ALLE_TAGE, von: felder.von ?? "", bis: felder.bis ?? "" },
    grund: felder.grund ?? "",
  };
};
