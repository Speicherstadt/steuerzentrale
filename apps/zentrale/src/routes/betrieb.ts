import type { Context } from "hono";
import {
  auditSeite,
  auftraegeSeite,
  ereignisseSeite,
  groesseLesen,
  markeLesen,
  type Seite,
  uebersichtLesen,
} from "../modules/betrieb/index.ts";
import type { Marke } from "../modules/betrieb/seite.ts";
import type { RoutenDeps } from "./deps.ts";
import type { Anfrage, Registrar } from "./zugang.ts";

/*
 * Reading what happens (BAULISTE.md Z-406; docs/plan.md, "Echte Daten (Z-406)"): the overview, and
 * jobs, events and the audit log page by page. Each reads the operator of the session only; the
 * lists take `?weiter=` (the cursor of the page before), `?anzahl=` (1 to 200) and their filters,
 * each repeatable (`?zustand=gescheitert&zustand=abgebrochen`).
 */

type Lesen<F, T> = (
  db: RoutenDeps["db"],
  betreiberId: string,
  filter: F,
  marke: Marke | undefined,
  groesse: number,
) => Seite<T>;

/** The list's page for the request's cursor, size and filters; 400 for a cursor or size it did not get */
const seite =
  <F extends Record<string, string[]>, T>(
    deps: RoutenDeps,
    filter: (keyof F & string)[],
    lesen: Lesen<F, T>,
  ) =>
  (c: Context<Anfrage>) => {
    const marke = markeLesen(c.req.query("weiter"));
    const groesse = groesseLesen(c.req.query("anzahl"));
    if (!marke.ok || groesse === undefined) return c.json({ fehler: "ungueltig" }, 400);
    const werte = Object.fromEntries(filter.map((name) => [name, c.req.queries(name) ?? []])) as F;
    return c.json(lesen(deps.db, c.get("betreiberId"), werte, marke.marke, groesse));
  };

export const betriebRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("GET /api/v1/uebersicht", (c) =>
    c.json({
      eintraege: uebersichtLesen(
        {
          db: deps.db,
          jetzt: deps.now(),
          verbundenSeit: (b, s) => deps.verbindungen.verbundenSeit(b, s),
        },
        c.get("betreiberId"),
      ),
    }),
  );
  route(
    "GET /api/v1/auftraege",
    seite(deps, ["zustand", "serverId", "installationId"], auftraegeSeite),
  );
  route("GET /api/v1/ereignisse", seite(deps, ["schwere", "art", "ziel"], ereignisseSeite));
  route("GET /api/v1/audit", seite(deps, ["akteur", "aktion", "ziel"], auditSeite));
};
