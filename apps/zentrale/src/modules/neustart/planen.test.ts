import {
  BACKUP_AKTIONEN,
  KEIN_MANIFEST,
  PFORTE_AKTIONEN,
  SERVER_NEUSTART_AKTION,
} from "@steuerzentrale/manifest";
import { NEUSTART_PAUSE_MS } from "@steuerzentrale/planung";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog } from "../../db/schema.ts";
import { minioNachbau } from "../../testhilfen/minio.ts";
import {
  BOOT,
  IM_FENSTER,
  IN_SPERRZEIT,
  NACH_FENSTER,
  NEUER_BOOT,
  neustartUmgebung,
} from "../../testhilfen/neustart.ts";
import { serverLesen } from "../server/index.ts";
import { NEUSTART_ARTEN } from "./ende.ts";
import { neustartStand } from "./lage.ts";

/*
 * BAULISTE.md Z-701 in the Zentrale (docs/plan.md, "Wann ein Server neu startet", "Backup vor dem
 * Neustart", "Neustart beim Zustellen"): a server whose facts ask for a reboot gets one in its
 * maintenance window, outside every freeze window of its apps, beside no open job, at most once a
 * day, after a backup of each running installation; a reboot is done once its agent reports the new
 * boot, and one whose time passed while its backups ran is cancelled.
 */

const minio = minioNachbau();
afterAll(() => minio.stoppen());

