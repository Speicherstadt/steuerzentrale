import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { ereignisse, installationen } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { schreiben } from "../audit/index.ts";
import type { Planer } from "../aufbewahrung/index.ts";
import type { Installation } from "../installationen/lesen.ts";
import { serverFakten, serverLesen } from "../server/index.ts";
import {
  type DnsEintrag,
  type Ergebnis,
  eintraegeLesen,
  eintragAendern,
  eintragAnlegen,
  eintragLoeschen,
  type Zugang,
} from "./cloudflare.ts";
import { dnsStand, dnsZugang } from "./einstellungen.ts";
import {
  DNS_FEHLER_ART,
  kommentarFuer,
  loeschPlan,
  naechsterVersuch,
  type Schritt,
  setzPlan,
  sollAus,
  TTL,
} from "./plan.ts";

/*
 * Setting and deleting the DNS records of installations (Z-407; docs/plan.md, "DNS über
 * Cloudflare"): an installation whose records are due (`dns` is `setzen` or `loeschen`, its next
 * attempt reached) is brought in line with Cloudflare, one after the other. A failed attempt counts
 * up and waits (plan.ts, `naechsterVersuch`); it makes the event `dns_fehler` (severity `warn`) on
 * the first failure of a series and then at most once a day, so a lasting fault is not forgotten
 * and does not flood the events. The installation runs either way. The state is written through
 * `schreiben`, only if it did not change while Cloudflare answered.
 */

export const DNS_PRUEFUNG_MS = 30_000;
const EREIGNIS_ABSTAND_MS = 24 * 60 * 60_000;

export type DnsDeps = {
  db: Db;
  schreibDb: SchreibDb;
  schluessel: Schluesselbund;
  fetch: typeof fetch;
  /** Cloudflare's API (cloudflare.ts, CLOUDFLARE_API), elsewhere only in tests */
  basis: string;
  now: () => number;
  log: (zeile: string) => void;
  neueId?: () => string;
};

/** The installations whose records are due now, of every operator */
export const faelligeInstallationen = (db: Db, jetzt: number): Installation[] =>
  db
    .select()
    .from(installationen)
    .where(
      and(
        inArray(installationen.dns, ["setzen", "loeschen"]),
        isNotNull(installationen.dnsNaechsterVersuch),
        lte(installationen.dnsNaechsterVersuch, jetzt),
      ),
    )
    .all();

const schrittAusfuehren = (
  zugang: Zugang,
  i: Installation,
  s: Schritt,
): Promise<Ergebnis<unknown>> => {
  if (s.art === "loeschen") return eintragLoeschen(zugang, s.id);
  if (s.art === "aendern") return eintragAendern(zugang, s.id, s.inhalt);
  return eintragAnlegen(zugang, {
    type: s.typ,
    name: i.host,
    content: s.inhalt,
    ttl: TTL,
    proxied: false,
    comment: kommentarFuer(i.installationId),
  });
};

const schritteFuer = (deps: DnsDeps, i: Installation, vorhanden: DnsEintrag[]) => {
  const kommentar = kommentarFuer(i.installationId);
  if (i.dns === "loeschen")
    return { ok: true, schritte: loeschPlan(vorhanden, kommentar) } as const;
  const sv = serverLesen(deps.db, i.betreiberId, i.serverId);
  return setzPlan(vorhanden, kommentar, sollAus(sv ? serverFakten(sv) : null));
};

/** Brings one installation's records in line with Cloudflare; the first failure ends it */
export const installationAbgleichen = async (
  deps: DnsDeps,
  i: Installation,
): Promise<Ergebnis<null>> => {
  const z = dnsZugang(deps.db, deps.schluessel, i.betreiberId);
  if (!z.ok) return { ok: false, fehler: z.grund };
  const zugang: Zugang = { fetch: deps.fetch, basis: deps.basis, token: z.token, zoneId: z.zoneId };
  const vorhanden = await eintraegeLesen(zugang, i.host);
  if (!vorhanden.ok) return vorhanden;
  const plan = schritteFuer(deps, i, vorhanden.wert);
  if (!plan.ok) return plan;
  for (const s of plan.schritte) {
    const r = await schrittAusfuehren(zugang, i, s);
    if (!r.ok) return r;
  }
  return { ok: true, wert: null };
};

const zielVon = (installationId: string) => `installation:${installationId}`;

