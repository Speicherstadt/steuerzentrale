import { connect as tcp } from "node:net";
import { connect as tls } from "node:tls";

/*
 * A small SMTP client for the notifications (BAULISTE.md Z-703; RFC 5321, RFC 3207 STARTTLS,
 * RFC 4954 AUTH PLAIN and LOGIN): one message to one recipient per connection, plain text in UTF-8
 * as base64 (RFC 2045), so no line of the body can end the DATA. `tls` speaks TLS from the start
 * (port 465), `starttls` upgrades and refuses a server that does not offer it, `keine` only for a
 * relay on the Zentrale's own machine (checked where it is set). The password goes out only inside
 * TLS and never into an error: a failure names the step and the server's code.
 */

export type SmtpZugang = {
  host: string;
  port: number;
  sicherheit: "tls" | "starttls" | "keine";
  benutzer: string | null;
  passwort: string | null;
  absender: string;
};

export type Mail = {
  an: string;
  betreff: string;
  text: string;
  /** Without angle brackets, e.g. `<zustellung>@steuerzentrale` */
  nachrichtId: string;
  datum: number;
  /** Further headers, e.g. the delivery's id */
  kopf?: Record<string, string>;
};

export type SmtpOptionen = { zeitlimitMs: number; ca?: string; ehlo?: string };

export type Gesendet = { ok: true } | { ok: false; fehler: string };

type Antwort = { code: number; zeilen: string[] };

type Leitung = {
  lesen: () => Promise<Antwort>;
  schreiben: (zeile: string) => void;
  ende: () => void;
};

/** Reads replies line by line from a socket; a reply ends at "<code> " (RFC 5321, 4.2.1) */
const leitung = (socket: import("node:net").Socket): Leitung => {
  let puffer = "";
  const fertige: Antwort[] = [];
  let zeilen: string[] = [];
  let wartet: ((a: Antwort) => void) | undefined;
  let fehler: ((f: Error) => void) | undefined;
  let kaputt: Error | undefined;
  const lesenAus = (text: string) => {
    puffer += text;
    for (let i = puffer.indexOf("\r\n"); i >= 0; i = puffer.indexOf("\r\n")) {
      const zeile = puffer.slice(0, i);
      puffer = puffer.slice(i + 2);
      zeilen.push(zeile.slice(4));
      if (zeile[3] === "-") continue;
      const antwort = { code: Number(zeile.slice(0, 3)), zeilen };
      zeilen = [];
      if (wartet) {
        const w = wartet;
        wartet = undefined;
        w(antwort);
      } else fertige.push(antwort);
    }
  };
  socket.setEncoding("utf8");
  socket.on("data", lesenAus);
  const abbrechen = (f: Error) => {
    kaputt = f;
    fehler?.(f);
  };
  socket.on("error", abbrechen);
  socket.on("close", () => abbrechen(new Error("connection closed")));
  return {
    lesen: () =>
      new Promise((ok, nein) => {
        const fertig = fertige.shift();
        if (fertig) return ok(fertig);
        if (kaputt) return nein(kaputt);
        wartet = ok;
        fehler = nein;
      }),
    schreiben: (zeile) => {
      socket.write(`${zeile}\r\n`);
    },
    ende: () => {
      socket.removeAllListeners("data");
      socket.removeAllListeners("error");
      socket.removeAllListeners("close");
    },
  };
};

/** A refusal of the server or of this client, as opposed to a broken connection */
const smtpFehler = (text: string): Error => Object.assign(new Error(text), { smtp: true });

const erwarten = async (l: Leitung, schritt: string, codes: number[]): Promise<Antwort> => {
  const a = await l.lesen();
  if (!codes.includes(a.code)) throw smtpFehler(`SMTP ${a.code} at ${schritt}`);
  return a;
};

const befehl = async (l: Leitung, zeile: string, schritt: string, codes: number[]) => {
  l.schreiben(zeile);
  return erwarten(l, schritt, codes);
};

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

/** A header value in UTF-8 per RFC 2047, as one encoded word per 45 bytes */
const kodiert = (text: string): string => {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const bytes = Buffer.from(text, "utf8");
  const stuecke: string[] = [];
  for (let i = 0; i < bytes.length; ) {
    let ende = Math.min(i + 45, bytes.length);
    // never cut inside a character: back to the start of a UTF-8 sequence
    while (ende < bytes.length && ((bytes[ende] ?? 0) & 0xc0) === 0x80) ende -= 1;
    stuecke.push(`=?UTF-8?B?${bytes.subarray(i, ende).toString("base64")}?=`);
    i = ende;
  }
  return stuecke.join("\r\n ");
};

