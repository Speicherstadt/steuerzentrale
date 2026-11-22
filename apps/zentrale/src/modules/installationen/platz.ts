import {
  festePorts,
  type Manifest,
  manifestPruefen,
  type PlatzBefund,
  type PlatzInstallation,
  type Platzierung,
  type PlatzServer,
  platzieren,
  ramBedarf,
  type Wert,
} from "@steuerzentrale/manifest";
import type { Db } from "../../db/oeffnen.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { kundeLesen } from "../kunden/index.ts";
import { platzServer, type Server, serverFakten, serverLesen } from "../server/index.ts";
import {
  betreiberWerteLesen,
  type Installation,
  installationenAufServer,
  installationenDesKunden,
  type Werte,
} from "./lesen.ts";
import { betreiberWerteErgaenzen } from "./werte.ts";

/*
 * Placement of a new installation (docs/plan.md, "Platzierung") with what the Zentrale knows: the
 * server's newest facts (`platzServer`), the installations on it, what the customer's
 * installations offer and the operator's values for the app, with those the dialog adds when it
 * makes the installation (Z-404). The same for the dialog's preview and for making the
 * installation, so the dialog shows what making it will decide.
 */

export type PlatzDeps = {
  db: Db;
  schluessel: Schluesselbund;
  /** Whether the server's agent is connected now */
  verbunden: (betreiberId: string, serverId: string) => boolean;
};

export type PlatzWunsch = {
  kundeId: string;
  serverId: string;
  manifest: Manifest;
  optionen: string[];
  /** Values of the level `betreiber` the dialog adds to the operator's (Z-404) */
  betreiberEingabe?: Readonly<Record<string, Wert>>;
};

export type Platz =
  | {
      ok: true;
      platzierung: Platzierung;
      server: Server;
      /** Undefined when a fact is missing; the placement then does not fit */
      platzServer: PlatzServer | undefined;
      /** The operator's values with those the dialog adds */
      betreiberWerte: Werte;
      /** As stored, and what the dialog adds of the form's fields, to write them */
      betreiberGespeichert: Werte;
      betreiberNeu: Werte;
    }
  | {
      ok: false;
      grund:
        | "kein_kunde"
        | "kein_server"
        | "server_gesperrt"
        | "werte_unlesbar"
        | "einstellung_ungueltig";
      detail?: string;
    };

/** The manifest an installation was made with; it was checked then, so this fails only on a schema change */
const manifestVon = (i: Installation): Manifest | undefined => {
  const geprueft = manifestPruefen(i.manifest);
  return geprueft.ok ? geprueft.manifest : undefined;
};

const alsPlatzInstallation = (i: Installation, m: Manifest): PlatzInstallation => ({
  kundeId: i.kundeId,
  ramMb: ramBedarf(m, JSON.parse(i.optionen) as string[]),
  platteGb: m.ressourcen.platte_gb,
  festePorts: festePorts(m),
  serverFuerSich: m.netz.server_fuer_sich || m.rootful || m.proxy === "eigen",
});

/** What the customer's installations offer (`bietet`), once they are set up or on their way */
const angeboten = (db: Db, betreiberId: string, kundeId: string): string[] => [
  ...new Set(
    installationenDesKunden(db, betreiberId, kundeId)
      .filter((i) => i.zustand !== "gescheitert")
      .flatMap((i) => manifestVon(i)?.bietet ?? []),
  ),
];

const passtNicht = (gruende: PlatzBefund[]): Platzierung => ({
  art: "passt_nicht",
  gruende,
  hinweise: [],
});

/** Whether the app fits the server, with every reason; or why the question has no answer */
export const platzPruefen = (deps: PlatzDeps, betreiberId: string, w: PlatzWunsch): Platz => {
  const kunde = kundeLesen(deps.db, betreiberId, w.kundeId);
  if (!kunde) return { ok: false, grund: "kein_kunde" };
  const server = serverLesen(deps.db, betreiberId, w.serverId);
  if (!server) return { ok: false, grund: "kein_server" };
  if (server.gesperrtAm !== null) return { ok: false, grund: "server_gesperrt" };
  const gespeichert = betreiberWerteLesen(deps.db, deps.schluessel, betreiberId, w.manifest.id);
  if (!gespeichert.ok) return { ok: false, grund: "werte_unlesbar" };
  const werte = betreiberWerteErgaenzen(w.manifest, gespeichert.werte, w.betreiberEingabe ?? {});
  if (!werte.ok) return { ok: false, grund: "einstellung_ungueltig", detail: werte.grund };
  const ps = platzServer(
    server,
    serverFakten(server),
    deps.verbunden(betreiberId, server.serverId),
  );
  const ergebnis = (platzierung: Platzierung, s?: PlatzServer): Platz => ({
    ok: true,
    platzierung,
    server,
    platzServer: s,
    betreiberWerte: werte.werte,
    betreiberGespeichert: gespeichert.werte,
    betreiberNeu: werte.neu,
  });
  if (!ps.ok)
    return ergebnis(
      passtNicht([{ code: "fakten_fehlen", werte: { fakten: ps.fehlt.join(", ") } }]),
    );
  const vorhanden = installationenAufServer(deps.db, betreiberId, server.serverId);
  const unlesbar = vorhanden.filter((i) => !manifestVon(i));
  if (unlesbar.length > 0)
    return ergebnis(
      passtNicht(
        unlesbar.map((i) => ({
          code: "installation_unlesbar",
          werte: { installation: i.installationId },
        })),
      ),
    );
  const platzierung = platzieren({
    manifest: w.manifest,
    optionen: w.optionen,
    server: ps.server,
    installationen: vorhanden.map((i) => alsPlatzInstallation(i, manifestVon(i) as Manifest)),
    kunde: { id: kunde.id, betreiberId, bietet: angeboten(deps.db, betreiberId, kunde.id) },
    betreiberWerte: [...Object.keys(werte.werte.offen), ...Object.keys(werte.werte.geheim)],
  });
  return ergebnis(platzierung, ps.server);
};
