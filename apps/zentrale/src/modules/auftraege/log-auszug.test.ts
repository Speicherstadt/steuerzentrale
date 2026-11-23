import { AKTIONS_AUFTRAEGE } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { auditLog, logAuszuege } from "../../db/schema.ts";
import { auftragsUmgebung, neuerAuftrag } from "../../testhilfen/auftraege.ts";
import type { Server } from "../server/index.ts";
import { auftragAnlegen } from "./anlegen.ts";
import { type LogAuszugNachricht, logAuszugAnnehmen, logAuszugLesen } from "./log-auszug.ts";

/*
 * BAULISTE.md Z-405 (docs/plan.md, "Log-Auszug", "Log-Auszüge der Aufträge"): the agent sends the
 * lines of a log excerpt with the job's id; the Zentrale keeps them in `log_auszuege` (30 days, the
 * retention run) only for a log job of the reporting server's operator and server, else it drops
 * them. The audit log records the excerpt, never its lines: they hold the customers' data.
 */

type U = ReturnType<typeof auftragsUmgebung>;

const ZEILE = "2026-11-20T12:00:00+0100 app[1]: Anmeldung von kim@kunde.test";

const server = (betreiberId: string, serverId: string) => ({ betreiberId, serverId }) as Server;

const auszug = (auftragId: string, zeilen = [ZEILE]): LogAuszugNachricht => ({
  typ: "log_auszug",
  protokoll: 1,
  auftragId,
  zeilen,
});

/** A log job of b1 for an installation on s1 */
const logAuftrag = (u: U, aktion: string = AKTIONS_AUFTRAEGE.log_auszug) => {
  const a = auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { aktion }));
  if (!a.ok) throw new Error(`${a.grund} ${a.detail ?? ""}`);
  return a.auftrag;
};

const umgebung = () => {
  const u = auftragsUmgebung();
  u.betreiber("b1", "s1", "s3");
  u.betreiber("b2", "s2");
  return u;
};

describe("a log excerpt from the agent", () => {
  it("is kept with its job, its lines in the table and not in the audit log", () => {
    const u = umgebung();
    const a = logAuftrag(u);
    expect(logAuszugAnnehmen(u.deps, server("b1", "s1"), auszug(a.auftragId), u.uhr.ms)).toEqual({
      ok: true,
    });
    expect(u.db.select().from(logAuszuege).all()).toEqual([
      {
        betreiberId: "b1",
        auszugId: a.auftragId,
        auftragId: a.auftragId,
        zeitpunkt: u.uhr.ms,
        inhalt: JSON.stringify([ZEILE]),
      },
    ]);
    expect(JSON.stringify(u.db.select().from(auditLog).all())).not.toContain("kim@kunde.test");
    expect(logAuszugLesen(u.db, "b1", "auftrag-k1", a.auftragId)).toMatchObject({
      auftrag: { auftragId: a.auftragId },
      zeilen: [ZEILE],
      zeitpunkt: u.uhr.ms,
    });
  });

  it("cuts each line to 2000 characters", () => {
    const u = umgebung();
    const a = logAuftrag(u);
    logAuszugAnnehmen(u.deps, server("b1", "s1"), auszug(a.auftragId, ["x".repeat(5000)]), 1);
    expect(logAuszugLesen(u.db, "b1", "auftrag-k1", a.auftragId)?.zeilen).toEqual([
      "x".repeat(2000),
    ]);
  });

  it.each([
    ["of another operator's server", () => server("b2", "s2"), "not a log job of this server"],
    ["of another server of the operator", () => server("b1", "s3"), "not a log job of this server"],
  ])("is dropped from an agent %s", (_fall, von, grund) => {
    const u = umgebung();
    const a = logAuftrag(u);
    expect(logAuszugAnnehmen(u.deps, von(), auszug(a.auftragId), u.uhr.ms)).toEqual({
      ok: false,
      grund,
    });
    expect(u.db.select().from(logAuszuege).all()).toEqual([]);
  });

  it("is dropped for a job that is no log excerpt, an unknown one, or a second time", () => {
    const u = umgebung();
    const anderer = logAuftrag(u, "migrieren");
    const s = server("b1", "s1");
    expect(logAuszugAnnehmen(u.deps, s, auszug(anderer.auftragId), 1).ok).toBe(false);
    expect(logAuszugAnnehmen(u.deps, s, auszug("gibt-es-nicht"), 1).ok).toBe(false);
    const a = logAuftrag(u);
    expect(logAuszugAnnehmen(u.deps, s, auszug(a.auftragId), 1).ok).toBe(true);
    expect(logAuszugAnnehmen(u.deps, s, auszug(a.auftragId, ["neu"]), 2)).toEqual({
      ok: false,
      grund: "already kept",
    });
    expect(u.db.select().from(logAuszuege).all()).toHaveLength(1);
  });

  it("is read only within its operator and installation", () => {
    const u = umgebung();
    const a = logAuftrag(u);
    logAuszugAnnehmen(u.deps, server("b1", "s1"), auszug(a.auftragId), 1);
    expect(logAuszugLesen(u.db, "b2", "auftrag-k1", a.auftragId)).toBeUndefined();
    expect(logAuszugLesen(u.db, "b1", "andere-k1", a.auftragId)).toBeUndefined();
    const anderer = logAuftrag(u, "migrieren");
    expect(logAuszugLesen(u.db, "b1", "auftrag-k1", anderer.auftragId)).toBeUndefined();
  });

  it("is read as missing until the agent sent it", () => {
    const u = umgebung();
    const a = logAuftrag(u);
    expect(logAuszugLesen(u.db, "b1", "auftrag-k1", a.auftragId)).toMatchObject({
      zeilen: null,
      zeitpunkt: null,
    });
  });
});