/** Whether this installation had a DNS event within the last day */
const kuerzlichGemeldet = (db: Db, i: Installation, jetzt: number): boolean =>
  db
    .select({ id: ereignisse.ereignisId })
    .from(ereignisse)
    .where(
      and(
        eq(ereignisse.betreiberId, i.betreiberId),
        eq(ereignisse.art, DNS_FEHLER_ART),
        eq(ereignisse.ziel, zielVon(i.installationId)),
        gte(ereignisse.zeitpunkt, jetzt - EREIGNIS_ABSTAND_MS),
      ),
    )
    .get() !== undefined;

/** Writes what the attempt came to, unless the installation's DNS state changed meanwhile */
export const ergebnisSchreiben = (
  deps: DnsDeps,
  i: Installation,
  ergebnis: Ergebnis<null>,
  jetzt: number,
): void => {
  const jetzig = deps.db
    .select({ dns: installationen.dns, versuche: installationen.dnsVersuche })
    .from(installationen)
    .where(
      and(
        eq(installationen.betreiberId, i.betreiberId),
        eq(installationen.installationId, i.installationId),
      ),
    )
    .get();
  if (!jetzig || jetzig.dns !== i.dns || jetzig.versuche !== i.dnsVersuche) return;
  const schluessel = { installationId: i.installationId };
  const kontext = {
    betreiberId: i.betreiberId,
    akteur: "system",
    jetzt,
    grund: i.dns === "setzen" ? "DNS-Einträge setzen" : "DNS-Einträge löschen",
  };
  if (ergebnis.ok) {
    schreiben(deps.schreibDb, kontext, `dns.${i.dns}`, (w) =>
      w.aendern("installationen", schluessel, {
        dns: i.dns === "setzen" ? "gesetzt" : "geloescht",
        dnsVersuche: 0,
        dnsNaechsterVersuch: null,
      }),
    );
    return;
  }
  const versuche = i.dnsVersuche + 1;
  const melden = versuche === 1 || !kuerzlichGemeldet(deps.db, i, jetzt);
  schreiben(deps.schreibDb, kontext, "dns.fehler", (w) => {
    w.aendern("installationen", schluessel, {
      dnsVersuche: versuche,
      dnsNaechsterVersuch: naechsterVersuch(versuche, jetzt),
    });
    if (melden)
      w.einfuegen("ereignisse", {
        betreiberId: i.betreiberId,
        ereignisId: (deps.neueId ?? randomUUID)(),
        zeitpunkt: jetzt,
        art: DNS_FEHLER_ART,
        schwere: "warn",
        ziel: zielVon(i.installationId),
        text: `DNS für ${i.host} (${i.dns === "setzen" ? "setzen" : "löschen"}), Versuch ${versuche}: ${ergebnis.fehler}`,
      });
  });
};

/** Every installation due now, one after the other; returns how many were tried */
export const dnsAbgleichen = async (deps: DnsDeps): Promise<number> => {
  const faellig = faelligeInstallationen(deps.db, deps.now());
  for (const i of faellig) {
    const stand = dnsStand(deps.db, i.betreiberId);
    const ergebnis = await installationAbgleichen(deps, i);
    // new settings came in while it ran: it stays due and is tried with them, not after a backoff
    if (!ergebnis.ok && dnsStand(deps.db, i.betreiberId) !== stand) continue;
    ergebnisSchreiben(deps, i, ergebnis, deps.now());
  }
  return faellig.length;
};

/**
 * Checks every 30 seconds, and at once when `anstossen` is called (a new installation, a removed
 * one, new settings); never two runs at a time: a push during a run makes one more after it
 */
export const dnsSchleife = (deps: DnsDeps, planen: Planer): { anstossen: () => void } => {
  let laeuft = false;
  let nochmal = false;
  const lauf = async (): Promise<void> => {
    if (laeuft) {
      nochmal = true;
      return;
    }
    laeuft = true;
    try {
      do {
        nochmal = false;
        await dnsAbgleichen(deps);
      } while (nochmal);
    } catch (fehler) {
      deps.log(JSON.stringify({ msg: "dns check failed", fehler: String(fehler) }));
    } finally {
      laeuft = false;
    }
  };
  planen(() => void lauf(), DNS_PRUEFUNG_MS);
  return { anstossen: () => void lauf() };
};
