import { BACKUP_AKTIONEN, snapshotArgument, UPDATE_AKTION } from "@steuerzentrale/manifest";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, auftraege, installationKonfigurationen } from "../../db/schema.ts";
import { minioNachbau } from "../../testhilfen/minio.ts";
import { GRUND, updateUmgebung } from "../../testhilfen/updates.ts";
import { backupAbgleichen } from "../backups/index.ts";
import { installationLesen } from "../installationen/index.ts";
import { updateStand } from "./lesen.ts";

/*
 * BAULISTE.md Z-503 in the Zentrale (docs/plan.md, "Update in der Zentrale (Z-503)"): an update is
 * a backup of the current state and the update with the new version's signed manifest waiting for
 * it, in one change of the audit log with the reason; only to a newer version the installation is
 * offered whose values it has, never beside an open job or another update on its server, never in a
 * freeze window unless the owner passes over it.
 */

const minio = minioNachbau();
afterAll(() => minio.stoppen());

const umgebung = async () => {
  const u = updateUmgebung(minio);
  const id = await u.eingerichtet();
  u.versionen("update-1.3.0");
  return { u, id };
};

describe("making an update", () => {
  it("backs up the current state first, then updates after it with the new manifest", async () => {
    const { u, id } = await umgebung();
    const vorher = u.agent.length;
    const r = u.anlegen(id);
    if (!r.ok) throw new Error(`${r.grund} ${r.detail ?? ""}`);
    const { backup, update } = u.updateAuftraege(id);
    expect(backup).toMatchObject({ auftragId: r.backup.auftragId, zustand: "zugestellt" });
    expect(update).toMatchObject({
      auftragId: r.update.auftragId,
      aktion: UPDATE_AKTION,
      version: "1.3.0",
      zustand: "wartend",
      wartetAuf: JSON.stringify([r.backup.auftragId]),
      argumente: "{}",
    });
    expect(update?.manifest).toContain("version: 1.3.0");
    // only the backup went to the agent; the update waits for it
    expect(u.agent.slice(vorher).map((n) => n.aktion)).toEqual([BACKUP_AKTIONEN.jetzt]);
    expect(updateStand(u.db, "b1", id)).toEqual({
      laeuft: true,
      letzter: {
        vonVersion: "1.0.3",
        nachVersion: "1.3.0",
        anlass: "hand",
        welle: null,
        sperrzeitUebergangen: false,
        angefordertAm: u.uhr.ms,
        phase: "sichern",
        endeAm: null,
        fehler: null,
        dauerMs: null,
      },
    });
    // the installation keeps its version until the update holds
    expect(installationLesen(u.db, "b1", id)?.version).toBe("1.0.3");
  });

  it("writes both jobs, the asked values and the update to the audit log with who and why", async () => {
    const { u, id } = await umgebung();
    const vorher = u.db.select().from(auditLog).all().length;
    expect(u.anlegen(id).ok).toBe(true);
    const neu = u.db.select().from(auditLog).all().slice(vorher);
    expect(neu.map((e) => [e.aktion, e.ziel.split(":")[0]])).toEqual([
      ["installation.update", "auftraege"],
      ["installation.update", "auftraege"],
      ["installation.update", "installationKonfigurationen"],
      ["installation.update", "updates"],
      ["auftrag.zugestellt", "auftraege"],
    ]);
    for (const e of neu.slice(0, 4)) expect(e).toMatchObject({ akteur: "nutzer-1", grund: GRUND });
    // the values' secrets never stand in the audit log
    expect(neu.map((e) => e.inhalt).join("")).not.toContain("kennwort-der-installation");
  });

  it("refuses without a reason, to no newer or unknown version, beside an open job", async () => {
    const { u, id } = await umgebung();
    expect(u.anlegen(id, {}, { grund: " " })).toEqual({ ok: false, grund: "grund_fehlt" });
    expect(u.anlegen(id, { version: "1.0.3" })).toEqual({ ok: false, grund: "nicht_angeboten" });
    expect(u.anlegen(id, { version: "1.0.0" })).toEqual({ ok: false, grund: "nicht_angeboten" });
    expect(u.anlegen(id, { version: "9.9.9" })).toEqual({ ok: false, grund: "kein_manifest" });
    expect(u.anlegen("gibt-es-nicht")).toEqual({ ok: false, grund: "keine_installation" });
    expect(u.anlegen(id).ok).toBe(true);
    expect(u.anlegen(id)).toEqual({ ok: false, grund: "auftrag_offen" });
  });

  it("refuses a version with a required value the installation lacks, and writes nothing", async () => {
    const { u, id } = await umgebung();
    u.versionen("update-pflicht");
    const vorher = u.db.select().from(auftraege).all().length;
    expect(u.anlegen(id, { version: "1.3.1" })).toEqual({
      ok: false,
      grund: "werte_fehlen",
      detail: "PROBE_MANDANT: required and without a value",
    });
    expect(u.db.select().from(auftraege).all().length).toBe(vorher);
    expect(u.zeilen()).toEqual([]);
  });

  it("refuses an installation not running or without backups", async () => {
    const { u } = await umgebung();
    expect(u.anlegen(u.laufend())).toEqual({ ok: false, grund: "nicht_eingerichtet" });
  });

  it("makes at most one update per server at a time", async () => {
    const { u, id } = await umgebung();
    const zweite = await u.eingerichtet();
    expect(u.anlegen(id).ok).toBe(true);
    expect(u.anlegen(zweite)).toEqual({ ok: false, grund: "server_belegt" });
    u.gesichert(id);
    u.beendet(id, { ergebnis: "aktualisiert", dauerMs: 1000 });
    expect(u.anlegen(zweite).ok).toBe(true);
  });

  it("never reaches an installation of another operator", async () => {
    const { u, id } = await umgebung();
    u.bereit("b2", null);
    const r = u.anlegen(id, {}, { betreiberId: "b2" });
    expect(r).toEqual({ ok: false, grund: "keine_installation" });
    expect(u.zeilen()).toEqual([]);
  });

  it("in a freeze window only when the owner passes over it, which the update keeps", async () => {
    const u = updateUmgebung(minio);
    // the 8th of a month, inside the manifest's window from the 7th to the 12th
    u.uhr.ms = Date.UTC(2027, 1, 8, 10, 0, 0);
    u.zielSetzen();
    const id = u.laufend("gesichert-gesperrt");
    u.melden(u.auftrag(id, "pforte_route_setzen")?.auftragId ?? "", true);
    await backupAbgleichen({ ...u.deps, fetch });
    u.melden(u.auftrag(id, BACKUP_AKTIONEN.einrichten)?.auftragId ?? "", true);
    u.versionen("update-1.3.0");
    expect(u.anlegen(id)).toEqual({
      ok: false,
      grund: "sperrzeit",
      detail: "Umsatzsteuer-Voranmeldung",
    });
    expect(u.anlegen(id, { sperrzeitUebergehen: true }).ok).toBe(true);
    expect(updateStand(u.db, "b1", id).letzter?.sperrzeitUebergangen).toBe(true);
  });
});

