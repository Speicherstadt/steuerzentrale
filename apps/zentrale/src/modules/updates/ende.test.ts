import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, ereignisse, installationKonfigurationen } from "../../db/schema.ts";
import { minioNachbau } from "../../testhilfen/minio.ts";
import { SNAPSHOT } from "../../testhilfen/pruef-restore.ts";
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

const unterwegs = async (version: "update-1.3.0" | "update-teile" = "update-1.3.0") => {
  const u = updateUmgebung(minio);
  const id = await u.eingerichtet();
  u.versionen(version);
  const r = u.anlegen(id, { version: version === "update-1.3.0" ? "1.3.0" : "1.3.3" });
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

  it("sends nothing more when the new version backs up and routes as the old one", async () => {
    const { u, id } = await unterwegs();
    const vorher = u.agent.length;
    u.beendet(id, { ergebnis: "aktualisiert", dauerMs: 1000 });
    expect(u.agent.slice(vorher)).toEqual([]);
  });

  it("sets backups and route up anew when the new version names other parts and port", async () => {
    const { u, id } = await unterwegs("update-teile");
    const vorher = u.agent.length;
    u.beendet(id, { ergebnis: "aktualisiert", dauerMs: 1000 });
    const i = installationLesen(u.db, "b1", id);
    const neu = u.agent.slice(vorher) as {
      aktion: string;
      argumente: unknown;
      manifest: string;
      backup?: unknown;
    }[];
    expect(neu.map((n) => n.aktion).sort()).toEqual([
      "installation_backup_einrichten",
      "pforte_route_setzen",
    ]);
    for (const n of neu) expect(n.manifest).toContain("version: 1.3.3");
    expect(neu.find((n) => n.aktion === "pforte_route_setzen")?.argumente).toEqual({
      host: i?.host,
      port: i?.httpPort,
    });
    expect(neu.find((n) => n.aktion === "installation_backup_einrichten")?.backup).toBeDefined();
    // not after a rollback: the old version keeps its backups and route
    const zurueck = await unterwegs("update-teile");
    const davor = zurueck.u.agent.length;
    zurueck.u.beendet(zurueck.id, { ergebnis: "zurueckgenommen", grund: "rot" });
    expect(zurueck.u.agent.slice(davor)).toEqual([]);
  });

  it("sends an update whose new version adds a part to back up, with the old parts' snapshots", async () => {
    // docs/plan.md, "Folgeaufträge nach einem Update (Z-503)": a new version may name other parts;
    // the backup before knows only the old ones, and a part the new version adds held no data yet
    const u = updateUmgebung(minio);
    const id = await u.eingerichtet();
    u.versionen("update-neuer-teil");
    const r = u.anlegen(id, { version: "1.3.4" });
    if (!r.ok) throw new Error(r.grund);
    u.gesichert(id);
    expect(u.updateAuftraege(id).update?.zustand).not.toBe("abgebrochen");
    expect(updateStand(u.db, "b1", id).letzter?.phase).toBe("aktualisieren");
    const gesendet = u.agent.find(
      (n) => (n as { aktion?: string }).aktion === "installation_update",
    );
    expect((gesendet as { argumente?: unknown } | undefined)?.argumente).toEqual({
      "snapshot:volume:daten": SNAPSHOT,
    });
  });
});
