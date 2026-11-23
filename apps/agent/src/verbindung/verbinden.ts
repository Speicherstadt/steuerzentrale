import {
  Hallo,
  HEARTBEAT_MS,
  Heartbeat,
  type NachrichtVonDerZentrale,
  PROTOKOLL_VERSION,
  ROTIEREN_VOR_MS,
  schreiben,
  VERBINDUNG_PFAD,
  VERSION,
  vonDerZentraleLesen,
  ZertifikatAnfrage,
} from "@steuerzentrale/protokoll";
import type { Auftraege } from "../auftraege/auftraege.ts";
import { anfrageErzeugen, privatPem, schluesselErzeugen } from "../beitritt/csr.ts";
import type { Dateien } from "../dateien.ts";
import { uhrAbweichung } from "../fakten/lesen.ts";
import type { Pfade } from "../pfade.ts";
import { wartezeit } from "./backoff.ts";
import { type MeldungenDeps, meldungenPlatz } from "./meldungen.ts";
import { rotationAbschliessen, rotationSpeichern } from "./rotieren.ts";
import type { Oeffnen, Sockel, Tls } from "./sockel.ts";

/*
 * The agent's connection to its Zentrale (BAULISTE.md Z-303): a WebSocket to `agent.<domain>` with
 * the client certificate, `hallo`, then a heartbeat every 30 seconds after `willkommen`. When the
 * connection ends, for whatever reason, the agent tries again after an exponential backoff with
 * jitter; a connection that got as far as `willkommen` starts the count anew. In the last 30 days of
 * its certificate the agent asks for a new one over the open connection, keeps it, and reconnects
 * with it. While connected it reports its facts and SSH logins (meldungen.ts, Z-304) and takes
 * jobs (src/auftraege, Z-305), whose reports go over whatever connection is open when they come.
 */

/** Plans `lauf` in `ms`; returns how to cancel it */
export type Planer = (lauf: () => void, ms: number) => () => void;

export type VerbindenDeps = {
  oeffnen: Oeffnen;
  planen: Planer;
  jetzt: () => number;
  zufall: () => number;
  log: (zeile: string) => void;
  dateien: Dateien;
  pfade: Pfade;
  architektur: "amd64" | "arm64";
  /** A CA for the Zentrale's server certificate other than the system's (tests only) */
  serverCa?: string;
  /** A new key and its request, PEM (csr.ts by default) */
  anfrage?: () => Promise<{ schluessel: string; csr: string }>;
  /** Facts, SSH logins (Z-304) and the state of the installations (Z-403) to report while connected; none without */
  meldungen?: Pick<MeldungenDeps, "fakten" | "anmeldungen" | "zustand" | "backups">;
  /** Takes the jobs the Zentrale sends (Z-305, src/auftraege); without, jobs are left alone */
  auftraege?: Pick<Auftraege, "empfangen">;
  /** At each `willkommen`: confirms an update of the agent to this version (Z-504, src/agent-update) */
  verbunden?: () => Promise<void>;
};

/** The WebSocket address for the Zentrale's origin: wss for https, ws for http (test mode only) */
export const verbindungsUrl = (zentrale: string): string =>
  `${zentrale.replace(/^http/, "ws")}${VERBINDUNG_PFAD}`;

const neueAnfrage = async () => {
  const paar = await schluesselErzeugen();
  return {
    schluessel: await privatPem(paar),
    csr: await anfrageErzeugen(paar, "steuerzentrale-agent"),
  };
};

/** Key and certificate as they lie now, after finishing a rotation a stop interrupted */
const tlsLesen = async (deps: VerbindenDeps): Promise<Tls> => {
  await rotationAbschliessen(deps.dateien, deps.pfade);
  const [cert, key] = await Promise.all([
    deps.dateien.lesen(deps.pfade.zertifikat),
    deps.dateien.lesen(deps.pfade.schluessel),
  ]);
  if (!cert || !key) throw new Error("key or certificate missing");
  return { cert, key, ...(deps.serverCa ? { ca: deps.serverCa } : {}) };
};

const hallo = (deps: VerbindenDeps) =>
  schreiben(Hallo, {
    typ: "hallo",
    protokoll: PROTOKOLL_VERSION,
    agentVersion: VERSION,
    architektur: deps.architektur,
    zeit: deps.jetzt(),
  });

const heartbeat = (deps: VerbindenDeps) =>
  schreiben(Heartbeat, { typ: "heartbeat", protokoll: PROTOKOLL_VERSION, zeit: deps.jetzt() });

const zertifikatAnfrage = (csr: string) =>
  schreiben(ZertifikatAnfrage, { typ: "zertifikat_anfrage", protokoll: PROTOKOLL_VERSION, csr });

export type Schleife = { stoppen: () => void };

/** At `willkommen`: an update of the agent to this version is confirmed (Z-504) */
const bestaetigen = (
  deps: VerbindenDeps,
  log: (msg: string, mehr?: Record<string, unknown>) => void,
) =>
  deps
    .verbunden?.()
    .catch((fehler) => log("agent update not confirmed", { fehler: String(fehler) }));