describe("the backup before an update", () => {
  it("gives the update the run's snapshots and sends it with the values of the new version", async () => {
    const { u, id } = await umgebung();
    const r = u.anlegen(id);
    if (!r.ok) throw new Error(r.grund);
    u.gesichert(id);
    const update = u.updateAuftraege(id).update;
    expect(update?.zustand).toBe("zugestellt");
    expect(JSON.parse(update?.argumente ?? "")).toEqual({
      [snapshotArgument("volume:daten")]: "4f2a9c1e".repeat(8),
    });
    const gesendet = u.agent.filter((n) => n.aktion === UPDATE_AKTION);
    expect(gesendet).toHaveLength(1);
    const n = gesendet[0] as {
      argumente: unknown;
      manifest: string;
      einrichtung: { einstellungen: { installation: unknown; auto: Record<string, string> } };
    };
    expect(n.argumente).toEqual({ [snapshotArgument("volume:daten")]: "4f2a9c1e".repeat(8) });
    expect(n.manifest).toContain("version: 1.3.0");
    expect(n.einrichtung.einstellungen.installation).toMatchObject({
      PROBE_TITEL: "Kanzlei",
      PROBE_KENNWORT: expect.any(String),
    });
    // the generated values are kept, the one the new version adds is made once
    expect(Object.keys(n.einrichtung.einstellungen.auto).sort()).toEqual([
      "PROBE_NEU",
      "PROBE_PASSWORT",
      "PROBE_SCHLUESSEL",
    ]);
    expect(n.einrichtung.einstellungen.auto.PROBE_NEU).toMatch(/^[0-9a-f]{64}$/);
    expect(updateStand(u.db, "b1", id).letzter?.phase).toBe("aktualisieren");
  });

  it("cancels the update when the backup fails: nothing reaches the agent", async () => {
    const { u, id } = await umgebung();
    const r = u.anlegen(id);
    if (!r.ok) throw new Error(r.grund);
    u.uhr.ms += 60_000;
    u.ergebnisMelden(r.backup.auftragId, { ok: false, fehler: "restic backup: exit 1" });
    expect(u.updateAuftraege(id).update?.zustand).toBe("abgebrochen");
    expect(u.agent.filter((n) => n.aktion === UPDATE_AKTION)).toEqual([]);
    expect(updateStand(u.db, "b1", id)).toMatchObject({
      laeuft: false,
      letzter: {
        phase: "abgebrochen",
        endeAm: u.uhr.ms,
        fehler: "Backup vor dem Update gescheitert: restic backup: exit 1",
      },
    });
    expect(installationLesen(u.db, "b1", id)?.version).toBe("1.0.3");
    expect(u.db.select().from(installationKonfigurationen).all()).toEqual([]);
  });

  it("cancels the update when the run has no snapshot of a part it plays back", async () => {
    const { u, id } = await umgebung();
    expect(u.anlegen(id).ok).toBe(true);
    u.gesichert(id, null);
    expect(u.updateAuftraege(id).update?.zustand).toBe("abgebrochen");
    expect(u.agent.filter((n) => n.aktion === UPDATE_AKTION)).toEqual([]);
    expect(updateStand(u.db, "b1", id).letzter).toMatchObject({
      phase: "abgebrochen",
      fehler: "Backup vor dem Update ohne Snapshot: the run has no snapshot of volume:daten",
    });
    expect(u.db.select().from(installationKonfigurationen).all()).toEqual([]);
  });
});
