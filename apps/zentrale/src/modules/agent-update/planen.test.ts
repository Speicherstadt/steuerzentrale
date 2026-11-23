import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_UPDATE_AKTION } from "@steuerzentrale/manifest";
import { VERSUCH_PAUSE_MS } from "@steuerzentrale/planung";
import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, auftraege, ereignisse } from "../../db/schema.ts";
import { auftragsUmgebung, neuerAuftrag } from "../../testhilfen/auftraege.ts";
import { schreiben } from "../audit/index.ts";
import { auftragAnlegen, auftragMelden } from "../auftraege/index.ts";
import { serverLesen } from "../server/index.ts";
import { AGENT_ARTEN } from "./ende.ts";
import { agentUpdatesPlanen } from "./planen.ts";

/*
 * BAULISTE.md Z-504, the Zentrale's side: an agent older than the release in the agent files gets
 * the job `agent_update` in its server's maintenance window, never beside another open job, and a
 * version that ended without the agent on it a day later at the earliest; a job that does not
 * succeed is an event of the server. Each operator's servers get their own jobs.
 */
const FIXTURES = join(import.meta.dirname, "../../../../../packages/manifest/test");
const SUMMEN = readFileSync(join(FIXTURES, "SHA256SUMS"), "utf8");
const SIGNATUR = readFileSync(join(FIXTURES, "SHA256SUMS.minisig"), "utf8");
const STAND = { version: "0.0.1", summen: SUMMEN, signatur: SIGNATUR };

// The window of the test servers: daily 03:00–04:00 Europe/Berlin
const IM_FENSTER = Date.UTC(2027, 0, 17, 2, 30); // 03:30 CET
const DANACH = Date.UTC(2027, 0, 17, 3, 30); // 04:30 CET

const umgebung = () => {
  const u = auftragsUmgebung();
  u.betreiber("b1", "s1");
  u.betreiber("b2", "s2");
  const beigetreten = (betreiberId: string, serverId: string, agentVersion = "0.0.0") =>
    schreiben(u.schreibDb, u.kontext(betreiberId), "test", (w) =>
      w.aendern(
        "server",
        { serverId },
        {
          beigetretenAm: u.uhr.ms,
          agentVersion,
          architektur: "amd64",
          wartungsfenster: JSON.stringify({
            tage: [0, 1, 2, 3, 4, 5, 6],
            von: "03:00",
            bis: "04:00",
          }),
        },
      ),
    );
  beigetreten("b1", "s1");
  const planen = (stand: typeof STAND | null = STAND) =>
    agentUpdatesPlanen({ ...u.deps, agentStand: async () => stand ?? undefined });
  const updates = (betreiberId: string) =>
    u.db
      .select()
      .from(auftraege)
      .where(and(eq(auftraege.betreiberId, betreiberId), eq(auftraege.aktion, AGENT_UPDATE_AKTION)))
      .all();
  const melden = (betreiberId: string, serverId: string, auftragId: string, ok: boolean) => {
    const server = serverLesen(u.db, betreiberId, serverId);
    if (!server) throw new Error("server");
    const ergebnis = ok
      ? { ok: true as const, daten: { version: "0.0.1", vorher: "0.0.0" } }
      : {
          ok: false as const,
          fehler: "abgelehnt: the signature of SHA256SUMS does not hold: signature does not match",
        };
    for (const n of [
      { typ: "bestaetigt" as const, protokoll: PROTOKOLL_VERSION, auftragId },
      { typ: "ergebnis" as const, protokoll: PROTOKOLL_VERSION, auftragId, zeit: 1, ergebnis },
    ])
      auftragMelden(u.deps, server, n, u.uhr.ms);
  };
  return { u, beigetreten, planen, updates, melden };
};

