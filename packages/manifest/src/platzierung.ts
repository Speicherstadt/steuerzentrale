import type { Manifest } from "./schema.ts";

/*
 * Placement (docs/plan.md, "Platzierung"): whether an app with its options fits a server, as a pure
 * function of manifest, options, server facts, the installations already there, customer and
 * operator. The same function serves the UI and the API. Every finding is a code
 * with values, so the UI words it in either language.
 */

export type Architektur = "amd64" | "arm64";

/** What placement needs of a server: its facts (Z-304) and what the Zentrale knows of it */
export type PlatzServer = {
  betreiberId: string;
  agentVerbunden: boolean;
  /** Only observed (Z-1102): its agent takes no job that changes it, so nothing is placed there */
  nurBeobachten: boolean;
  architektur: Architektur;
  ramMb: number;
  /** Free space on the volume the installations live on */
  platteFreiMb: number;
  /** Size of that volume */
  platteGesamtMb: number;
  ipv4: string[];
  ptr: Record<string, string>;
  port25Ausgehend: boolean | null;
  /** Ports in use on the server, besides those of the installations */
  portsBelegt: { port: number; proto: "tcp" | "udp" }[];
};

/** An installation already on the server, as far as placement needs it */
export type PlatzInstallation = {
  kundeId: string;
  ramMb: number;
  platteGb: number;
  festePorts: { port: number; bis?: number; proto: "tcp" | "udp" }[];
  serverFuerSich: boolean;
};

export type PlatzKunde = { id: string; betreiberId: string; bietet: string[] };

export type PlatzAnfrage = {
  manifest: Manifest;
  optionen: string[];
  server: PlatzServer;
  installationen: PlatzInstallation[];
  kunde: PlatzKunde;
  /** The names of the operator's values set for this app (level `betreiber`) */
  betreiberWerte: string[];
};

export type Befund = { code: string; werte: Record<string, string | number> };

export type Platzierung =
  | { art: "passt"; hinweise: [] }
  | { art: "hinweise"; hinweise: Befund[] }
  | { art: "passt_nicht"; gruende: Befund[]; hinweise: Befund[] };

/** A share of RAM or disk above which the placement still fits but says so */
export const WARNSCHWELLE = 0.8;

const befund = (code: string, werte: Befund["werte"] = {}): Befund => ({ code, werte });

const gewaehlteOptionen = (a: PlatzAnfrage) =>
  a.manifest.optionen.filter((o) => a.optionen.includes(o.id));

const containerMitArchitektur = (a: PlatzAnfrage) => [
  ...a.manifest.container.map((c) => ({ c, architektur: c.architektur ?? a.manifest.architektur })),
  ...gewaehlteOptionen(a).flatMap((o) =>
    o.container.map((c) => ({
      c,
      architektur: c.architektur ?? o.architektur ?? a.manifest.architektur,
    })),
  ),
];

/** The RAM an installation of this app with these options is limited to */
export const ramBedarf = (manifest: Manifest, optionen: string[]): number =>
  manifest.ressourcen.ram_mb +
  manifest.optionen
    .filter((o) => optionen.includes(o.id))
    .reduce((summe, o) => summe + o.ram_mb, 0);

/** The fixed ports an installation of this app with these options takes */
export const festePorts = (manifest: Manifest): PlatzInstallation["festePorts"] =>
  manifest.netz.ports
    .filter((p) => p.fest)
    .map((p) =>
      p.bis === undefined
        ? { port: p.port, proto: p.proto }
        : { port: p.port, bis: p.bis, proto: p.proto },
    );

const ueberschneiden = (
  a: PlatzInstallation["festePorts"][number],
  b: { port: number; bis?: number; proto: string },
) => a.proto === b.proto && a.port <= (b.bis ?? b.port) && b.port <= (a.bis ?? a.port);

/** Whether an IPv4 address is reachable from the internet: not private, loopback, CGNAT or link-local */
export const istOeffentlich = (ip: string): boolean => {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return !(
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254)
  );
};

type Ergebnis = { gruende: Befund[]; hinweise: Befund[] };
type Regel = (a: PlatzAnfrage) => Ergebnis;
const nur = (gruende: Befund[] = [], hinweise: Befund[] = []): Ergebnis => ({ gruende, hinweise });

// An option without containers of its own still limits the architecture (a feature of the app's
// image, say); with containers, theirs is checked and the option's is their default
const architektur: Regel = (a) =>
  nur([
    ...containerMitArchitektur(a)
      .filter(({ architektur }) => !architektur.includes(a.server.architektur))
      .map(({ c }) => befund("architektur", { container: c.name, server: a.server.architektur })),
    ...gewaehlteOptionen(a)
      .filter(
        (o) =>
          o.container.length === 0 &&
          o.architektur &&
          !o.architektur.includes(a.server.architektur),
      )
      .map((o) => befund("architektur", { option: o.id, server: a.server.architektur })),
  ]);

