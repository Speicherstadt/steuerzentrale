import { z } from "zod";
import { kundeLesen } from "../modules/kunden/index.ts";
import { ARTEN, serverAnlegen } from "../modules/server/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Registrar } from "./zugang.ts";

const uhrzeit = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const wartungsfenster = z
  .object({
    tage: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    von: uhrzeit,
    bis: uhrzeit,
  })
  .strict()
  .refine((f) => new Set(f.tage).size === f.tage.length, { message: "a weekday twice" });

const anlegenSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    art: z.enum(ARTEN),
    kundeId: z.string().min(1).max(200).optional(),
    wartungsfenster,
    grund: z.string().trim().min(1).max(500),
  })
  .strict()
  // a server of its own and one at the customer belong to a customer; a shared one to none
  .refine((s) => (s.art === "gemeinsam") === (s.kundeId === undefined), {
    message: "kundeId with eigen and beim_kunden only",
  });

/** The command the interface shows once (docs/plan.md, "Ablauf: Server hinzufügen") */
export const installBefehl = (agentUrl: string, token: string): string =>
  `curl -fsSL ${agentUrl}/install.sh | sudo sh -s -- --token ${token}`;

/**
 * Adding a server (BAULISTE.md Z-302): the row, and the one-time token in the command, which the
 * answer carries this once; the Zentrale keeps only its hash
 */
export const serverRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("POST /api/v1/server", async (c) => {
    const angaben = await eingabe(c, anlegenSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const { grund, ...neu } = angaben;
    // the customer must be one of the operator's own (Z-801): never another operator's
    if (neu.kundeId !== undefined && !kundeLesen(deps.db, c.get("betreiberId"), neu.kundeId))
      return c.json({ fehler: "kein_kunde" }, 404);
    const kontext = {
      betreiberId: c.get("betreiberId"),
      akteur: c.get("nutzerId"),
      jetzt: deps.now(),
      grund,
    };
    const { server, token, gueltigBis } = serverAnlegen(deps.schreibDb, kontext, neu);
    return c.json(
      {
        serverId: server.serverId,
        name: server.name,
        art: server.art,
        gueltigBis,
        befehl: installBefehl(deps.agentUrl, token),
      },
      201,
    );
  });
};
