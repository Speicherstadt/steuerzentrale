import type { InstallationsAktion } from "@steuerzentrale/manifest";
import type { Context } from "hono";
import { z } from "zod";
import type { Auftrag } from "../modules/auftraege/index.ts";
import { logAuszugLesen } from "../modules/auftraege/log-auszug.ts";
import { aktionAusloesen } from "../modules/installationen/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import { grund } from "./grund.ts";
import type { Anfrage, Registrar, RoutenName } from "./zugang.ts";

/*
 * The actions of an installation (BAULISTE.md Z-405; docs/plan.md, "Aktionen einer Installation"):
 * restart (`installationen:neustart`) and log excerpt (`installationen:log_auszug`) for both roles,
 * "nur lesen" for the owner (`installationen:schreiben`), each with its reason in `grund`; the lines of a log
 * excerpt only to the roles with that right. An installation or job of another operator is unknown.
 */

const grundSchema = z.object({ grund }).strict();

const STATUS: Record<string, 404 | 409 | 422> = {
  keine_installation: 404,
  laeuft_nicht: 409,
  sperrzeit: 409,
  auftrag_offen: 409,
  nicht_angeboten: 422,
  nicht_ausfuehrbar: 422,
};

/** A job as the actions answer it: never its manifest or signature */
const auftragAntwort = (a: Auftrag) => ({
  auftragId: a.auftragId,
  aktion: a.aktion,
  zustand: a.zustand,
  angelegtAm: a.angelegtAm,
});

/** The failure of a job that ended, for the page */
const fehlerVon = (a: Auftrag): string | null => {
  const e = a.ergebnis ? (JSON.parse(a.ergebnis) as { ok: boolean; fehler?: string }) : null;
  return e && !e.ok ? (e.fehler ?? null) : null;
};

const ROUTEN: readonly [RoutenName, InstallationsAktion][] = [
  ["POST /api/v1/installationen/:installationId/neustart", "neustart"],
  ["POST /api/v1/installationen/:installationId/log-auszug", "log_auszug"],
  ["POST /api/v1/installationen/:installationId/nur-lesen", "nur_lesen"],
];

export const aktionenRouten = (route: Registrar, deps: RoutenDeps): void => {
  const installationId = (c: Context<Anfrage>) => c.req.param("installationId") ?? "";

  for (const [name, aktion] of ROUTEN)
    route(name, async (c) => {
      const angaben = await eingabe(c, grundSchema);
      if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
      const kontext = {
        betreiberId: c.get("betreiberId"),
        akteur: c.get("nutzerId"),
        jetzt: deps.now(),
        grund: angaben.grund,
      };
      const r = aktionAusloesen(deps, kontext, installationId(c), aktion);
      if (!r.ok)
        return c.json(
          { fehler: r.grund, ...(r.detail === undefined ? {} : { detail: r.detail }) },
          STATUS[r.grund] ?? 400,
        );
      return c.json({ auftrag: auftragAntwort(r.auftrag) }, 201);
    });

  route("GET /api/v1/installationen/:installationId/log-auszuege/:auftragId", (c) => {
    const l = logAuszugLesen(
      deps.db,
      c.get("betreiberId"),
      installationId(c),
      c.req.param("auftragId") ?? "",
    );
    if (!l) return c.json({ fehler: "kein_log_auszug" }, 404);
    return c.json({
      ...auftragAntwort(l.auftrag),
      fehler: fehlerVon(l.auftrag),
      zeilen: l.zeilen,
      zeitpunkt: l.zeitpunkt,
    });
  });
};
