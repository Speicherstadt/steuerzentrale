import { createServer, type Server, type Socket } from "node:net";
import { TLSSocket } from "node:tls";

/*
 * A stand-in for a mail server in the tests of the notifications (BAULISTE.md Z-703; Mailpit is the
 * real one in CI): SMTP on a free port of localhost, the messages in memory as received after DATA.
 * With `tls` it offers STARTTLS with that certificate and takes AUTH only after it; with `benutzer`
 * it wants AUTH PLAIN with that password; `scheitern(n)` refuses the next n messages with 451.
 */

export type Empfangen = { von: string; an: string[]; daten: string; angemeldet: string | null };

export type SmtpNachbauOptionen = {
  tls?: { zertifikat: string; schluessel: string };
  benutzer?: { name: string; passwort: string };
};

type Sitzung = { von: string; an: string[]; angemeldet: string | null; sicher: boolean };

const faehigkeiten = (o: SmtpNachbauOptionen, s: Sitzung): string[] => [
  "250-localhost",
  ...(o.tls && !s.sicher ? ["250-STARTTLS"] : []),
  ...(o.benutzer && (s.sicher || !o.tls) ? ["250-AUTH PLAIN"] : []),
  "250 8BITMIME",
];

export const smtpNachbau = async (o: SmtpNachbauOptionen = {}) => {
  const empfangen: Empfangen[] = [];
  const befehle: string[] = [];
  let scheitert = 0;

  const bedienen = (start: Socket) => {
    let socket: Socket = start;
    const s: Sitzung = { von: "", an: [], angemeldet: null, sicher: false };
    let puffer = "";
    let daten: string[] | undefined;
    const senden = (zeilen: string[]) => socket.write(`${zeilen.join("\r\n")}\r\n`);
    const zeile = (z: string) => {
      if (daten) {
        if (z !== ".") return void daten.push(z.startsWith("..") ? z.slice(1) : z);
        const text = daten.join("\r\n");
        daten = undefined;
        if (scheitert > 0) {
          scheitert -= 1;
          return senden(["451 try again later"]);
        }
        empfangen.push({ von: s.von, an: s.an, daten: text, angemeldet: s.angemeldet });
        return senden(["250 OK queued"]);
      }
      befehle.push(z.startsWith("AUTH") ? "AUTH ***" : z);
      const [verb = "", ...rest] = z.split(" ");
      switch (verb.toUpperCase()) {
        case "EHLO":
          return senden(faehigkeiten(o, s));
        case "STARTTLS": {
          if (!o.tls) return senden(["502 not offered"]);
          senden(["220 go ahead"]);
          socket.removeAllListeners("data");
          const sicher = new TLSSocket(socket, {
            isServer: true,
            key: o.tls.schluessel,
            cert: o.tls.zertifikat,
          });
          s.sicher = true;
          socket = sicher;
          return void sicher.on("data", lesen);
        }
        case "AUTH": {
          const geschickt = Buffer.from(rest[1] ?? "", "base64")
            .toString("utf8")
            .split("\u0000");
          const passt =
            o.benutzer && geschickt[1] === o.benutzer.name && geschickt[2] === o.benutzer.passwort;
          if (!passt || (o.tls && !s.sicher)) return senden(["535 authentication failed"]);
          s.angemeldet = geschickt[1] ?? null;
          return senden(["235 authenticated"]);
        }
        case "MAIL":
          if (o.benutzer && !s.angemeldet) return senden(["530 authentication required"]);
          s.von = z.slice(z.indexOf("<") + 1, z.lastIndexOf(">"));
          s.an = [];
          return senden(["250 OK"]);
        case "RCPT":
          s.an.push(z.slice(z.indexOf("<") + 1, z.lastIndexOf(">")));
          return senden(["250 OK"]);
        case "DATA":
          daten = [];
          return senden(["354 go ahead"]);
        case "QUIT":
          senden(["221 bye"]);
          return void socket.end();
        default:
          return senden(["500 unknown"]);
      }
    };
    const lesen = (stueck: Buffer) => {
      puffer += stueck.toString("utf8");
      for (let i = puffer.indexOf("\r\n"); i >= 0; i = puffer.indexOf("\r\n")) {
        const z = puffer.slice(0, i);
        puffer = puffer.slice(i + 2);
        zeile(z);
      }
    };
    socket.on("data", lesen);
    socket.on("error", () => {});
    senden(["220 localhost ESMTP Nachbau"]);
  };

  const server: Server = createServer(bedienen);
  await new Promise<void>((fertig) => server.listen(0, "127.0.0.1", fertig));
  const adresse = server.address();
  const port = typeof adresse === "object" && adresse ? adresse.port : 0;
  return {
    port,
    empfangen,
    befehle,
    scheitern: (n: number) => {
      scheitert = n;
    },
    stoppen: () => new Promise<void>((fertig) => server.close(() => fertig())),
  };
};

/** The decoded body of a received message (base64 after the blank line) */
export const mailInhalt = (daten: string): { kopf: string; text: string } => {
  const [kopf = "", ...rest] = daten.split("\r\n\r\n");
  return { kopf, text: Buffer.from(rest.join("").replace(/\r\n/g, ""), "base64").toString("utf8") };
};
