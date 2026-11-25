import {
  healthPfadGueltig,
  linuxNutzerGueltig,
  UNITS_MAX,
  unitGueltig,
} from "@steuerzentrale/protokoll";
import type { Context } from "hono";
import { z } from "zod";
import { hostAusAdresse, PFAD_MAX, pfadGueltig } from "../modules/dienste/adresse.ts";
import { beobachtenSenden } from "../modules/dienste/beobachten.ts";
import {
  type DienstDaten,
  dienstAendern,
  dienstAnlegen,
  dienstEntfernen,
  diensteListe,
  type Ergebnis,
} from "../modules/dienste/dienste.ts";
import type { Innen } from "../modules/dienste/innen.ts";
import { dienstZeileLesen } from "../modules/dienste/lesen.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Anfrage, Registrar } from "./zugang.ts";

/*
 * Observed services (BAULISTE.md Z-1101): every role reads, the owner makes, changes and removes
 * (src/auth/rollen.ts). The address is `https://<host>` and nothing else (modules/dienste/adresse.ts),
 * the health path `/` unless given; nobody is asked for a reason (BAULISTE.md, Stufe 2). Only a
 * service of the session's operator; any other is 404. On a server that is only observed the
 * agent may read its units inside (Z-1103): names off the protocol's patterns are 400, a server not
 * the operator's 404, a managed one 409; the agents of the servers before and after get the new list.
 */

const innenSchema = z
  .object({
    serverId: z.string().min(1).max(200),
    /** null: units of the system */
    nutzer: z.string().refine(linuxNutzerGueltig).nullable(),
    units: z.array(z.string().refine(unitGueltig)).min(1).max(UNITS_MAX),
    /** The check on 127.0.0.1: with a path HTTP, without TCP, without a port none */
    port: z.number().int().min(1).max(65535).nullable().default(null),
    pfad: z.string().refine(healthPfadGueltig).nullable().default(null),
  })
  .strict();

const innenAus = (i: z.infer<typeof innenSchema> | null): Innen | null =>
  i && {
    serverId: i.serverId,
    nutzer: i.nutzer,
    units: [...new Set(i.units)],
    health:
      i.port === null
        ? { art: "keine" }
        : i.pfad === null
          ? { art: "tcp", port: i.port }
          : { art: "http", port: i.port, pfad: i.pfad },
  };

const angabenSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    adresse: z
      .string()
      .max(300)
      .refine((a) => hostAusAdresse(a) !== undefined),
    pfad: z.string().max(PFAD_MAX).refine(pfadGueltig).default("/"),
    kundeId: z.string().min(1).max(100).nullable().default(null),
    innen: innenSchema.nullable().default(null),
  })
  .strict();

const datenAus = (a: z.infer<typeof angabenSchema>): DienstDaten => ({
  name: a.name,
  host: hostAusAdresse(a.adresse) ?? "",
  pfad: a.pfad,
  kundeId: a.kundeId,
  innen: innenAus(a.innen),
});

const STATUS = {
  kein_dienst: 404,
  kein_kunde: 404,
  kein_server: 404,
  server_verwaltet: 409,
  ungueltig: 400,
} as const;

const antwort = (c: Context<Anfrage>, e: Ergebnis, status: 200 | 201 = 200) =>
  e.ok ? c.json(e.dienst, status) : c.json({ fehler: e.grund }, STATUS[e.grund]);

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
    const e = dienstAnlegen(deps.db, deps.schreibDb, k, datenAus(angaben));
    if (e.ok) beobachtenSenden(deps, k.betreiberId, [e.dienst.innen?.serverId]);
    return antwort(c, e, 201);
  });

  route("PUT /api/v1/dienste/:dienstId", async (c) => {
    const angaben = await eingabe(c, angabenSchema);
    if (!angaben) return ungueltig(c);
    const k = kontext(c, "Dienst geändert");
    const vorher = dienstZeileLesen(deps.db, k.betreiberId, dienstId(c))?.serverId;
    const e = dienstAendern(deps.db, deps.schreibDb, k, dienstId(c), datenAus(angaben));
    if (e.ok) beobachtenSenden(deps, k.betreiberId, [vorher, e.dienst.innen?.serverId]);
    return antwort(c, e);
  });

  route("DELETE /api/v1/dienste/:dienstId", (c) => {
    const k = kontext(c, "Dienst entfernt");
    const vorher = dienstZeileLesen(deps.db, k.betreiberId, dienstId(c))?.serverId;
    const r = dienstEntfernen(deps.db, deps.schreibDb, k, dienstId(c));
    if (r.ok) beobachtenSenden(deps, k.betreiberId, [vorher]);
    return r.ok ? c.body(null, 204) : c.json({ fehler: r.grund }, 404);
  });
};
