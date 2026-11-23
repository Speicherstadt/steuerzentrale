import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { manifestPruefen } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { BACKUP_TEILE, demoBackups } from "./backups.ts";
import { demo } from "./index.ts";

// Z-601, Z-602: the demo answers like GET /api/v1/backups, and its parts are those of the apps'
// manifests

const MANIFESTE = join(import.meta.dirname, "../../../../manifeste");

const teileAusManifest = (app: string) => {
  const version = readdirSync(join(MANIFESTE, app)).find((v) => /^\d/.test(v)) ?? "";
  const m = manifestPruefen(readFileSync(join(MANIFESTE, app, version, "manifest.yml"), "utf8"));
  if (!m.ok) throw new Error(m.fehler.join("; "));
  return m.manifest.backup.map((t) => ({
    art: t.art,
    name: t.art === "pg_dump" ? t.container : t.art === "volume" ? t.volume : t.befehl,
  }));
};

describe("the demo's backups", () => {
  it("name the parts each app's manifest backs up", () => {
    for (const app of demo.apps.map((a) => a.id))
      expect(BACKUP_TEILE[app], app).toEqual(teileAusManifest(app));
  });

  it("show every installation with its last run, a failed one with its reason", async () => {
    const a = await demoBackups().uebersicht();
    if (!a.ok) throw new Error(a.fehler);
    expect(a.daten.map((z) => z.installationId)).toEqual(demo.installationen.map((i) => i.id));
    for (const z of a.daten) {
      const i = demo.installationen.find((x) => x.id === z.installationId);
      expect(z.letzter?.ok, z.installationId).toBe(i?.snapshots[0]?.gb !== null);
      if (z.letzter && !z.letzter.ok) expect(z.letzter.grund).not.toBeNull();
    }
  });

  it("show each installation's newest test restore as its demo state says (Z-602)", async () => {
    const a = await demoBackups().uebersicht();
    if (!a.ok) throw new Error(a.fehler);
    for (const z of a.daten) {
      const i = demo.installationen.find((x) => x.id === z.installationId);
      const l = z.pruefRestore.letzter;
      expect(l?.ok, z.installationId).toBe(i?.pruefRestore !== "gescheitert");
      expect(l?.kopie).toMatch(/^restore-[a-z0-9]{6}$/);
      if (i?.pruefRestore === "offen")
        expect(demo.jetzt - (l?.zeitpunkt ?? 0)).toBeGreaterThan(8 * 86_400_000);
    }
  });

  it("keep the admin access only as set and need one the first time", async () => {
    const q = demoBackups(demo, {
      endpunkt: null,
      region: null,
      bucket: null,
      zugangGesetzt: false,
    });
    const ort = { endpunkt: "https://s3.example.net", region: "eu-central-1", bucket: "b" };
    expect(await q.zielSetzen(ort, "Test")).toMatchObject({ ok: false, fehler: "zugang_fehlt" });
    const gesetzt = await q.zielSetzen({ ...ort, accessKey: "admin", secretKey: "geheim-1" }, "T");
    expect(gesetzt).toEqual({ ok: true, status: 200, daten: { ...ort, zugangGesetzt: true } });
  });
});
