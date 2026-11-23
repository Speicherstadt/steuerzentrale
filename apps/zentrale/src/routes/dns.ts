import { HOST } from "@steuerzentrale/manifest";
import { z } from "zod";
import { dnsEinstellungenLesen, dnsEinstellungenSetzen } from "../modules/dns/index.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Registrar } from "./zugang.ts";

/*
 * The operator's DNS at Cloudflare (BAULISTE.md Z-407; docs/plan.md, "DNS über Cloudflare"): every
 * role reads domain, zone id and whether a token is set; owner and technik set them with a reason.
 * The token comes back only as `tokenGesetzt`; left out, the one set before stays. Domain and zone
 * stay as they are while an installation has records there (`dns_in_benutzung`): its records are
 * deleted where they were set.
 */

// Cloudflare's ids are 32 hex digits; its API tokens 40 characters of letters, digits, _ and -
const ZONE_ID = /^[0-9a-f]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

const setzenSchema = z
  .object({
    domain: z.string().regex(HOST, "a lowercase domain with a dot"),
    zoneId: z.string().regex(ZONE_ID),
    token: z.string().regex(TOKEN).optional(),
    grund: z.string().trim().min(1).max(500),
  })
  .strict();

export const dnsRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("GET /api/v1/dns", (c) => c.json(dnsEinstellungenLesen(deps.db, c.get("betreiberId"))));

  route("PUT /api/v1/dns", async (c) => {
    const angaben = await eingabe(c, setzenSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const { grund, ...neu } = angaben;
    const kontext = {
      betreiberId: c.get("betreiberId"),
      akteur: c.get("nutzerId"),
      jetzt: deps.now(),
      grund,
    };
    const gesetzt = dnsEinstellungenSetzen(deps, kontext, neu);
    if (!gesetzt.ok) return c.json({ fehler: gesetzt.grund }, 409);
    // records that waited for a token (or a new one) are tried at once
    deps.dnsAnstossen?.();
    return c.json(gesetzt.einstellungen);
  });
};
