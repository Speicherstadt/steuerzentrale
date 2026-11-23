import type { DnsEinstellungen, DnsQuelle } from "../daten/dns.ts";

/**
 * The DNS settings of the demo operator in memory, answering as the Zentrale's API does
 * (routes/dns.ts in apps/zentrale): the token only as set. A change lasts until the page reloads.
 */
export const demoDns = (
  start: DnsEinstellungen = {
    domain: "apps.beispiel-hosting.de",
    zoneId: "023e105f4ecef8ad9ca31a8372d0c353",
    tokenGesetzt: true,
  },
): DnsQuelle => {
  let stand = { ...start };
  return {
    lesen: async () => ({ ok: true, status: 200, daten: { ...stand } }),
    setzen: async (neu) => {
      stand = {
        domain: neu.domain,
        zoneId: neu.zoneId,
        tokenGesetzt: stand.tokenGesetzt || neu.token !== undefined,
      };
      return { ok: true, status: 200, daten: { ...stand } };
    },
  };
};
