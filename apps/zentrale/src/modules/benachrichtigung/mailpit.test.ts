import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { benachrichtigungsUmgebung, T0 } from "../../testhilfen/benachrichtigung.ts";
import { eintrag, zustandNachricht } from "../../testhilfen/bewertung.ts";
import { bewertungenPruefen, zustandAnnehmen } from "../bewertung/index.ts";

/*
 * BAULISTE.md Z-703, "Fertig, wenn": a fault that lasts 10 checks makes one mail at Mailpit, its
 * fix a second (docs/plan.md, "Was sich in der CI nicht echt testen lässt"). The CI job `unit`
 * runs Mailpit as a service and names it in SZ_TEST_MAILPIT_SMTP (host:port) and
 * SZ_TEST_MAILPIT_API (its HTTP API); without them the test is skipped locally, never in CI, where
 * a missing Mailpit fails it. Each run writes to an address of its own and searches Mailpit for it.
 */
const SMTP = process.env.SZ_TEST_MAILPIT_SMTP;
const API = process.env.SZ_TEST_MAILPIT_API;
const MIT_MAILPIT = Boolean(SMTP && API);

type Nachricht = { Subject: string; To: { Address: string }[] };

const nachrichtenAn = async (adresse: string): Promise<Nachricht[]> => {
  const antwort = await fetch(`${API}/api/v1/search?query=${encodeURIComponent(`to:${adresse}`)}`);
  if (!antwort.ok) throw new Error(`Mailpit answered ${antwort.status}`);
  return ((await antwort.json()) as { messages: Nachricht[] }).messages;
};

/** Mailpit stores what it accepted at once; a short wait covers a slow runner */
const warteAuf = async (adresse: string, anzahl: number): Promise<Nachricht[]> => {
  for (let i = 0; i < 50; i++) {
    const n = await nachrichtenAn(adresse);
    if (n.length >= anzahl) return n;
    await Bun.sleep(100);
  }
  return nachrichtenAn(adresse);
};

describe("Mailpit in CI", () => {
  it("is there when the tests run in CI", () => {
    if (process.env.CI === "true") expect(MIT_MAILPIT).toBe(true);
  });
});

describe.skipIf(!MIT_MAILPIT)("a fault at Mailpit", () => {
  it("that lasts 10 checks makes one mail, and its fix a second", async () => {
    const [host = "", port = ""] = (SMTP ?? "").split(":");
    const adresse = `betrieb-${randomUUID().slice(0, 8)}@betreiber.test`;
    const u = benachrichtigungsUmgebung();
    u.einstellen("b1", {
      smtp: {
        host,
        port: Number(port),
        sicherheit: "keine",
        benutzer: null,
        absender: "zentrale@betreiber.test",
      },
      ruhezeit: null,
    });
    u.empfaenger("b1", { art: "mail", adresse, abSchwere: "warn" });
    const deps = { db: u.db, schreibDb: u.schreibDb, log: () => {} };
    const pruefung = async (health: "gruen" | "rot") => {
      zustandAnnehmen(
        deps,
        { betreiberId: "b1", serverId: "s1" },
        zustandNachricht([eintrag("i1", health)]),
        u.uhr.ms,
      );
      bewertungenPruefen(u.db, u.schreibDb, u.uhr.ms);
      await u.lauf();
      u.uhr.ms += 30_000;
    };
    while (u.uhr.ms < T0 + 5 * 60_000) await pruefung("rot");
    for (let i = 0; i < 10; i++) await pruefung("rot");
    const eine = await warteAuf(adresse, 1);
    expect(eine.map((n) => n.Subject)).toEqual([
      "[Störung] Störung i1: seit 5 Min. rot; Health: HTTP 503",
    ]);
    for (let i = 0; i < 3; i++) await pruefung("gruen");
    const zwei = await warteAuf(adresse, 2);
    expect(zwei.map((n) => n.Subject).sort()).toEqual([
      "[Behoben] Störung i1 behoben: wieder grün",
      "[Störung] Störung i1: seit 5 Min. rot; Health: HTTP 503",
    ]);
    expect(zwei.every((n) => n.To.map((t) => t.Address).join() === adresse)).toBe(true);
  });
});
