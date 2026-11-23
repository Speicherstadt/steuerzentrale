import {
  PLATTE_STOERUNG_PROZENT,
  PLATTE_WARNUNG_PROZENT,
  type Serverpruefung,
  serverPruefen,
  ZERTIFIKAT_FRIST_MS,
} from "@steuerzentrale/planung";
import { installationenAuf, istGekuendigt, titel } from "./ableitungen.ts";
import type { Bestand, Server } from "./typen.ts";

/*
 * The checks of a server and the sidebar counters, as data; the pages turn them into text; what
 * needs attention comes from the Zentrale (GET /api/v1/uebersicht). The checks of Z-702 (disk,
 * certificates, backups, open ports, clock) come from the Zentrale's API with the limits of
 * packages/planung; the demo computes them with the same function from its values. The checks of
 * kernel, updates, reboot and Podman are the demo's; the real operating system shows in the card
 * "Wartung" (Z-701, seiten/server-wartung.tsx).
 */

export const PLATTE_WARNUNG = PLATTE_WARNUNG_PROZENT;
export const PLATTE_STOERUNG = PLATTE_STOERUNG_PROZENT;
const TAG = 86_400_000;
export const ZERTIFIKAT_TAGE = ZERTIFIKAT_FRIST_MS / TAG;

export type Pruefung =
  | { art: "kernel"; ok: boolean; laeuft: string; installiert: string }
  | { art: "sicherheitsupdates"; ok: boolean; anzahl: number }
  | { art: "neustart"; ok: boolean; wartung: string }
  | { art: "podman"; ok: true; version: string };

/** The checks of the operating system the demo shows (the API has them in the card "Wartung") */
export const pruefungen = (sv: Server): Pruefung[] => [
  { art: "kernel", ok: sv.kernel.laeuft === sv.kernel.installiert, ...sv.kernel },
  { art: "sicherheitsupdates", ok: sv.sicherheitsupdates === 0, anzahl: sv.sicherheitsupdates },
  { art: "neustart", ok: !sv.neustart, wartung: sv.wartung.von },
  { art: "podman", ok: true, version: sv.podman },
];

/**
 * The checks of Z-702 for a demo server, as the Zentrale computes them (packages/planung): its disk
 * as a root of 1000 MiB with its share in use, one certificate per installation with its days
 * left, the last good backup of each installation, SSH and the Pforte open, its clock in sync
 */
export const pruefungenDerDemo = (b: Bestand, sv: Server): Serverpruefung[] => {
  const installationen = installationenAuf(b, sv.id).filter((i) => !istGekuendigt(b, i));
  return serverPruefen({
    jetzt: b.jetzt,
    fakten: {
      am: b.jetzt,
      platten: [{ mount: "/", gesamtMb: 1000, freiMb: 1000 - sv.platte * 10 }],
      portsOffen: [22, 80, 443].map((port) => ({ port, proto: "tcp" as const })),
      zertifikate: installationen.map((i) => ({
        host: i.adresse,
        gueltigBis: b.jetzt + sv.zertifikatTage * TAG,
      })),
      uhrzeitAbweichungMs: sv.uhrAbweichungMs,
      uhrSynchron: true,
    },
    hosts: installationen.map((i) => i.adresse),
    erlaubtePorts: [],
    backups: installationen.map((i) => ({
      installationId: i.id,
      name: titel(b, i),
      letzterErfolg: i.backup.zeitpunkt,
      eingerichtetAm: i.backup.zeitpunkt,
    })),
  });
};

/** Whether a check of Z-702 needs a look: yellow or red */
export const auffaellig = (p: Pick<Serverpruefung, "ergebnis">): boolean =>
  p.ergebnis === "gelb" || p.ergebnis === "rot";

export type ServerZustand = "ok" | "neustart" | "platte" | "pruefen" | "agent";

/** One word for a server: the worst of agent, disk, reboot and the other checks */
export const serverZustand = (b: Bestand, sv: Server): ServerZustand => {
  if (sv.agent.zustand !== "verbunden") return "agent";
  const z702 = pruefungenDerDemo(b, sv);
  if (z702.some((p) => p.pruefung === "platte" && p.ergebnis === "rot")) return "platte";
  if (sv.neustart) return "neustart";
  return pruefungen(sv).every((p) => p.ok) && !z702.some(auffaellig) ? "ok" : "pruefen";
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
