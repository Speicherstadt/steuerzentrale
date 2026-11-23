import type { Bewertung } from "./bewertung.ts";

/*
 * The checks of a server (BAULISTE.md Z-702; docs/plan.md, "Prüfungen eines Servers"): disk over
 * 80/90 %, a certificate of an installation within 14 days, a backup older than 26 h, a port open
 * that no manifest names, and the clock. Pure: the Zentrale reads facts, installations and backups
 * and hands them in; each check is green, yellow, red or unknown, never green without a measurement.
 */

export const PLATTE_WARNUNG_PROZENT = 80;
export const PLATTE_STOERUNG_PROZENT = 90;
export const ZERTIFIKAT_FRIST_MS = 14 * 86_400_000;
export const BACKUP_FRIST_MS = 26 * 3_600_000;
/** docs/plan.md, "Uhrzeit des Servers": the measurement is good to half a round trip */
export const UHR_GRENZE_MS = 500;
/** The agent sends facts every 15 minutes (FAKTEN_MS): three missed, and they say nothing now */
export const FAKTEN_FRIST_MS = 45 * 60_000;

export type Port = { port: number; proto: "tcp" | "udp" };

/**
 * What the system itself may listen on: SSH (the emergency access, docs/plan.md "Notzugang"), the
 * Pforte (80, 443 and HTTP/3 on 443/udp) and the DHCP clients of IPv4 and IPv6; the agent listens on
 * nothing, it connects out
 */
export const SYSTEM_PORTS: readonly Port[] = [
  { port: 22, proto: "tcp" },
  { port: 68, proto: "udp" },
  { port: 80, proto: "tcp" },
  { port: 443, proto: "tcp" },
  { port: 443, proto: "udp" },
  { port: 546, proto: "udp" },
];

export const PRUEFUNGEN = ["platte", "zertifikate", "backups", "ports", "uhrzeit"] as const;
export type PruefungName = (typeof PRUEFUNGEN)[number];

/** One check's result with what it measured; null where the agent could not read it */
export type Serverpruefung = { ergebnis: Bewertung } & (
  | { pruefung: "platte"; platten: { mount: string; prozent: number }[] | null }
  | { pruefung: "zertifikate"; zertifikate: { host: string; gueltigBis: number }[] | null }
  | { pruefung: "backups"; alt: { installationId: string; name: string; seit: number }[] }
  | { pruefung: "ports"; fremd: Port[] | null }
  | { pruefung: "uhrzeit"; abweichungMs: number | null; synchron: boolean | null }
);

type Platte = { mount: string; gesamtMb: number; freiMb: number };

/** Whether more than `prozent` of the disk is in use; multiplied, not divided, so 80 is exact */
const ueber = (p: Platte, prozent: number) => (p.gesamtMb - p.freiMb) * 100 > prozent * p.gesamtMb;

/**
 * The fullest disk decides: over 80 % yellow, over 90 % red. `freiMb` is what users may still
 * write (statfs bavail), so the share only root may use counts as taken: installations run as users
 */
export const plattePruefen = (platten: readonly Platte[] | null) => {
  const gemessen = (platten ?? [])
    .filter((p) => p.gesamtMb > 0)
    // the smallest share free first
    .sort((a, b) => a.freiMb * b.gesamtMb - b.freiMb * a.gesamtMb);
  const voll = gemessen[0];
  if (!voll) return { pruefung: "platte" as const, ergebnis: "unbekannt" as const, platten: null };
  const ergebnis: Bewertung = ueber(voll, PLATTE_STOERUNG_PROZENT)
    ? "rot"
    : ueber(voll, PLATTE_WARNUNG_PROZENT)
      ? "gelb"
      : "gruen";
  return {
    pruefung: "platte" as const,
    ergebnis,
    // one decimal for the interface; the limits above compare the exact values
    platten: gemessen.map((p) => ({
      mount: p.mount,
      prozent: Math.round(((p.gesamtMb - p.freiMb) * 1000) / p.gesamtMb) / 10,
    })),
  };
};

/**
 * The certificates of the installations' hosts, each by its newest (Caddy may hold one per issuer),
 * soonest first: expired red, within 14 days yellow. A host without one is not judged here; the
 * check from outside (Z-704) sees it.
 */
export const zertifikatePruefen = (
  zertifikate: readonly { host: string; gueltigBis: number }[] | null,
  hosts: readonly string[],
  jetzt: number,
) => {
  if (!zertifikate)
    return { pruefung: "zertifikate" as const, ergebnis: "unbekannt" as const, zertifikate: null };
  const gesucht = new Set(hosts.map((h) => h.toLowerCase()));
  const neueste = new Map<string, number>();
  for (const z of zertifikate) {
    const host = z.host.toLowerCase();
    if (gesucht.has(host)) neueste.set(host, Math.max(neueste.get(host) ?? 0, z.gueltigBis));
  }
  const liste = [...neueste]
    .map(([host, gueltigBis]) => ({ host, gueltigBis }))
    .sort((a, b) => a.gueltigBis - b.gueltigBis);
  const naechstes = liste[0]?.gueltigBis ?? Number.POSITIVE_INFINITY;
  const ergebnis: Bewertung =
    naechstes <= jetzt ? "rot" : naechstes <= jetzt + ZERTIFIKAT_FRIST_MS ? "gelb" : "gruen";
  return { pruefung: "zertifikate" as const, ergebnis, zertifikate: liste };
};

