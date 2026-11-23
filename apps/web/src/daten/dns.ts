import { type Antwort, api } from "../anmeldung/api.ts";
import { demoDns } from "../demo/dns.ts";

/*
 * The operator's DNS at Cloudflare (BAULISTE.md Z-407; docs/plan.md, "DNS über Cloudflare"), for
 * the settings' tab "DNS" and the address the dialog "Installieren" suggests: domain, zone id and
 * whether a token is set, as GET /api/v1/dns answers. The token goes only to the Zentrale and never
 * comes back. Signed in the API, else the demo in memory.
 */

export type DnsEinstellungen = {
  domain: string | null;
  zoneId: string | null;
  tokenGesetzt: boolean;
};

/** What the form sends; a token left out keeps the one set */
export type DnsAenderung = { domain: string; zoneId: string; token?: string };

export type DnsQuelle = {
  lesen: () => Promise<Antwort<DnsEinstellungen>>;
  setzen: (neu: DnsAenderung, grund: string) => Promise<Antwort<DnsEinstellungen>>;
};

export const apiDns: DnsQuelle = {
  lesen: () => api<DnsEinstellungen>("/api/v1/dns"),
  setzen: (neu, grund) =>
    api<DnsEinstellungen>("/api/v1/dns", { method: "PUT", body: { ...neu, grund } }),
};

let quelle: DnsQuelle = demoDns();

export const dnsQuelle = (): DnsQuelle => quelle;

export const dnsQuelleEinsetzen = (neu: DnsQuelle): void => {
  quelle = neu;
};
