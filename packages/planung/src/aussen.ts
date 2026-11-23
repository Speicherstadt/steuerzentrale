import { GRUND_MAX } from "./bewertung.ts";

/*
 * The check from outside (BAULISTE.md Z-704; docs/plan.md, "Prüfung von außen"): independent of
 * the agent, the Zentrale resolves an installation's public host, connects to the Pforte with TLS
 * and asks for the health path through it. The steps go in order and the first that fails is the
 * reason; what the steps answered comes in as data, so this stays pure. A check is green or red;
 * without a check for three minutes the state is unknown.
 */

export type AussenZustand = "gruen" | "rot" | "unbekannt";

/**
 * Why: `erreichbar` (green, with status and time), `dns` (the name does not resolve),
 * `dns_abweichung` (A or AAAA not what the Zentrale set), `zertifikat` (TLS refused the
 * certificate), `pforte` (no connection or no answer), `health` (a status that is not fine),
 * `keine_pruefung` (none for three minutes)
 */
export type AussenGrundCode =
  | "erreichbar"
  | "dns"
  | "dns_abweichung"
  | "zertifikat"
  | "pforte"
  | "health"
  | "keine_pruefung";

export type AussenGrund = { code: AussenGrundCode; werte: Record<string, string> };

export type AussenErgebnis = { zustand: "gruen" | "rot"; grund: AussenGrund };

export type DnsAntwort = { ok: true; a: string[]; aaaa: string[] } | { ok: false; fehler: string };

export type TlsAntwort =
  | { ok: true; gueltigBis: number }
  | { ok: false; art: "zertifikat" | "netz"; fehler: string };

export type HttpAntwort = { ok: true; status: number; ms: number } | { ok: false; fehler: string };

/** What each step answered; a step after one that failed is not taken */
export type Probe = { dns: DnsAntwort; tls?: TlsAntwort; http?: HttpAntwort };

/** The addresses the Zentrale set for the host (modules/dns), null for a host it sets none for */
export type DnsSoll = { A: string | null; AAAA: string | null } | null;

/**
 * What counts as healthy: `health` the manifest's health path, 200–399 as the agent counts it;
 * `antwort` any answer below 500, for an app whose health check is not an HTTP path of the service
 * behind the Pforte
 */
export type Erwartung = "health" | "antwort";

/** Without a check for this long the state from outside is unknown (three checks missed) */
export const AUSSEN_FRIST_MS = 3 * 60_000;

const rot = (code: AussenGrundCode, werte: Record<string, string>): AussenErgebnis => ({
  zustand: "rot",
  grund: { code, werte },
});

const kurz = (text: string) => text.slice(0, GRUND_MAX);

const gleich = (ist: readonly string[], soll: string | null) =>
  soll === null ? ist.length === 0 : ist.length > 0 && ist.every((ip) => ip === soll);

const liste = (ips: readonly (string | null)[]) => ips.filter((ip) => ip !== null).join(", ");

const dnsPruefen = (dns: DnsAntwort, soll: DnsSoll): AussenErgebnis | undefined => {
  if (!dns.ok) return rot("dns", { fehler: kurz(dns.fehler) });
  if (soll === null || (gleich(dns.a, soll.A) && gleich(dns.aaaa, soll.AAAA))) return undefined;
  return rot("dns_abweichung", {
    soll: liste([soll.A, soll.AAAA]),
    ist: kurz(liste([...dns.a, ...dns.aaaa])),
  });
};

const gesund = (status: number, erwartung: Erwartung) =>
  erwartung === "health" ? status >= 200 && status < 400 : status < 500;

/** Rates one check from outside */
export const aussenBewerten = (p: Probe, soll: DnsSoll, erwartung: Erwartung): AussenErgebnis => {
  const dns = dnsPruefen(p.dns, soll);
  if (dns) return dns;
  if (!p.tls) return rot("pforte", { fehler: "keine TLS-Prüfung" });
  if (!p.tls.ok)
    return rot(p.tls.art === "zertifikat" ? "zertifikat" : "pforte", {
      fehler: kurz(p.tls.fehler),
    });
  if (!p.http) return rot("pforte", { fehler: "keine Anfrage" });
  if (!p.http.ok) return rot("pforte", { fehler: kurz(p.http.fehler) });
  if (!gesund(p.http.status, erwartung)) return rot("health", { status: String(p.http.status) });
  return {
    zustand: "gruen",
    grund: { code: "erreichbar", werte: { status: String(p.http.status), ms: String(p.http.ms) } },
  };
};

/** The state from outside: since when it holds and when the last check came */
export type AussenStand = {
  zustand: AussenZustand;
  grund: AussenGrund;
  seit: number;
  geprueftAm: number;
};

/** The state after a check: `seit` stays while the state does, a change starts it anew */
export const aussenFortschreiben = (
  alt: AussenStand | null,
  neu: AussenErgebnis,
  jetzt: number,
): { stand: AussenStand; wechsel: boolean } => {
  const wechsel = alt === null || alt.zustand !== neu.zustand;
  return { stand: { ...neu, seit: wechsel ? jetzt : alt.seit, geprueftAm: jetzt }, wechsel };
};

/** The state as it stands at `jetzt`: unknown once no check came for three minutes */
export const aussenJetzt = (stand: AussenStand, jetzt: number): AussenStand => {
  const faellig = stand.geprueftAm + AUSSEN_FRIST_MS;
  if (stand.zustand === "unbekannt" || jetzt < faellig) return stand;
  return {
    zustand: "unbekannt",
    grund: { code: "keine_pruefung", werte: {} },
    seit: faellig,
    geprueftAm: stand.geprueftAm,
  };
};

/**
 * Whether to report a change from outside now, given the last report (`aussen_rot` or
 * `aussen_gruen`, null for none): red once a second check in a row was red, so a single lost
 * packet reports nothing; green once green again after a red report; unknown reports nothing
 */
export const aussenMeldungPruefen = (
  stand: AussenStand,
  letzte: "rot" | "gruen" | null,
  jetzt: number,
): "rot" | "gruen" | undefined => {
  const aktuell = aussenJetzt(stand, jetzt);
  if (aktuell.zustand === "rot" && aktuell.geprueftAm > aktuell.seit && letzte !== "rot")
    return "rot";
  if (aktuell.zustand === "gruen" && letzte === "rot") return "gruen";
  return undefined;
};
