import { z } from "zod";

/*
 * The few calls of Cloudflare's API v4 the Zentrale makes for DNS records (Z-407; docs/plan.md,
 * "DNS über Cloudflare"), with the `fetch` passed in, so the tests run them against the stand-in in
 * testhilfen/cloudflare.ts. Source: Cloudflare API, DNS Records for a Zone
 * (https://developers.cloudflare.com/api/resources/dns/subresources/records/): GET
 * /zones/:zone_id/dns_records with the filters `name` and `per_page`, POST, PATCH and DELETE on
 * /zones/:zone_id/dns_records/:id, the token as `Authorization: Bearer`, every answer in the
 * envelope `{ success, errors: [{ code, message }], result }`. The token goes only into that header:
 * it is replaced in every error text, so no log, event or answer can carry it.
 */

/** Where the API is; only the tests point it elsewhere (STEUERZENTRALE_CLOUDFLARE_API) */
export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

const ZEITLIMIT_MS = 10_000;
const FEHLER_MAX = 300;

export type Zugang = { fetch: typeof fetch; basis: string; token: string; zoneId: string };

export type DnsEintrag = {
  id: string;
  type: string;
  name: string;
  content: string;
  comment: string | null;
};

export type NeuerEintrag = {
  type: "A" | "AAAA";
  name: string;
  content: string;
  ttl: number;
  proxied: false;
  comment: string;
};

export type Ergebnis<T> = { ok: true; wert: T } | { ok: false; fehler: string };

const Eintrag = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  content: z.string(),
  comment: z.string().nullish(),
});

const Umschlag = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number().optional(), message: z.string() })).default([]),
  result: z.unknown(),
});

/** The text with the token replaced, cut short: what may stand in a log or an event */
export const ohneToken = (text: string, token: string): string =>
  (token === "" ? text : text.split(token).join("[token]")).slice(0, FEHLER_MAX);

type Methode = "GET" | "POST" | "PATCH" | "DELETE";

/** One call; its result checked against `schema`, every failure as a text without the token */
const aufruf = async <T>(
  zugang: Zugang,
  methode: Methode,
  pfad: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<Ergebnis<T>> => {
  const url = `${zugang.basis}/zones/${encodeURIComponent(zugang.zoneId)}/dns_records${pfad}`;
  try {
    const antwort = await zugang.fetch(url, {
      method: methode,
      headers: {
        authorization: `Bearer ${zugang.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
    });
    const umschlag = Umschlag.safeParse(await antwort.json().catch(() => null));
    if (!umschlag.success) return nein(zugang, `HTTP ${antwort.status}: no answer of the API`);
    const { success, errors, result } = umschlag.data;
    if (!antwort.ok || !success) {
      const gruende = errors.map((e) => `${e.code ?? ""} ${e.message}`.trim()).join("; ");
      return nein(zugang, `HTTP ${antwort.status}: ${gruende || "failed"}`);
    }
    const wert = schema.safeParse(result);
    return wert.success ? { ok: true, wert: wert.data } : nein(zugang, "unexpected result");
  } catch (fehler) {
    return nein(zugang, String(fehler));
  }
};

const nein = (zugang: Zugang, text: string) =>
  ({ ok: false, fehler: ohneToken(text, zugang.token) }) as const;

const alsEintrag = (e: z.infer<typeof Eintrag>): DnsEintrag => ({
  ...e,
  comment: e.comment ?? null,
});

/** The records of exactly this name (Cloudflare matches `name` exactly; checked again here) */
export const eintraegeLesen = async (
  zugang: Zugang,
  name: string,
): Promise<Ergebnis<DnsEintrag[]>> => {
  const suche = new URLSearchParams({ name, per_page: "100" });
  const liste = await aufruf(zugang, "GET", `?${suche}`, z.array(Eintrag));
  if (!liste.ok) return liste;
  const gleich = (e: { name: string }) => e.name.toLowerCase() === name.toLowerCase();
  return { ok: true, wert: liste.wert.filter(gleich).map(alsEintrag) };
};

export const eintragAnlegen = (zugang: Zugang, neu: NeuerEintrag) =>
  aufruf(zugang, "POST", "", Eintrag, neu);

/** Only the content changes; type, name, comment and TTL stay */
export const eintragAendern = (zugang: Zugang, id: string, content: string) =>
  aufruf(zugang, "PATCH", `/${encodeURIComponent(id)}`, Eintrag, { content });

export const eintragLoeschen = (zugang: Zugang, id: string) =>
  aufruf(zugang, "DELETE", `/${encodeURIComponent(id)}`, z.object({ id: z.string() }));
