import type { HealthDerZentrale } from "./bewertung.ts";
import type {
  Einstellungswert,
  InstallationDerZentrale,
  InstallationsZustand,
} from "./installationen.ts";
import type { ServerDerZentrale } from "./server.ts";
import type { Art, Health, Installation, Kunde, Manifest } from "./typen.ts";

/*
 * An installation as the installation pages show it (BAULISTE.md Z-402): what the Zentrale's API
 * has, named by its customer, server and app, and nothing invented; its state from the agent's
 * reports (Z-403). Backups, data and the settings of the manifest come from the demo data by the
 * installation's id until Z-406 (`demo`), so an installation of the Zentrale shows none of those yet.
 */

export type Namen = {
  kunden: Kunde[];
  server: ServerDerZentrale[];
  /** The demo's descriptions of the apps: name and icon, until manifests are imported (Z-501) */
  apps: Manifest[];
  demo: Installation[];
};

export type InstallationAnsicht = {
  id: string;
  app: string;
  appName: string;
  appIcon: string;
  kundeId: string;
  kundeName: string;
  /** The day the customer's contract ends, once it gave notice */
  vertragsende: number | null;
  serverId: string;
  serverName: string;
  serverArt: Art | null;
  version: string;
  host: string;
  httpPort: number | null;
  ports: Record<string, number>;
  optionen: string[];
  werte: Record<string, Einstellungswert>;
  zustand: InstallationsZustand;
  health: HealthDerZentrale;
  angelegtAm: number;
  geaendertAm: number;
  demo: Installation | undefined;
};

const ARTEN = { gemeinsam: "gemeinsam", eigen: "eigen", beim_kunden: "kunde" } as const;

export const installationAnsicht = (i: InstallationDerZentrale, n: Namen): InstallationAnsicht => {
  const kunde = n.kunden.find((k) => k.id === i.kundeId);
  const server = n.server.find((s) => s.serverId === i.serverId);
  const app = n.apps.find((a) => a.id === i.app);
  return {
    id: i.installationId,
    app: i.app,
    appName: app?.name ?? i.app,
    // an unknown icon name falls back to a package (teile/app-icon.ts)
    appIcon: app?.icon ?? "",
    kundeId: i.kundeId,
    kundeName: kunde?.name ?? i.kundeId,
    vertragsende: kunde?.vertrag.ende ?? null,
    serverId: i.serverId,
    serverName: server?.name ?? i.serverId,
    serverArt: server ? ARTEN[server.art] : null,
    version: i.version,
    host: i.host,
    httpPort: i.httpPort,
    ports: i.ports,
    optionen: i.optionen,
    werte: i.einstellungen.installation,
    zustand: i.zustand,
    health: i.health,
    angelegtAm: i.angelegtAm,
    geaendertAm: i.geaendertAm,
    demo: n.demo.find((d) => d.id === i.installationId),
  };
};

/** One word for the installation: its state of setup until it runs, then its health (Z-403) */
export type Anzeige = Health | Exclude<InstallationsZustand, "laeuft">;

export const anzeige = (a: Pick<InstallationAnsicht, "zustand" | "health">): Anzeige =>
  a.zustand === "laeuft" ? a.health.zustand : a.zustand;

export const titelVon = (a: Pick<InstallationAnsicht, "kundeName" | "appName">) =>
  `${a.kundeName} · ${a.appName}`;

export const linuxNutzerVon = (a: Pick<InstallationAnsicht, "id">) => `sz-${a.id}`;
