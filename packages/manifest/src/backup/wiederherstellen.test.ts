import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beispielManifest } from "../quadlet/testeingabe.ts";
import {
  snapshotArgument,
  WIEDERHERSTELLEN_AKTION,
  WIEDERHERSTELLEN_ZEITLIMIT_S,
  type WiederherstellenAnfrage,
  wiederherstellenArgumente,
  wiederherstellenAuftragPruefen,
  wiederherstellenDatenLesen,
} from "./wiederherstellen.ts";

/*
 * BAULISTE.md Z-603 (docs/plan.md, "Wiederherstellen (Z-603)"): the restore names the installation
 * and, for each part of the manifest's `backup` that is played back, its snapshot as
 * `snapshot:<tag>`; what is played back where comes from the signed manifest, never from the job.
 * Whether the manifest is the installation's own (the labels of its units) the agent checks.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const VORLAGE = readFileSync(join(ROOT, "manifeste/beispiel/manifest.vorlage.yml"), "utf8");
const beispiel = beispielManifest(VORLAGE);
const BACKUP = "backup:\n  - { art: volume, volume: daten }\n  - { art: befehl, befehl: export }\n";
const mitBackup = (zeilen: string) => {
  if (!VORLAGE.includes(BACKUP)) throw new Error("the template's backup changed");
  return beispielManifest(VORLAGE.replace(BACKUP, zeilen));
};
const mitDump = mitBackup(
  "backup:\n  - { art: volume, volume: daten }\n  - { art: pg_dump, container: app, datenbank: b, nutzer: b }\n",
);

const A = "a".repeat(64);
const B = "b".repeat(64);

const anfrage = (teil: Partial<WiederherstellenAnfrage> = {}): WiederherstellenAnfrage => ({
  aktion: WIEDERHERSTELLEN_AKTION,
  installationId: "beispiel-x7k2p9",
  argumente: { "snapshot:volume:daten": A },
  ...teil,
});

const grund = (r: { ok: boolean; grund?: string }) => (r.ok ? "ok" : r.grund);

describe("the restore job", () => {
  it("plays the manifest's parts back into the installation with the job's snapshots", () => {
    const r = wiederherstellenAuftragPruefen(beispiel, anfrage());
    if (!r.ok) throw new Error(r.grund);
    expect(r.auftrag).toEqual({
      art: "wiederherstellen",
      name: "beispiel-x7k2p9",
      netz: { name: "beispiel-x7k2p9", unit: "beispiel-x7k2p9-network.service" },
      teile: [
        {
          art: "volume",
          tag: "volume:daten",
          volume: "beispiel-x7k2p9-daten",
          pfad: "/sicherung/daten",
          unit: "beispiel-x7k2p9-daten-volume.service",
        },
        { art: "befehl", tag: "befehl:export" },
      ],
      snapshots: { "volume:daten": A },
    });
    expect(WIEDERHERSTELLEN_ZEITLIMIT_S).toBe(4 * 3600 + 1800);
  });

  it("takes a snapshot of each part, a dump's with pg_restore from the manifest", () => {
    const r = wiederherstellenAuftragPruefen(
      mitDump,
      anfrage({ argumente: { "snapshot:volume:daten": A, "snapshot:pg_dump:app:b": B } }),
    );
    if (!r.ok) throw new Error(r.grund);
    expect(r.auftrag.snapshots).toEqual({ "volume:daten": A, "pg_dump:app:b": B });
    expect(r.auftrag.teile[1]).toMatchObject({
      art: "pg_dump",
      container: "beispiel-x7k2p9-app",
      argv: ["pg_restore", "--clean", "--if-exists", "-d", "b", "-U", "b"],
    });
  });

  it.each([
    ["another action", { aktion: "installation_pruef_restore" }, "not a restore"],
    ["no installation", { installationId: null }, "named installation"],
    ["a name of another shape", { installationId: "../x" }, "named installation"],
    ["installation data", { einrichtung: { installation: {} } }, "no installation data"],
    ["a backup access", { backup: { passwort: "x" } }, "no backup data"],
    ["no snapshot", { argumente: {} }, "no snapshot for snapshot:volume:daten"],
    [
      "an unknown tag",
      { argumente: { "snapshot:volume:daten": A, "snapshot:volume:fremd": B } },
      "unknown argument snapshot:volume:fremd",
    ],
    [
      "an argument of another kind",
      { argumente: { "snapshot:volume:daten": A, argv: "sh" } },
      "unknown argument argv",
    ],
    [
      "a snapshot for a command's export",
      { argumente: { "snapshot:volume:daten": A, "snapshot:befehl:export": B } },
      "a command's export is not played back",
    ],
    ["a short ID", { argumente: { "snapshot:volume:daten": "a".repeat(8) } }, "64 hex"],
    ["upper case", { argumente: { "snapshot:volume:daten": "A".repeat(64) } }, "64 hex"],
    ["latest", { argumente: { "snapshot:volume:daten": "latest" } }, "64 hex"],
    ["a number", { argumente: { "snapshot:volume:daten": 12 } }, "64 hex"],
    [
      "a snapshot with a folder",
      { argumente: { "snapshot:volume:daten": `${A}:/sicherung` } },
      "64 hex",
    ],
  ] as const)("refuses %s", (_, teil, text) => {
    expect(grund(wiederherstellenAuftragPruefen(beispiel, anfrage(teil)))).toContain(text);
  });

  it("refuses a missing part among several", () => {
    const r = wiederherstellenAuftragPruefen(mitDump, anfrage());
    expect(grund(r)).toBe("no snapshot for snapshot:pg_dump:app:b");
  });

  it("refuses a manifest with nothing to back up", () => {
    expect(grund(wiederherstellenAuftragPruefen(mitBackup(""), anfrage()))).toContain(
      "no backup part",
    );
  });

  it("refuses a manifest whose parts are exports only", () => {
    const nurExport = mitBackup("backup:\n  - { art: befehl, befehl: export }\n");
    expect(grund(wiederherstellenAuftragPruefen(nurExport, anfrage({ argumente: {} })))).toContain(
      "no part that is played back",
    );
  });
});

describe("the arguments from a chosen run", () => {
  it("name the snapshot of each part that is played back, not the export's", () => {
    const lauf = [
      { tag: "volume:daten", snapshot: A },
      { tag: "pg_dump:app:b", snapshot: B },
      { tag: "befehl:export", snapshot: "c".repeat(64) },
    ];
    const r = wiederherstellenArgumente(mitDump, "beispiel-x7k2p9", lauf);
    expect(r).toEqual({
      ok: true,
      argumente: { "snapshot:volume:daten": A, "snapshot:pg_dump:app:b": B },
    });
    if (!r.ok) return;
    const geprueft = wiederherstellenAuftragPruefen(mitDump, anfrage({ argumente: r.argumente }));
    expect(grund(geprueft)).toBe("ok");
    expect(snapshotArgument("volume:daten")).toBe("snapshot:volume:daten");
  });

  it("are refused for a run without a snapshot of a part", () => {
    const lauf = [{ tag: "volume:daten", snapshot: null }];
    expect(grund(wiederherstellenArgumente(beispiel, "beispiel-x7k2p9", lauf))).toBe(
      "the run has no snapshot of volume:daten",
    );
    expect(grund(wiederherstellenArgumente(beispiel, "beispiel-x7k2p9", []))).toBe(
      "the run has no snapshot of volume:daten",
    );
  });
});

describe("the agent's data of a restore", () => {
  it("are read like a Prüf-Restore's", () => {
    const daten = {
      teile: [{ tag: "volume:daten", snapshot: A, zurueckgespielt: true }],
      dauerMs: 4_000,
      fremd: "weg",
    };
    expect(wiederherstellenDatenLesen(daten)).toEqual({
      teile: [{ tag: "volume:daten", snapshot: A, zurueckgespielt: true, grund: null }],
      dauerMs: 4_000,
    });
  });
});
