import { afterEach, describe, expect, it } from "vitest";
import { mailInhalt, smtpNachbau } from "../../testhilfen/smtp.ts";
import { pforteTls } from "../../testhilfen/tls.ts";
import { type Mail, mailSenden, mailText, type SmtpZugang } from "./smtp.ts";

/*
 * BAULISTE.md Z-703: the Zentrale's own small SMTP client against a stand-in mail server: plain on
 * the own machine, STARTTLS with the name checked, AUTH only inside TLS, the body as base64 so no
 * line ends DATA, and a refusal or a broken connection as a value that names no secret.
 */
const PASSWORT = "smtp-passwort-geheim-4711";
const MAIL: Mail = {
  an: "betrieb@betreiber.test",
  betreff: "[Störung] Health rot – Kanzlei Müller",
  text: "Störung i1: seit 5 Min. rot\n.\nZeile nach einem Punkt",
  nachrichtId: "e1.r1@steuerzentrale",
  datum: Date.UTC(2026, 10, 23, 12),
  kopf: { "X-Steuerzentrale-Zustellung": "e1.r1" },
};

const stopper: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const s of stopper.splice(0)) await s();
});

const nachbau = async (o: Parameters<typeof smtpNachbau>[0] = {}) => {
  const n = await smtpNachbau(o);
  stopper.push(n.stoppen);
  return n;
};

const zugang = (port: number, teil: Partial<SmtpZugang> = {}): SmtpZugang => ({
  host: "127.0.0.1",
  port,
  sicherheit: "keine",
  benutzer: null,
  passwort: null,
  absender: "zentrale@betreiber.test",
  ...teil,
});

describe("mailSenden", () => {
  it("delivers one message with sender, recipient, encoded subject and the body in UTF-8", async () => {
    const n = await nachbau();
    expect(await mailSenden(zugang(n.port), MAIL, { zeitlimitMs: 5000 })).toEqual({ ok: true });
    expect(n.empfangen).toHaveLength(1);
    const [m] = n.empfangen;
    expect(m?.von).toBe("zentrale@betreiber.test");
    expect(m?.an).toEqual(["betrieb@betreiber.test"]);
    const { kopf, text } = mailInhalt(m?.daten ?? "");
    expect(kopf).toContain("Subject: =?UTF-8?B?");
    expect(kopf).toContain("Message-ID: <e1.r1@steuerzentrale>");
    expect(kopf).toContain("X-Steuerzentrale-Zustellung: e1.r1");
    expect(kopf).toContain("Date: Mon, 23 Nov 2026 12:00:00 +0000");
    expect(text).toBe("Störung i1: seit 5 Min. rot\r\n.\r\nZeile nach einem Punkt");
    expect(n.befehle.at(-1)).toBe("QUIT");
  });

  it("upgrades with STARTTLS, signs in only then, and keeps the password out of everything", async () => {
    const tls = await pforteTls();
    const n = await nachbau({
      tls: { zertifikat: tls.zertifikat, schluessel: tls.schluessel },
      benutzer: { name: "zentrale", passwort: PASSWORT },
    });
    const z = zugang(n.port, {
      host: "localhost",
      sicherheit: "starttls",
      benutzer: "zentrale",
      passwort: PASSWORT,
    });
    expect(await mailSenden(z, MAIL, { zeitlimitMs: 5000, ca: tls.ca })).toEqual({ ok: true });
    expect(n.empfangen[0]?.angemeldet).toBe("zentrale");
    expect(n.befehle.slice(0, 3)).toEqual([
      "EHLO steuerzentrale",
      "STARTTLS",
      "EHLO steuerzentrale",
    ]);
  });

  it("refuses a server whose certificate does not name the host", async () => {
    const tls = await pforteTls();
    const n = await nachbau({ tls: { zertifikat: tls.zertifikat, schluessel: tls.schluessel } });
    const z = zugang(n.port, { host: "127.0.0.2", sicherheit: "starttls" });
    const r = await mailSenden(z, MAIL, { zeitlimitMs: 5000, ca: tls.ca });
    expect(r.ok).toBe(false);
    expect(n.empfangen).toEqual([]);
  });

  it("refuses STARTTLS when the server does not offer it", async () => {
    const n = await nachbau();
    const r = await mailSenden(zugang(n.port, { sicherheit: "starttls" }), MAIL, {
      zeitlimitMs: 5000,
    });
    expect(r).toEqual({ ok: false, fehler: "the server offers no STARTTLS" });
    expect(n.empfangen).toEqual([]);
  });

  it("reports a refusal with the step and code, a wrong password without it", async () => {
    const n = await nachbau({ benutzer: { name: "zentrale", passwort: PASSWORT } });
    const falsch = await mailSenden(
      zugang(n.port, { benutzer: "zentrale", passwort: `${PASSWORT}x` }),
      MAIL,
      { zeitlimitMs: 5000 },
    );
    expect(falsch).toEqual({ ok: false, fehler: "SMTP 535 at AUTH" });
    expect(JSON.stringify(falsch)).not.toContain(PASSWORT);
    n.scheitern(1);
    const z = zugang(n.port, { benutzer: "zentrale", passwort: PASSWORT });
    expect(await mailSenden(z, MAIL, { zeitlimitMs: 5000 })).toEqual({
      ok: false,
      fehler: "SMTP 451 at end of DATA",
    });
  });

  it("reports a server that is not there", async () => {
    const n = await nachbau();
    await n.stoppen();
    stopper.pop();
    const r = await mailSenden(zugang(n.port), MAIL, { zeitlimitMs: 5000 });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.fehler).toMatch(/^SMTP connection: /);
  });
});

describe("mailText", () => {
  it("splits a long non-ASCII subject into encoded words without cutting a character", () => {
    const text = mailText("a@b.test", { ...MAIL, betreff: "Ä".repeat(40) });
    const betreff = /Subject: ([\s\S]*?)\r\nDate:/.exec(text)?.[1] ?? "";
    const woerter = betreff.split("\r\n ");
    expect(woerter.length).toBeGreaterThan(1);
    const dekodiert = woerter
      .map((w) => Buffer.from(w.slice(10, -2), "base64").toString("utf8"))
      .join("");
    expect(dekodiert).toBe("Ä".repeat(40));
  });
});
