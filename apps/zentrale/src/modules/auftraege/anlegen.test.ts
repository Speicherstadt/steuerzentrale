import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { auditLog, auftraege } from "../../db/schema.ts";
import { auftragsUmgebung, MANIFEST, neuerAuftrag } from "../../testhilfen/auftraege.ts";
import { schreiben } from "../audit/index.ts";
import { zyklusIn } from "./abhaengigkeiten.ts";
import { auftragAnlegen } from "./anlegen.ts";
import { type AuftragsMeldung, auftragMelden } from "./melden.ts";
import { offeneZustellen } from "./zustellen.ts";

/*
 * BAULISTE.md Z-305: the Zentrale's queue. A job names a command of a manifest with arguments that
 * fit it; it waits for its predecessors, also on other servers of its operator, and goes to its
 * agent once it is ready and the agent is connected.
 */

const ergebnis = (auftragId: string, ok: boolean): AuftragsMeldung => ({
  typ: "ergebnis",
  protokoll: 1,
  auftragId,
  zeit: 1,
  ergebnis: ok ? { ok: true, daten: {} } : { ok: false, fehler: "exit 1" },
});

const zeile = (u: ReturnType<typeof auftragsUmgebung>, auftragId: string) =>
  u.db
    .select()
    .from(auftraege)
    .all()
    .find((a) => a.auftragId === auftragId);

describe("a new job", () => {
  it("is ready, goes to the connected agent at once and stands in the audit log without its manifest", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1");
    const agent = u.verbinden("b1", "s1");
    const angelegt = auftragAnlegen(
      u.deps,
      u.kontext("b1"),
      neuerAuftrag("s1", { auftragId: "a1" }),
    );
    expect(angelegt).toMatchObject({
      ok: true,
      auftrag: {
        auftragId: "a1",
        zustand: "zugestellt",
        app: "auftrag",
        version: "1.0.0",
        manifestHash: createHash("sha256").update(MANIFEST).digest("hex"),
        zeitlimitS: 900,
        wartetAuf: "[]",
      },
    });
    expect(agent).toEqual([
      expect.objectContaining({
        typ: "auftrag",
        auftragId: "a1",
        installationId: "auftrag-k1",
        aktion: "migrieren",
        argumente: {},
        manifest: MANIFEST,
        zeitlimitS: 900,
      }),
    ]);
    const eintraege = u.db
      .select()
      .from(auditLog)
      .all()
      .filter((e) => e.ziel === "auftraege:a1");
    expect(eintraege.map((e) => e.aktion)).toEqual(["auftrag.anlegen", "auftrag.zugestellt"]);
    const inhalt = JSON.parse(eintraege[0]?.inhalt ?? "{}");
    expect(inhalt.zeile).toMatchObject({ manifest: "[ausgelassen]", signatur: "[ausgelassen]" });
  });

  it("takes the time limit of its command from the manifest", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1");
    const angelegt = auftragAnlegen(
      u.deps,
      u.kontext("b1"),
      neuerAuftrag("s1", { aktion: "langsam" }),
    );
    expect(angelegt).toMatchObject({ ok: true, auftrag: { zeitlimitS: 1, zustand: "bereit" } });
  });

  it("waits while its agent is away and goes out when the agent connects", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1");
    auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { auftragId: "a1" }));
    expect(zeile(u, "a1")?.zustand).toBe("bereit");
    const agent = u.verbinden("b1", "s1");
    offeneZustellen(u.deps, "b1", "s1");
    expect(agent.map((n) => n.auftragId)).toEqual(["a1"]);
    expect(zeile(u, "a1")?.zustand).toBe("zugestellt");
    // a reconnect sends it again: the agent answers from its record, it runs once
    offeneZustellen(u.deps, "b1", "s1");
    expect(agent.map((n) => n.auftragId)).toEqual(["a1", "a1"]);
  });

  it.each([
    [{ aktion: "neustart" }, "aktion_unbekannt"],
    [{ aktion: "wiederherstellen", argumente: { snapshot: "x; rm -rf /" } }, "argumente_ungueltig"],
    [{ aktion: "wiederherstellen", argumente: {} }, "argumente_ungueltig"],
    [{ argumente: { mehr: 1 } }, "argumente_ungueltig"],
    [{ manifest: `${MANIFEST}\nunbekannt: 1\n` }, "manifest_ungueltig"],
    [{ installationId: null }, "installation_fehlt"],
    [{ installationId: "--privileged" }, "installation_fehlt"],
    [{ serverId: "s9" }, "server_unbekannt"],
  ])("is refused for %j: %s, and nothing is written", (teil, grund) => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1");
    expect(auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", teil))).toMatchObject({
      ok: false,
      grund,
    });
    expect(u.db.select().from(auftraege).all()).toEqual([]);
  });

  it("is refused for a revoked server and with an id already taken", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1", "s2");
    schreiben(u.schreibDb, u.kontext("b1"), "test", (w) =>
      w.aendern("server", { serverId: "s2" }, { gesperrtAm: 1 }),
    );
    expect(auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s2"))).toMatchObject({
      grund: "server_gesperrt",
    });
    auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { auftragId: "a1" }));
    expect(
      auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { auftragId: "a1" })),
    ).toMatchObject({ grund: "auftrag_vorhanden" });
  });

  it("is refused when it could never go out to its agent, instead of staying ready for ever", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1");
    const agent = u.verbinden("b1", "s1");
    // the protocol takes ids of at most 200 characters (packages/protokoll, `auftrag`)
    const angelegt = auftragAnlegen(
      u.deps,
      u.kontext("b1"),
      neuerAuftrag("s1", { auftragId: "a".repeat(201) }),
    );
    expect(angelegt).toMatchObject({ ok: false, grund: "nachricht_ungueltig" });
    expect(u.db.select().from(auftraege).all()).toEqual([]);
    expect(agent).toEqual([]);
  });
});

