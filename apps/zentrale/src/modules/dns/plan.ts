import { istOeffentlicheIpv4 } from "@steuerzentrale/manifest";
import type { DnsEintrag } from "./cloudflare.ts";

/*
 * What the Zentrale does to an installation's DNS records (Z-407; docs/plan.md, "DNS über
 * Cloudflare"), as pure functions of the records there: A for the server's public IPv4, AAAA for
 * its public IPv6 when it reports one, `proxied: false`, TTL 300. Only a record with the comment
 * `steuerzentrale:<installation>` is the Zentrale's: it changes or deletes nothing else, and a
 * record of a person on the same name (A, AAAA or CNAME) stops the setting instead of being joined.
 */

export const TTL = 300;
export const DNS_FEHLER_ART = "dns_fehler";

const ERSTER_VERSUCH_MS = 60_000;
const LETZTER_ABSTAND_MS = 60 * 60_000;

export const kommentarFuer = (installationId: string) => `steuerzentrale:${installationId}`;

export type Soll = { A: string | null; AAAA: string | null };

export type Schritt =
  | { art: "anlegen"; typ: "A" | "AAAA"; inhalt: string }
  | { art: "aendern"; id: string; inhalt: string }
  | { art: "loeschen"; id: string };

/** A global unicast address (2000::/3), not loopback, link-local, unique-local or multicast */
export const istOeffentlicheIpv6 = (ip: string): boolean => {
  const erster = Number.parseInt(ip.split(":")[0] ?? "", 16);
  return ip.includes(":") && erster >= 0x2000 && erster <= 0x3fff;
};

/** The addresses the records should point to, from the server's facts */
export const sollAus = (f: { ipv4: string[] | null; ipv6: string[] | null } | null): Soll => ({
  A: f?.ipv4?.find(istOeffentlicheIpv4) ?? null,
  AAAA: f?.ipv6?.find(istOeffentlicheIpv6) ?? null,
});

const TYPEN = ["A", "AAAA"] as const;

/** Of the Zentrale's records of one type: keep the one that fits, change one, add or delete */
const schritteFuer = (typ: "A" | "AAAA", eigene: DnsEintrag[], soll: string | null): Schritt[] => {
  const loeschen = (e: DnsEintrag): Schritt => ({ art: "loeschen", id: e.id });
  if (soll === null) return eigene.map(loeschen);
  const passend = eigene.find((e) => e.content === soll);
  if (passend) return eigene.filter((e) => e !== passend).map(loeschen);
  const [erster, ...rest] = eigene;
  if (!erster) return [{ art: "anlegen", typ, inhalt: soll }];
  return [{ art: "aendern", id: erster.id, inhalt: soll }, ...rest.map(loeschen)];
};

export type SetzPlan = { ok: true; schritte: Schritt[] } | { ok: false; fehler: string };

/** The steps that make the records of the name match `soll`, or why the Zentrale may not */
export const setzPlan = (vorhanden: DnsEintrag[], kommentar: string, soll: Soll): SetzPlan => {
  if (soll.A === null && soll.AAAA === null)
    return { ok: false, fehler: "the server reports no public address" };
  const fremd = vorhanden.find(
    (e) => e.comment !== kommentar && ["A", "AAAA", "CNAME"].includes(e.type),
  );
  if (fremd)
    return {
      ok: false,
      fehler: `a record not made by the Zentrale exists: ${fremd.type} ${fremd.name}`,
    };
  const eigene = vorhanden.filter((e) => e.comment === kommentar);
  const schritte = [
    ...TYPEN.flatMap((typ) =>
      schritteFuer(
        typ,
        eigene.filter((e) => e.type === typ),
        soll[typ],
      ),
    ),
    ...eigene
      .filter((e) => !TYPEN.includes(e.type as "A"))
      .map((e) => ({ art: "loeschen", id: e.id }) as const),
  ];
  return { ok: true, schritte };
};

/** Deleting: the Zentrale's own records of the name, nothing else */
export const loeschPlan = (vorhanden: DnsEintrag[], kommentar: string): Schritt[] =>
  vorhanden.filter((e) => e.comment === kommentar).map((e) => ({ art: "loeschen", id: e.id }));

/** When to try again after the n-th failure in a row: 1, 2, 4 … minutes, at most an hour */
export const naechsterVersuch = (versuche: number, jetzt: number): number =>
  jetzt + Math.min(ERSTER_VERSUCH_MS * 2 ** Math.max(0, versuche - 1), LETZTER_ABSTAND_MS);
