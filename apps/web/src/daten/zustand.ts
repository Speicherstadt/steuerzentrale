import { installationenAuf, istGekuendigt } from "./ableitungen.ts";
import type {
  AgentZustand,
  Auftrag,
  Bestand,
  Health,
  Installation,
  Schwere,
  Server,
  Zugang,
} from "./typen.ts";

/*
 * The checks of a server and what needs attention, as data; the pages turn them into text. Limits
 * from BAULISTE.md, Z-702: disk over 80/90 %, a certificate within 14 days, a backup older than 26 h.
 */

export const PLATTE_WARNUNG = 80;
export const PLATTE_STOERUNG = 90;
export const ZERTIFIKAT_TAGE = 14;
const UHR_GRENZE_MS = 500;

export type Pruefung =
  | { art: "kernel"; ok: boolean; laeuft: string; installiert: string }
  | { art: "sicherheitsupdates"; ok: boolean; anzahl: number }
  | { art: "neustart"; ok: boolean; wartung: string }
  | { art: "podman"; ok: true; version: string }
  | { art: "platte"; ok: boolean; prozent: number; grenze: number | null }
  | { art: "ports"; ok: true; ports: string[] }
  | { art: "zertifikate"; ok: boolean; tage: number }
  | { art: "backups"; ok: boolean; alt: Installation[] }
  | { art: "uhrzeit"; ok: boolean; ms: number };

const grenzeVon = (prozent: number) =>
  prozent >= PLATTE_STOERUNG ? PLATTE_STOERUNG : prozent >= PLATTE_WARNUNG ? PLATTE_WARNUNG : null;

/** The checks the agent runs on a server, every five minutes */
export const pruefungen = (b: Bestand, sv: Server): Pruefung[] => {
  const installationen = installationenAuf(b, sv.id);
  const ports = installationen.flatMap((i) => b.apps.find((a) => a.id === i.app)?.ports ?? []);
  const alt = installationen.filter((i) => !i.backup.ok);
  return [
    { art: "kernel", ok: sv.kernel.laeuft === sv.kernel.installiert, ...sv.kernel },
    { art: "sicherheitsupdates", ok: sv.sicherheitsupdates === 0, anzahl: sv.sicherheitsupdates },
    { art: "neustart", ok: !sv.neustart, wartung: sv.wartung.von },
    { art: "podman", ok: true, version: sv.podman },
    {
      art: "platte",
      ok: sv.platte < PLATTE_WARNUNG,
      prozent: sv.platte,
      grenze: grenzeVon(sv.platte),
    },
    { art: "ports", ok: true, ports: [...new Set(["80", "443", ...ports])] },
    { art: "zertifikate", ok: sv.zertifikatTage > ZERTIFIKAT_TAGE, tage: sv.zertifikatTage },
    { art: "backups", ok: alt.length === 0, alt },
    { art: "uhrzeit", ok: sv.uhrAbweichungMs < UHR_GRENZE_MS, ms: sv.uhrAbweichungMs },
  ];
};

export type ServerZustand = "ok" | "neustart" | "platte" | "pruefen" | "agent";

/** One word for a server: the worst of agent, disk, reboot and the other checks */
export const serverZustand = (b: Bestand, sv: Server): ServerZustand => {
  if (sv.agent.zustand !== "verbunden") return "agent";
  if (sv.platte >= PLATTE_STOERUNG) return "platte";
  if (sv.neustart) return "neustart";
  return pruefungen(b, sv).every((p) => p.ok) ? "ok" : "pruefen";
};

export type Hinweis =
  | { schwere: Schwere; art: "agent"; server: Server; zustand: AgentZustand; seit: number }
  | { schwere: Schwere; art: "platte"; server: Server; prozent: number }
  | { schwere: Schwere; art: "neustart"; server: Server; kernel: string; wartung: string }
  | { schwere: Schwere; art: "zertifikat"; server: Server; tage: number }
  | { schwere: Schwere; art: "pakete"; server: Server; anzahl: number }
  | { schwere: Schwere; art: "health"; installation: Installation; health: Health; grund: string }
  | { schwere: Schwere; art: "pruef_restore"; installation: Installation }
  | { schwere: Schwere; art: "auftrag"; auftrag: Auftrag }
  | { schwere: Schwere; art: "support"; zugang: Zugang };

