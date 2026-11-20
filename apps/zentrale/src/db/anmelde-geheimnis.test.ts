import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rotieren } from "../modules/geheim/rotieren.ts";
import { oeffneDatenbank } from "./oeffnen.ts";
import { testDatenbank, testSchluessel } from "./test-db.ts";

// Better Auth's secret is made once, kept encrypted, and survives a key rotation (Z-104)
describe("the sign-in secret", () => {
  it("is 32 random bytes, the same on every opening", () => {
    const erste = testDatenbank();
    expect(Buffer.from(erste.anmeldeGeheimnis, "base64")).toHaveLength(32);
    erste.schliessen();
    const zweite = oeffneDatenbank(erste.pfad, 0, { aktuell: testSchluessel(), alt: [] });
    expect(zweite.anmeldeGeheimnis).toBe(erste.anmeldeGeheimnis);
    zweite.schliessen();
  });

  it("differs between two databases", () => {
    expect(testDatenbank().anmeldeGeheimnis).not.toBe(testDatenbank().anmeldeGeheimnis);
  });

  it("is never stored in plain text", () => {
    const offen = testDatenbank();
    offen.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");
    expect(readFileSync(offen.pfad).toString("latin1")).not.toContain(offen.anmeldeGeheimnis);
  });

  it("stays the same after a rotation and then opens with the new key alone", () => {
    const alt = testSchluessel(7);
    const neu = testSchluessel(9);
    const erste = testDatenbank({ aktuell: alt, alt: [] });
    const geheimnis = erste.anmeldeGeheimnis;
    erste.schliessen();
    const rotation = oeffneDatenbank(erste.pfad, 0, { aktuell: neu, alt: [alt] });
    rotieren(rotation, 1);
    rotation.schliessen();
    const danach = oeffneDatenbank(erste.pfad, 0, { aktuell: neu, alt: [] });
    expect(danach.anmeldeGeheimnis).toBe(geheimnis);
    danach.schliessen();
  });
});
