import { z } from "zod";
import {
  BETRIEBSARTEN,
  betriebsartLesen,
  betriebsartSetzen,
} from "../modules/betriebsart/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Registrar } from "./zugang.ts";

/*
 * The Betriebsart (BAULISTE.md Z-805): the owner answers once after setting up ("Nur für mich" or
 * "Für Kunden") and later changes it under Einstellungen with a reason. The first answer needs no
 * reason; the audit log records it as the first setup.
 */
const schema = z
  .object({
    betriebsart: z.enum(BETRIEBSARTEN),
    grund: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const ERSTE_ANTWORT = "Erste Einrichtung";

export const betriebsartRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("PUT /api/v1/betriebsart", async (c) => {
    const angaben = await eingabe(c, schema);
    const betreiberId = c.get("betreiberId");
    const offen = betriebsartLesen(deps.db, betreiberId).betriebsart === null;
    if (!angaben || (!offen && angaben.grund === undefined))
      return c.json({ fehler: "ungueltig" }, 400);
    const kontext = {
      betreiberId,
      akteur: c.get("nutzerId"),
      jetzt: deps.now(),
      grund: angaben.grund ?? ERSTE_ANTWORT,
    };
    const r = betriebsartSetzen(deps.db, deps.schreibDb, kontext, angaben.betriebsart);
    return r.ok ? c.json(r.stand) : c.json({ fehler: r.grund }, 409);
  });
};
