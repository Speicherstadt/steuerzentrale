import { leistungenCsv, leistungenDatei, monatAusText, monatVon } from "@steuerzentrale/planung";
import { leistungenLesen } from "../modules/leistungen/index.ts";
import type { RoutenDeps } from "./deps.ts";
import type { Registrar } from "./zugang.ts";

/*
 * The services of each customer in a month (BAULISTE.md Z-804; docs/plan.md, "Leistungen"):
 * `monat` as "2026-11", the current month in Berlin without it; `format=csv` gives the same as a
 * download after RFC 4180. Only the session's operator's customers; read like customers.
 */
export const leistungenRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("GET /api/v1/leistungen", (c) => {
    const jetzt = deps.now();
    const text = c.req.query("monat");
    const monat = text === undefined ? monatVon(jetzt) : monatAusText(text);
    const format = c.req.query("format");
    if (!monat || (format !== undefined && format !== "csv"))
      return c.json({ fehler: "ungueltig" }, 400);
    const l = leistungenLesen(deps.db, c.get("betreiberId"), monat, jetzt);
    if (format === undefined) return c.json(l);
    return c.body(leistungenCsv(l), 200, {
      "content-type": "text/csv; charset=utf-8; header=present",
      "content-disposition": `attachment; filename="${leistungenDatei(l.monat)}"`,
    });
  });
};