export type BackupInstallation = {
  installationId: string;
  /** What the interface and the event call it, e.g. "Müller · haben" */
  name: string;
  letzterErfolg: number | null;
  /** When its backups were set up: before the first good run, the age counts from there */
  eingerichtetAm: number;
};

/** An installation whose last good backup is older than 26 hours makes yellow */
export const backupsPruefen = (installationen: readonly BackupInstallation[], jetzt: number) => {
  const alt = installationen
    .map((i) => ({
      installationId: i.installationId,
      name: i.name,
      seit: i.letzterErfolg ?? i.eingerichtetAm,
    }))
    .filter((i) => jetzt - i.seit > BACKUP_FRIST_MS)
    .sort((a, b) => a.seit - b.seit);
  return {
    pruefung: "backups" as const,
    ergebnis: (alt.length > 0 ? "gelb" : "gruen") as Bewertung,
    alt,
  };
};

const schluessel = (p: Port) => `${p.port}/${p.proto}`;

/** A port open to the network that neither a manifest on the server nor the system names */
export const portsPruefen = (offen: readonly Port[] | null, erlaubt: readonly Port[]) => {
  if (!offen) return { pruefung: "ports" as const, ergebnis: "unbekannt" as const, fremd: null };
  const bekannt = new Set([...SYSTEM_PORTS, ...erlaubt].map(schluessel));
  const fremd = offen
    .filter((p) => !bekannt.has(schluessel(p)))
    .map((p) => ({ port: p.port, proto: p.proto }))
    .sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));
  return {
    pruefung: "ports" as const,
    ergebnis: (fremd.length > 0 ? "gelb" : "gruen") as Bewertung,
    fremd,
  };
};

/** Off by 500 ms or more either way, or a time service that is not synchronised, is yellow */
export const uhrzeitPruefen = (abweichungMs: number | null, synchron: boolean | null) => {
  const ergebnis: Bewertung =
    synchron === false || (abweichungMs !== null && Math.abs(abweichungMs) >= UHR_GRENZE_MS)
      ? "gelb"
      : abweichungMs === null
        ? "unbekannt"
        : "gruen";
  return { pruefung: "uhrzeit" as const, ergebnis, abweichungMs, synchron };
};

/** What the agent reported; a field an older agent does not send counts as not read */
export type PruefFakten = {
  /** When the Zentrale got them */
  am: number;
  platten: Platte[] | null;
  portsOffen?: Port[] | null;
  zertifikate?: { host: string; gueltigBis: number }[] | null;
  uhrzeitAbweichungMs: number | null;
  uhrSynchron?: boolean | null;
};

export type PruefEingabe = {
  jetzt: number;
  /** The newest facts, null before the first */
  fakten: PruefFakten | null;
  /** The hosts of the installations on the server */
  hosts: string[];
  /** The ports the manifests of the installations on the server open */
  erlaubtePorts: Port[];
  /** The installations on the server whose backups are set up */
  backups: BackupInstallation[];
};

/** Every check of one server, in the order of PRUEFUNGEN */
export const serverPruefen = (e: PruefEingabe): Serverpruefung[] => {
  const f = e.fakten && e.jetzt - e.fakten.am <= FAKTEN_FRIST_MS ? e.fakten : null;
  return [
    plattePruefen(f?.platten ?? null),
    zertifikatePruefen(f?.zertifikate ?? null, e.hosts, e.jetzt),
    backupsPruefen(e.backups, e.jetzt),
    portsPruefen(f?.portsOffen ?? null, e.erlaubtePorts),
    uhrzeitPruefen(f?.uhrzeitAbweichungMs ?? null, f?.uhrSynchron ?? null),
  ];
};

/** How bad a reported finding is: yellow or red */
export type Stufe = "gelb" | "rot";

/**
 * Whether a check's result makes an event (one per finding, not per run; Z-703 notifies from
 * them): `gemeldet` is the level of the open finding, null when none is open. A check that turns
 * yellow or red is a finding, red after yellow once more; green ends it; unknown and red easing to
 * yellow change nothing.
 */
export const befundFortschreiben = (
  gemeldet: Stufe | null,
  ergebnis: Bewertung,
): { art: "auffaellig"; stufe: Stufe } | { art: "behoben" } | undefined => {
  if (ergebnis === "gruen") return gemeldet ? { art: "behoben" } : undefined;
  if (ergebnis === "rot" && gemeldet !== "rot") return { art: "auffaellig", stufe: "rot" };
  if (ergebnis === "gelb" && gemeldet === null) return { art: "auffaellig", stufe: "gelb" };
  return undefined;
};
