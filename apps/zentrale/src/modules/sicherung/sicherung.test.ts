import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { oeffneDatenbank } from "../../db/oeffnen.ts";
import { server } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { testDatenbank, testSchluessel } from "../../db/test-db.ts";
import { agentCa, serverAnlegen } from "../server/index.ts";
import { DATEI, sichern, wiederherstellen } from "./index.ts";

// Z-1002: the Zentrale backs up its database as one consistent file and restores it into the empty
// data directory of a new server; the key is never part of it (docs/plan.md, "Sicherung der Zentrale")
const ordner: string[] = [];
const neuerOrdner = () => {
  const pfad = mkdtempSync(join(tmpdir(), "sz-test-sicherung-"));
  ordner.push(pfad);
  return pfad;
};
afterEach(() => {
  for (const pfad of ordner.splice(0)) rmSync(pfad, { recursive: true, force: true });
});

const bund: Schluesselbund = { aktuell: testSchluessel(7), alt: [] };
const kontext = { betreiberId: "b1", akteur: "test", jetzt: 1, grund: "Test" };

/** A database with a server and the operator's agent CA, as after a join */
const mitBestand = async () => {
  const offen = testDatenbank(bund);
  const neu = serverAnlegen(offen.schreibDb, kontext, {
    name: "s1",
    art: "gemeinsam",
    wartungsfenster: { tage: [1], von: "03:30", bis: "04:30" },
  });
  const ca = await agentCa(offen.db, offen.schreibDb, bund, kontext);
  return { offen, serverId: neu.server.serverId, ca: ca.zertifikat.toString("pem") };
};

const oeffnen = (b: Schluesselbund) => (pfad: string) => oeffneDatenbank(pfad, 2, b);

describe("backing up the Zentrale", () => {
  it("writes one file with everything committed, also what is still in the write-ahead log", async () => {
    const { offen, serverId } = await mitBestand();
    const ziel = join(neuerOrdner(), "zentrale.sicherung.db");
    expect(sichern(offen, ziel)).toEqual({ ok: true });
    const kopie = oeffneDatenbank(ziel, 2, bund);
    const zeile = kopie.db.select().from(server).where(eq(server.serverId, serverId)).get();
    kopie.schliessen();
    expect(zeile?.name).toBe("s1");
  });

  it("is readable for the Zentrale's user alone", async () => {
    const { offen } = await mitBestand();
    const ziel = join(neuerOrdner(), "zentrale.sicherung.db");
    sichern(offen, ziel);
    expect(statSync(ziel).mode & 0o777).toBe(0o600);
  });

  it("replaces an earlier backup and leaves no half file beside it", async () => {
    const { offen } = await mitBestand();
    const ort = neuerOrdner();
    const ziel = join(ort, "zentrale.sicherung.db");
    writeFileSync(ziel, "alt");
    expect(sichern(offen, ziel)).toEqual({ ok: true });
    expect(readFileSync(ziel).subarray(0, 15).toString()).toBe("SQLite format 3");
    expect(existsSync(`${ziel}.neu`)).toBe(false);
  });

  it("never holds the key", async () => {
    const { offen } = await mitBestand();
    const ziel = join(neuerOrdner(), "zentrale.sicherung.db");
    sichern(offen, ziel);
    const text = readFileSync(ziel).toString("latin1");
    const roh = Buffer.alloc(32, 7);
    expect(text).not.toContain(roh.toString("base64"));
    expect(text).not.toContain(roh.toString("latin1"));
  });

  it("fails as a value where it cannot write", async () => {
    const { offen } = await mitBestand();
    const r = sichern(offen, join(neuerOrdner(), "fehlt", "zentrale.sicherung.db"));
    expect(r.ok).toBe(false);
  });
});

