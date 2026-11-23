import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beispielManifest } from "../quadlet/testeingabe.ts";
import { restoreTeile } from "./zurueckspielen.ts";

/*
 * BAULISTE.md Z-602 (docs/plan.md, "Prüf-Restore auf dem Server"): the parts of the manifest's
 * `backup` as they are played back into a target installation, from the signed manifest only.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const VORLAGE = readFileSync(join(ROOT, "manifeste/beispiel/manifest.vorlage.yml"), "utf8");
const beispiel = beispielManifest(VORLAGE);
const KOPIE_NAME = "restore-a1b2c3";

const mitBackup = (backup: string) =>
  beispielManifest(VORLAGE.replace(/^backup:\n(\s+- .*\n)+/m, `backup:\n${backup}\n`));

const grund = (r: { ok: boolean; grund?: string }) => (r.ok ? "ok" : r.grund);

describe("restoreTeile", () => {
  it("plays a volume back into the target's volume of the same name, from its folder in the snapshot", () => {
    const r = restoreTeile(beispiel, KOPIE_NAME);
    if (!r.ok) throw new Error(r.grund);
    expect(r.netz).toEqual({ name: KOPIE_NAME, unit: `${KOPIE_NAME}-network.service` });
    expect(r.teile).toEqual([
      {
        art: "volume",
        tag: "volume:daten",
        volume: `${KOPIE_NAME}-daten`,
        pfad: "/sicherung/daten",
        unit: `${KOPIE_NAME}-daten-volume.service`,
      },
      { art: "befehl", tag: "befehl:export" },
    ]);
  });

  it("restores a pg_dump with pg_restore --clean --if-exists, database and user from the manifest", () => {
    const m = mitBackup(
      "  - { art: pg_dump, container: app, datenbank: beispiel, nutzer: b-nutzer }",
    );
    const r = restoreTeile(m, KOPIE_NAME);
    if (!r.ok) throw new Error(r.grund);
    expect(r.teile).toEqual([
      {
        art: "pg_dump",
        tag: "pg_dump:app:beispiel",
        container: `${KOPIE_NAME}-app`,
        unit: `${KOPIE_NAME}-app.service`,
        datei: "/app-beispiel.dump",
        argv: ["pg_restore", "--clean", "--if-exists", "-d", "beispiel", "-U", "b-nutzer"],
        bereit: ["pg_isready", "-h", "127.0.0.1", "-d", "beispiel", "-U", "b-nutzer"],
      },
    ]);
  });

  it("refuses what backupTeile refuses", () => {
    const m = mitBackup("  - { art: pg_dump, container: app, datenbank: 'a,b', nutzer: n }");
    expect(grund(restoreTeile(m, KOPIE_NAME))).toContain("backup.0.datenbank");
  });
});
