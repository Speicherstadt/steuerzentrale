import { installationenAuf, istGekuendigt } from "./ableitungen.ts";
import type { Bestand, Installation, Server } from "./typen.ts";

/*
 * The checks of a server (demo only until Z-702) and the sidebar counters, as data; the pages turn
 * them into text; what needs attention comes from the Zentrale (GET /api/v1/uebersicht). Limits
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