describe("restoring the Zentrale", () => {
  it("puts the backup into an empty data directory, with its servers and the same agent CA", async () => {
    const { offen, serverId, ca } = await mitBestand();
    const datei = join(neuerOrdner(), "zentrale.sicherung.db");
    sichern(offen, datei);
    const daten = join(neuerOrdner(), "daten");
    expect(wiederherstellen(datei, daten, oeffnen(bund))).toEqual({ ok: true });
    expect(statSync(join(daten, DATEI)).mode & 0o777).toBe(0o600);
    expect(existsSync(join(daten, `${DATEI}.wiederherstellen`))).toBe(false);
    const neu = oeffneDatenbank(join(daten, DATEI), 3, bund);
    const zeile = neu.db.select().from(server).where(eq(server.serverId, serverId)).get();
    // the agents' certificates chain to this CA: the same one lets them connect again
    const wieder = await agentCa(neu.db, neu.schreibDb, bund, { ...kontext, jetzt: 3 });
    neu.schliessen();
    expect(zeile?.name).toBe("s1");
    expect(wieder.zertifikat.toString("pem")).toBe(ca);
  });

  it("refuses a data directory that already holds a database and leaves it alone", async () => {
    const { offen } = await mitBestand();
    const datei = join(neuerOrdner(), "zentrale.sicherung.db");
    sichern(offen, datei);
    const daten = neuerOrdner();
    writeFileSync(join(daten, DATEI), "bestand");
    const r = wiederherstellen(datei, daten, oeffnen(bund));
    expect(r).toEqual({ ok: false, grund: expect.stringContaining("already holds a database") });
    expect(readFileSync(join(daten, DATEI), "utf8")).toBe("bestand");
  });

  it("refuses a backup the key does not open, and writes nothing", async () => {
    const { offen } = await mitBestand();
    const datei = join(neuerOrdner(), "zentrale.sicherung.db");
    sichern(offen, datei);
    const daten = join(neuerOrdner(), "daten");
    const falsch = { aktuell: testSchluessel(9), alt: [] };
    const r = wiederherstellen(datei, daten, oeffnen(falsch));
    expect(r).toEqual({ ok: false, grund: expect.stringContaining("does not open this database") });
    expect(existsSync(join(daten, DATEI))).toBe(false);
    expect(existsSync(join(daten, `${DATEI}.wiederherstellen`))).toBe(false);
  });

  it("refuses a damaged file, and writes nothing", () => {
    const datei = join(neuerOrdner(), "kaputt.db");
    writeFileSync(datei, Buffer.alloc(8192, 1));
    const daten = join(neuerOrdner(), "daten");
    const r = wiederherstellen(datei, daten, oeffnen(bund));
    expect(r.ok).toBe(false);
    expect(existsSync(join(daten, DATEI))).toBe(false);
  });

  it("does not replace a database that appears in the data directory while it restores", async () => {
    const { offen } = await mitBestand();
    const datei = join(neuerOrdner(), "zentrale.sicherung.db");
    sichern(offen, datei);
    const daten = join(neuerOrdner(), "daten");
    // e.g. the service started meanwhile and made its empty database
    const r = wiederherstellen(datei, daten, (pfad) => {
      const geoeffnet = oeffnen(bund)(pfad);
      writeFileSync(join(daten, DATEI), "bestand");
      return geoeffnet;
    });
    expect(r).toEqual({ ok: false, grund: expect.stringContaining("already holds a database") });
    expect(readFileSync(join(daten, DATEI), "utf8")).toBe("bestand");
    expect(existsSync(join(daten, `${DATEI}.wiederherstellen`))).toBe(false);
  });

  it("refuses a data directory whose database is a link, even one pointing nowhere", async () => {
    const { offen } = await mitBestand();
    const datei = join(neuerOrdner(), "zentrale.sicherung.db");
    sichern(offen, datei);
    const daten = neuerOrdner();
    symlinkSync(join(daten, "anderswo.db"), join(daten, DATEI));
    const r = wiederherstellen(datei, daten, oeffnen(bund));
    expect(r).toEqual({ ok: false, grund: expect.stringContaining("already holds a database") });
    expect(lstatSync(join(daten, DATEI)).isSymbolicLink()).toBe(true);
  });

  it("refuses a backup that is not there", () => {
    const daten = join(neuerOrdner(), "daten");
    const r = wiederherstellen(join(neuerOrdner(), "fehlt.db"), daten, oeffnen(bund));
    expect(r).toEqual({ ok: false, grund: expect.stringContaining("no backup at") });
    expect(existsSync(join(daten, DATEI))).toBe(false);
  });
});
