import { z } from "zod";
import { ROLLEN } from "../auth/rollen.ts";
import { mitgliedEntfernen, mitgliederListe, rolleAendern } from "../modules/mitglieder/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Registrar } from "./zugang.ts";

const rolleSchema = z.object({ rolle: z.enum(ROLLEN) }).strict();

const STATUS = { kein_mitglied: 404, letzter_inhaber: 409 } as const;

/** The members of the caller's operator; the owner changes roles and removes members */
export const mitgliederRouten = (route: Registrar, deps: RoutenDeps): void => {
  const kontext = (c: { get: (k: "betreiberId" | "nutzerId") => string }) => ({
    betreiberId: c.get("betreiberId"),
    akteur: c.get("nutzerId"),
    jetzt: deps.now(),
    grund: "Mitglieder",
  });

  route("GET /api/v1/mitglieder", (c) =>
    c.json({ mitglieder: mitgliederListe(deps.db, c.get("betreiberId")) }),
  );

  route("PATCH /api/v1/mitglieder/:nutzerId", async (c) => {
    const angaben = await eingabe(c, rolleSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const nutzerId = c.req.param("nutzerId") ?? "";
    const k = kontext(c);
    const ergebnis = rolleAendern(deps.db, deps.schreibDb, k, nutzerId, angaben.rolle);
    if (!ergebnis.ok) return c.json({ fehler: ergebnis.grund }, STATUS[ergebnis.grund]);
    await deps.auth.rolleSetzen(k.betreiberId, nutzerId, angaben.rolle);
    return c.json({ nutzerId, rolle: angaben.rolle });
  });

  route("DELETE /api/v1/mitglieder/:nutzerId", async (c) => {
    const nutzerId = c.req.param("nutzerId") ?? "";
    const k = kontext(c);
    const ergebnis = mitgliedEntfernen(deps.db, deps.schreibDb, k, nutzerId);
    if (!ergebnis.ok) return c.json({ fehler: ergebnis.grund }, STATUS[ergebnis.grund]);
    await deps.auth.mitgliedschaftEntfernen(k.betreiberId, nutzerId);
    return c.body(null, 204);
  });
};