const anteil = (code: string, belegt: number, gesamt: number): Ergebnis => {
  if (belegt > gesamt) return nur([befund(code, { bedarf: belegt, verfuegbar: gesamt })]);
  if (belegt > gesamt * WARNSCHWELLE)
    return nur([], [befund(`${code}_knapp`, { prozent: Math.round((belegt / gesamt) * 100) })]);
  return nur();
};

const ram: Regel = (a) =>
  anteil(
    "ram",
    ramBedarf(a.manifest, a.optionen) + a.installationen.reduce((s, i) => s + i.ramMb, 0),
    a.server.ramMb,
  );

/**
 * Disk is a planned value (docs/plan.md, "Ressourcen"), summed like RAM (BAULISTE.md, Z-204): the
 * planned sizes of all installations against the volume, and the app's against the free space the
 * agent measures; the tighter of the two decides
 */
const platte: Regel = (a) => {
  const neu = a.manifest.ressourcen.platte_gb * 1024;
  const geplant = neu + a.installationen.reduce((s, i) => s + i.platteGb * 1024, 0);
  return geplant / a.server.platteGesamtMb > neu / a.server.platteFreiMb
    ? anteil("platte", geplant, a.server.platteGesamtMb)
    : anteil("platte", neu, a.server.platteFreiMb);
};

const ports: Regel = (a) => {
  const belegt = [...a.installationen.flatMap((i) => i.festePorts), ...a.server.portsBelegt];
  return nur(
    festePorts(a.manifest)
      .filter((p) => belegt.some((b) => ueberschneiden(p, b)))
      .map((p) =>
        befund("port_belegt", { port: p.bis ? `${p.port}-${p.bis}` : p.port, proto: p.proto }),
      ),
  );
};

const ipv4: Regel = (a) =>
  nur(
    a.manifest.netz.oeffentliche_ipv4 && !a.server.ipv4.some(istOeffentlich)
      ? [befund("keine_oeffentliche_ipv4")]
      : [],
  );

const mail: Regel = (a) => {
  if (!a.manifest.netz.mail) return nur();
  const gruende: Befund[] = [];
  const oeffentlich = a.server.ipv4.filter(istOeffentlich);
  if (!oeffentlich.some((ip) => a.server.ptr[ip])) gruende.push(befund("kein_ptr"));
  if (a.server.port25Ausgehend !== true) gruende.push(befund("port25_gesperrt"));
  return nur(gruende);
};

const fuerSich: Regel = (a) => {
  const gruende: Befund[] = [];
  const brauchtAllein =
    a.manifest.netz.server_fuer_sich || a.manifest.rootful || a.manifest.proxy === "eigen";
  if (brauchtAllein && a.installationen.length > 0)
    gruende.push(befund("braucht_server_fuer_sich", { andere: a.installationen.length }));
  if (a.installationen.some((i) => i.serverFuerSich))
    gruende.push(befund("server_belegt_fuer_sich"));
  return nur(gruende);
};

const besitz: Regel = (a) => {
  if (a.server.betreiberId !== a.kunde.betreiberId)
    return nur([befund("server_anderer_betreiber")]);
  return nur();
};

const abhaengigkeiten: Regel = (a) =>
  nur(
    a.manifest.braucht
      .filter((dienst) => !a.kunde.bietet.includes(dienst))
      .map((dienst) => befund("braucht_dienst", { dienst })),
  );

const betreiberWerte: Regel = (a) =>
  nur(
    a.manifest.env
      .filter((e) => e.ebene === "betreiber" && e.pflicht && !a.betreiberWerte.includes(e.name))
      .map((e) => befund("betreiberwert_fehlt", { name: e.name })),
  );

const agent: Regel = (a) => nur(a.server.agentVerbunden ? [] : [befund("agent_getrennt")]);

const beobachtet: Regel = (a) => nur(a.server.nurBeobachten ? [befund("nur_beobachten")] : []);

const image: Regel = (a) =>
  nur(
    containerMitArchitektur(a)
      .filter(({ c }) => typeof c.image !== "string")
      .map(({ c }) => befund("kein_image", { container: c.name })),
  );

const unbekannteOptionen: Regel = (a) =>
  nur(
    a.optionen
      .filter((id) => !a.manifest.optionen.some((o) => o.id === id))
      .map((option) => befund("unbekannte_option", { option })),
  );

export const REGELN: readonly Regel[] = [
  unbekannteOptionen,
  besitz,
  agent,
  beobachtet,
  image,
  architektur,
  ram,
  platte,
  ports,
  ipv4,
  mail,
  fuerSich,
  abhaengigkeiten,
  betreiberWerte,
];

/** Whether the app fits the server: `passt`, fits with hints, or does not fit with reasons */
export const platzieren = (anfrage: PlatzAnfrage): Platzierung => {
  const ergebnisse = REGELN.map((regel) => regel(anfrage));
  const gruende = ergebnisse.flatMap((e) => e.gruende);
  const hinweise = ergebnisse.flatMap((e) => e.hinweise);
  if (gruende.length > 0) return { art: "passt_nicht", gruende, hinweise };
  if (hinweise.length > 0) return { art: "hinweise", hinweise };
  return { art: "passt", hinweise: [] };
};
