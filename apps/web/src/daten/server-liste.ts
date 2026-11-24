import { aufServer, einmal, type InstallationAnsicht } from "./installation-ansicht.ts";
import { ansichtZustand, type ServerAnsicht } from "./server-ansicht.ts";
import type { AgentZustand, Bestand } from "./typen.ts";

/*
 * The table of the page "Server" as data (docs/plan.md, "Server und Kunden (Oberfläche
 * 2026-11)"): per server its state in plain words, its load, its apps and their customers; what
 * needs attention first. The state comes from the agent, the facts and the checks
 * (server-ansicht.ts); CPU and RAM only where something measured them, which the agent does not
 * report yet: the demo's values, else null.
 */

export type ServerStand =
  | { art: "platte"; prozent: number }
  | { art: "agent"; zustand: AgentZustand; letzteMeldung: number | null }
  | { art: "neustart"; ab: number | null }
  | { art: "pruefen" }
  | { art: "ok" };

/** The order of the table: a full disk, then a silent agent, a reboot, a check, all well */
const RANG: Record<ServerStand["art"], number> = {
  platte: 0,
  agent: 1,
  neustart: 2,
  pruefen: 3,
  ok: 4,
};

/** When a needed reboot is planned: the start of the next maintenance window that is free */
const neustartAb = (a: ServerAnsicht): number | null => {
  const plan = a.neustartStand.plan;
  return plan.art === "warten" && plan.grund === "fenster" ? (plan.ab ?? null) : null;
};

export const serverStand = (b: Bestand, a: ServerAnsicht): ServerStand => {
  switch (ansichtZustand(b, a)) {
    case "agent":
      return { art: "agent", zustand: a.agent.zustand, letzteMeldung: a.agent.letzteMeldung };
    case "platte":
      return { art: "platte", prozent: a.platte ?? 0 };
    case "neustart":
      return { art: "neustart", ab: neustartAb(a) };
    case "pruefen":
      return { art: "pruefen" };
    case "ok":
      return { art: "ok" };
  }
};

/** Whether the state needs someone: anything but all well */
export const brauchtJemanden = (s: ServerStand): boolean => s.art !== "ok";

export type ServerZeile = {
  a: ServerAnsicht;
  stand: ServerStand;
  /** Its apps not removed, and how many customers they belong to */
  apps: number;
  kunden: number;
  /** Load in percent where measured */
  cpu: number | null;
  ram: number | null;
};

/** Every server with its state and apps, what needs attention first, else by name */
export const serverZeilen = (
  b: Bestand,
  server: ServerAnsicht[],
  installationen: InstallationAnsicht[],
): ServerZeile[] =>
  server
    .map((a): ServerZeile => {
      const hier = aufServer(installationen, a.id);
      return {
        a,
        stand: serverStand(b, a),
        apps: hier.length,
        kunden: einmal(hier.map((i) => i.kundeId)).length,
        cpu: a.demo?.cpu ?? null,
        ram: a.demo?.ram ?? null,
      };
    })
    .sort(
      (x, y) => RANG[x.stand.art] - RANG[y.stand.art] || x.a.name.localeCompare(y.a.name, "de"),
    );

/** Whether any row has a measured CPU and RAM: the table shows those columns only then */
export const lastGemessen = (zeilen: ServerZeile[]): boolean =>
  zeilen.some((z) => z.cpu !== null || z.ram !== null);
