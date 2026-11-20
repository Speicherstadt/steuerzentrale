import { z } from "zod";
import { ROLLEN } from "../auth/rollen.ts";
import { schreiben } from "../modules/audit/index.ts";
import {
  betreiberLesen,
  type Einladung,
  einladungAngenommen,
  einladungEinloesen,
  einladungErstellen,
  einladungFinden,
  einladungZurueckziehen,
  mitgliedEintragen,
  offeneEinladungen,
} from "../modules/mitglieder/index.ts";
import { eingabe, type RoutenDeps, sitzungUebernehmen } from "./deps.ts";
import { kontoSchema } from "./konto-schema.ts";
import type { Registrar } from "./zugang.ts";

const einladenSchema = z.object({ rolle: z.enum(ROLLEN) }).strict();
const tokenSchema = z.object({ token: z.string().min(1).max(256) }).strict();
const annehmenSchema = kontoSchema.extend({ token: z.string().min(1).max(256) }).strict();

const kontextVon = (c: { get: (k: "betreiberId" | "nutzerId") => string }, jetzt: number) => ({
  betreiberId: c.get("betreiberId"),
  akteur: c.get("nutzerId"),
  jetzt,
  grund: "Mitglieder",
});

const alsAntwort = (einladung: Einladung, jetzt: number) => ({
  einladungId: einladung.einladungId,
  rolle: einladung.rolle,
  angelegtAm: einladung.angelegtAm,
  gueltigBis: einladung.gueltigBis,
  abgelaufen: einladung.gueltigBis <= jetzt,
});

/**
 * Invitations by link (BAULISTE.md Z-104): the owner makes one for a role; the token stands after
 * the `#` of the link, so it reaches neither a server log nor a Referer, and the interface sends it
 * in the body, never in a path.
 */
export const einladungRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("GET /api/v1/einladungen", (c) => {
    const jetzt = deps.now();
    return c.json({
      einladungen: offeneEinladungen(deps.db, c.get("betreiberId")).map((e) =>
        alsAntwort(e, jetzt),
      ),
    });
  });

  route("POST /api/v1/einladungen", async (c) => {
    const angaben = await eingabe(c, einladenSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const { einladung, token } = einladungErstellen(
      deps.schreibDb,
      kontextVon(c, deps.now()),
      angaben.rolle,
    );
    return c.json(
      { ...alsAntwort(einladung, deps.now()), link: `${deps.url}/einladung#${token}` },
      201,
    );
  });

  route("DELETE /api/v1/einladungen/:einladungId", (c) => {
    const id = c.req.param("einladungId") ?? "";
    if (!einladungZurueckziehen(deps.db, deps.schreibDb, kontextVon(c, deps.now()), id))
      return c.json({ fehler: "nicht_gefunden" }, 404);
    return c.body(null, 204);
  });

  oeffentlicheEinladungRouten(route, deps);
};

/** The public side: what an invitation is for, and accepting it with a new account */
const oeffentlicheEinladungRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("POST /api/v1/einladung/ansehen", async (c) => {
    const angaben = await eingabe(c, tokenSchema);
    const einladung = angaben && einladungFinden(deps.db, angaben.token, deps.now());
    if (!einladung) return c.json({ fehler: "einladung_ungueltig" }, 404);
    return c.json({
      betreiber: betreiberLesen(deps.db, einladung.betreiberId)?.name ?? "",
      rolle: einladung.rolle,
      gueltigBis: einladung.gueltigBis,
    });
  });

  route("POST /api/v1/einladung/annehmen", async (c) => {
    const angaben = await eingabe(c, annehmenSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const einladung = einladungFinden(deps.db, angaben.token, deps.now());
    if (!einladung) return c.json({ fehler: "einladung_ungueltig" }, 404);
    if (await deps.auth.emailVergeben(angaben.email))
      return c.json({ fehler: "email_vergeben" }, 409);
    const { betreiberId, einladungId, rolle } = einladung;
    const kontext = { betreiberId, akteur: "einladung", jetzt: deps.now(), grund: "Einladung" };
    if (!einladungEinloesen(deps.schreibDb, kontext, einladungId))
      return c.json({ fehler: "einladung_ungueltig" }, 404);
    const konto = await deps.auth.kontoAnlegen({
      email: angaben.email,
      name: angaben.name,
      ...(angaben.passwort === undefined ? {} : { passwort: angaben.passwort }),
      betreiberId,
      rolle,
    });
    if (!konto.ok) return c.json({ fehler: konto.grund }, 409);
    const jetzt = deps.now();
    schreiben(
      deps.schreibDb,
      { ...kontext, akteur: konto.nutzerId, jetzt },
      "einladung.annehmen",
      (s) => {
        mitgliedEintragen(s, { betreiberId, nutzerId: konto.nutzerId, rolle }, jetzt);
        einladungAngenommen(s, einladungId, konto.nutzerId, jetzt);
      },
    );
    sitzungUebernehmen(c, konto.headers);
    return c.json({ betreiberId, nutzerId: konto.nutzerId }, 201);
  });
};
