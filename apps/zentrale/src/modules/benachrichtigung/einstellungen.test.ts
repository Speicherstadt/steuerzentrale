import { describe, expect, it } from "vitest";
import { benachrichtigungsUmgebung } from "../../testhilfen/benachrichtigung.ts";
import { smtpZugang } from "./einstellungen.ts";

/*
 * BAULISTE.md Z-703; docs/plan.md, "Geheimnisse der Benachrichtigungen": the SMTP password never
 * comes back through the API, so it must not be sent elsewhere either: kept without a new one only
 * while host and user stay the same.
 */
const SMTP = {
  host: "smtp.betreiber.test",
  port: 587,
  sicherheit: "starttls" as const,
  benutzer: "zentrale",
  absender: "zentrale@betreiber.test",
};

const passwort = (u: ReturnType<typeof benachrichtigungsUmgebung>) => {
  const z = smtpZugang(u.db, u.schluessel, "b1");
  return z.ok ? z.zugang.passwort : null;
};

describe("einstellungenSetzen", () => {
  it("keeps the password without a new one while host and user stay", () => {
    const u = benachrichtigungsUmgebung();
    u.einstellen("b1", { smtp: { ...SMTP, passwort: "geheim-1" }, ruhezeit: null });
    const neu = u.einstellen("b1", {
      smtp: { ...SMTP, port: 465, sicherheit: "tls" },
      ruhezeit: null,
    });
    expect(neu.smtp?.passwortGesetzt).toBe(true);
    expect(passwort(u)).toBe("geheim-1");
  });

  it("does not send the kept password to another host", () => {
    const u = benachrichtigungsUmgebung();
    u.einstellen("b1", { smtp: { ...SMTP, passwort: "geheim-1" }, ruhezeit: null });
    const neu = u.einstellen("b1", {
      smtp: { ...SMTP, host: "smtp.angreifer.test" },
      ruhezeit: null,
    });
    expect(neu.smtp?.passwortGesetzt).toBe(false);
    expect(passwort(u)).not.toBe("geheim-1");
  });

  it("does not keep the password for another user", () => {
    const u = benachrichtigungsUmgebung();
    u.einstellen("b1", { smtp: { ...SMTP, passwort: "geheim-1" }, ruhezeit: null });
    const neu = u.einstellen("b1", { smtp: { ...SMTP, benutzer: "anderer" }, ruhezeit: null });
    expect(neu.smtp?.passwortGesetzt).toBe(false);
  });
});
