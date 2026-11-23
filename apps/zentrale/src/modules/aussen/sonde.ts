import { connect } from "node:tls";
import type { DnsAntwort, HttpAntwort, Probe, TlsAntwort } from "@steuerzentrale/planung";

/*
 * The steps of a check from outside, on the network (BAULISTE.md Z-704; docs/plan.md, "Prüfung von
 * außen"): resolve A and AAAA with the resolver handed in (in the Zentrale node:dns's `Resolver`,
 * which asks the name servers itself, no local cache), connect with TLS to the first address with
 * the host as SNI and the system's trust (a CA only in tests), and GET the path through the
 * public host without following redirects. Each step has its own time limit; the first that fails
 * ends the check. What they answered is rated by packages/planung (`aussenBewerten`).
 */

export type Aufloeser = {
  resolve4: (host: string) => Promise<string[]>;
  resolve6: (host: string) => Promise<string[]>;
};

export type SondenDeps = {
  aufloeser: Aufloeser;
  /** 443; another port only in tests */
  port: number;
  /** A CA to trust instead of the system's, only in tests */
  ca?: string;
  zeitlimitMs: { dns: number; tls: number; http: number };
};

export type Sonde = (host: string, pfad: string) => Promise<Probe>;

/** A name without records of the type: no address of that kind, not an error */
const OHNE_EINTRAG = "ENODATA";

/**
 * The codes of node:tls (OpenSSL's verify errors and Node's own) that mean the certificate, not the
 * connection, was refused: `CERT_HAS_EXPIRED`, `CERT_SIGNATURE_FAILURE`,
 * `ERR_TLS_CERT_ALTNAME_INVALID`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE` …
 */
const ZERTIFIKAT = /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)/;

const codeVon = (fehler: unknown): string => {
  const f = fehler as { code?: unknown; message?: unknown };
  if (typeof f?.code === "string") return f.code;
  return typeof f?.message === "string" ? f.message : String(fehler);
};

const mitZeitlimit = <T>(arbeit: Promise<T>, ms: number, sonst: T): Promise<T> => {
  let uhr: ReturnType<typeof setTimeout> | undefined;
  const ablauf = new Promise<T>((fertig) => {
    uhr = setTimeout(() => fertig(sonst), ms);
  });
  return Promise.race([arbeit, ablauf]).finally(() => clearTimeout(uhr));
};

const adressen = (frage: Promise<string[]>): Promise<string[]> =>
  frage.catch((fehler: unknown) => {
    if (codeVon(fehler) === OHNE_EINTRAG) return [];
    throw fehler;
  });

export const dnsFragen = async (
  aufloeser: Aufloeser,
  host: string,
  ms: number,
): Promise<DnsAntwort> => {
  const frage = Promise.all([
    adressen(aufloeser.resolve4(host)),
    adressen(aufloeser.resolve6(host)),
  ]).then(
    ([a, aaaa]): DnsAntwort =>
      a.length + aaaa.length === 0
        ? { ok: false, fehler: "keine A- und AAAA-Einträge" }
        : { ok: true, a, aaaa },
    (fehler: unknown): DnsAntwort => ({ ok: false, fehler: codeVon(fehler) }),
  );
  return mitZeitlimit(frage, ms, { ok: false, fehler: "Zeitlimit" });
};

export const tlsFragen = (
  ip: string,
  host: string,
  deps: Pick<SondenDeps, "port" | "ca" | "zeitlimitMs">,
): Promise<TlsAntwort> =>
  new Promise((fertig) => {
    let uhr: ReturnType<typeof setTimeout> | undefined;
    const socket = connect({
      host: ip,
      port: deps.port,
      servername: host,
      rejectUnauthorized: true,
      ...(deps.ca ? { ca: deps.ca } : {}),
    });
    const ende = (antwort: TlsAntwort) => {
      clearTimeout(uhr);
      socket.destroy();
      fertig(antwort);
    };
    uhr = setTimeout(
      () => ende({ ok: false, art: "netz", fehler: "Zeitlimit" }),
      deps.zeitlimitMs.tls,
    );
    socket.once("secureConnect", () => {
      const gueltigBis = Date.parse(socket.getPeerCertificate().valid_to);
      ende({ ok: true, gueltigBis });
    });
    socket.once("error", (fehler) => {
      const code = codeVon(fehler);
      ende({ ok: false, art: ZERTIFIKAT.test(code) ? "zertifikat" : "netz", fehler: code });
    });
  });

export const httpFragen = async (
  host: string,
  pfad: string,
  deps: Pick<SondenDeps, "port" | "ca" | "zeitlimitMs">,
): Promise<HttpAntwort> => {
  const start = performance.now();
  const ort = deps.port === 443 ? host : `${host}:${deps.port}`;
  try {
    const antwort = await fetch(`https://${ort}${pfad}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(deps.zeitlimitMs.http),
      ...(deps.ca ? { tls: { ca: deps.ca } } : {}),
    });
    await antwort.body?.cancel();
    return { ok: true, status: antwort.status, ms: Math.round(performance.now() - start) };
  } catch (fehler) {
    const name = (fehler as { name?: string }).name;
    return { ok: false, fehler: name === "TimeoutError" ? "Zeitlimit" : codeVon(fehler) };
  }
};

/** The check of one host: DNS, then TLS to its first address, then the path */
export const sonde =
  (deps: SondenDeps): Sonde =>
  async (host, pfad) => {
    const dns = await dnsFragen(deps.aufloeser, host, deps.zeitlimitMs.dns);
    const ip = dns.ok ? (dns.a[0] ?? dns.aaaa[0]) : undefined;
    if (ip === undefined) return { dns };
    const tls = await tlsFragen(ip, host, deps);
    if (!tls.ok) return { dns, tls };
    return { dns, tls, http: await httpFragen(host, pfad, deps) };
  };
