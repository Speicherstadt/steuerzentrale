import { tagesbeginn } from "@steuerzentrale/planung";
import type { Context } from "hono";
import { z } from "zod";
import {
  type Ergebnis,
  kundeAendern,
  kundeAnlegen,
  kundeLesen,
  kundenListe,
  vertragsendeSetzen,
} from "../modules/kunden/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Anfrage, Registrar } from "./zugang.ts";

/*
 * Customers and their contracts (BAULISTE.md Z-801): every role reads, owner and technik write
 * (src/auth/rollen.ts). Every write names its reason in `grund`, which goes into the audit log.
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
};

// stage 1 offers only SLA Basis; the schema of the table carries Plus and Ruhe for Z-505
const anlegenSchema = z
  .object({
    ...stammdaten,
    vertrag: z.object({ sla: z.literal("basis"), beginn: tag }).strict(),
    grund,
  })
  .strict();
const aendernSchema = z.object({ ...stammdaten, beginn: tag, grund }).strict();
const kuendigenSchema = z.object({ ende: tag, grund }).strict();
const grundSchema = z.object({ grund }).strict();

const STATUS = { kein_kunde: 404, ende_vor_beginn: 409 } as const;

const antwort = (c: Context<Anfrage>, ergebnis: Ergebnis) =>
  ergebnis.ok ? c.json(ergebnis.kunde) : c.json({ fehler: ergebnis.grund }, STATUS[ergebnis.grund]);

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
    const { grund: begruendung, ...daten } = angaben;
    return c.json(kundeAnlegen(deps.db, deps.schreibDb, kontext(c, begruendung), daten), 201);
  });

  route("PUT /api/v1/kunden/:kundeId", async (c) => {
    const angaben = await eingabe(c, aendernSchema);
    if (!angaben) return ungueltig(c);
    const { grund: begruendung, ...daten } = angaben;
    return antwort(
      c,
      kundeAendern(deps.db, deps.schreibDb, kontext(c, begruendung), kundeId(c), daten),
    );
  });

  route("PUT /api/v1/kunden/:kundeId/kuendigung", async (c) => {
    const angaben = await eingabe(c, kuendigenSchema);
    if (!angaben) return ungueltig(c);
    const k = kontext(c, angaben.grund);
    return antwort(c, vertragsendeSetzen(deps.db, deps.schreibDb, k, kundeId(c), angaben.ende));
  });

  route("DELETE /api/v1/kunden/:kundeId/kuendigung", async (c) => {
    const angaben = await eingabe(c, grundSchema);
    if (!angaben) return ungueltig(c);
    const k = kontext(c, angaben.grund);
    return antwort(c, vertragsendeSetzen(deps.db, deps.schreibDb, k, kundeId(c), null));
  });
};
