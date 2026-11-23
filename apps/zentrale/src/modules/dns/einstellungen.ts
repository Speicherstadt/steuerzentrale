import { and, eq, inArray } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { dnsEinstellungen, geheimnisse, installationen } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { geheimnisLesen, geheimnisSetzen } from "../geheim/index.ts";

/*
 * The operator's DNS settings (Z-407; docs/plan.md, "DNS über Cloudflare"): domain and zone id in
 * `dns_einstellungen`, the API token as a secret of the operator in `geheimnisse`, encrypted. What
 * the API shows of the token is only whether it is set; only the Zentrale's own calls to Cloudflare
 * read it (`dnsZugang`), never an answer and never a message to an agent. Domain and zone change
 * only while no installation has records set or due there: those are deleted where they were set.
 * New settings make every waiting attempt due at once, so a token set late takes effect now.
 */

export const TOKEN_GEHEIMNIS = "dns-cloudflare-token";
const TOKEN_ZWECK = "dns:cloudflare";

export type DnsEinstellungen = {
  domain: string | null;
  zoneId: string | null;
  tokenGesetzt: boolean;
};

export type NeueDnsEinstellungen = {
  domain: string;
  zoneId: string;
  /** Left out: the token set before stays */
  token?: string | undefined;
};

const zeileVon = (db: Db, betreiberId: string) =>
  db.select().from(dnsEinstellungen).where(eq(dnsEinstellungen.betreiberId, betreiberId)).get();

const tokenGesetzt = (db: Db, betreiberId: string): boolean =>
  db
    .select({ id: geheimnisse.geheimnisId })
    .from(geheimnisse)
    .where(
      and(eq(geheimnisse.betreiberId, betreiberId), eq(geheimnisse.geheimnisId, TOKEN_GEHEIMNIS)),
    )
    .get() !== undefined;

export const dnsEinstellungenLesen = (db: Db, betreiberId: string): DnsEinstellungen => {
  const zeile = zeileVon(db, betreiberId);
  return {
    domain: zeile?.domain ?? null,
    zoneId: zeile?.zoneId ?? null,
    tokenGesetzt: tokenGesetzt(db, betreiberId),
  };
};

/** The operator's installations whose records are set or due (`setzen`, `gesetzt`, `loeschen`) */
const mitEintraegen = (db: Db, betreiberId: string) =>
  db
    .select({ id: installationen.installationId, dns: installationen.dns })
    .from(installationen)
    .where(
      and(
        eq(installationen.betreiberId, betreiberId),
        inArray(installationen.dns, ["setzen", "gesetzt", "loeschen"]),
      ),
    )
    .all();

export type Gesetzt =
  | { ok: true; einstellungen: DnsEinstellungen }
  | { ok: false; grund: "dns_in_benutzung" };

/** Sets domain and zone, and the token when one is given; the audit log marks it only as changed */
export const dnsEinstellungenSetzen = (
  deps: { db: Db; schreibDb: SchreibDb; schluessel: Schluesselbund },
  kontext: Kontext,
  neu: NeueDnsEinstellungen,
): Gesetzt => {
  const { betreiberId, jetzt } = kontext;
  const alt = zeileVon(deps.db, betreiberId);
  const zeile = { domain: neu.domain, zoneId: neu.zoneId, geaendertAm: jetzt };
  const geaendert = !alt || alt.domain !== neu.domain || alt.zoneId !== neu.zoneId;
  const eintraege = mitEintraegen(deps.db, betreiberId);
  if (alt && geaendert && eintraege.length > 0) return { ok: false, grund: "dns_in_benutzung" };
  if (geaendert || neu.token !== undefined)
    schreiben(deps.schreibDb, kontext, "dns.einstellungen", (w) => {
      for (const i of eintraege.filter((e) => e.dns !== "gesetzt"))
        w.aendern("installationen", { installationId: i.id }, { dnsNaechsterVersuch: jetzt });
      if (alt && geaendert) w.aendern("dnsEinstellungen", {}, zeile);
      else if (!alt) w.einfuegen("dnsEinstellungen", { betreiberId, ...zeile });
      if (neu.token !== undefined)
        geheimnisSetzen(w, deps.schluessel, {
          betreiberId,
          geheimnisId: TOKEN_GEHEIMNIS,
          zweck: TOKEN_ZWECK,
          klartext: neu.token,
          jetzt,
        });
    });
  return { ok: true, einstellungen: dnsEinstellungenLesen(deps.db, betreiberId) };
};

export type DnsZugang =
  | { ok: true; domain: string; zoneId: string; token: string }
  | { ok: false; grund: string };

/** Everything a call to Cloudflare needs, the token decrypted, or what is missing */
export const dnsZugang = (db: Db, bund: Schluesselbund, betreiberId: string): DnsZugang => {
  const zeile = zeileVon(db, betreiberId);
  if (!zeile) return { ok: false, grund: "no domain and zone set" };
  const token = geheimnisLesen(db, bund, betreiberId, TOKEN_GEHEIMNIS);
  if (!token.ok)
    return {
      ok: false,
      grund: token.grund === "fehlt" ? "no API token set" : "the API token does not decrypt",
    };
  return { ok: true, domain: zeile.domain, zoneId: zeile.zoneId, token: token.wert };
};