/** The message as sent after DATA: headers, a blank line, the body as base64 in lines of 76 */
export const mailText = (absender: string, mail: Mail): string => {
  const kopf = {
    From: absender,
    To: mail.an,
    Subject: kodiert(mail.betreff),
    Date: new Date(mail.datum).toUTCString().replace("GMT", "+0000"),
    "Message-ID": `<${mail.nachrichtId}>`,
    "MIME-Version": "1.0",
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Transfer-Encoding": "base64",
    "Auto-Submitted": "auto-generated",
    ...mail.kopf,
  };
  const zeilen = Object.entries(kopf).map(([name, wert]) => `${name}: ${wert}`);
  const text = b64(mail.text.replace(/\r?\n/g, "\r\n")).replace(/(.{76})/g, "$1\r\n");
  return `${zeilen.join("\r\n")}\r\n\r\n${text}`;
};

/** Signs in with PLAIN, or LOGIN where the server offers only that */
const anmelden = async (l: Leitung, faehig: string[], benutzer: string, passwort: string) => {
  const auth = faehig.find((z) => /^AUTH\b/i.test(z))?.toUpperCase() ?? "";
  if (!auth.includes("PLAIN") && auth.includes("LOGIN")) {
    await befehl(l, "AUTH LOGIN", "AUTH", [334]);
    await befehl(l, b64(benutzer), "AUTH", [334]);
    await befehl(l, b64(passwort), "AUTH", [235]);
    return;
  }
  await befehl(l, `AUTH PLAIN ${b64(`\u0000${benutzer}\u0000${passwort}`)}`, "AUTH", [235]);
};

type Sockel = import("node:net").Socket;

const verbinden = (z: SmtpZugang, o: SmtpOptionen): Sockel =>
  z.sicherheit === "tls"
    ? tls({ host: z.host, port: z.port, servername: z.host, ...(o.ca ? { ca: o.ca } : {}) })
    : tcp({ host: z.host, port: z.port });

/** STARTTLS: the same connection, now in TLS, checked against the host's name */
const aufTls = (socket: Sockel, z: SmtpZugang, o: SmtpOptionen): Promise<Sockel> =>
  new Promise((ok, nein) => {
    const sicher = tls({ socket, servername: z.host, ...(o.ca ? { ca: o.ca } : {}) });
    sicher.once("secureConnect", () => ok(sicher));
    sicher.once("error", nein);
  });

const dialog = async (start: Sockel, z: SmtpZugang, mail: Mail, o: SmtpOptionen) => {
  let socket = start;
  let l = leitung(socket);
  const name = o.ehlo ?? "steuerzentrale";
  await erwarten(l, "greeting", [220]);
  let faehig = (await befehl(l, `EHLO ${name}`, "EHLO", [250])).zeilen;
  if (z.sicherheit === "starttls") {
    if (!faehig.some((zeile) => /^STARTTLS\b/i.test(zeile)))
      throw smtpFehler("the server offers no STARTTLS");
    await befehl(l, "STARTTLS", "STARTTLS", [220]);
    l.ende();
    socket = await aufTls(socket, z, o);
    l = leitung(socket);
    faehig = (await befehl(l, `EHLO ${name}`, "EHLO", [250])).zeilen;
  }
  if (z.benutzer && z.passwort) await anmelden(l, faehig, z.benutzer, z.passwort);
  await befehl(l, `MAIL FROM:<${z.absender}>`, "MAIL FROM", [250]);
  await befehl(l, `RCPT TO:<${mail.an}>`, "RCPT TO", [250, 251]);
  await befehl(l, "DATA", "DATA", [354]);
  await befehl(l, `${mailText(z.absender, mail)}\r\n.`, "end of DATA", [250]);
  // the message is accepted; a server that drops the line before its goodbye changes nothing
  await befehl(l, "QUIT", "QUIT", [221]).catch(() => undefined);
  return socket;
};

const verschicken = (z: SmtpZugang, mail: Mail, o: SmtpOptionen): Promise<Gesendet> =>
  new Promise((fertig) => {
    const socket = verbinden(z, o);
    let letzter: Sockel = socket;
    const uhr = setTimeout(() => ende({ ok: false, fehler: "SMTP time limit" }), o.zeitlimitMs);
    const ende = (g: Gesendet) => {
      clearTimeout(uhr);
      letzter.destroy();
      socket.destroy();
      fertig(g);
    };
    dialog(socket, z, mail, o).then(
      (s) => {
        letzter = s;
        ende({ ok: true });
      },
      (f: unknown) =>
        ende({
          ok: false,
          fehler:
            (f as { smtp?: boolean }).smtp === true
              ? String((f as Error).message)
              : `SMTP connection: ${(f as { code?: string }).code ?? "error"}`,
        }),
    );
  });

/** An address that cannot end a command's line or its angle brackets (the API checks more) */
const ADRESSE = /^[^\s<>@]+@[^\s<>@]+$/;

/** Sends one message; never throws, a failure comes back as a value without any secret */
export const mailSenden = (z: SmtpZugang, mail: Mail, o: SmtpOptionen): Promise<Gesendet> =>
  !ADRESSE.test(z.absender) || !ADRESSE.test(mail.an)
    ? Promise.resolve({ ok: false, fehler: "SMTP: an address that is not one" })
    : verschicken(z, mail, o);
