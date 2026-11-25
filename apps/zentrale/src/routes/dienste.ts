import type { Context } from "hono";
import { z } from "zod";
import { hostAusAdresse, PFAD_MAX, pfadGueltig } from "../modules/dienste/adresse.ts";
import {
  type DienstDaten,
  dienstAendern,
  dienstAnlegen,
  dienstEntfernen,
  diensteListe,
  type Ergebnis,
} from "../modules/dienste/dienste.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Anfrage, Registrar } from "./zugang.ts";

/*
 * Observed services (BAULISTE.md Z-1101): every role reads, the owner makes, changes and removes
 * (src/auth/rollen.ts). The address is `https://<host>` and nothing else (modules/dienste/adresse.ts),
 * the health path `/` unless given; nobody is asked for a reason (BAULISTE.md, Stufe 2). Only a
 * service of the session's operator; any other is 404.
 */

const angabenSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    adresse: z
      .string()
      .max(300)
      .refine((a) => hostAusAdresse(a) !== undefined),
    pfad: z.string().max(PFAD_MAX).refine(pfadGueltig).default("/"),
    kundeId: z.string().min(1).max(100).nullable().default(null),
  })
  .strict();

const datenAus = (a: z.infer<typeof angabenSchema>): DienstDaten => ({
  name: a.name,
  host: hostAusAdresse(a.adresse) ?? "",
  pfad: a.pfad,
  kundeId: a.kundeId,
});

const antwort = (c: Context<Anfrage>, e: Ergebnis, status: 200 | 201 = 200) =>
  e.ok ? c.json(e.dienst, status) : c.json({ fehler: e.grund }, 404);

export const dienstRouten = (route: Registrar, deps: RoutenDeps): void => {
  const kontext = (c: Context<Anfrage>, grund: string) => ({
    betreiberId: c.get("betreiberId"),
    akteur: c.get("nutzerId"),
    jetzt: deps.now(),
    grund,
  });
  const dienstId = (c: Context<Anfrage>) => c.req.param("dienstId") ?? "";
  const ungueltig = (c: Context<Anfrage>) => c.json({ fehler: "ungueltig" }, 400);

  route("GET /api/v1/dienste", (c) =>
    c.json({ dienste: diensteListe(deps.db, c.get("betreiberId"), deps.now()) }),
  );

  route("POST /api/v1/dienste", async (c) => {
    const angaben = await eingabe(c, angabenSchema);
    if (!angaben) return ungueltig(c);
    const k = kontext(c, "Dienst angelegt");
    return antwort(c, dienstAnlegen(deps.db, deps.schreibDb, k, datenAus(angaben)), 201);
  });

  route("PUT /api/v1/dienste/:dienstId", async (c) => {
    const angaben = await eingabe(c, angabenSchema);
    if (!angaben) return ungueltig(c);
    const k = kontext(c, "Dienst geändert");
    return antwort(c, dienstAendern(deps.db, deps.schreibDb, k, dienstId(c), datenAus(angaben)));
  });

  route("DELETE /api/v1/dienste/:dienstId", (c) => {
    const r = dienstEntfernen(deps.db, deps.schreibDb, kontext(c, "Dienst entfernt"), dienstId(c));
    return r.ok ? c.body(null, 204) : c.json({ fehler: r.grund }, 404);
  });
};