describe("the update of the agents", () => {
  it("sends an older agent the job in its server's window, with SHA256SUMS and its signature", async () => {
    const { u, planen, updates } = umgebung();
    const gesendet = u.verbinden("b1", "s1");
    u.uhr.ms = DANACH;
    expect(await planen()).toEqual({ angelegt: [] });
    u.uhr.ms = IM_FENSTER;
    expect(await planen()).toEqual({ angelegt: ["s1"] });
    expect(updates("b1")).toEqual([
      expect.objectContaining({
        serverId: "s1",
        installationId: null,
        app: "steuerzentrale-agent",
        version: "0.0.1",
        manifest: SUMMEN,
        signatur: SIGNATUR,
        argumente: JSON.stringify({ version: "0.0.1" }),
        angelegtVon: "system",
        zustand: "zugestellt",
      }),
    ]);
    expect(gesendet).toEqual([
      expect.objectContaining({
        typ: "auftrag",
        aktion: AGENT_UPDATE_AKTION,
        installationId: null,
        argumente: { version: "0.0.1" },
        manifest: SUMMEN,
        signatur: SIGNATUR,
      }),
    ]);
    const audit = u.db
      .select()
      .from(auditLog)
      .all()
      .find((e) => e.aktion === "auftrag.anlegen");
    expect(audit).toMatchObject({ aktion: "auftrag.anlegen", akteur: "system" });
    expect(audit?.grund).toBe("Update des Agenten von 0.0.0 auf 0.0.1");
    // open: no second one
    expect(await planen()).toEqual({ angelegt: [] });
  });

  it("leaves a current, a disconnected, a revoked agent and one beside an open job alone", async () => {
    const { u, beigetreten, planen } = umgebung();
    u.uhr.ms = IM_FENSTER;
    expect(await planen(), "not connected").toEqual({ angelegt: [] });
    u.verbinden("b1", "s1");
    expect(await planen(null), "no agent files").toEqual({ angelegt: [] });
    beigetreten("b1", "s1", "0.0.1");
    expect(await planen(), "current").toEqual({ angelegt: [] });
    beigetreten("b1", "s1", "0.0.0");
    auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1"));
    expect(await planen(), "open job").toEqual({ angelegt: [] });
    expect(u.log).toEqual([]);
  });

  it("makes each operator's job under that operator", async () => {
    const { u, beigetreten, planen, updates } = umgebung();
    beigetreten("b2", "s2");
    u.verbinden("b1", "s1");
    const b2 = u.verbinden("b2", "s2");
    u.uhr.ms = IM_FENSTER;
    expect((await planen()).angelegt.sort()).toEqual(["s1", "s2"]);
    expect(updates("b1").map((a) => a.serverId)).toEqual(["s1"]);
    expect(updates("b2").map((a) => a.serverId)).toEqual(["s2"]);
    expect(b2).toHaveLength(1);
  });

  it("writes an event when the agent refuses, and tries the version again a day later", async () => {
    const { u, planen, updates, melden } = umgebung();
    u.verbinden("b1", "s1");
    u.uhr.ms = IM_FENSTER;
    await planen();
    const [erster] = updates("b1");
    melden("b1", "s1", erster?.auftragId ?? "", false);
    expect(u.db.select().from(ereignisse).all()).toEqual([
      expect.objectContaining({
        betreiberId: "b1",
        art: AGENT_ARTEN.gescheitert,
        schwere: "fehler",
        ziel: "server:s1",
        text: expect.stringContaining("signature of SHA256SUMS does not hold"),
      }),
    ]);
    u.uhr.ms = IM_FENSTER + 10 * 60_000;
    expect(await planen()).toEqual({ angelegt: [] });
    u.uhr.ms = IM_FENSTER + VERSUCH_PAUSE_MS;
    expect(await planen()).toEqual({ angelegt: ["s1"] });
  });

  it("writes no event for a job that put the new agent in place: its hallo tells", async () => {
    const { u, planen, updates, melden } = umgebung();
    u.verbinden("b1", "s1");
    u.uhr.ms = IM_FENSTER;
    await planen();
    melden("b1", "s1", updates("b1")[0]?.auftragId ?? "", true);
    expect(updates("b1")[0]?.zustand).toBe("erfolgreich");
    expect(u.db.select().from(ereignisse).all()).toEqual([]);
  });
});

describe("the job's shape when it is made", () => {
  it("refuses an installation, an address and anything but SHA256SUMS", () => {
    const { u } = umgebung();
    const neu = (teil: Partial<Parameters<typeof neuerAuftrag>[1]>) =>
      auftragAnlegen(
        u.deps,
        u.kontext("b1"),
        neuerAuftrag("s1", {
          installationId: null,
          aktion: AGENT_UPDATE_AKTION,
          argumente: { version: "0.0.1" },
          manifest: SUMMEN,
          signatur: SIGNATUR,
          ...teil,
        }),
      );
    expect(neu({ installationId: "auftrag-k1" })).toMatchObject({ ok: false });
    expect(neu({ argumente: { version: "0.0.1", url: "https://boese.example" } })).toMatchObject({
      ok: false,
      grund: "argumente_ungueltig",
    });
    expect(neu({ manifest: "schema: 1\n" })).toMatchObject({ ok: false });
    expect(neu({})).toMatchObject({ ok: true });
  });
});