const hinweiseZumServer = (sv: Server): Hinweis[] => [
  ...(sv.agent.zustand !== "verbunden"
    ? [
        {
          schwere: "krit" as const,
          art: "agent" as const,
          server: sv,
          zustand: sv.agent.zustand,
          seit: sv.agent.letzteMeldung,
        },
      ]
    : []),
  ...(sv.platte >= PLATTE_WARNUNG
    ? [
        {
          schwere: sv.platte >= PLATTE_STOERUNG ? ("krit" as const) : ("warn" as const),
          art: "platte" as const,
          server: sv,
          prozent: sv.platte,
        },
      ]
    : []),
  ...(sv.neustart
    ? [
        {
          schwere: "warn" as const,
          art: "neustart" as const,
          server: sv,
          kernel: sv.kernel.installiert,
          wartung: sv.wartung.von,
        },
      ]
    : []),
  ...(sv.zertifikatTage <= ZERTIFIKAT_TAGE
    ? [
        {
          schwere: "warn" as const,
          art: "zertifikat" as const,
          server: sv,
          tage: sv.zertifikatTage,
        },
      ]
    : []),
  ...(sv.sicherheitsupdates > 0
    ? [
        {
          schwere: "info" as const,
          art: "pakete" as const,
          server: sv,
          anzahl: sv.sicherheitsupdates,
        },
      ]
    : []),
];

const hinweiseZurInstallation = (b: Bestand, i: Installation): Hinweis[] => [
  ...((i.health === "rot" || i.health === "gelb") && !istGekuendigt(b, i)
    ? [
        {
          schwere: i.health === "rot" ? ("krit" as const) : ("warn" as const),
          art: "health" as const,
          installation: i,
          health: i.health,
          grund: i.grund ?? "",
        },
      ]
    : []),
  ...(i.pruefRestore === "gescheitert"
    ? [{ schwere: "warn" as const, art: "pruef_restore" as const, installation: i }]
    : []),
];

const RANG: Record<Schwere, number> = { krit: 0, warn: 1, info: 2 };

const zielId = (h: Hinweis) =>
  "server" in h ? h.server.id : "installation" in h ? h.installation.id : undefined;

/**
 * What needs attention, worst first (DESIGN.md, "Grundsätze"): servers, installations, failed jobs
 * whose target is not listed yet, and running support accesses
 */
export const aufmerksamkeit = (b: Bestand): Hinweis[] => {
  const grund = [
    ...b.server.flatMap(hinweiseZumServer),
    ...b.installationen.flatMap((i) => hinweiseZurInstallation(b, i)),
  ];
  const genannt = new Set(grund.map(zielId));
  const auftraege: Hinweis[] = b.auftraege
    .filter((a) => a.zustand === "gescheitert" && !("id" in a.ziel && genannt.has(a.ziel.id)))
    .map((auftrag) => ({ schwere: "warn", art: "auftrag", auftrag }));
  const support: Hinweis[] = b.zugaenge
    .filter((z) => z.restMinuten !== undefined)
    .map((zugang) => ({ schwere: "info", art: "support", zugang }));
  return [...grund, ...auftraege, ...support].sort((x, y) => RANG[x.schwere] - RANG[y.schwere]);
};

/** The counters of the sidebar: only where there is something to do (DESIGN.md, "Bausteine") */
export const zaehler = (b: Bestand) => ({
  updates: b.apps.filter((a) =>
    b.installationen.some(
      (i) =>
        i.app === a.id && a.version !== null && i.version !== a.version && !istGekuendigt(b, i),
    ),
  ).length,
  auftraege: b.auftraege.filter((a) => a.zustand === "laeuft").length,
  support: b.zugaenge.filter((z) => z.restMinuten !== undefined).length,
  ereignisse: b.ereignisse.filter((e) => e.schwere !== "info").length,
});

/** Installations by state, cancelled ones apart (they count only as cancelled) */
export const nachHealth = (b: Bestand, health: Health) =>
  b.installationen.filter((i) => i.health === health && !istGekuendigt(b, i));
