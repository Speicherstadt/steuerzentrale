import type { Socket } from "bun";
import { FINGERABDRUCK_HEADER } from "../modules/verbindung/herkunft.ts";

/*
 * For tests only: a stand-in for the Pforte in front of `agent.<domain>` (docs/plan.md, "TLS und
 * Zertifikate"). Like Caddy with `client_auth { mode verify_if_given }` it ends TLS, checks a client
 * certificate against the operators' CAs, and passes the request on to the Zentrale on 127.0.0.1
 * with the certificate's SHA-256 in FINGERABDRUCK_HEADER, removing whatever the client put there.
 * Bun.serve verifies client certificates but does not tell the handler which one was shown; a TLS
 * socket of Bun.listen does (getPeerX509Certificate), so the stand-in is a small TCP proxy. It
 * rewrites only the first request head and the first answer head of a connection: a plain request
 * and its answer get `Connection: close`, so the client opens a new connection for its next request
 * instead of sending it to a Zentrale that has closed (Bun.serve does not say so itself); a WebSocket
 * upgrade becomes a stream of frames after it.
 */

export type TestPforte = { port: number; stoppen: () => void };

/**
 * What one direction still has to write: a socket takes only what fits at once (write returns the
 * bytes taken), the rest goes on `drain`; an end asked for waits until all of it went out
 */
type Puffer = { rest: Uint8Array[]; enden: boolean };

const neuerPuffer = (): Puffer => ({ rest: [], enden: false });

/** Writes the waiting bytes until the socket takes no more; ends it once empty if asked to */
const leeren = (socket: Socket<unknown>, puffer: Puffer): void => {
  while (puffer.rest.length > 0) {
    const erstes = puffer.rest[0] as Uint8Array;
    const genommen = Math.max(socket.write(erstes), 0);
    if (genommen < erstes.length) {
      puffer.rest[0] = erstes.subarray(genommen);
      return;
    }
    puffer.rest.shift();
  }
  if (puffer.enden) socket.end();
};

/** Queues a copy (Bun may reuse the buffer it handed to `data`) and writes what fits */
const schreiben = (socket: Socket<unknown>, puffer: Puffer, daten: Uint8Array): void => {
  puffer.rest.push(daten.slice());
  if (puffer.rest.length === 1) leeren(socket, puffer);
};

const beenden = (socket: Socket<unknown>, puffer: Puffer): void => {
  puffer.enden = true;
  leeren(socket, puffer);
};

type Strom = {
  /** The request head until it is complete; undefined once it went on */
  kopf: Uint8Array | undefined;
  /** The same for the answer's head */
  antwortKopf: Uint8Array | undefined;
  fingerabdruck: string | undefined;
  oben: Socket<undefined> | undefined;
  /** What arrived while the connection to the Zentrale was being opened */
  wartend: Uint8Array[];
  offen: boolean;
  /** What is still to go to the client, and to the Zentrale */
  nachUnten: Puffer;
  nachOben: Puffer;
};

const ENDE = new TextEncoder().encode("\r\n\r\n");

const kopfEnde = (bytes: Uint8Array): number => {
  for (let i = 0; i + 3 < bytes.length; i++)
    if (ENDE.every((b, j) => bytes[i + j] === b)) return i + 4;
  return -1;
};

const zusammen = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const neu = new Uint8Array(a.length + b.length);
  neu.set(a);
  neu.set(b, a.length);
  return neu;
};

/** A head still arriving, or the complete head and the bytes after it */
type Kopf = { bisher: Uint8Array } | { kopf: string; rest: Uint8Array };

const kopfSammeln = (bisher: Uint8Array, daten: Uint8Array): Kopf => {
  const alles = zusammen(bisher, daten);
  const ende = kopfEnde(alles);
  if (ende < 0) return { bisher: alles };
  return { kopf: new TextDecoder().decode(alles.subarray(0, ende)), rest: alles.subarray(ende) };
};

const zeilenName = (zeile: string) => zeile.split(":")[0]?.trim().toLowerCase() ?? "";

/** An answer's head with `connection: close`; a WebSocket upgrade (101) stays as it is */
export const antwortKopfUmschreiben = (kopf: string): string => {
  const [status = "", ...zeilen] = kopf.replace(/\r\n\r\n$/, "").split("\r\n");
  if (/^HTTP\/1\.1 101 /.test(status)) return kopf;
  const behalten = zeilen.filter((z) => zeilenName(z) !== "connection");
  return `${[status, ...behalten, "connection: close"].join("\r\n")}\r\n\r\n`;
};

