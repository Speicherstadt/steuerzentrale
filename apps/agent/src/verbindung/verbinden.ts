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
import { anfrageErzeugen, privatPem, schluesselErzeugen } from "../beitritt/csr.ts";
import type { Dateien } from "../dateien.ts";
import type { Pfade } from "../pfade.ts";
import { wartezeit } from "./backoff.ts";
import { rotationAbschliessen, rotationSpeichern } from "./rotieren.ts";
import type { Oeffnen, Sockel, Tls } from "./sockel.ts";

/*
 * The agent's connection to its Zentrale (BAULISTE.md Z-303): a WebSocket to `agent.<domain>` with
 * the client certificate, `hallo`, then a heartbeat every 30 seconds after `willkommen`. When the
 * connection ends, for whatever reason, the agent tries again after an exponential backoff with
 * jitter; a connection that got as far as `willkommen` starts the count anew. In the last 30 days of
 * its certificate the agent asks for a new one over the open connection, keeps it, and reconnects
 * with it.
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

export const verbindungsSchleife = (deps: VerbindenDeps, zentrale: string): Schleife => {
  let versuch = 0;
  let gestoppt = false;
  let sockel: Sockel | undefined;
  let abbrechen: (() => void) | undefined;
  let rotation: { schluessel: string } | "laeuft" | undefined;
  const log = (msg: string, mehr: Record<string, unknown> = {}) =>
    deps.log(JSON.stringify({ msg, ...mehr }));

  const planen = (lauf: () => void, ms: number) => {
    abbrechen?.();
    abbrechen = deps.planen(lauf, ms);
  };

  const rotieren = async (s: Sockel) => {
    rotation = "laeuft";
    const { schluessel, csr } = await (deps.anfrage ?? neueAnfrage)();
    rotation = { schluessel };
    s.senden(zertifikatAnfrage(csr));
    log("certificate requested");
  };

  /** Asks for a new certificate once its last 30 days began: at willkommen or on a later beat */
  const rotierenWennFaellig = async (s: Sockel, bis: number | undefined) => {
    if (bis !== undefined && bis - deps.jetzt() <= ROTIEREN_VOR_MS && rotation === undefined)
      await rotieren(s);
  };

  // a connection may stay open for weeks: the end of the certificate is checked with every beat
  const herzschlag = (s: Sockel, bis: number | undefined) => {
    planen(() => {
      s.senden(heartbeat(deps));
      herzschlag(s, bis);
      rotierenWennFaellig(s, bis).catch((fehler) =>
        log("certificate request failed", { fehler: String(fehler) }),
      );
    }, HEARTBEAT_MS);
  };

  const behandeln = async (n: NachrichtVonDerZentrale, s: Sockel) => {
    if (n.typ === "willkommen") {
      versuch = 0;
      log("connected");
      herzschlag(s, n.zertifikatGueltigBis);
      await rotierenWennFaellig(s, n.zertifikatGueltigBis);
      return;
    }
    if (n.typ === "zertifikat" && typeof rotation === "object") {
      await rotationSpeichern(deps.dateien, deps.pfade, { ...n, schluessel: rotation.schluessel });
      rotation = undefined;
      log("certificate rotated", { gueltigBis: n.gueltigBis });
      // the next connection opens with the new certificate, which replaces the old one
      versuch = 0;
      s.schliessen(1000, "certificate rotated");
    }
    // jobs come with Z-305
  };

  const wiederholen = (code: number, grund: string) => {
    sockel = undefined;
    abbrechen?.();
    abbrechen = undefined;
    if (rotation === "laeuft" || typeof rotation === "object") rotation = undefined;
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
      offen: () => s?.senden(hallo(deps)),
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
      sockel?.schliessen(1000, "agent stops");
    },
  };
};
