import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { oeffneDatenbank } from "../db/oeffnen.ts";
import { betreiber, server } from "../db/schema.ts";
import { schluesselAus } from "../modules/geheim/verschluesseln.ts";

/*
 * The CI helper (job `server`) adds its server under an operator the Zentrale knows: the loops
 * that go over every operator, the update of the agents (Z-504) among them, see only those in
 * `betreiber`, and a server of an unknown one would never be updated.
 */
const KEY = Buffer.alloc(32, 7).toString("base64");
const ordner: string[] = [];
afterEach(() => {
  for (const o of ordner.splice(0)) rmSync(o, { recursive: true, force: true });
});

const ausfuehren = (daten: string, ...argumente: string[]) => {
  const lauf = Bun.spawnSync(["bun", join(import.meta.dirname, "testserver.ts"), ...argumente], {
    env: {
      ...process.env,
      STEUERZENTRALE_DATA: daten,
      STEUERZENTRALE_SECRET_KEY: KEY,
      STEUERZENTRALE_URL: "http://localhost:28300",
      STEUERZENTRALE_AGENT_URL: "https://10.0.0.1:28443",
    },
  });
  expect(lauf.exitCode, lauf.stderr.toString()).toBe(0);
  return lauf.stdout.toString();
};

describe("testserver.ts", () => {
  it("adds the server under an operator in `betreiber`, once for two servers", () => {
    const daten = mkdtempSync(join(tmpdir(), "sz-testserver-"));
    ordner.push(daten);
    ausfuehren(daten, "anlegen", "debian/13");
    const zweiter = JSON.parse(ausfuehren(daten, "anlegen", "ubuntu/24.04")) as {
      befehl: string;
    };
    expect(zweiter.befehl).toContain("https://10.0.0.1:28443/install.sh");
    const schluessel = schluesselAus(KEY);
    if (!schluessel.ok) throw new Error("test key");
    const offen = oeffneDatenbank(join(daten, "zentrale.db"), Date.now(), {
      aktuell: schluessel.schluessel,
      alt: [],
    });
    try {
      const betreiberIds = offen.db
        .select()
        .from(betreiber)
        .all()
        .map((b) => b.betreiberId);
      const ihre = offen.db
        .select()
        .from(server)
        .all()
        .map((s) => s.betreiberId);
      expect(ihre).toHaveLength(2);
      expect(betreiberIds).toEqual([ihre[0]]);
      expect(ihre[1]).toBe(ihre[0]);
    } finally {
      offen.schliessen();
    }
  }, 30_000);

  it("tells where the reboot of a server stands (Z-701)", () => {
    const daten = mkdtempSync(join(tmpdir(), "sz-testserver-"));
    ordner.push(daten);
    const { serverId } = JSON.parse(ausfuehren(daten, "anlegen", "debian/13")) as {
      serverId: string;
    };
    expect(JSON.parse(ausfuehren(daten, "neustart", serverId))).toEqual({
      neustart: null,
      fakten: null,
      faktenAm: null,
      letzterHeartbeat: null,
      ereignisse: [],
    });
  }, 30_000);
});