describe("the planning of reboots", () => {
  it("makes the reboot of the facts' boot in the server's window and sends it", () => {
    const u = neustartUmgebung(minio);
    u.uhr.ms = NACH_FENSTER;
    expect(u.planen()).toEqual({ angelegt: [], abgebrochen: [] });
    u.uhr.ms = IM_FENSTER;
    const vorher = u.agent.length;
    expect(u.planen()).toEqual({ angelegt: ["s1"], abgebrochen: [] });
    expect(u.neustarts()).toEqual([
      expect.objectContaining({
        serverId: "s1",
        installationId: null,
        app: "betriebssystem",
        version: "-",
        manifest: KEIN_MANIFEST,
        signatur: KEIN_MANIFEST,
        argumente: JSON.stringify({ bootId: BOOT }),
        angelegtVon: "system",
        zustand: "zugestellt",
        wartetAuf: "[]",
      }),
    ]);
    expect(u.agent.slice(vorher)).toEqual([
      expect.objectContaining({
        typ: "auftrag",
        aktion: SERVER_NEUSTART_AKTION,
        argumente: { bootId: BOOT },
        manifest: KEIN_MANIFEST,
      }),
    ]);
    const audit = u.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.aktion === "server.neustart");
    expect(audit[0]).toMatchObject({ akteur: "system" });
    expect(audit[0]?.grund).toBe("Neustart nötig: Kernel 6.12.0-2-amd64 installiert, 6.12.0-1-amd64 läuft");
    // open: no second one
    expect(u.planen().angelegt).toEqual([]);
  });

  it("postpones the reboot while a freeze window of an app on the server runs", () => {
    const u = neustartUmgebung(minio);
    const id = u.laufend("gesperrt");
    u.melden(u.auftrag(id, PFORTE_AKTIONEN.setzen)?.auftragId ?? "", true);
    u.uhr.ms = IN_SPERRZEIT;
    const sv = serverLesen(u.db, "b1", "s1");
    if (!sv) throw new Error("server");
    expect(neustartStand(u.db, () => true, sv, u.uhr.ms).plan).toEqual({
      art: "warten",
      grund: "sperrzeit",
      ab: Date.UTC(2027, 1, 13, 2, 0),
    });
    expect(u.planen().angelegt).toEqual([]);
    expect(u.neustarts()).toEqual([]);
    // by hand neither, not even for the owner
    expect(u.vonHand()).toEqual({
      ok: false,
      grund: "sperrzeit",
      detail: "Umsatzsteuer-Voranmeldung",
    });
    // the 13th is free again
    u.uhr.ms = IN_SPERRZEIT + 5 * 24 * 3600_000;
    expect(u.planen().angelegt).toEqual(["s1"]);
  });

  it("does nothing for a server that needs no reboot or has a job open", () => {
    const u = neustartUmgebung(minio);
    u.uhr.ms = IM_FENSTER;
    u.fakten("b1", "s1", { neustartNoetig: false });
    expect(u.planen().angelegt).toEqual([]);
    u.fakten("b1", "s1", { bootId: null });
    expect(u.planen().angelegt).toEqual([]);
    u.fakten("b1", "s1");
    // the route of a new installation is still open
    u.laufend("probe");
    expect(u.planen().angelegt).toEqual([]);
    expect(u.neustarts()).toEqual([]);
  });

  it("waits for a disconnected agent", () => {
    const u = neustartUmgebung(minio);
    u.uhr.ms = IM_FENSTER;
    u.deps.verbindungen.trennen("b1", "s1", 4000, "test");
    expect(u.planen().angelegt).toEqual([]);
  });

  it("backs up each running installation first and reboots once all succeeded", async () => {
    const u = neustartUmgebung(minio);
    const a = await u.eingerichtet();
    const b = await u.eingerichtet();
    u.uhr.ms = IM_FENSTER;
    expect(u.planen().angelegt).toEqual(["s1"]);
    const backupA = u.auftrag(a, BACKUP_AKTIONEN.jetzt);
    const backupB = u.auftrag(b, BACKUP_AKTIONEN.jetzt);
    const [neustart] = u.neustarts();
    expect(backupA).toMatchObject({ zustand: "zugestellt", angelegtVon: "system" });
    expect(neustart).toMatchObject({
      zustand: "wartend",
      wartetAuf: JSON.stringify([backupA?.auftragId, backupB?.auftragId]),
    });
    u.melden(backupA?.auftragId ?? "", true);
    expect(u.neustarts()[0]?.zustand).toBe("wartend");
    u.melden(backupB?.auftragId ?? "", true);
    expect(u.neustarts()[0]?.zustand).toBe("zugestellt");
  });

  it("reboots no server when a backup before fails, and says why", async () => {
    const u = neustartUmgebung(minio);
    const a = await u.eingerichtet();
    u.uhr.ms = IM_FENSTER;
    u.planen();
    u.melden(u.auftrag(a, BACKUP_AKTIONEN.jetzt)?.auftragId ?? "", false);
    expect(u.neustarts()[0]?.zustand).toBe("abgebrochen");
    expect(u.ereignisseVon()).toEqual([
      expect.objectContaining({
        art: NEUSTART_ARTEN.abgebrochen,
        schwere: "warn",
        text: `Neustart des Servers abgebrochen: das Backup von ${a} davor ging nicht`,
      }),
    ]);
    // tried today: the next attempt a day later
    expect(u.planen().angelegt).toEqual([]);
    u.uhr.ms += NEUSTART_PAUSE_MS;
    expect(u.planen().angelegt).toEqual(["s1"]);
  });

  it("waits for the backups of a running installation to be set up", () => {
    const u = neustartUmgebung(minio);
    const id = u.laufend();
    u.melden(u.auftrag(id, "pforte_route_setzen")?.auftragId ?? "", true);
    u.uhr.ms = IM_FENSTER;
    expect(u.planen().angelegt).toEqual([]);
    expect(u.vonHand()).toMatchObject({ ok: false, grund: "backup_fehlt" });
  });

  it("cancels a reboot whose backups ran past the window, instead of sending it later", async () => {
    const u = neustartUmgebung(minio);
    const a = await u.eingerichtet();
    u.uhr.ms = IM_FENSTER;
    u.planen();
    u.uhr.ms = NACH_FENSTER;
    const vorher = u.agent.length;
    u.melden(u.auftrag(a, BACKUP_AKTIONEN.jetzt)?.auftragId ?? "", true);
    expect(u.neustarts()[0]?.zustand).toBe("bereit");
    expect(u.agent.slice(vorher).filter((n) => n.aktion === SERVER_NEUSTART_AKTION)).toEqual([]);
    const [neustart] = u.neustarts();
    expect(u.planen()).toEqual({ angelegt: [], abgebrochen: [neustart?.auftragId] });
    expect(u.neustarts()[0]).toMatchObject({ zustand: "abgebrochen" });
    expect(u.ereignisseVon().at(-1)).toMatchObject({
      art: NEUSTART_ARTEN.abgebrochen,
      text: "Neustart des Servers abgebrochen: das Wartungsfenster endete vor den Backups",
    });
  });

  it("is done when the agent reports the new boot, and failed when it does not", () => {
    const u = neustartUmgebung(minio);
    u.uhr.ms = IM_FENSTER;
    u.planen();
    const [erster] = u.neustarts();
    u.neustartMelden(erster?.auftragId ?? "", true);
    expect(u.neustarts()[0]).toMatchObject({ zustand: "erfolgreich" });
    expect(u.ereignisseVon()).toEqual([
      expect.objectContaining({
        art: NEUSTART_ARTEN.erfolgreich,
        schwere: "info",
        text: `Server neu gestartet (Boot ${NEUER_BOOT})`,
      }),
    ]);
    // the facts still ask for one (a kernel the boot loader does not pick): not again today
    u.uhr.ms += 60_000;
    expect(u.planen().angelegt).toEqual([]);
    u.uhr.ms = IM_FENSTER + NEUSTART_PAUSE_MS;
    expect(u.planen().angelegt).toEqual(["s1"]);
    const zweiter = u.neustarts().at(-1);
    u.neustartMelden(zweiter?.auftragId ?? "", false);
    expect(u.ereignisseVon().at(-1)).toMatchObject({
      art: NEUSTART_ARTEN.gescheitert,
      schwere: "fehler",
      text: "Neustart des Servers gescheitert: Neustart nicht erfolgt: Agent neu gestartet",
    });
  });

  it("plans each operator's servers on their own", () => {
    const u = neustartUmgebung(minio);
    u.betreiber("b2", "s2");
    u.fakten("b2", "s2");
    u.beitreten("b2", "s2");
    u.uhr.ms = IM_FENSTER;
    // b2's agent is not connected: only b1's server is rebooted
    expect(u.planen().angelegt).toEqual(["s1"]);
    expect(u.neustarts("b2")).toEqual([]);
    u.verbinden("b2", "s2");
    expect(u.planen().angelegt).toEqual(["s2"]);
    expect(u.neustarts("b2")).toEqual([expect.objectContaining({ betreiberId: "b2", serverId: "s2" })]);
    expect(u.neustarts("b1")).toHaveLength(1);
  });
});