/** The head with the fingerprint header set by the Pforte alone */
export const kopfUmschreiben = (kopf: string, fingerabdruck: string | undefined): string => {
  const [anfrage = "", ...zeilen] = kopf.replace(/\r\n\r\n$/, "").split("\r\n");
  const upgrade = zeilen.some((z) => zeilenName(z) === "upgrade" && /websocket/i.test(z));
  const behalten = zeilen.filter(
    (z) => zeilenName(z) !== FINGERABDRUCK_HEADER && (upgrade || zeilenName(z) !== "connection"),
  );
  if (fingerabdruck) behalten.push(`${FINGERABDRUCK_HEADER}: ${fingerabdruck}`);
  if (!upgrade) behalten.push("connection: close");
  return `${[anfrage, ...behalten].join("\r\n")}\r\n\r\n`;
};

export const testPforte = (optionen: {
  /** The Zentrale's port on 127.0.0.1 */
  ziel: number;
  /** The Pforte's own certificate and key, PEM */
  zertifikat: string;
  schluessel: string;
  /** The CAs client certificates are checked against */
  clientCas: string[];
  /** Where it listens: 127.0.0.1 and a free port unless given (CI's VMs reach it on the bridge) */
  hostname?: string;
  port?: number;
}): TestPforte => {
  const weiter = async (unten: Socket<Strom>, start: Uint8Array) => {
    // a Zentrale that is down: the client's connection ends, as Caddy's would with a 502
    const oben = await Bun.connect({
      hostname: "127.0.0.1",
      port: optionen.ziel,
      socket: {
        data: (_o, daten) => {
          const bisher = unten.data.antwortKopf;
          if (bisher === undefined) return schreiben(unten, unten.data.nachUnten, daten);
          const gesammelt = kopfSammeln(bisher, daten);
          if ("bisher" in gesammelt) {
            unten.data.antwortKopf = gesammelt.bisher;
            return;
          }
          unten.data.antwortKopf = undefined;
          const kopf = new TextEncoder().encode(antwortKopfUmschreiben(gesammelt.kopf));
          schreiben(unten, unten.data.nachUnten, zusammen(kopf, gesammelt.rest));
        },
        drain: (o) => leeren(o, unten.data.nachOben),
        close: () => beenden(unten, unten.data.nachUnten),
        error: () => beenden(unten, unten.data.nachUnten),
      },
    }).catch(() => undefined);
    if (!oben) return unten.end();
    if (!unten.data.offen) return oben.end();
    unten.data.oben = oben;
    schreiben(oben, unten.data.nachOben, start);
    for (const teil of unten.data.wartend) schreiben(oben, unten.data.nachOben, teil);
    unten.data.wartend = [];
  };

  const listener = Bun.listen<Strom>({
    hostname: optionen.hostname ?? "127.0.0.1",
    port: optionen.port ?? 0,
    tls: {
      cert: optionen.zertifikat,
      key: optionen.schluessel,
      ca: optionen.clientCas,
      requestCert: true,
      // verify_if_given: install.sh and the join come without a certificate
      rejectUnauthorized: false,
    },
    socket: {
      open: (s) => {
        s.data = {
          kopf: new Uint8Array(0),
          antwortKopf: new Uint8Array(0),
          fingerabdruck: undefined,
          oben: undefined,
          wartend: [],
          offen: true,
          nachUnten: neuerPuffer(),
          nachOben: neuerPuffer(),
        };
      },
      drain: (s) => leeren(s, s.data.nachUnten),
      handshake: (s, _ok, fehler) => {
        const zertifikat = fehler ? undefined : s.getPeerX509Certificate();
        s.data.fingerabdruck = zertifikat?.fingerprint256.replaceAll(":", "").toLowerCase();
      },
      data: (s, daten) => {
        if (s.data.oben) return schreiben(s.data.oben, s.data.nachOben, daten);
        if (s.data.kopf === undefined) return void s.data.wartend.push(daten.slice());
        const gesammelt = kopfSammeln(s.data.kopf, daten);
        if ("bisher" in gesammelt) {
          s.data.kopf = gesammelt.bisher;
          return;
        }
        const kopf = kopfUmschreiben(gesammelt.kopf, s.data.fingerabdruck);
        // from now on everything goes on unchanged
        s.data.kopf = undefined;
        void weiter(s, zusammen(new TextEncoder().encode(kopf), gesammelt.rest));
      },
      close: (s) => {
        s.data.offen = false;
        if (s.data.oben) beenden(s.data.oben, s.data.nachOben);
      },
    },
  });
  return { port: listener.port, stoppen: () => listener.stop(true) };
};
