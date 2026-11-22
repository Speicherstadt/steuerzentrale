import type { Context } from "hono";
import { z } from "zod";
import {
  betreiberEinstellungenAendern,
  betreiberEinstellungenLesen,
  type Gelesen,
} from "../modules/einstellungen/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Anfrage, Registrar } from "./zugang.ts";

/*
 * The operator's values of an app (BAULISTE.md Z-404; docs/plan.md, "Werte des Betreibers
 * schreiben"): every role reads them, owner and technik change them with a reason, like
 * installations. Read and checked with the form of the app's newest manifest among the operator's
 * installations; without one there is no form (`kein_manifest`). A secret value never comes back,
 * only its name among `gesetzt`.
 */

/** A value of a setting as the API takes it; the form decides which type a name needs */
export const einstellungsWert = z.union([z.string().max(10_000), z.number(), z.boolean()]);
export const einstellungsWerte = z.record(z.string().max(100), einstellungsWert);

const aendernSchema = z
  .object({ werte: einstellungsWerte, grund: z.string().trim().min(1).max(500) })
  .strict();

const STATUS: Record<string, 400 | 404 | 500> = {
  kein_manifest: 404,
  einstellung_ungueltig: 400,
  werte_unlesbar: 500,
};

const antwort = (c: Context<Anfrage>, g: Gelesen) =>
  g.ok
    ? c.json(g.einstellungen)
    : c.json(
        { fehler: g.grund, ...(g.detail === undefined ? {} : { detail: g.detail }) },
        STATUS[g.grund] ?? 500,
      );

export const einstellungenRouten = (route: Registrar, deps: RoutenDeps): void => {
  const app = (c: Context<Anfrage>) => c.req.param("app") ?? "";

  route("GET /api/v1/apps/:app/einstellungen", (c) =>
    antwort(c, betreiberEinstellungenLesen(deps, c.get("betreiberId"), app(c))),
  );

  route("PUT /api/v1/apps/:app/einstellungen", async (c) => {
    const angaben = await eingabe(c, aendernSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const kontext = {
      betreiberId: c.get("betreiberId"),
      akteur: c.get("nutzerId"),
      jetzt: deps.now(),
      grund: angaben.grund,
    };
    return antwort(c, betreiberEinstellungenAendern(deps, kontext, app(c), angaben.werte));
  });
};
