import {
  festePorts,
  type Manifest,
  type PlatzInstallation,
  type Platzierung,
  type PlatzServer,
  platzieren,
  ramBedarf,
} from "@steuerzentrale/manifest";
import type { ServerDerZentrale } from "../daten/server.ts";
import type { Manifest as DemoManifest } from "../daten/typen.ts";

/*
 * The placement of the demo, with the same pure function the Zentrale calls (packages/manifest,
 * `platzieren`; apps/zentrale, modules/installationen/platz.ts): the server's demo facts, the
 * installations on it and the demo operator's values. One operator, so ownership is the customer's.
 */

export const DEMO_BETREIBER = "demo";

/** What placement needs of a server, from its facts; undefined lists what is missing */
export const demoPlatzServer = (
  sv: ServerDerZentrale,
): { ok: true; server: PlatzServer } | { ok: false; fehlt: string[] } => {
  const f = sv.fakten;
  const platte = f?.platten?.find((p) => p.mount === "/");
  const architektur = f?.architektur ?? sv.architektur;
  if (!f?.ramMb || !platte || !f.ipv4 || !f.portsBelegt || !architektur)
    return { ok: false, fehlt: ["architektur", "ramMb", "platte", "ipv4", "portsBelegt"] };
  return {
    ok: true,
    server: {
      betreiberId: DEMO_BETREIBER,
      art: sv.art,
      kundeId: sv.kundeId,
      agentVerbunden: sv.agent.zustand === "verbunden",
      nurBeobachten: f.nurBeobachten === true,
      architektur,
      ramMb: f.ramMb,
      platteFreiMb: platte.freiMb,
      platteGesamtMb: platte.gesamtMb,
      ipv4: f.ipv4,
      ptr: f.ptr,
      port25Ausgehend: f.port25Ausgehend,
      portsBelegt: f.portsBelegt,
    },
  };
};

/** A demo installation as placement counts it, from the demo's description of its app */
export const ausDemoApp = (kundeId: string, app: DemoManifest | undefined): PlatzInstallation => ({
  kundeId,
  ramMb: app?.ramMb ?? 0,
  platteGb: app?.platteGb ?? 0,
  festePorts: [],
  serverFuerSich: app?.serverFuerSich ?? false,
});

/** An installation made in the demo, as placement counts it, from its signed manifest */
export const ausManifest = (
  kundeId: string,
  m: Manifest,
  optionen: string[],
): PlatzInstallation => ({
  kundeId,
  ramMb: ramBedarf(m, optionen),
  platteGb: m.ressourcen.platte_gb,
  festePorts: festePorts(m),
  serverFuerSich: m.netz.server_fuer_sich || m.rootful || m.proxy === "eigen",
});

export type DemoPlatzAnfrage = {
  manifest: Manifest;
  optionen: string[];
  server: ServerDerZentrale;
  kundeId: string;
  installationen: PlatzInstallation[];
  bietet: string[];
  betreiberWerte: string[];
};

export const demoPlatzieren = (a: DemoPlatzAnfrage): Platzierung => {
  const ps = demoPlatzServer(a.server);
  if (!ps.ok)
    return {
      art: "passt_nicht",
      gruende: [{ code: "fakten_fehlen", werte: { fakten: ps.fehlt.join(", ") } }],
      hinweise: [],
    };
  return platzieren({
    manifest: a.manifest,
    optionen: a.optionen,
    server: ps.server,
    installationen: a.installationen,
    kunde: { id: a.kundeId, betreiberId: DEMO_BETREIBER, bietet: a.bietet },
    betreiberWerte: a.betreiberWerte,
  });
};
