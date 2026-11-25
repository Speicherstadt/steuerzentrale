import { z } from "zod";
import {
  einstellungenLesen,
  einstellungenSetzen,
  empfaengerAnlegen,
  empfaengerEntfernen,
  empfaengerLesen,
  testSenden,
  type Versand,
  zustellungenLesen,
} from "../modules/benachrichtigung/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Registrar } from "./zugang.ts";

/*
 * The operator's notifications (BAULISTE.md Z-703; docs/plan.md, "Benachrichtigungen"): every role
 * reads mail server, quiet hours, recipients and the newest deliveries; the owner changes
 * them with a reason and sends a test message. The SMTP password and a webhook's URL and key go in
 * and never come back: the password shows as `passwortGesetzt`, a webhook as its origin.
 */

// RFC 5321 allows more, but a line break, a bracket or a space in an address would make a header
const ADRESSE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const LOKAL = new Set(["localhost", "127.0.0.1", "::1"]);
const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;
// a key of the operator's own, 32 to 200 visible ASCII characters: the browser offers 43 of base64url
const SCHLUESSEL = /^[\x21-\x7e]{32,200}$/;
const SCHWERE = z.enum(["info", "warn", "fehler"]);
const GRUND = z.string().trim().min(1).max(500);

const smtpSchema = z
  .object({
    host: z.string().max(253).regex(HOST),
    port: z.number().int().min(1).max(65535),
    sicherheit: z.enum(["tls", "starttls", "keine"]),
    benutzer: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\r\n]+$/)
      .nullable(),
    absender: z.string().max(254).regex(ADRESSE),
    passwort: z
      .string()
      .min(1)
      .max(500)
      .regex(/^[^\r\n]+$/)
      .optional(),
  })
  .strict()
  // without TLS the mail goes only to a relay on the Zentrale's own machine
  .refine((s) => s.sicherheit !== "keine" || LOKAL.has(s.host), { path: ["sicherheit"] });

const ruhezeitSchema = z
  .object({ von: z.string().regex(UHRZEIT), bis: z.string().regex(UHRZEIT) })
  .strict()
  .refine((r) => r.von !== r.bis);

const setzenSchema = z
  .object({ smtp: smtpSchema.nullable(), ruhezeit: ruhezeitSchema.nullable(), grund: GRUND })
  .strict();

const webhookUrl = z
  .string()
  .max(2000)
  .refine((text) => {
    const url = URL.canParse(text) ? new URL(text) : undefined;
    return url?.protocol === "https:" && !url.username && !url.password && !url.hash;
  });

const empfaengerSchema = z.discriminatedUnion("art", [
  z
    .object({
      art: z.literal("mail"),
      adresse: z.string().max(254).regex(ADRESSE),
      abSchwere: SCHWERE,
      grund: GRUND,
    })
    .strict(),
  z
    .object({
      art: z.literal("webhook"),
      url: webhookUrl,
      schluessel: z.string().regex(SCHLUESSEL),
      abSchwere: SCHWERE,
      grund: GRUND,
    })
    .strict(),
]);

const grundSchema = z.object({ grund: GRUND }).strict();

export const benachrichtigungRouten = (
  route: Registrar,
  deps: RoutenDeps & { versand?: Versand },
): void => {
  const lesen = (betreiberId: string) => ({
    ...einstellungenLesen(deps.db, betreiberId),
    empfaenger: empfaengerLesen(deps.db, betreiberId),
    zustellungen: zustellungenLesen(deps.db, betreiberId),
  });

  const kontext = (c: Parameters<Parameters<Registrar>[1]>[0], grund: string) => ({
    betreiberId: c.get("betreiberId"),
    akteur: c.get("nutzerId"),
    jetzt: deps.now(),
    grund,
  });

  route("GET /api/v1/benachrichtigungen", (c) => c.json(lesen(c.get("betreiberId"))));

  route("PUT /api/v1/benachrichtigungen", async (c) => {
    const angaben = await eingabe(c, setzenSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const { grund, ...neu } = angaben;
    einstellungenSetzen(deps, kontext(c, grund), neu);
    return c.json(lesen(c.get("betreiberId")));
  });

  route("POST /api/v1/benachrichtigungen/empfaenger", async (c) => {
    const angaben = await eingabe(c, empfaengerSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const { grund, ...neu } = angaben;
    return c.json(empfaengerAnlegen(deps, kontext(c, grund), neu), 201);
  });

  route("DELETE /api/v1/benachrichtigungen/empfaenger/:empfaengerId", async (c) => {
    const angaben = await eingabe(c, grundSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const weg = empfaengerEntfernen(
      deps,
      kontext(c, angaben.grund),
      c.req.param("empfaengerId") ?? "",
    );
    return weg ? c.body(null, 204) : c.json({ fehler: "nicht_gefunden" }, 404);
  });

  route("POST /api/v1/benachrichtigungen/empfaenger/:empfaengerId/test", async (c) => {
    if (!deps.versand) return c.json({ fehler: "kein_versand" }, 503);
    const gesendet = testSenden(
      { ...deps, versand: deps.versand },
      c.get("betreiberId"),
      c.req.param("empfaengerId") ?? "",
      deps.now(),
    );
    if (!gesendet) return c.json({ fehler: "nicht_gefunden" }, 404);
    const g = await gesendet;
    return g.ok
      ? c.json({ ok: true })
      : c.json({ fehler: "nicht_zugestellt", detail: g.fehler }, 502);
  });
};
