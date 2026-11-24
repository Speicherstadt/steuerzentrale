import { z } from "zod";
import { darf } from "../auth/rollen.ts";
import {
  type SupportZugang,
  zugaengeListe,
  zugangAnsicht,
  zugangBeenden,
  zugangStarten,
} from "../modules/support/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import { nurFuerKunden, type Registrar } from "./zugang.ts";

/*
 * Support accesses (BAULISTE.md Z-802; docs/plan.md, "Support-Zugang"): every role lists them and
 * starts one for itself on an installation, with a reason and a duration; its holder ends it early,
 * owner and technik also another's. What an access opens, the guard checks (src/routes/zugang.ts).
 * An installation or access of another operator is unknown.
 */

const startSchema = z
  .object({
    installationId: z.string().min(1).max(200),
    grund: z.string().trim().min(1).max(500),
    dauerMinuten: z.number().optional(),
  })
  .strict();

const endeSchema = z.object({ grund: z.string().trim().min(1).max(500).optional() }).strict();

/** Why an access ended by hand, when its holder names none */
const ENDE_GRUND = "Support-Zugang von Hand beendet";

const STATUS = {
  grund_fehlt: 400,
  dauer: 400,
  keine_installation: 404,
  kein_zugang: 404,
  zugang_aktiv: 409,
  zugang_beendet: 409,
  keine_berechtigung: 403,
} as const;

/** An access as the API answers it, with whether the caller holds it */
const antwort = (a: SupportZugang, nutzerId: string) => ({ ...a, eigen: a.nutzer.id === nutzerId });

export const supportRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("GET /api/v1/support-zugaenge", (c) => {
    const filter = {
      kundeId: c.req.query("kundeId") || undefined,
      installationId: c.req.query("installationId") || undefined,
    };
    const liste = zugaengeListe(deps.db, c.get("betreiberId"), filter, deps.now());
    return c.json({ zugaenge: liste.map((a) => antwort(a, c.get("nutzerId"))) });
  });

  route("POST /api/v1/support-zugaenge", async (c) => {
    const angaben = await eingabe(c, startSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const gesperrt = nurFuerKunden(deps.db, c);
    if (gesperrt) return gesperrt;
    const kontext = {
      betreiberId: c.get("betreiberId"),
      akteur: c.get("nutzerId"),
      jetzt: deps.now(),
      grund: angaben.grund,
    };
    const r = zugangStarten(deps, kontext, angaben);
    if (!r.ok)
      return STATUS[r.grund] === 400
        ? c.json({ fehler: "ungueltig" }, 400)
        : c.json({ fehler: r.grund }, STATUS[r.grund]);
    const a = zugangAnsicht(deps.db, kontext.betreiberId, r.zugangId, kontext.jetzt);
    return a ? c.json(antwort(a, kontext.akteur), 201) : c.json({ fehler: "kein_zugang" }, 404);
  });

  route("POST /api/v1/support-zugaenge/:zugangId/beenden", async (c) => {
    const angaben = await eingabe(c, endeSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const zugangId = c.req.param("zugangId") ?? "";
    const kontext = {
      betreiberId: c.get("betreiberId"),
      akteur: c.get("nutzerId"),
      jetzt: deps.now(),
      grund: angaben.grund ?? ENDE_GRUND,
    };
    const alle = darf(c.get("rolle"), "support:verwalten");
    const r = zugangBeenden(deps, kontext, zugangId, alle);
    if (!r.ok) return c.json({ fehler: r.grund }, STATUS[r.grund]);
    const a = zugangAnsicht(deps.db, kontext.betreiberId, zugangId, kontext.jetzt);
    return a ? c.json(antwort(a, kontext.akteur)) : c.json({ fehler: "kein_zugang" }, 404);
  });
};
