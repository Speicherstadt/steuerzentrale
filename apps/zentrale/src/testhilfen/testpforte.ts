import type { Socket } from "bun";
import { FINGERABDRUCK_HEADER } from "../modules/verbindung/herkunft.ts";

/*
 * For tests only: a stand-in for the Pforte in front of `agent.<domain>` (docs/plan.md, "TLS und
 * Zertifikate"). Like Caddy with `client_auth { mode verify_if_given }` it ends TLS, checks a client
 * certificate against the operators' CAs, and passes the request on to the Zentrale on 127.0.0.1
 * with the certificate's SHA-256 in FINGERABDRUCK_HEADER, removing whatever the client put there.
 * Bun.serve verifies client certificates but does not tell the handler which one was shown; a TLS
 * socket of Bun.listen does (getPeerX509Certificate), so the stand-in is a small TCP proxy. It
 * rewrites only the first request head of a connection: a plain request gets `Connection: close`,
 * a WebSocket upgrade becomes a stream of frames after it.
 */

export type TestPforte = { port: number; stoppen: () => void };

type Strom = {
  /** The request head until it is complete; undefined once it went on */
  kopf: Uint8Array | undefined;
  fingerabdruck: string | undefined;
  oben: Socket<undefined> | undefined;
  /** What arrived while the connection to the Zentrale was being opened */
  wartend: Uint8Array[];
  offen: boolean;
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

/** The head with the fingerprint header set by the Pforte alone */
export const kopfUmschreiben = (kopf: string, fingerabdruck: string | undefined): string => {
  const [anfrage = "", ...zeilen] = kopf.replace(/\r\n\r\n$/, "").split("\r\n");
  const name = (zeile: string) => zeile.split(":")[0]?.trim().toLowerCase() ?? "";
  const upgrade = zeilen.some((z) => name(z) === "upgrade" && /websocket/i.test(z));
  const behalten = zeilen.filter(
    (z) => name(z) !== FINGERABDRUCK_HEADER && (upgrade || name(z) !== "connection"),
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
          unten.write(daten);
        },
        close: () => {
          unten.end();
        },
        error: () => {
          unten.end();
        },
      },
    }).catch(() => undefined);
    if (!oben) return unten.end();
    if (!unten.data.offen) return oben.end();
    unten.data.oben = oben;
    oben.write(start);
    for (const teil of unten.data.wartend) oben.write(teil);
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
          fingerabdruck: undefined,
          oben: undefined,
          wartend: [],
          offen: true,
        };
      },
      handshake: (s, _ok, fehler) => {
        const zertifikat = fehler ? undefined : s.getPeerX509Certificate();
        s.data.fingerabdruck = zertifikat?.fingerprint256.replaceAll(":", "").toLowerCase();
      },
      data: (s, daten) => {
        if (s.data.oben) return void s.data.oben.write(daten);
        if (s.data.kopf === undefined) return void s.data.wartend.push(daten);
        const bisher = zusammen(s.data.kopf, daten);
        const ende = kopfEnde(bisher);
        if (ende < 0) {
          s.data.kopf = bisher;
          return;
        }
        const kopf = kopfUmschreiben(
          new TextDecoder().decode(bisher.subarray(0, ende)),
          s.data.fingerabdruck,
        );
        // from now on everything goes on unchanged
        s.data.kopf = undefined;
        void weiter(s, zusammen(new TextEncoder().encode(kopf), bisher.subarray(ende)));
      },
      close: (s) => {
        s.data.offen = false;
        s.data.oben?.end();
      },
    },
  });
  return { port: listener.port, stoppen: () => listener.stop(true) };
};
