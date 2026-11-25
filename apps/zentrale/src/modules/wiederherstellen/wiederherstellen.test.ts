import {
  BACKUP_AKTIONEN,
  snapshotArgument,
  WIEDERHERSTELLEN_AKTION,
} from "@steuerzentrale/manifest";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, auftraege, backups, ereignisse } from "../../db/schema.ts";
import { neueInstallation, TEST_SCHLUESSEL } from "../../testhilfen/installationen.ts";
import { minioNachbau } from "../../testhilfen/minio.ts";
import { SNAPSHOT } from "../../testhilfen/pruef-restore.ts";
import { wiederherstellenUmgebung } from "../../testhilfen/wiederherstellen.ts";
import { backupAbgleichen, backupJetzt, backupStandAnnehmen } from "../backups/index.ts";
import { installationAnlegen } from "../installationen/anlegen.ts";
import type { Server } from "../server/index.ts";
import { wiederherstellenAnlegen } from "./anlegen.ts";
import { WIEDERHERSTELLEN_GELUNGEN_ART, WIEDERHERSTELLEN_GESCHEITERT_ART } from "./ende.ts";
import { wiederherstellenStand } from "./lesen.ts";

/*
 * BAULISTE.md Z-603 in the Zentrale (docs/plan.md, "Wiederherstellen (Z-603)"): a successful run of
 * this installation and operator only; first a backup of the current state, then the restore with
 * the run's snapshots, waiting for it and cancelled when it fails; the result kept, a failed one an
 * event, everything in the audit log with the reason.
 */

const minio = minioNachbau();
afterAll(() => minio.stoppen());

const GRUND = "Auftrag des Kunden vom 20.11.";

const umgebung = async () => {
  const u = wiederherstellenUmgebung(minio);
  const id = await u.gesichert();
  const lauf = u.laufId(id);
  const kontext = () => ({ ...u.kontext("b1"), jetzt: u.uhr.ms, grund: GRUND });
  const anlegen = (laufId = lauf, installationId = id) =>
    wiederherstellenAnlegen(u.deps, kontext(), installationId, laufId);
  return { u, id, lauf, anlegen };
};

const alleAuftraege = (u: Awaited<ReturnType<typeof umgebung>>["u"]) =>
  u.db.select().from(auftraege).all();

