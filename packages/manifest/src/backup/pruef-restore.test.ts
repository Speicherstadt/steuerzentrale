import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beispielManifest } from "../quadlet/testeingabe.ts";
import {
  PRUEF_RESTORE_AKTION,
  PRUEF_RESTORE_ZEITLIMIT_S,
  type PruefRestoreAnfrage,
  pruefRestoreAuftragPruefen,
  pruefRestoreDatenLesen,
} from "./pruef-restore.ts";

/*
 * BAULISTE.md Z-602 (docs/plan.md, "Prüf-Restore (Z-602)"): the test restore names the original
 * installation, the copy in `kopie` and carries the copy's data in `einrichtung`, rendered from the
 * signed manifest under the copy's name; never a backup access, never an argv.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const VORLAGE = readFileSync(join(ROOT, "manifeste/beispiel/manifest.vorlage.yml"), "utf8");
const beispiel = beispielManifest(VORLAGE);

const anfrage = (teil: Partial<PruefRestoreAnfrage> = {}): PruefRestoreAnfrage => ({
  aktion: PRUEF_RESTORE_AKTION,
  installationId: "beispiel-x7k2p9",
  argumente: { kopie: "restore-a1b2c3" },
  einrichtung: {
    installation: {
      kundeId: "k-1",
      optionen: [],
      httpPort: 20003,
      ports: { "app:9000": 20004 },
      host: "beispiel.kunde.example",
      ipv4: null,
    },
    einstellungen: { betreiber: {}, installation: {}, auto: { BEISPIEL_SCHLUESSEL: "dGVzdA==" } },
  },
  ...teil,
});

const grund = (r: { ok: boolean; grund?: string }) => (r.ok ? "ok" : r.grund);

describe("the test restore job", () => {
  it("renders the copy under its own name with the manifest's parts", () => {
    const r = pruefRestoreAuftragPruefen(beispiel, anfrage());
    if (!r.ok) throw new Error(r.grund);
    expect(r.auftrag).toMatchObject({
      art: "pruef_restore",
      original: "beispiel-x7k2p9",
      kopie: "restore-a1b2c3",
      units: ["restore-a1b2c3-app.service"],
    });
    expect(r.auftrag.teile.map((t) => t.tag)).toEqual(["volume:daten", "befehl:export"]);
    expect(Object.keys(r.auftrag.quadlets.units).every((u) => u.startsWith("restore-a1b2c3"))).toBe(
      true,
    );
    expect(JSON.stringify(r.auftrag.quadlets)).toContain("127.0.0.1:20003:8080");
    expect(PRUEF_RESTORE_ZEITLIMIT_S).toBe(1800 + 4 * 3600);
  });

  it.each([
    ["another action", { aktion: "installation_backup" }, "not a test restore"],
    ["no installation", { installationId: null }, "named installation"],
    ["no copy", { argumente: {} }, "kopie"],
    ["a copy of another shape", { argumente: { kopie: "beispiel-a1b2c3" } }, "kopie"],
    ["an argument more", { argumente: { kopie: "restore-a1b2c3", argv: "sh" } }, "argv"],
    ["no copy's data", { einrichtung: undefined }, "einrichtung"],
    ["a backup access", { backup: { passwort: "x" } }, "no backup data"],
  ] as const)("refuses %s", (_, teil, text) => {
    expect(grund(pruefRestoreAuftragPruefen(beispiel, anfrage(teil)))).toContain(text);
  });

  it("refuses a copy named like the installation", () => {
    const r = pruefRestoreAuftragPruefen(beispiel, anfrage({ installationId: "restore-a1b2c3" }));
    expect(grund(r)).toContain("not be the installation itself");
  });

  it("refuses a manifest with nothing to back up", () => {
    const ohne = beispielManifest(VORLAGE.replace(/^backup:\n(\s+- .*\n)+/m, ""));
    expect(grund(pruefRestoreAuftragPruefen(ohne, anfrage()))).toContain("no backup part");
  });

  it("refuses a port the Zentrale does not assign", () => {
    const a = anfrage();
    if (!a.einrichtung) throw new Error("test");
    const r = pruefRestoreAuftragPruefen(beispiel, {
      ...a,
      einrichtung: {
        ...a.einrichtung,
        installation: { ...a.einrichtung.installation, httpPort: 22 },
      },
    });
    expect(grund(r)).toContain("httpPort");
  });
});

describe("the agent's data of a test restore", () => {
  it("keeps the parts and the duration", () => {
    const daten = {
      teile: [
        { tag: "volume:daten", snapshot: "a".repeat(64), zurueckgespielt: true },
        { tag: "befehl:export", zurueckgespielt: false, grund: "ein Export ist kein Restore" },
      ],
      dauerMs: 93_000,
    };
    expect(pruefRestoreDatenLesen(daten)).toEqual({
      teile: [
        { tag: "volume:daten", snapshot: "a".repeat(64), zurueckgespielt: true, grund: null },
        {
          tag: "befehl:export",
          snapshot: null,
          zurueckgespielt: false,
          grund: "ein Export ist kein Restore",
        },
      ],
      dauerMs: 93_000,
    });
  });

  it("drops what it does not know", () => {
    expect(pruefRestoreDatenLesen(null)).toEqual({ teile: [], dauerMs: null });
    expect(
      pruefRestoreDatenLesen({ teile: [{ snapshot: "x" }, 3, { tag: "" }], dauerMs: -1 }),
    ).toEqual({ teile: [], dauerMs: null });
    expect(pruefRestoreDatenLesen({ teile: "x", dauerMs: 1.5 })).toEqual({
      teile: [],
      dauerMs: null,
    });
  });
});
