import { afterAll, describe, expect, it } from "vitest";
import { ereignisse, pruefRestores } from "../../db/schema.ts";
import { minioNachbau } from "../../testhilfen/minio.ts";
import { pruefUmgebung, SNAPSHOT } from "../../testhilfen/pruef-restore.ts";
import { vergebenePorts } from "../installationen/lesen.ts";
import { kopieVon } from "./kopie.ts";
import { pruefRestoreStand } from "./lesen.ts";
import { pruefRestorePlanen } from "./zeitplan.ts";

/*
 * BAULISTE.md Z-602, the end of a test restore (docs/plan.md, "Prüf-Restore (Z-602)"): the copy's
 * ports are free again, the result is kept in `pruef_restores` with the snapshot of each part and
 * the duration, and a failed one makes the event `pruef_restore_gescheitert`.
 */

const minio = minioNachbau();
afterAll(() => minio.stoppen());

const mitAuftrag = async () => {
  const u = pruefUmgebung(minio);
  const id = await u.gesichert();
  pruefRestorePlanen(u.deps);
  const [job] = u.pruefAuftraege(id);
  if (!job) throw new Error("no test restore");
  return { u, id, job, kopie: kopieVon(job) ?? "" };
};

describe("the end of a test restore", () => {
  it("keeps a successful one with its parts and duration and frees the copy's ports", async () => {
    const { u, id, job, kopie } = await mitAuftrag();
    const ports = u.kopiePortZeilen(kopie).map((p) => p.port);
    expect(ports.length).toBeGreaterThan(0);
    expect(pruefRestoreStand(u.db, "b1", id)).toEqual({ letzter: null, laeuft: true });
    u.uhr.ms += 90_000;
    const teile = [
      { tag: "volume:daten", snapshot: SNAPSHOT, zurueckgespielt: true },
      { tag: "befehl:sichern", zurueckgespielt: false, grund: "ein Export ist kein Restore" },
    ];
    u.pruefMelden(
      job.auftragId,
      u.ergebnis(job.auftragId, { ok: true, daten: { teile, dauerMs: 84_000 } }),
    );
    expect(u.kopiePortZeilen(kopie)).toEqual([]);
    for (const p of ports) expect(vergebenePorts(u.db, "b1", "s1")).not.toContain(p);
    expect(pruefRestoreStand(u.db, "b1", id)).toEqual({
      laeuft: false,
      letzter: {
        zeitpunkt: u.uhr.ms,
        ok: true,
        grund: null,
        kopie,
        teile: [
          { ...teile[0], grund: null },
          { ...teile[1], snapshot: null },
        ],
        dauerMs: 84_000,
      },
    });
    expect(u.db.select().from(ereignisse).all()).toEqual([]);
  });

  it("makes an event when it failed, and frees the ports all the same", async () => {
    const { u, id, job, kopie } = await mitAuftrag();
    u.pruefMelden(
      job.auftragId,
      u.ergebnis(job.auftragId, {
        ok: false,
        fehler: "volume:daten: restic dump endete mit Code 1",
      }),
    );
    expect(u.kopiePortZeilen(kopie)).toEqual([]);
    expect(pruefRestoreStand(u.db, "b1", id).letzter).toMatchObject({
      ok: false,
      grund: "volume:daten: restic dump endete mit Code 1",
      teile: [],
    });
    expect(u.db.select().from(ereignisse).all()).toEqual([
      expect.objectContaining({
        art: "pruef_restore_gescheitert",
        schwere: "fehler",
        ziel: `installation:${id}`,
        text: `Prüf-Restore von ${id} gescheitert: volume:daten: restic dump endete mit Code 1`,
      }),
    ]);
  });

  it("is one row per job, even if the agent reports it again", async () => {
    const { u, job } = await mitAuftrag();
    const e = u.ergebnis(job.auftragId, { ok: false, fehler: "Health rot" });
    u.pruefMelden(job.auftragId, e);
    u.pruefMelden(job.auftragId, e);
    expect(u.db.select().from(pruefRestores).all()).toHaveLength(1);
    expect(u.db.select().from(ereignisse).all()).toHaveLength(1);
  });

  it("lets a new installation take the copy's ports afterwards", async () => {
    const { u, job, kopie } = await mitAuftrag();
    const ports = u.kopiePortZeilen(kopie).map((p) => p.port);
    u.pruefMelden(job.auftragId, u.ergebnis(job.auftragId, { ok: true, daten: {} }));
    const neu = u.laufend();
    const genommen = vergebenePorts(u.db, "b1", "s1");
    expect(ports.every((p) => genommen.includes(p))).toBe(true);
    expect(neu).toBeTruthy();
  });
});