describe("making a restore", () => {
  it("backs up the current state first, then restores the run's snapshots after it", async () => {
    const { u, id, lauf, anlegen } = await umgebung();
    const vorher = u.agent.length;
    const r = anlegen();
    if (!r.ok) throw new Error(r.grund);
    const { backup, wiederherstellen } = u.auftraegeVon(id);
    expect(backup).toMatchObject({ auftragId: r.backup.auftragId, zustand: "zugestellt" });
    expect(wiederherstellen).toMatchObject({
      auftragId: r.wiederherstellen.auftragId,
      zustand: "wartend",
      wartetAuf: JSON.stringify([r.backup.auftragId]),
    });
    expect(JSON.parse(wiederherstellen?.argumente ?? "")).toEqual({
      [snapshotArgument("volume:daten")]: SNAPSHOT,
    });
    // only the backup went to the agent; the restore waits for it
    expect(u.agent.slice(vorher).map((n) => n.aktion)).toEqual([BACKUP_AKTIONEN.jetzt]);
    const zeitpunkt = u.db
      .select()
      .from(backups)
      .all()
      .find((b) => b.backupId === lauf)?.zeitpunkt;
    expect(wiederherstellenStand(u.db, "b1", id)).toEqual({
      laeuft: true,
      letzter: {
        angefordertAm: u.uhr.ms,
        laufZeitpunkt: zeitpunkt,
        phase: "sichern",
        endeAm: null,
        fehler: null,
        teile: [],
        dauerMs: null,
      },
    });
  });

  it("writes both jobs and the restore to the audit log with who and why", async () => {
    const { u, anlegen } = await umgebung();
    const vorher = u.db.select().from(auditLog).all().length;
    expect(anlegen().ok).toBe(true);
    const neu = u.db.select().from(auditLog).all().slice(vorher);
    expect(neu.map((e) => [e.aktion, e.ziel.split(":")[0]])).toEqual([
      ["installation.wiederherstellen", "auftraege"],
      ["installation.wiederherstellen", "auftraege"],
      ["installation.wiederherstellen", "wiederherstellungen"],
      ["auftrag.zugestellt", "auftraege"],
    ]);
    for (const e of neu.slice(0, 3)) expect(e).toMatchObject({ akteur: "nutzer-1", grund: GRUND });
  });

  it("refuses a run of another installation and writes nothing", async () => {
    const { u, id, anlegen } = await umgebung();
    const andere = await u.gesichert();
    const fremd = u.laufId(andere);
    const vorher = alleAuftraege(u).length;
    expect(anlegen(fremd, id)).toEqual({ ok: false, grund: "lauf_unbekannt" });
    expect(anlegen("backup-gibt-es-nicht", id)).toEqual({ ok: false, grund: "lauf_unbekannt" });
    expect(alleAuftraege(u).length).toBe(vorher);
  });

  it("refuses a run of another operator, though its id is known", async () => {
    const { u, id, anlegen } = await umgebung();
    u.bereit("b2");
    const andere = u.laufend("gesichert", {}, "b2");
    backupStandAnnehmen(
      u.deps,
      { betreiberId: "b2", serverId: "s1" } as Server,
      {
        typ: "backup_stand",
        protokoll: 1,
        installationId: andere,
        lauf: "fremd",
        beginn: u.uhr.ms - 1000,
        ende: u.uhr.ms,
        ok: true,
        teile: [{ tag: "volume:daten", ok: true, snapshot: "ab".repeat(32) }],
      },
      u.uhr.ms,
    );
    const fremd = u.db
      .select()
      .from(backups)
      .all()
      .find((b) => b.betreiberId === "b2");
    const vorher = alleAuftraege(u).length;
    expect(anlegen(fremd?.backupId ?? "", id)).toEqual({ ok: false, grund: "lauf_unbekannt" });
    // nor does the other operator's installation exist for this one
    expect(anlegen(fremd?.backupId ?? "", andere)).toEqual({
      ok: false,
      grund: "keine_installation",
    });
    expect(alleAuftraege(u).length).toBe(vorher);
  });

  it("refuses a failed run", async () => {
    const { u, id, anlegen } = await umgebung();
    const gescheitert = u.laufId(id, false);
    expect(anlegen(gescheitert)).toEqual({ ok: false, grund: "lauf_gescheitert" });
    expect(u.auftraegeVon(id).wiederherstellen).toBeUndefined();
  });

  it("takes no reason (Z-1207), refuses beside an open job and for an installation not running", async () => {
    const { u, id, lauf, anlegen } = await umgebung();
    const ohneGrund = { ...u.kontext("b1"), grund: "" };
    expect(wiederherstellenAnlegen(u.deps, ohneGrund, id, lauf).ok).toBe(true);
    expect(anlegen()).toEqual({ ok: false, grund: "auftrag_offen" });
    const ohneLauf = await u.eingerichtet();
    expect(anlegen(lauf, ohneLauf)).toEqual({ ok: false, grund: "lauf_unbekannt" });
    expect(anlegen(lauf, u.laufend())).toEqual({ ok: false, grund: "nicht_eingerichtet" });
    const neu = installationAnlegen(u.deps, u.kontext("b1"), TEST_SCHLUESSEL, {
      ...neueInstallation({ host: "neu.kunde.example", ...u.manifest("gesichert") }),
    });
    if (!neu.ok) throw new Error(neu.grund);
    expect(anlegen(lauf, neu.installation.installationId)).toEqual({
      ok: false,
      grund: "laeuft_nicht",
    });
    expect(anlegen(lauf, "gibt-es-nicht")).toEqual({ ok: false, grund: "keine_installation" });
  });

  it('keeps "Backup jetzt" back while the restore is open, also once its backup is done', async () => {
    const { u, id, anlegen } = await umgebung();
    const r = anlegen();
    if (!r.ok) throw new Error(r.grund);
    const jetzt = () => backupJetzt(u.deps, { ...u.kontext("b1"), grund: GRUND }, id);
    expect(jetzt()).toMatchObject({ ok: false });
    u.ergebnisMelden(r.backup.auftragId, { ok: true, daten: {} });
    expect(jetzt()).toEqual({ ok: false, grund: "auftrag_offen" });
    u.ergebnisMelden(r.wiederherstellen.auftragId, { ok: true, daten: {} });
    expect(jetzt().ok).toBe(true);
  });

  it("is allowed in a freeze window: the backup goes out at once", async () => {
    const u = wiederherstellenUmgebung(minio);
    // the 8th of a month, inside the manifest's window from the 7th to the 12th
    u.uhr.ms = Date.UTC(2027, 1, 8, 10, 0, 0);
    u.zielSetzen();
    const id = u.laufend("gesichert-gesperrt");
    u.melden(u.auftrag(id, "pforte_route_setzen")?.auftragId ?? "", true);
    await backupAbgleichen({ ...u.deps, fetch });
    u.melden(u.auftrag(id, BACKUP_AKTIONEN.einrichten)?.auftragId ?? "", true);
    const lauf = u.laufId(id);
    const r = wiederherstellenAnlegen(u.deps, { ...u.kontext("b1"), grund: GRUND }, id, lauf);
    expect(r.ok).toBe(true);
    expect(u.auftraegeVon(id).backup?.zustand).toBe("zugestellt");
  });
});

