import { z } from "zod";
import { abwicklungAnsicht, archivLink } from "../modules/abwicklung/index.ts";
import { installationLesen } from "../modules/installationen/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Registrar } from "./zugang.ts";

/*
 * After the contract's end (BAULISTE.md Z-604; docs/plan.md, "Kündigung und Löschung"): where an
 * installation stands (phase, deadlines, archive, deletion log) for every role, and the link to the
 * archive for the customer, made with a reason for the owner and shown once: the answer
 * is the only place it appears, it is never stored and never logged (the request log has the path
 * only). An installation of another operator is unknown.
 */

const grundSchema = z.object({ grund: z.string().trim().min(1).max(500) }).strict();

const STATUS = {
  grund_fehlt: 400,
  keine_installation: 404,
  kein_archiv: 409,
  frist_abgelaufen: 409,
  kein_zugang: 409,
} as const;

export const abwicklungRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("GET /api/v1/installationen/:installationId/abwicklung", (c) => {
    const i = installationLesen(deps.db, c.get("betreiberId"), c.req.param("installationId") ?? "");
    if (!i) return c.json({ fehler: "keine_installation" }, 404);
    return c.json(abwicklungAnsicht(deps.db, i.betreiberId, i, deps.now()));
  });

  route("POST /api/v1/installationen/:installationId/archiv-link", async (c) => {
    const angaben = await eingabe(c, grundSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const kontext = {
      betreiberId: c.get("betreiberId"),
      akteur: c.get("nutzerId"),
      jetzt: deps.now(),
      grund: angaben.grund,
    };
    const r = await archivLink(deps, kontext, c.req.param("installationId") ?? "");
    if (!r.ok) return c.json({ fehler: r.grund }, STATUS[r.grund]);
    c.header("cache-control", "no-store");
    return c.json({ gueltigBis: r.gueltigBis, links: r.links });
  });
};
