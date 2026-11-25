import { KUERZEL } from "@steuerzentrale/manifest";
import { tagesbeginn } from "@steuerzentrale/planung";
import type { Context } from "hono";
import { z } from "zod";
import {
  type Ergebnis,
  internSetzen,
  kundeAendern,
  kundeAnlegen,
  kundeLesen,
  kundenListe,
  vertragsendeSetzen,
} from "../modules/kunden/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import { type Anfrage, nurFuerKunden, type Registrar } from "./zugang.ts";

/*
 * Customers and their contracts (BAULISTE.md Z-801): every role reads, the owner writes
 * (src/auth/rollen.ts); only the owner marks a customer as internal (Z-501). Every write names its reason in `grund`, which goes into the audit log.
 * The short name (Z-407) may be left out: a new customer gets one from its name, a change keeps it.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
// A contract day is the start of that day in Berlin (docs/kunden.md); the bound keeps the check
// within the range Intl can format
const LETZTER_TAG = Date.UTC(9999, 11, 31);
const tag = z
  .number()
  .int()
  .min(0)
  .max(LETZTER_TAG)
  .refine((t) => t <= LETZTER_TAG && tagesbeginn(t) === t);
const grund = text(500);

const stammdaten = {
  name: text(200),
  kontakt: z
    .object({ name: text(200), email: z.email().max(254), telefon: text(50).optional() })
    .strict(),
  notiz: text(2000).optional(),
  kuerzel: z.string().regex(KUERZEL).optional(),
};

// a contract has a beginning and, once given notice, an end; no SLA (Z-1202)
const anlegenSchema = z
  .object({
    ...stammdaten,
    vertrag: z.object({ beginn: tag }).strict(),
    grund,
  })
  .strict();
const aendernSchema = z.object({ ...stammdaten, beginn: tag, grund }).strict();
const kuendigenSchema = z.object({ ende: tag, grund }).strict();
const grundSchema = z.object({ grund }).strict();
const internSchema = z.object({ intern: z.boolean(), grund }).strict();

const STATUS = {
  kein_kunde: 404,
  ende_vor_beginn: 409,
  kuerzel_vergeben: 409,
  kuerzel_fest: 409,
  loeschung_laeuft: 409,
} as const;

const antwort = (c: Context<Anfrage>, ergebnis: Ergebnis, status: 200 | 201 = 200) =>
  ergebnis.ok
    ? c.json(ergebnis.kunde, status)
    : c.json({ fehler: ergebnis.grund }, STATUS[ergebnis.grund]);

export const kundenRouten = (route: Registrar, deps: RoutenDeps): void => {
  const kontext = (c: Context<Anfrage>, begruendung: string) => ({
    betreiberId: c.get("betreiberId"),
    akteur: c.get("nutzerId"),
    jetzt: deps.now(),
    grund: begruendung,
  });
  const ungueltig = (c: Context<Anfrage>) => c.json({ fehler: "ungueltig" }, 400);
  const kundeId = (c: Context<Anfrage>) => c.req.param("kundeId") ?? "";

  route("GET /api/v1/kunden", (c) =>
    c.json({ kunden: kundenListe(deps.db, c.get("betreiberId")) }),
  );

  route("GET /api/v1/kunden/:kundeId", (c) => {
    const kunde = kundeLesen(deps.db, c.get("betreiberId"), kundeId(c));
    return kunde ? c.json(kunde) : c.json({ fehler: "kein_kunde" }, 404);
  });

  route("POST /api/v1/kunden", async (c) => {
    const angaben = await eingabe(c, anlegenSchema);
    if (!angaben) return ungueltig(c);
    const gesperrt = nurFuerKunden(deps.db, c);
    if (gesperrt) return gesperrt;
    const { grund: begruendung, ...daten } = angaben;
    return antwort(c, kundeAnlegen(deps.db, deps.schreibDb, kontext(c, begruendung), daten), 201);
  });

  route("PUT /api/v1/kunden/:kundeId", async (c) => {
    const angaben = await eingabe(c, aendernSchema);
    if (!angaben) return ungueltig(c);
    const gesperrt = nurFuerKunden(deps.db, c);
    if (gesperrt) return gesperrt;
    const { grund: begruendung, ...daten } = angaben;
    return antwort(
      c,
      kundeAendern(deps.db, deps.schreibDb, kontext(c, begruendung), kundeId(c), daten),
    );
  });

  route("PUT /api/v1/kunden/:kundeId/kuendigung", async (c) => {
    const angaben = await eingabe(c, kuendigenSchema);
    if (!angaben) return ungueltig(c);
    const gesperrt = nurFuerKunden(deps.db, c);
    if (gesperrt) return gesperrt;
    const k = kontext(c, angaben.grund);
    const r = vertragsendeSetzen(deps.db, deps.schreibDb, k, kundeId(c), angaben.ende);
    deps.abwicklungAnstossen?.();
    return antwort(c, r);
  });

  // Z-501: our own customer, whose installations alone are offered pre-releases; only the owner
  route("PUT /api/v1/kunden/:kundeId/intern", async (c) => {
    const angaben = await eingabe(c, internSchema);
    if (!angaben) return ungueltig(c);
    const gesperrt = nurFuerKunden(deps.db, c);
    if (gesperrt) return gesperrt;
    const k = kontext(c, angaben.grund);
    return antwort(c, internSetzen(deps.db, deps.schreibDb, k, kundeId(c), angaben.intern));
  });

  route("DELETE /api/v1/kunden/:kundeId/kuendigung", async (c) => {
    const angaben = await eingabe(c, grundSchema);
    if (!angaben) return ungueltig(c);
    const gesperrt = nurFuerKunden(deps.db, c);
    if (gesperrt) return gesperrt;
    const k = kontext(c, angaben.grund);
    const r = vertragsendeSetzen(deps.db, deps.schreibDb, k, kundeId(c), null);
    deps.abwicklungAnstossen?.();
    return antwort(c, r);
  });
};
