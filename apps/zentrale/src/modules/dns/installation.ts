import { unterDomain } from "@steuerzentrale/manifest";
import type { Db } from "../../db/oeffnen.ts";
import type { DNS_ZUSTAENDE } from "../../db/schema.ts";
import { dnsEinstellungenLesen } from "./einstellungen.ts";

/*
 * What making and removing an installation means for its DNS records (Z-407; docs/plan.md,
 * "Adresse einer Installation", "DNS über Cloudflare"): a host below the operator's domain gets
 * them, due at once (modules/dns/abgleich.ts sets them after the transaction); any other host the
 * operator sets himself. Once `installation_entfernen` succeeded, records set or still to be set
 * are due for deletion. Written in the transaction that makes or removes the installation.
 */

type DnsZustand = (typeof DNS_ZUSTAENDE)[number];

export type DnsSpalten = {
  dns: DnsZustand | null;
  dnsVersuche: number;
  dnsNaechsterVersuch: number | null;
};

export const dnsFuerNeueInstallation = (
  db: Db,
  betreiberId: string,
  host: string,
  jetzt: number,
): DnsSpalten =>
  unterDomain(host, dnsEinstellungenLesen(db, betreiberId).domain)
    ? { dns: "setzen", dnsVersuche: 0, dnsNaechsterVersuch: jetzt }
    : { dns: null, dnsVersuche: 0, dnsNaechsterVersuch: null };

/** The columns that change when the installation is removed, or none */
export const dnsNachEntfernen = (dns: DnsZustand | null, jetzt: number): Partial<DnsSpalten> =>
  dns === "setzen" || dns === "gesetzt"
    ? { dns: "loeschen", dnsVersuche: 0, dnsNaechsterVersuch: jetzt }
    : {};
