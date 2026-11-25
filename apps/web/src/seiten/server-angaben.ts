/*
 * What the dialog "Server hinzufügen" sends (BAULISTE.md Z-302): name, a daily maintenance window
 * (every weekday, 0 Sunday) as in the mockup, and the reason. Every server is the operator's own for
 * several customers, so it asks no kind and no customer (Z-1205). Pure, so it is tested without a
 * page.
 */
const ALLE_TAGE = [0, 1, 2, 3, 4, 5, 6];

/** The request body from the form's fields */
export const serverAngaben = (felder: Record<string, string>) => ({
  name: felder.name ?? "",
  wartungsfenster: { tage: ALLE_TAGE, von: felder.von ?? "", bis: felder.bis ?? "" },
  grund: felder.grund ?? "",
});
