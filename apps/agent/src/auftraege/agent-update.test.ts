import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_UPDATE_AKTION,
  pforteGrundkonfiguration,
  schluesselLesen,
} from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import type { AgentUpdateDeps } from "../agent-update/aktualisieren.ts";
import { BINARY, MARKE, NEUES_X64, platte, SIGNATUR, SUMMEN } from "../agent-update/testhilfen.ts";
import { speicher, TEST_PUB } from "../beitritt/testhilfen.ts";
import { eingerichtet, INSTALLATIONEN, installationenAuf } from "../einrichtung/testauftraege.ts";
import { testSystem } from "../einrichtung/testsystem.ts";
import { testCaddy } from "../pforte/testcaddy.ts";
import { auftraegeAnnehmen } from "./auftraege.ts";
import type { Spawn } from "./ausfuehren.ts";
import type { AuftragNachricht } from "./pruefen.ts";

/*
 * BAULISTE.md Z-504, the update of the agent among its jobs: once it holds, the result is kept and
 * sent, the agent takes no further job (the new agent gets it again) and restarts; beside a running
 * job it is refused, since the restart would end that job halfway.
 */
const FIXTURES = join(import.meta.dirname, "../../../../packages/manifest/test");

const update: AuftragNachricht = {
  typ: "auftrag",
  protokoll: PROTOKOLL_VERSION,
  auftragId: "u-1",
  installationId: null,
  aktion: AGENT_UPDATE_AKTION,
  argumente: { version: "0.0.1" },
  manifest: SUMMEN,
  signatur: SIGNATUR,
  zeitlimitS: 600,
};

const befehl: AuftragNachricht = {
  ...update,
  auftragId: "a-1",
  installationId: "auftrag-k1",
  aktion: "migrieren",
  argumente: {},
  manifest: readFileSync(join(FIXTURES, "auftrag.yml"), "utf8"),
  signatur: readFileSync(join(FIXTURES, "auftrag.yml.minisig"), "utf8"),
};

const aufgebaut = (
  holen: AgentUpdateDeps["holen"] = async () => new Response(NEUES_X64.slice()),
) => {
  const schluessel = schluesselLesen(TEST_PUB);
  if (!schluessel) throw new Error("test key");
  const fs = speicher();
  fs.inhalt.set(INSTALLATIONEN, {
    text: eingerichtet({ "auftrag-k1": "fertig" })[INSTALLATIONEN] ?? "",
    modus: 0o600,
  });
  const server = testSystem({
    nutzer: [{ name: "sz-auftrag-k1", uid: 1001, gid: 1001, home: "/home/sz-auftrag-k1" }],
  });
  // a command in a container runs until the test ends
  const spawn: Spawn = (_argv, signal) =>
    new Promise((fertig) => signal.addEventListener("abort", () => fertig({ code: null })));
  const p = platte({ [BINARY]: "agent linux-x64 0.0.0\n" });
  const agentUpdate: AgentUpdateDeps = {
    zentrale: "https://agent.example.org",
    architektur: "amd64",
    binary: BINARY,
    marke: MARKE,
    version: "0.0.0",
    protokoll: PROTOKOLL_VERSION,
    holen,
    dateien: p.dateien,
    binaer: p.binaer,
    lesen: async () => ({
      code: 0,
      aus: `steuerzentrale-agent 0.0.1 (protokoll ${PROTOKOLL_VERSION})`,
    }),
    spawn: async () => ({ code: 0 }),
    jetzt: () => 1,
  };
  const neustarts: number[] = [];
  const log: Record<string, unknown>[] = [];
  const agent = auftraegeAnnehmen({
    dateien: fs.dateien,
    pfad: "/z/auftraege.json",
    vertrauen: { schluessel, zweck: "test" },
    spawn,
    pforte: { admin: testCaddy().admin, grund: pforteGrundkonfiguration() },
    installationen: installationenAuf(server),
    planen: () => () => {},
    jetzt: () => 1_800_000_000_000,
    log: (msg, mehr) => log.push({ msg, ...mehr }),
    agentUpdate,
    neustarten: () => neustarts.push(1),
  });
  const gesendet: Record<string, unknown>[] = [];
  const empfangen = (n: AuftragNachricht) =>
    agent.empfangen(n, (text) => gesendet.push(JSON.parse(text)));
  return { p, gesendet, empfangen, neustarts, log };
};

describe("the update of the agent as a job", () => {
  it("reports its result, then restarts and leaves every later job to the new agent", async () => {
    const a = aufgebaut();
    await a.empfangen(update);
    expect(a.gesendet.at(-1)).toMatchObject({
      typ: "ergebnis",
      auftragId: "u-1",
      ergebnis: { ok: true, daten: { version: "0.0.1", vorher: "0.0.0" } },
    });
    expect(a.neustarts).toEqual([1]);
    expect(a.p.lesen(BINARY)).toBe("agent linux-x64 0.0.1\n");
    const vorher = a.gesendet.length;
    await a.empfangen(befehl);
    expect(a.gesendet.length).toBe(vorher);
    expect(a.log.at(-1)).toEqual({ msg: "job left for the new agent", auftragId: "a-1" });
  });

  it("is refused while another job runs, and nothing changes", async () => {
    const a = aufgebaut();
    void a.empfangen(befehl);
    await new Promise((r) => setTimeout(r, 0));
    await a.empfangen(update);
    expect(a.gesendet.at(-1)).toMatchObject({
      typ: "ergebnis",
      auftragId: "u-1",
      ergebnis: { ok: false, fehler: "abgelehnt: other jobs run on the agent" },
    });
    expect(a.neustarts).toEqual([]);
    expect(a.p.lesen(BINARY)).toBe("agent linux-x64 0.0.0\n");
  });

  it("starts no job that comes while it loads the new binary, and leaves it to the new agent", async () => {
    let laden: (r: Response) => void = () => {};
    const a = aufgebaut(
      () =>
        new Promise<Response>((r) => {
          laden = r;
        }),
    );
    const laeuft = a.empfangen(update);
    await new Promise((r) => setTimeout(r, 0));
    void a.empfangen(befehl);
    await new Promise((r) => setTimeout(r, 0));
    laden(new Response(NEUES_X64.slice()));
    await laeuft;
    await new Promise((r) => setTimeout(r, 10));
    expect(a.neustarts).toEqual([1]);
    // the restart would end it halfway: the new agent gets it again
    expect(a.gesendet.filter((n) => n.auftragId === "a-1")).toEqual([]);
    expect(a.log.at(-1)).toEqual({ msg: "job left for the new agent", auftragId: "a-1" });
  });

  it("runs a job that came while it loaded once its update failed", async () => {
    let laden: (r: Response) => void = () => {};
    const a = aufgebaut(
      () =>
        new Promise<Response>((r) => {
          laden = r;
        }),
    );
    const laeuft = a.empfangen(update);
    await new Promise((r) => setTimeout(r, 0));
    void a.empfangen(befehl);
    await new Promise((r) => setTimeout(r, 0));
    laden(new Response("not the binary"));
    await laeuft;
    await new Promise((r) => setTimeout(r, 10));
    expect(a.neustarts).toEqual([]);
    expect(a.gesendet.filter((n) => n.auftragId === "a-1").map((n) => n.typ)).toEqual([
      "bestaetigt",
      "fortschritt",
    ]);
  });
});
