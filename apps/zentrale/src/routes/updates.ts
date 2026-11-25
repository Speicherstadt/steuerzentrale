import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { z } from "zod";
import { darf } from "../auth/rollen.ts";
import type { Auftrag } from "../modules/auftraege/index.ts";
import {
  type UpdateDeps,
  updateAnlegen,
  updatePlanLesen,
  updateStand,
} from "../modules/updates/index.ts";
import { angeboteFuer } from "../modules/versionen/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import { grund } from "./grund.ts";
import type { Anfrage, Registrar } from "./zugang.ts";

/*
 * Updates (BAULISTE.md Z-503; docs/plan.md, "Update in der Zentrale (Z-503)"): every role reads,
 * for each installation of its operator, the versions it is offered (Z-501), where the plan stands
 * for it (its wave and next slot, or why it waits) and its last update; the owner updates
 * one by hand to a version it is offered, with a reason. In a freeze window of the app only the
 * owner may, and the update keeps that it passed over it. An installation of another operator is
 * unknown.
 */

const updateSchema = z
  .object({
    version: z.string().min(1).max(100),
    grund,
  })
  .strict();

const STATUS: Record<string, 404 | 409 | 422 | 503> = {
  keine_installation: 404,
  laeuft_nicht: 409,
  nicht_eingerichtet: 409,
  auftrag_offen: 409,
  server_belegt: 409,
  sperrzeit: 409,
  kein_manifest: 422,
  nicht_angeboten: 422,
  signatur_ungueltig: 422,
  manifest_ungueltig: 422,
  werte_fehlen: 422,
  werte_unlesbar: 422,
  nicht_ausfuehrbar: 422,
  kein_schluessel: 503,
};

/** A job as an answer names it */
const kurz = ({ auftragId, aktion, zustand, angelegtAm }: Auftrag) => ({
  auftragId,
  aktion,
  zustand,
  angelegtAm,
});

export const updateRouten = (route: Registrar, deps: RoutenDeps): void => {
  const updateDeps: UpdateDeps = { ...deps, zufall: (n) => new Uint8Array(randomBytes(n)) };

  route("GET /api/v1/updates", (c) => {
    const betreiberId = c.get("betreiberId");
    const plan = new Map(
      updatePlanLesen(deps.db, betreiberId, deps.now()).map((z) => [
        z.installationId,
        { welle: z.welle, version: z.version, ...z.ergebnis },
      ]),
    );
    return c.json({
      installationen: angeboteFuer(deps.db, betreiberId).map((i) => ({
        ...i,
        plan: plan.get(i.installationId) ?? null,
        update: updateStand(deps.db, betreiberId, i.installationId),
      })),
    });
  });

  route("POST /api/v1/installationen/:installationId/update", async (c: Context<Anfrage>) => {
    const angaben = await eingabe(c, updateSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const schluessel = await deps.auslieferung.manifestSchluessel();
    if (!schluessel) return c.json({ fehler: "kein_schluessel" }, STATUS.kein_schluessel);
    const kontext = {
      betreiberId: c.get("betreiberId"),
      akteur: c.get("nutzerId"),
      jetzt: deps.now(),
      grund: angaben.grund,
    };
    const r = updateAnlegen(updateDeps, kontext, schluessel, c.req.param("installationId") ?? "", {
      version: angaben.version,
      anlass: "hand",
      sperrzeitUebergehen: darf(c.get("rolle"), "installationen:sperrzeit"),
    });
    if (!r.ok)
      return c.json(
        { fehler: r.grund, ...(r.detail === undefined ? {} : { detail: r.detail }) },
        STATUS[r.grund] ?? 400,
      );
    return c.json({ backup: kurz(r.backup), update: kurz(r.update) }, 201);
  });
};
