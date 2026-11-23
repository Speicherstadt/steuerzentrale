import { aussenLesen } from "../modules/aussen/index.ts";
import { installationLesen } from "../modules/installationen/index.ts";
import type { RoutenDeps } from "./deps.ts";
import type { Registrar } from "./zugang.ts";

/*
 * The check from outside and the availability of one installation (BAULISTE.md Z-704;
 * docs/plan.md, "Prüfung von außen", "Verfügbarkeit"): its newest check with what each step
 * answered, unknown after three minutes without one, and the availability of the current month
 * and the twelve before. Only an installation of the session's operator; any other is 404.
 */
export const aussenRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("GET /api/v1/installationen/:installationId/aussen", (c) => {
    const betreiberId = c.get("betreiberId");
    const i = installationLesen(deps.db, betreiberId, c.req.param("installationId") ?? "");
    if (!i) return c.json({ fehler: "keine_installation" }, 404);
    return c.json(aussenLesen(deps.db, betreiberId, i.installationId, deps.now()));
  });
};