describe("the end of a restore", () => {
  it("restores nothing when the backup fails: the restore is cancelled, with an event", async () => {
    const { u, id, anlegen } = await umgebung();
    const r = anlegen();
    if (!r.ok) throw new Error(r.grund);
    const vorher = u.agent.length;
    u.uhr.ms += 60_000;
    u.ergebnisMelden(r.backup.auftragId, { ok: false, fehler: "restic backup: exit 1" });
    expect(u.auftraegeVon(id).wiederherstellen?.zustand).toBe("abgebrochen");
    expect(u.agent.slice(vorher).filter((n) => n.aktion === WIEDERHERSTELLEN_AKTION)).toEqual([]);
    expect(wiederherstellenStand(u.db, "b1", id)).toMatchObject({
      laeuft: false,
      letzter: {
        phase: "gescheitert",
        endeAm: u.uhr.ms,
        fehler: "Backup vom Ist-Zustand gescheitert: restic backup: exit 1",
      },
    });
    expect(u.db.select().from(ereignisse).all()).toEqual([
      expect.objectContaining({
        ereignisId: `wiederherstellen-${r.wiederherstellen.auftragId}`,
        art: WIEDERHERSTELLEN_GESCHEITERT_ART,
        schwere: "fehler",
        ziel: `installation:${id}`,
        text: `Wiederherstellen von ${id} gescheitert: Backup vom Ist-Zustand gescheitert: restic backup: exit 1`,
      }),
    ]);
  });

  it("sends the restore once the backup succeeded and keeps its result", async () => {
    const { u, id, anlegen } = await umgebung();
    const r = anlegen();
    if (!r.ok) throw new Error(r.grund);
    u.ergebnisMelden(r.backup.auftragId, { ok: true, daten: {} });
    expect(u.auftraegeVon(id).wiederherstellen?.zustand).toBe("zugestellt");
    const gesendet = u.agent.filter((n) => n.aktion === WIEDERHERSTELLEN_AKTION);
    expect(gesendet).toEqual([
      expect.objectContaining({
        auftragId: r.wiederherstellen.auftragId,
        installationId: id,
        argumente: { [snapshotArgument("volume:daten")]: SNAPSHOT },
      }),
    ]);
    expect(gesendet[0] && ("backup" in gesendet[0] || "einrichtung" in gesendet[0])).toBe(false);
    expect(wiederherstellenStand(u.db, "b1", id).letzter?.phase).toBe("zurueckspielen");
    u.uhr.ms += 120_000;
    const teile = [
      { tag: "volume:daten", snapshot: SNAPSHOT, zurueckgespielt: true },
      { tag: "befehl:sichern", zurueckgespielt: false, grund: "ein Export ist kein Restore" },
    ];
    u.ergebnisMelden(r.wiederherstellen.auftragId, {
      ok: true,
      daten: { teile, dauerMs: 95_000 },
    });
    expect(wiederherstellenStand(u.db, "b1", id)).toMatchObject({
      laeuft: false,
      letzter: {
        phase: "gelungen",
        endeAm: u.uhr.ms,
        fehler: null,
        teile: [
          { ...teile[0], grund: null },
          { ...teile[1], snapshot: null },
        ],
        dauerMs: 95_000,
      },
    });
    // in the installation's events and in the audit log
    expect(u.db.select().from(ereignisse).all()).toEqual([
      expect.objectContaining({
        art: WIEDERHERSTELLEN_GELUNGEN_ART,
        schwere: "info",
        ziel: `installation:${id}`,
      }),
    ]);
    const audit = u.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.ziel === `wiederherstellungen:${r.wiederherstellen.auftragId}`);
    expect(audit.at(-1)).toMatchObject({ akteur: "server:s1" });
    expect(JSON.parse(audit.at(-1)?.inhalt ?? "{}")).toMatchObject({
      art: "aendern",
      werte: { ok: true, endeAm: u.uhr.ms },
    });
  });

  it("makes an event when the restore failed", async () => {
    const { u, id, anlegen } = await umgebung();
    const r = anlegen();
    if (!r.ok) throw new Error(r.grund);
    u.ergebnisMelden(r.backup.auftragId, { ok: true, daten: {} });
    u.ergebnisMelden(r.wiederherstellen.auftragId, {
      ok: false,
      fehler: "Wiederherstellen gescheitert: Health blieb rot",
    });
    expect(wiederherstellenStand(u.db, "b1", id).letzter).toMatchObject({
      phase: "gescheitert",
      fehler: "Wiederherstellen gescheitert: Health blieb rot",
    });
    expect(u.db.select().from(ereignisse).all()).toEqual([
      expect.objectContaining({
        art: WIEDERHERSTELLEN_GESCHEITERT_ART,
        schwere: "fehler",
        text: `Wiederherstellen von ${id} gescheitert: Wiederherstellen gescheitert: Health blieb rot`,
      }),
    ]);
  });
});