/**
 * The certificate's care over one connection: in its last 30 days, at willkommen or on a later
 * beat, the agent asks for a new one and keeps the key until it comes; a connection that ends
 * drops the request, and the next one asks again
 */
const zertifikatPflege = (
  deps: VerbindenDeps,
  log: (msg: string, mehr?: Record<string, unknown>) => void,
) => {
  let rotation: { schluessel: string } | "laeuft" | undefined;
  return {
    faellig: async (s: Sockel, bis: number | undefined) => {
      if (bis === undefined || bis - deps.jetzt() > ROTIEREN_VOR_MS || rotation !== undefined)
        return;
      rotation = "laeuft";
      const { schluessel, csr } = await (deps.anfrage ?? neueAnfrage)();
      rotation = { schluessel };
      s.senden(zertifikatAnfrage(csr));
      log("certificate requested");
    },
    /** Keeps a certificate it asked for; false for one it did not */
    gekommen: async (n: Extract<NachrichtVonDerZentrale, { typ: "zertifikat" }>) => {
      if (typeof rotation !== "object") return false;
      await rotationSpeichern(deps.dateien, deps.pfade, { ...n, schluessel: rotation.schluessel });
      rotation = undefined;
      log("certificate rotated", { gueltigBis: n.gueltigBis });
      return true;
    },
    verwerfen: () => {
      rotation = undefined;
    },
  };
};

export const verbindungsSchleife = (deps: VerbindenDeps, zentrale: string): Schleife => {
  let versuch = 0;
  let gestoppt = false;
  let sockel: Sockel | undefined;
  let abbrechen: (() => void) | undefined;
  let halloAm = 0;
  const log = (msg: string, mehr: Record<string, unknown> = {}) =>
    deps.log(JSON.stringify({ msg, ...mehr }));
  const meldungen = meldungenPlatz(
    deps.meldungen && { ...deps.meldungen, planen: deps.planen, log },
  );

  const planen = (lauf: () => void, ms: number) => {
    abbrechen?.();
    abbrechen = deps.planen(lauf, ms);
  };

  const pflege = zertifikatPflege(deps, log);

  // a connection may stay open for weeks: the end of the certificate is checked with every beat
  const herzschlag = (s: Sockel, bis: number | undefined) => {
    planen(() => {
      s.senden(heartbeat(deps));
      herzschlag(s, bis);
      pflege
        .faellig(s, bis)
        .catch((fehler) => log("certificate request failed", { fehler: String(fehler) }));
    }, HEARTBEAT_MS);
  };

  const behandeln = async (n: NachrichtVonDerZentrale, s: Sockel) => {
    if (n.typ === "willkommen") {
      versuch = 0;
      log("connected");
      void bestaetigen(deps, log);
      herzschlag(s, n.zertifikatGueltigBis);
      meldungen.starten(
        (text) => s.senden(text),
        uhrAbweichung({ gesendet: halloAm, empfangen: deps.jetzt(), zentrale: n.zeit }),
      );
      await pflege.faellig(s, n.zertifikatGueltigBis);
      return;
    }
    if (n.typ === "zertifikat" && (await pflege.gekommen(n))) {
      // the next connection opens with the new certificate, which replaces the old one
      versuch = 0;
      s.schliessen(1000, "certificate rotated");
    }
    if (n.typ === "auftrag") await deps.auftraege?.empfangen(n, (text) => sockel?.senden(text));
  };

  const wiederholen = (code: number, grund: string) => {
    sockel = undefined;
    abbrechen?.();
    abbrechen = undefined;
    meldungen.stoppen();
    pflege.verwerfen();
    if (gestoppt) return;
    const ms =
      code === 1000 && grund === "certificate rotated" ? 0 : wartezeit(versuch, deps.zufall());
    versuch += 1;
    log("disconnected", { code, grund, wiederIn: ms });
    planen(() => void verbinden(), ms);
  };

  const verbinden = async () => {
    if (gestoppt) return;
    let tls: Tls;
    try {
      tls = await tlsLesen(deps);
    } catch (fehler) {
      return wiederholen(0, String(fehler));
    }
    let s: Sockel | undefined;
    const ereignisse = {
      offen: () => {
        halloAm = deps.jetzt();
        s?.senden(hallo(deps));
      },
      nachricht: (text: string) => {
        const gelesen = vonDerZentraleLesen(text);
        if (!s) return;
        if (!gelesen.ok) return log("message refused", { grund: gelesen.grund });
        behandeln(gelesen.nachricht, s).catch((fehler) =>
          log("message failed", { fehler: String(fehler) }),
        );
      },
      zu: (code: number, grund: string) => {
        if (s === sockel) wiederholen(code, grund);
      },
    };
    try {
      s = deps.oeffnen(verbindungsUrl(zentrale), tls, ereignisse);
      sockel = s;
    } catch (fehler) {
      wiederholen(0, String(fehler));
    }
  };

  void verbinden();
  return {
    stoppen: () => {
      gestoppt = true;
      abbrechen?.();
      meldungen.stoppen();
      sockel?.schliessen(1000, "agent stops");
    },
  };
};
