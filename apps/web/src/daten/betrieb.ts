import type { Serverpruefung } from "@steuerzentrale/planung";
import { type Antwort, api } from "../anmeldung/api.ts";
import type { HealthGrund as Grund } from "./bewertung.ts";
import type { AuftragsZustand } from "./installationen.ts";

/*
 * Where the overview, the jobs, the events and the audit log read (BAULISTE.md Z-406): the
 * Zentrale's API once someone is signed in (main.tsx puts it in), else the demo fixtures, which
 * answer as the API does (src/demo/betrieb-quelle.ts). The lists come page by page: `weiter` is the
 * cursor of the page before, null on the last.
 */

export type Seite<T> = { eintraege: T[]; weiter: string | null };

/** The severity of an overview entry: fault, warning, note (DESIGN.md, "Grundsätze") */
export type Dringlichkeit = "stoerung" | "warnung" | "hinweis";

export type InstallationsVerweis = {
  installationId: string;
  app: string;
  host: string;
  kunde: string;
  /** The server it runs on (the overview puts it beside that server's entries) */
  serverId: string;
};
export type ServerVerweis = { serverId: string; name: string };

/** Where an overview entry leads */
export type Verweis =
  | { art: "installation"; id: string }
  | { art: "server"; id: string }
  | { art: "auftrag"; id: string }
  | { art: "ereignisse" };

/** One entry of GET /api/v1/uebersicht (apps/zentrale, modules/betrieb/ordnen.ts) */
export type UebersichtEintrag = { schwere: Dringlichkeit; verweis: Verweis } & (
  | { art: "stoerung"; installation: InstallationsVerweis; grund: Grund; seit: number | null }
  | {
      art: "installation";
      installation: InstallationsVerweis;
      zustand: "rot" | "gelb" | "unbekannt";
      grund: Grund;
      seit: number | null;
    }
  | { art: "agent"; server: ServerVerweis; zustand: "getrennt" | "still"; seit: number | null }
  | {
      /** A check of the server red or yellow (Z-702); `seit` the event of its open finding */
      art: "pruefung";
      server: ServerVerweis;
      pruefung: Serverpruefung;
      seit: number | null;
    }
  | {
      /** The newest test restore failed, or there was none for 8 days (Z-602) */
      art: "pruef_restore";
      installation: InstallationsVerweis;
      gescheitert: boolean;
      grund: string | null;
      seit: number | null;
    }
  | {
      art: "auftrag";
      auftragId: string;
      aktion: string;
      fehler: string | null;
      server: ServerVerweis;
      installation: InstallationsVerweis | null;
      seit: number;
    }
  | {
      art: "ereignis";
      ereignisId: string;
      ereignisArt: string;
      ziel: string;
      text: string;
      seit: number;
    }
);

/** A job as GET /api/v1/auftraege lists it: never the manifest, its signature or the arguments */
export type AuftragDerZentrale = {
  auftragId: string;
  aktion: string;
  app: string;
  version: string;
  zustand: AuftragsZustand;
  fortschritt: string | null;
  fehler: string | null;
  server: ServerVerweis;
  installation: { installationId: string; host: string; kunde: string } | null;
  angelegtVon: string;
  angelegtAm: number;
  geaendertAm: number;
};

/** The page of an event's or audit entry's target, with its name */
export type ZielVerweis = { art: "installation" | "server" | "kunde"; id: string; name: string };

export type Ereignisschwere = "fehler" | "warn" | "info";

export type EreignisDerZentrale = {
  ereignisId: string;
  zeitpunkt: number;
  art: string;
  schwere: Ereignisschwere;
  /** `art:id`, e.g. `installation:haben-x1y2z3` */
  ziel: string;
  verweis: ZielVerweis | null;
  text: string;
};

export type Akteur =
  | { art: "person"; id: string; name: string }
  | { art: "server"; id: string; name: string }
  | { art: "zentrale"; id: string };

export type AuditEintragDerZentrale = {
  nummer: number;
  zeitpunkt: number;
  akteur: Akteur;
  aktion: string;
  ziel: string;
  verweis: ZielVerweis | null;
  grund: string;
  inhalt: unknown;
};

export type AuftragFilter = {
  zustand?: AuftragsZustand[];
  serverId?: string[];
  installationId?: string[];
};
export type EreignisFilter = { schwere?: Ereignisschwere[]; art?: string[]; ziel?: string[] };
export type AuditFilter = { akteur?: string[]; aktion?: string[]; ziel?: string[] };

export type BetriebQuelle = {
  uebersicht: () => Promise<Antwort<UebersichtEintrag[]>>;
  auftraege: (
    filter: AuftragFilter,
    weiter?: string,
  ) => Promise<Antwort<Seite<AuftragDerZentrale>>>;
  ereignisse: (
    filter: EreignisFilter,
    weiter?: string,
  ) => Promise<Antwort<Seite<EreignisDerZentrale>>>;
  audit: (filter: AuditFilter, weiter?: string) => Promise<Antwort<Seite<AuditEintragDerZentrale>>>;
};

/** The query of a list: each filter value repeated, then the cursor */
export const abfrage = (filter: Record<string, string[] | undefined>, weiter?: string): string => {
  const q = new URLSearchParams();
  for (const [name, werte] of Object.entries(filter))
    for (const w of werte ?? []) q.append(name, w);
  if (weiter) q.set("weiter", weiter);
  const text = q.toString();
  return text ? `?${text}` : "";
};

export const apiBetrieb: BetriebQuelle = {
  uebersicht: async () => {
    const a = await api<{ eintraege: UebersichtEintrag[] }>("/api/v1/uebersicht");
    return a.ok ? { ...a, daten: a.daten.eintraege } : a;
  },
  auftraege: (filter, weiter) => api(`/api/v1/auftraege${abfrage(filter, weiter)}`),
  ereignisse: (filter, weiter) => api(`/api/v1/ereignisse${abfrage(filter, weiter)}`),
  audit: (filter, weiter) => api(`/api/v1/audit${abfrage(filter, weiter)}`),
};

/** The demo source, loaded on its first call, so the fixtures stay out of the signed-in bundle */
const spaeterDemo = (): BetriebQuelle => {
  let geladen: Promise<BetriebQuelle> | undefined;
  const laden = () => {
    geladen ??= import("../demo/betrieb-quelle.ts").then((d) => d.demoBetrieb());
    return geladen;
  };
  return {
    uebersicht: async () => (await laden()).uebersicht(),
    auftraege: async (f, w) => (await laden()).auftraege(f, w),
    ereignisse: async (f, w) => (await laden()).ereignisse(f, w),
    audit: async (f, w) => (await laden()).audit(f, w),
  };
};

let quelle: BetriebQuelle = spaeterDemo();

export const betriebQuelle = (): BetriebQuelle => quelle;

export const betriebQuelleEinsetzen = (neu: BetriebQuelle): void => {
  quelle = neu;
};
