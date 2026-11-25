import { aussenLesen, TAGE_MAX, tageLesen } from "../modules/aussen/index.ts";
import { installationLesen } from "../modules/installationen/index.ts";
import { lastVerlauf, nutzerLast } from "../modules/server/index.ts";
import type { RoutenDeps } from "./deps.ts";
import type { Registrar } from "./zugang.ts";

/** How many days the availability per day covers without `tage`: the bars of the page "Messwerte" */
const TAGE_VORGABE = 90;

/** `tage` as a whole number from 1 to TAGE_MAX, the default without it, else undefined */
const tageAusText = (text: string | undefined): number | undefined => {
  if (text === undefined) return TAGE_VORGABE;
  if (!/^\d{1,3}$/.test(text)) return undefined;
  const tage = Number(text);
  return tage >= 1 && tage <= TAGE_MAX ? tage : undefined;
};

/*
 * The check from outside and the availability of one installation (BAULISTE.md Z-704;
 * docs/plan.md, "Prüfung von außen", "Verfügbarkeit"): its newest check with what each step
 * answered, unknown after three minutes without one, and the availability of the current month
 * and the twelve before; and the availability of each of its last days in Berlin, read from the
 * same hourly counts, for the bars of the app's tab "Messwerte". Only an installation of the
 * session's operator; any other is 404.
 */
export const aussenRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("GET /api/v1/installationen/:installationId/aussen", (c) => {
    const betreiberId = c.get("betreiberId");
    const i = installationLesen(deps.db, betreiberId, c.req.param("installationId") ?? "");
    if (!i) return c.json({ fehler: "keine_installation" }, 404);
    return c.json(aussenLesen(deps.db, betreiberId, i.installationId, deps.now()));
  });

  route("GET /api/v1/installationen/:installationId/verfuegbarkeit", (c) => {
    const betreiberId = c.get("betreiberId");
    const tage = tageAusText(c.req.query("tage"));
    if (tage === undefined) return c.json({ fehler: "ungueltig" }, 400);
    const i = installationLesen(deps.db, betreiberId, c.req.param("installationId") ?? "");
    if (!i) return c.json({ fehler: "keine_installation" }, 404);
    return c.json({ tage: tageLesen(deps.db, betreiberId, i.installationId, tage, deps.now()) });
  });

  // Z-1106: CPU and memory of the installation's Linux user, per hour, from its server's facts;
  // `tage` up to the 30 days the facts are kept
  route("GET /api/v1/installationen/:installationId/last", (c) => {
    const betreiberId = c.get("betreiberId");
    const tage = tageAusText(c.req.query("tage") ?? "30");
    if (tage === undefined || tage > 30) return c.json({ fehler: "ungueltig" }, 400);
    const i = installationLesen(deps.db, betreiberId, c.req.param("installationId") ?? "");
    if (!i) return c.json({ fehler: "keine_installation" }, 404);
    const stunden = lastVerlauf(deps.db, betreiberId, i.serverId, tage, deps.now());
    return c.json({ stunden: nutzerLast(stunden, `sz-${i.installationId}`) });
  });
};