describe("a waiting job", () => {
  it("starts only after its predecessor on another server succeeded", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1", "s2");
    const agent1 = u.verbinden("b1", "s1");
    const agent2 = u.verbinden("b1", "s2");
    auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { auftragId: "oidc" }));
    const b = auftragAnlegen(
      u.deps,
      u.kontext("b1"),
      neuerAuftrag("s2", { auftragId: "app", installationId: "app-k1", wartetAuf: ["oidc"] }),
    );
    expect(b).toMatchObject({ ok: true, auftrag: { zustand: "wartend", wartetAuf: '["oidc"]' } });
    expect(agent2).toEqual([]);
    // the agent of s2 connecting again does not get it either
    offeneZustellen(u.deps, "b1", "s2");
    expect(agent2).toEqual([]);
    const server1 = { betreiberId: "b1", serverId: "s1" } as never;
    auftragMelden(u.deps, server1, { typ: "bestaetigt", protokoll: 1, auftragId: "oidc" }, 2);
    expect(agent2).toEqual([]);
    auftragMelden(u.deps, server1, ergebnis("oidc", true), 3);
    expect(agent1.map((n) => n.auftragId)).toEqual(["oidc"]);
    expect(agent2.map((n) => n.auftragId)).toEqual(["app"]);
    expect(zeile(u, "app")?.zustand).toBe("zugestellt");
  });

  it("waits for all of its predecessors", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1");
    const server = { betreiberId: "b1", serverId: "s1" } as never;
    for (const id of ["a", "b"])
      auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { auftragId: id }));
    auftragAnlegen(
      u.deps,
      u.kontext("b1"),
      neuerAuftrag("s1", { auftragId: "c", wartetAuf: ["a", "b"] }),
    );
    u.verbinden("b1", "s1");
    offeneZustellen(u.deps, "b1", "s1");
    auftragMelden(u.deps, server, ergebnis("a", true), 2);
    expect(zeile(u, "c")?.zustand).toBe("wartend");
    auftragMelden(u.deps, server, ergebnis("b", true), 3);
    expect(zeile(u, "c")?.zustand).toBe("zugestellt");
  });

  it("is cancelled when its predecessor fails, and so are the jobs waiting for it", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1", "s2");
    const agent2 = u.verbinden("b1", "s2");
    u.verbinden("b1", "s1");
    auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { auftragId: "a" }));
    auftragAnlegen(
      u.deps,
      u.kontext("b1"),
      neuerAuftrag("s2", { auftragId: "b", wartetAuf: ["a"] }),
    );
    auftragAnlegen(
      u.deps,
      u.kontext("b1"),
      neuerAuftrag("s2", { auftragId: "c", wartetAuf: ["b"] }),
    );
    auftragMelden(u.deps, { betreiberId: "b1", serverId: "s1" } as never, ergebnis("a", false), 2);
    expect([zeile(u, "a")?.zustand, zeile(u, "b")?.zustand, zeile(u, "c")?.zustand]).toEqual([
      "gescheitert",
      "abgebrochen",
      "abgebrochen",
    ]);
    expect(JSON.parse(zeile(u, "c")?.ergebnis ?? "{}")).toEqual({
      ok: false,
      fehler: "Vorgänger b abgebrochen",
    });
    expect(agent2).toEqual([]);
  });

  it("made after its predecessor ended starts ready or cancelled at once", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1");
    u.verbinden("b1", "s1");
    const server = { betreiberId: "b1", serverId: "s1" } as never;
    auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { auftragId: "gut" }));
    auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { auftragId: "schlecht" }));
    auftragMelden(u.deps, server, ergebnis("gut", true), 2);
    auftragMelden(u.deps, server, ergebnis("schlecht", false), 2);
    const nach = (id: string) =>
      auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { wartetAuf: [id] }));
    expect(nach("gut")).toMatchObject({ auftrag: { zustand: "zugestellt" } });
    expect(nach("schlecht")).toMatchObject({ auftrag: { zustand: "abgebrochen" } });
  });

  it("may not wait for itself or for an unknown job", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1");
    expect(
      auftragAnlegen(
        u.deps,
        u.kontext("b1"),
        neuerAuftrag("s1", { auftragId: "x", wartetAuf: ["x"] }),
      ),
    ).toMatchObject({ ok: false, grund: "zyklus" });
    expect(
      auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { wartetAuf: ["nirgends"] })),
    ).toEqual({ ok: false, grund: "vorgaenger_unbekannt", detail: "nirgends" });
  });
});

