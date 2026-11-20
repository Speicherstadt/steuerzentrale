import type { NachrichtVonDerZentrale } from "@steuerzentrale/protokoll";
import {
  HEARTBEAT_MS,
  type NachrichtVomAgenten,
  schreiben as nachrichtSchreiben,
  PROTOKOLL_VERSION,
  TRENNUNG,
  VonDerZentrale,
  vomAgentenLesen,
} from "@steuerzentrale/protokoll";
import type { LogSink } from "../../log.ts";
import { heartbeatAnfuegen, schreiben } from "../audit/index.ts";
import type { BeitrittDeps } from "../server/beitritt.ts";
import {
  neuesZertifikatUebernehmen,
  type Server,
  serverLesen,
  zertifikatRotieren,
} from "../server/index.ts";
import type { Sockel, Verbindungen } from "./verbindungen.ts";

/*
 * One agent's connection, from the Zentrale's side (BAULISTE.md Z-303): the agent says `hallo`,
 * the Zentrale answers `willkommen` with the end of the agent's certificate, and from then on
 * heartbeats arrive every 30 seconds and land in `heartbeats` as measurements. A message the
 * Zentrale cannot read, or anything before `hallo`, ends the connection. Messages of later items
 * (facts, jobs) are read and left for those items.
 */
export type SitzungDeps = BeitrittDeps & {
  verbindungen: Verbindungen;
  now: () => number;
  log: LogSink;
};

export type Sitzung = {
  offen: (sockel: Sockel) => void;
  nachricht: (text: string | ArrayBuffer) => Promise<void>;
  zu: () => void;
};

/**
 * Heartbeats closer than this are dropped: they bypass the audit log because they come every 30 s,
 * so an agent that sends more cannot fill the table
 */
const HEARTBEAT_ABSTAND_MS = HEARTBEAT_MS / 2;

/** The close reason is at most 123 bytes (RFC 6455, 5.5); ours are short and ASCII */
const kurz = (grund: string) => grund.slice(0, 100);

const senden = (sockel: Sockel, nachricht: NachrichtVonDerZentrale) =>
  sockel.senden(nachrichtSchreiben(VonDerZentrale, nachricht));

export const sitzung = (
  deps: SitzungDeps,
  angemeldet: { server: Server; neu: boolean },
): Sitzung => {
  const { betreiberId, serverId } = angemeldet.server;
  let server = angemeldet.server;
  let sockel: Sockel | undefined;
  let gegruesst = false;
  let letzterHeartbeat = Number.NEGATIVE_INFINITY;

  const hallo = (n: Extract<NachrichtVomAgenten, { typ: "hallo" }>, s: Sockel, jetzt: number) => {
    if (n.agentVersion !== server.agentVersion || n.architektur !== server.architektur)
      server = schreiben(
        deps.schreibDb,
        { betreiberId, akteur: `server:${serverId}`, jetzt, grund: "Agent meldet sich" },
        "server.agent",
        (w) =>
          w.aendern(
            "server",
            { serverId },
            { agentVersion: n.agentVersion, architektur: n.architektur },
          ),
      );
    gegruesst = true;
    senden(s, {
      typ: "willkommen",
      protokoll: PROTOKOLL_VERSION,
      zeit: jetzt,
      ...(server.zertifikatGueltigBis === null
        ? {}
        : { zertifikatGueltigBis: server.zertifikatGueltigBis }),
    });
  };

  const rotieren = async (csr: string, s: Sockel) => {
    const aktuell = serverLesen(deps.db, betreiberId, serverId);
    if (!aktuell) return;
    const ergebnis = await zertifikatRotieren(deps, aktuell, csr, deps.now());
    if (!ergebnis.ok) {
      deps.log(JSON.stringify({ msg: "certificate not rotated", serverId, grund: ergebnis.grund }));
      return;
    }
    // revoked or replaced while the certificate was made: this connection has no say any more
    if (!deps.verbindungen.aktuell(betreiberId, serverId, s)) return;
    const { zertifikat, ca, gueltigBis } = ergebnis;
    senden(s, { typ: "zertifikat", protokoll: PROTOKOLL_VERSION, zertifikat, ca, gueltigBis });
  };

  return {
    offen: (s) => {
      sockel = s;
      const jetzt = deps.now();
      if (angemeldet.neu) server = neuesZertifikatUebernehmen(deps.schreibDb, server, jetzt);
      deps.verbindungen.anmelden(betreiberId, serverId, s, jetzt);
    },
    nachricht: async (text) => {
      const s = sockel;
      if (!s || !deps.verbindungen.aktuell(betreiberId, serverId, s)) return;
      const gelesen =
        typeof text === "string" ? vomAgentenLesen(text) : { ok: false as const, grund: "binary" };
      if (!gelesen.ok) return s.schliessen(TRENNUNG.ungueltig, kurz(gelesen.grund));
      const n = gelesen.nachricht;
      const jetzt = deps.now();
      if (!gegruesst) {
        if (n.typ !== "hallo") return s.schliessen(TRENNUNG.ungueltig, "hallo first");
        return hallo(n, s, jetzt);
      }
      if (n.typ === "heartbeat") {
        // a clock that jumped back does not silence the server
        const abstand = jetzt - letzterHeartbeat;
        if (abstand >= 0 && abstand < HEARTBEAT_ABSTAND_MS) return;
        letzterHeartbeat = jetzt;
        return heartbeatAnfuegen(deps.schreibDb, {
          betreiberId,
          serverId,
          zeitpunkt: jetzt,
          daten: JSON.stringify({ zeit: n.zeit, protokoll: n.protokoll }),
        });
      }
      if (n.typ === "zertifikat_anfrage") return rotieren(n.csr, s);
    },
    zu: () => {
      if (sockel) deps.verbindungen.abmelden(betreiberId, serverId, sockel);
    },
  };
};
