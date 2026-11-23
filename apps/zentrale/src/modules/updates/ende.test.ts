import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, ereignisse, installationKonfigurationen } from "../../db/schema.ts";
import { minioNachbau } from "../../testhilfen/minio.ts";
import { updateUmgebung } from "../../testhilfen/updates.ts";
import { spalteEntschluesseln } from "../geheim/spalten.ts";
import { installationLesen } from "../installationen/index.ts";
import { UPDATE_ARTEN } from "./ende.ts";
import { updateStand, wellenstandLesen } from "./lesen.ts";

/*
 * BAULISTE.md Z-503, the end of an update (docs/plan.md, "Update auf dem Server (Z-503)"): only
 * `aktualisiert` raises the installation to the new version with its values; a rollback, an
 * incomplete one and a failure keep the old version, make an event of severity `fehler` and halt
 * the waves of the version.
 */

const minio = minioNachbau();
afterAll(() => minio.stoppen());

const unterwegs = async () => {
  const u = updateUmgebung(minio);
  const id = await u.eingerichtet();
  u.versionen("update-1.3.0");
  const r = u.anlegen(id);
  if (!r.ok) throw new Error(r.grund);
  u.gesichert(id);
  u.uhr.ms += 90_000;
  return { u, id, auftragId: r.update.auftragId };
};

const ereignisseVon = (u: Awaited<ReturnType<typeof unterwegs>>["u"]) =>
  u.db.select().from(ereignisse).all();

describe("the end of an update", () => {
  it("raises the installation to the new version with its values once it holds", async () => {
    const { u, id, auftragId } = await unterwegs();
    u.beendet(id, { ergebnis: "aktualisiert", dauerMs: 41_000 });
    const i = installationLesen(u.db, "b1", id);
    const text = u.updateAuftraege(id).update?.manifest ?? "";
    expect(i).toMatchObject({
      version: "1.3.0",
      manifest: text,
      manifestHash: createHash("sha256").update(text, "utf8").digest("hex"),
      geaendertAm: u.uhr.ms,
    });
    // the value the new version added is the installation's from now on
    const klar = spalteEntschluesseln(
      u.schluessel,
      "installationen",
      "b1",
      i as never,
      i?.geheim ?? "",
    );
    if (!klar.ok) throw new Error(klar.grund);
    expect(Object.keys(JSON.parse(klar.wert).auto)).toContain("PROBE_NEU");
    expect(u.db.select().from(installationKonfigurationen).all()).toEqual([]);
    expect(updateStand(u.db, "b1", id)).toMatchObject({
      laeuft: false,
      letzter: { phase: "aktualisiert", endeAm: u.uhr.ms, fehler: null, dauerMs: 41_000 },
    });
    expect(ereignisseVon(u)).toEqual([
      expect.objectContaining({
        ereignisId: `update-${auftragId}`,
        art: UPDATE_ARTEN.aktualisiert,
        schwere: "info",
        ziel: `installation:${id}`,
        text: `Update von ${id} auf probe 1.3.0 gelungen`,
      }),
    ]);
    expect(wellenstandLesen(u.db, "b1", "probe", "1.3.0", new Set())).toEqual({});
    const audit = u.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.ziel === `installationen:${id}`);
    expect(audit.at(-1)).toMatchObject({ akteur: "server:s1" });
  });

  it("keeps the old version after a rollback: an event, and the waves of the version halt", async () => {
    const { u, id, auftragId } = await unterwegs();
    u.beendet(id, {
      ergebnis: "zurueckgenommen",
      grund: "Health blieb rot: HTTP 502",
      dauerMs: 330_000,
    });
    expect(installationLesen(u.db, "b1", id)?.version).toBe("1.0.3");
    expect(u.db.select().from(installationKonfigurationen).all()).toEqual([]);
    expect(updateStand(u.db, "b1", id).letzter).toMatchObject({
      phase: "zurueckgenommen",
      fehler: "Health blieb rot: HTTP 502",
      dauerMs: 330_000,
    });
    expect(ereignisseVon(u)).toEqual([
      expect.objectContaining({
        ereignisId: `update-${auftragId}`,
        art: "update_zurueckgenommen",
        schwere: "fehler",
        text: `Update von ${id} auf probe 1.3.0 zurückgenommen, wieder 1.0.3: Health blieb rot: HTTP 502`,
      }),
    ]);
    expect(wellenstandLesen(u.db, "b1", "probe", "1.3.0", new Set())).toEqual({
      stoerungAm: u.uhr.ms,
    });
    // another operator's waves know nothing of it
    expect(wellenstandLesen(u.db, "b2", "probe", "1.3.0", new Set())).toEqual({});
  });

  it("makes an event of an incomplete rollback, which halts the waves too", async () => {
    const { u, id } = await unterwegs();
    u.beendet(id, { ergebnis: "ruecknahme_unvollstaendig", grund: "restic restore: exit 1" });
    expect(installationLesen(u.db, "b1", id)?.version).toBe("1.0.3");
    expect(ereignisseVon(u)).toEqual([
      expect.objectContaining({
        art: "update_ruecknahme_unvollstaendig",
        schwere: "fehler",
        text: `Update von ${id} auf probe 1.3.0 gescheitert, Rücknahme unvollständig: restic restore: exit 1`,
      }),
    ]);
    expect(wellenstandLesen(u.db, "b1", "probe", "1.3.0", new Set()).stoerungAm).toBe(u.uhr.ms);
  });

  it("takes a result without a known outcome, or a failed one, as a failure", async () => {
    for (const ergebnis of [
      { ok: true as const, daten: { ergebnis: "vielleicht" } },
      { ok: true as const, daten: {} },
      { ok: false as const, fehler: "abgelehnt: die Units stammen nicht aus dem Manifest" },
    ]) {
      const { u, id } = await unterwegs();
      u.ergebnisMelden(u.updateAuftraege(id).update?.auftragId ?? "", ergebnis);
      expect(installationLesen(u.db, "b1", id)?.version).toBe("1.0.3");
      expect(updateStand(u.db, "b1", id).letzter).toMatchObject({
        phase: "gescheitert",
        fehler: ergebnis.ok ? "Ergebnis des Agenten ohne Ausgang" : ergebnis.fehler,
      });
      expect(ereignisseVon(u)).toEqual([
        expect.objectContaining({ art: "update_gescheitert", schwere: "fehler" }),
      ]);
      expect(wellenstandLesen(u.db, "b1", "probe", "1.3.0", new Set()).stoerungAm).toBe(u.uhr.ms);
    }
  });

  it("knows when the internal installations reached the version", async () => {
    const { u, id } = await unterwegs();
    u.beendet(id, { ergebnis: "aktualisiert", dauerMs: null });
    expect(wellenstandLesen(u.db, "b1", "probe", "1.3.0", new Set([id]))).toEqual({
      internGelungenAm: u.uhr.ms,
    });
    // a newer version reached counts for an older one too
    expect(wellenstandLesen(u.db, "b1", "probe", "1.2.0", new Set([id]))).toEqual({
      internGelungenAm: u.uhr.ms,
    });
    expect(wellenstandLesen(u.db, "b1", "probe", "1.4.0", new Set([id]))).toEqual({});
  });
});
