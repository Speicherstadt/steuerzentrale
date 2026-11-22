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
import { offeneZustellen } from "../auftraege/index.ts";
import { zustandAnnehmen } from "../bewertung/index.ts";
import type { BeitrittDeps } from "../server/beitritt.ts";
import {
  neuesZertifikatUebernehmen,
  type Server,
  serverLesen,
  zertifikatRotieren,
} from "../server/index.ts";
import { auftragsEingang } from "./auftraege.ts";
import { eimer, mindestabstand } from "./eimer.ts";
import { faktenSpeichern, sshAnmeldungSchreiben } from "./meldungen.ts";
import type { Sockel, Verbindungen } from "./verbindungen.ts";

/*
 * One agent's connection, from the Zentrale's side (BAULISTE.md Z-303): the agent says `hallo`,
 * the Zentrale answers `willkommen` with the end of the agent's certificate, and from then on
 * heartbeats arrive every 30 seconds and land in `heartbeats` as measurements. A message the
 * Zentrale cannot read, or anything before `hallo`, ends the connection. Facts and SSH logins
 * (Z-304) are kept (meldungen.ts), the state of the installations is rated (Z-403,
 * src/modules/bewertung). After `willkommen` the agent gets its open jobs, and its reports
 * about them move them on (Z-305, src/modules/auftraege); log excerpts are left for Z-405.
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

/**
 * Facts closer than this are dropped, for the same reason (Z-304): the agent sends them once per
 * connection and then every 15 minutes
 */
const FAKTEN_ABSTAND_MS = 60_000;

/**
 * States of the installations closer than this are dropped (Z-403): the agent sends them every
 * 30 seconds, and each is a write per installation
 */
const ZUSTAND_ABSTAND_MS = 10_000;

/**
 * SSH logins become events and audit entries, which stay; an agent may send a backlog of this many
 * at once (logins while it was away), then one a minute more, the rest is dropped
 */
const SSH_VORRAT = 100;
const SSH_NACHSCHUB_MS = 60_000;

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
  // a clock that jumped back does not silence the server
  const heartbeatErlaubt = mindestabstand(HEARTBEAT_ABSTAND_MS);
  const faktenErlaubt = mindestabstand(FAKTEN_ABSTAND_MS);
  const zustandErlaubt = mindestabstand(ZUSTAND_ABSTAND_MS);
  // whether one more SSH login may become an event, as a bucket refilled one a minute
  const sshErlaubt = eimer(SSH_VORRAT, SSH_NACHSCHUB_MS);

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
    deps.verbindungen.gruessen(betreiberId, serverId, s);
    offeneZustellen(deps, betreiberId, serverId);
  };

  const auftrag = auftragsEingang(deps, () => server);

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
        if (!heartbeatErlaubt(jetzt)) return;
        return heartbeatAnfuegen(deps.schreibDb, {
          betreiberId,
          serverId,
          zeitpunkt: jetzt,
          daten: JSON.stringify({ zeit: n.zeit, protokoll: n.protokoll }),
        });
      }
      if (n.typ === "zertifikat_anfrage") return rotieren(n.csr, s);
      if (n.typ === "bestaetigt" || n.typ === "fortschritt" || n.typ === "ergebnis")
        return auftrag(n, jetzt);
      if (n.typ === "fakten")
        return faktenErlaubt(jetzt) ? faktenSpeichern(deps.schreibDb, server, n, jetzt) : undefined;
      if (n.typ === "zustand")
        return zustandErlaubt(jetzt) ? zustandAnnehmen(deps, server, n, jetzt) : undefined;
      if (n.typ === "ssh_anmeldung") {
        if (!sshErlaubt(jetzt)) {
          deps.log(JSON.stringify({ msg: "ssh login dropped", serverId }));
          return;
        }
        return sshAnmeldungSchreiben(deps.db, deps.schreibDb, server, n, jetzt);
      }
    },
    zu: () => {
      if (sockel) deps.verbindungen.abmelden(betreiberId, serverId, sockel);
    },
  };
};