describe("zyklusIn", () => {
  it("finds a chain back to the new job, however long", () => {
    const graph: Record<string, string[]> = { a: ["b"], b: ["c"], c: ["neu"], d: [] };
    const vorgaenger = (id: string) => graph[id] ?? [];
    expect(zyklusIn({ id: "neu", wartetAuf: ["a"] }, vorgaenger)).toBe(true);
    expect(zyklusIn({ id: "neu", wartetAuf: ["d"] }, vorgaenger)).toBe(false);
    expect(zyklusIn({ id: "neu", wartetAuf: [] }, vorgaenger)).toBe(false);
  });

  it("ends on a cycle among the others that does not reach the new job", () => {
    const graph: Record<string, string[]> = { a: ["b"], b: ["a"] };
    expect(zyklusIn({ id: "neu", wartetAuf: ["a"] }, (id) => graph[id] ?? [])).toBe(false);
  });
});

describe("operators", () => {
  it("never reach each other's servers or jobs", () => {
    const u = auftragsUmgebung();
    u.betreiber("b1", "s1");
    u.betreiber("b2", "s2");
    auftragAnlegen(u.deps, u.kontext("b1"), neuerAuftrag("s1", { auftragId: "a1" }));
    // b2 cannot put a job on b1's server, nor wait for b1's job
    expect(auftragAnlegen(u.deps, u.kontext("b2"), neuerAuftrag("s1"))).toMatchObject({
      grund: "server_unbekannt",
    });
    expect(
      auftragAnlegen(u.deps, u.kontext("b2"), neuerAuftrag("s2", { wartetAuf: ["a1"] })),
    ).toMatchObject({ grund: "vorgaenger_unbekannt" });
    // the same id is free for b2: ids are per operator
    expect(
      auftragAnlegen(u.deps, u.kontext("b2"), neuerAuftrag("s2", { auftragId: "a1" })),
    ).toMatchObject({ ok: true });
    // b2's agent cannot report b1's job, and b1's job stays where it was
    const b2 = { betreiberId: "b2", serverId: "s2" } as never;
    const b1Andere = { betreiberId: "b1", serverId: "s9" } as never;
    expect(auftragMelden(u.deps, b1Andere, ergebnis("a1", true), 2)).toEqual({
      ok: false,
      grund: "not a job of this server",
    });
    auftragMelden(u.deps, b2, ergebnis("a1", false), 2);
    expect(
      u.db
        .select()
        .from(auftraege)
        .all()
        .map((a) => [a.betreiberId, a.auftragId, a.zustand]),
    ).toEqual([
      ["b1", "a1", "bereit"],
      ["b2", "a1", "bereit"],
    ]);
  });
});
