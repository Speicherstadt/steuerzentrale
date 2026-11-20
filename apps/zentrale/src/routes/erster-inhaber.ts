import { z } from "zod";
import {
  einrichtungOffen,
  einrichtungscodeEinloesen,
} from "../modules/anmeldung/einrichtungscode.ts";
import { schreiben } from "../modules/audit/index.ts";
import { betreiberAnlegen, mitgliedEintragen } from "../modules/mitglieder/index.ts";
import { eingabe, type RoutenDeps, sitzungUebernehmen } from "./deps.ts";
import { kontoSchema } from "./konto-schema.ts";
import type { Registrar } from "./zugang.ts";

const ersterInhaberSchema = kontoSchema
  .extend({ code: z.string().min(1).max(256), betreiber: z.string().trim().min(1).max(100) })
  .strict();

type Inhaber = { betreiber: string; name: string; email: string; passwort?: string | undefined };

/**
 * An operator with its organization and first owner, signed in: Better Auth makes account,
 * organization and membership, `schreiben` the operator row and the mirror of the membership.
 * Partners (BAULISTE.md, phase 8) will come in the same way.
 */
export const betreiberEinrichten = async (
  deps: RoutenDeps,
  betreiberId: string,
  angaben: Inhaber,
) => {
  const konto = await deps.auth.kontoAnlegen({
    email: angaben.email,
    name: angaben.name,
    ...(angaben.passwort === undefined ? {} : { passwort: angaben.passwort }),
    betreiberId,
    betreiberName: angaben.betreiber,
    rolle: "inhaber",
  });
  if (!konto.ok) return konto;
  const jetzt = deps.now();
  const kontext = { betreiberId, akteur: konto.nutzerId, jetzt, grund: "Erster Inhaber" };
  schreiben(deps.schreibDb, kontext, "betreiber.anlegen", (s) => {
    betreiberAnlegen(s, betreiberId, angaben.betreiber, jetzt);
    mitgliedEintragen(s, { betreiberId, nutzerId: konto.nutzerId, rolle: "inhaber" }, jetzt);
  });
  return konto;
};

/**
 * The first owner (docs/plan.md, "Anmeldung an der Zentrale"): with the setup code from the log,
 * the operator and its owner are made at once. GET tells the interface whether the setup is open.
 */
export const ersterInhaberRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("GET /api/v1/erster-inhaber", (c) => c.json({ offen: einrichtungOffen(deps.db) }));

  route("POST /api/v1/erster-inhaber", async (c) => {
    const angaben = await eingabe(c, ersterInhaberSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    if (!einrichtungOffen(deps.db)) return c.json({ fehler: "abgeschlossen" }, 409);
    // checked before the code is used up, so a taken address does not cost the code
    if (await deps.auth.emailVergeben(angaben.email))
      return c.json({ fehler: "email_vergeben" }, 409);
    const eingeloest = einrichtungscodeEinloesen(deps.db, deps.schreibDb, angaben.code, deps.now());
    if (!eingeloest.ok)
      return eingeloest.grund === "abgeschlossen"
        ? c.json({ fehler: "abgeschlossen" }, 409)
        : c.json({ fehler: "code_ungueltig" }, 403);
    const konto = await betreiberEinrichten(deps, eingeloest.betreiberId, angaben);
    if (!konto.ok) return c.json({ fehler: konto.grund }, 409);
    sitzungUebernehmen(c, konto.headers);
    return c.json({ betreiberId: eingeloest.betreiberId, nutzerId: konto.nutzerId }, 201);
  });
};
