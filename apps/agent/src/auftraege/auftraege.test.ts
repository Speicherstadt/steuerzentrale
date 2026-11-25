import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_UPDATE_AKTION,
  AUFTRAGS_ARTEN,
  pforteGrundkonfiguration,
  schluesselLesen,
} from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { speicher, TEST_PUB } from "../beitritt/testhilfen.ts";
import { eingerichtet, INSTALLATIONEN, installationenAuf } from "../einrichtung/testauftraege.ts";
import { testSystem } from "../einrichtung/testsystem.ts";
import { testCaddy } from "../pforte/testcaddy.ts";
import { type AuftraegeDeps, auftraegeAnnehmen, NEU_GESTARTET } from "./auftraege.ts";
import type { Spawn } from "./ausfuehren.ts";
import type { AuftragNachricht } from "./pruefen.ts";

/*
 * BAULISTE.md Z-305, the agent's side: it runs only the command of a manifest with a valid
 * signature, with arguments that fit, within the time limit; a job sent twice runs once; a job that
 * was running when the agent stopped is reported failed, or run again if the manifest allows it.
 * The manifest is packages/manifest/test/auftrag.yml, signed with the public test key.
 */
const FIXTURES = join(import.meta.dirname, "../../../../packages/manifest/test");
const MANIFEST = readFileSync(join(FIXTURES, "auftrag.yml"), "utf8");
const SIGNATUR = readFileSync(join(FIXTURES, "auftrag.yml.minisig"), "utf8");
const FREMDE_SIGNATUR = readFileSync(join(FIXTURES, "signiert.yml.minisig"), "utf8");
/** auftrag.yml signed with a key the agent does not trust (docs/sicherheit.md, a foreign manifest) */
const FREMDER_SCHLUESSEL = readFileSync(join(FIXTURES, "auftrag.yml.fremd.minisig"), "utf8");
const PFAD = "/z/auftraege.json";

const auftrag = (teil: Partial<AuftragNachricht> = {}): AuftragNachricht => ({
  typ: "auftrag",
  protokoll: PROTOKOLL_VERSION,
  auftragId: "a1",
  installationId: "auftrag-k1",
  aktion: "migrieren",
  argumente: {},
  manifest: MANIFEST,
  signatur: SIGNATUR,
  zeitlimitS: 1800,
  ...teil,
});

/** A spawn that records each argv and ends when the test says so, or when it is killed */
const testSpawn = () => {
  const laeufe: { argv: readonly string[]; ende: (code: number) => void; signal: AbortSignal }[] =
    [];
  const spawn: Spawn = (argv, signal) =>
    new Promise((fertig) => {
      signal.addEventListener("abort", () => fertig({ code: null }));
      laeufe.push({ argv, ende: (code) => fertig({ code }), signal });
    });
  return { spawn, laeufe };
};

/**
 * Since Z-402 a command runs as the installation's user (docs/plan.md, "Was ein Auftrag
 * ausführt"), and only in an installation the agent set up: auftrag-k1 is one, as sz-auftrag-k1
 */
const ALS = [
  "runuser",
  "-u",
  "sz-auftrag-k1",
  "--",
  "env",
  "-i",
  "HOME=/home/sz-auftrag-k1",
  "USER=sz-auftrag-k1",
  "LOGNAME=sz-auftrag-k1",
  "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  "XDG_RUNTIME_DIR=/run/user/1001",
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus",
];

const aufgebaut = (teil: Partial<AuftraegeDeps> = {}, fs = speicher()) => {
  const schluessel = schluesselLesen(TEST_PUB);
  if (!schluessel) throw new Error("test key");
  const { spawn, laeufe } = testSpawn();
  const server = testSystem({
    nutzer: [{ name: "sz-auftrag-k1", uid: 1001, gid: 1001, home: "/home/sz-auftrag-k1" }],
  });
  const eingerichtete = eingerichtet({ "auftrag-k1": "fertig" })[INSTALLATIONEN] ?? "";
  if (!fs.inhalt.has(INSTALLATIONEN))
    fs.inhalt.set(INSTALLATIONEN, { text: eingerichtete, modus: 0o600 });
  const plaene: { ms: number; lauf: () => void }[] = [];
  const log: Record<string, unknown>[] = [];
  const agent = auftraegeAnnehmen({
    dateien: fs.dateien,
    pfad: PFAD,
    vertrauen: { schluessel, zweck: "test" },
    spawn,
    pforte: { admin: testCaddy().admin, grund: pforteGrundkonfiguration() },
    installationen: installationenAuf(server),
    planen: (lauf, ms) => {
      plaene.push({ ms, lauf });
      return () => {};
    },
    jetzt: () => 1_800_000_000_000,
    log: (msg, mehr) => log.push({ msg, ...mehr }),
    ...teil,
  });
  const gesendet: Record<string, unknown>[] = [];
  const senden = (text: string) => gesendet.push(JSON.parse(text));
  const empfangen = (n = auftrag()) => agent.empfangen(n, senden);
  const record = () => JSON.parse(fs.inhalt.get(PFAD)?.text ?? "{}");
  return { fs, laeufe, plaene, log, gesendet, empfangen, record };
};

/** Lets the job's awaits (record, spawn) run */
const weiter = () => new Promise((r) => setTimeout(r, 0));

const typen = (gesendet: Record<string, unknown>[]) => gesendet.map((n) => n.typ);

describe("a job with a signed manifest", () => {
  it("is acknowledged, runs the command's argv in its installation's container and reports the result", async () => {
    const a = aufgebaut();
    const fertig = a.empfangen();
    await weiter();
    expect(a.laeufe.map((l) => l.argv)).toEqual([
      [
        ...ALS,
        "podman",
        "exec",
        "--env",
        expect.stringMatching(/^STEUERZENTRALE_LAUF=[0-9a-f-]{36}$/),
        "auftrag-k1-app",
        "bun",
        "/app/server.ts",
        "migrieren",
      ],
    ]);
    expect(a.record().auftraege.a1).toMatchObject({ zustand: "laeuft" });
    a.laeufe[0]?.ende(0);
    await fertig;
    expect(a.gesendet).toEqual([
      { typ: "bestaetigt", protokoll: PROTOKOLL_VERSION, auftragId: "a1" },
      expect.objectContaining({ typ: "fortschritt", auftragId: "a1", schritt: "migrieren" }),
      expect.objectContaining({
        typ: "ergebnis",
        auftragId: "a1",
        ergebnis: { ok: true, daten: { code: 0 } },
      }),
    ]);
    expect(a.record().auftraege.a1).toMatchObject({ zustand: "fertig", ergebnis: { ok: true } });
    expect(a.fs.inhalt.get(PFAD)?.modus).toBe(0o600);
  });

  it("puts each argument into its place as one word", async () => {
    const a = aufgebaut();
    const fertig = a.empfangen(
      auftrag({ aktion: "wiederherstellen", argumente: { snapshot: "a1b2c3d4" } }),
    );
    await weiter();
    // podman exec --env <mark> <container>
    expect(a.laeufe[0]?.argv.slice(ALS.length + 5)).toEqual([
      "bun",
      "/app/server.ts",
      "wiederherstellen",
      "a1b2c3d4",
    ]);
    a.laeufe[0]?.ende(0);
    await fertig;
  });

  it("fails with the exit code of a command that ends badly", async () => {
    const a = aufgebaut();
    const fertig = a.empfangen();
    await weiter();
    a.laeufe[0]?.ende(3);
    await fertig;
    expect(a.gesendet.at(-1)).toMatchObject({
      ergebnis: { ok: false, fehler: "Befehl endete mit Code 3" },
    });
  });

  it("fails when its command cannot start", async () => {
    const a = aufgebaut({ spawn: async () => Promise.reject(new Error("ENOENT podman")) });
    await a.empfangen();
    expect(a.gesendet.at(-1)).toMatchObject({
      ergebnis: { ok: false, fehler: "Befehl startete nicht: Error: ENOENT podman" },
    });
  });
});

describe("a job sent twice", () => {
  it("runs once: after its end the stored result is sent again", async () => {
    const a = aufgebaut();
    const erst = a.empfangen();
    await weiter();
    a.laeufe[0]?.ende(0);
    await erst;
    await a.empfangen();
    expect(a.laeufe).toHaveLength(1);
    expect(typen(a.gesendet)).toEqual(["bestaetigt", "fortschritt", "ergebnis", "ergebnis"]);
    expect(a.gesendet[3]).toEqual({ ...a.gesendet[2], zeit: expect.any(Number) });
  });

  it("runs once while it runs: the second gets only an acknowledgement", async () => {
    const a = aufgebaut();
    const erst = a.empfangen();
    const zweit = a.empfangen();
    await weiter();
    await zweit;
    expect(a.laeufe).toHaveLength(1);
    a.laeufe[0]?.ende(0);
    await erst;
    expect(typen(a.gesendet)).toEqual(["bestaetigt", "bestaetigt", "fortschritt", "ergebnis"]);
  });
});

describe("a job the agent refuses, without starting anything", () => {
  it.each([
    ["an unsigned manifest", { signatur: "-" }, "(signature): no minisign signature"],
    [
      "the signature of another manifest",
      { signatur: FREMDE_SIGNATUR },
      "(signature): signature does not match",
    ],
    [
      "the manifest signed with another key, as a taken-over Zentrale would send it",
      { signatur: FREMDER_SCHLUESSEL },
      "(signature): signed with key 18DE39F36CBE9564, expected 3D1586A2B972C948",
    ],
    [
      "a manifest changed in one byte",
      { manifest: MANIFEST.replace("migrieren]", "migrierem]") },
      "(signature): signature does not match",
    ],
    [
      "an action the manifest does not have",
      { aktion: "neustart" },
      "neustart is not a command of the manifest",
    ],
    [
      "arguments against the schema",
      { aktion: "wiederherstellen", argumente: { snapshot: "x; id" } },
      "argument snapshot: does not match its pattern",
    ],
    [
      "an argument the command does not take",
      { argumente: { mehr: "1" } },
      "unknown argument mehr",
    ],
    [
      "no installation",
      { installationId: null },
      "a command runs in a container of a named installation",
    ],
    [
      "an installation name that is no name",
      { installationId: "--privileged" },
      "a command runs in a container of a named installation",
    ],
  ] as [string, Partial<AuftragNachricht>, string][])("%s", async (_fall, teil, grund) => {
    const a = aufgebaut();
    await a.empfangen(auftrag(teil));
    expect(a.laeufe).toEqual([]);
    expect(a.gesendet).toEqual([
      { typ: "bestaetigt", protokoll: PROTOKOLL_VERSION, auftragId: "a1" },
      expect.objectContaining({
        typ: "ergebnis",
        ergebnis: { ok: false, fehler: `abgelehnt: ${grund}` },
      }),
    ]);
  });

  it("a manifest signed with the public test key, outside test mode", async () => {
    const schluessel = schluesselLesen(TEST_PUB);
    if (!schluessel) throw new Error("test key");
    const a = aufgebaut({ vertrauen: { schluessel, zweck: "release" } });
    await a.empfangen();
    expect(a.laeufe).toEqual([]);
    expect(a.gesendet.at(-1)).toMatchObject({
      ergebnis: { ok: false, fehler: expect.stringContaining("is the public test key") },
    });
  });

  it("any job while its record cannot be read: it could not tell a job sent twice", async () => {
    const a = aufgebaut({}, speicher({ [PFAD]: "kaputt" }));
    await a.empfangen();
    expect(a.laeufe).toEqual([]);
    expect(a.gesendet).toEqual([]);
    expect(a.log).toContainEqual(expect.objectContaining({ msg: "job refused", auftragId: "a1" }));
  });

  it('only until its record is repaired (docs/plan.md, "Gedächtnis des Agenten")', async () => {
    const fs = speicher({ [PFAD]: "kaputt" });
    const a = aufgebaut({}, fs);
    await a.empfangen();
    expect(a.laeufe).toEqual([]);
    fs.inhalt.set(PFAD, { text: JSON.stringify({ auftraege: {} }), modus: 0o600 });
    void a.empfangen();
    await weiter();
    expect(a.laeufe.map((l) => l.argv.at(-1))).toEqual(["migrieren"]);
  });
});

describe("the time limit", () => {
  it("kills the command when the manifest's limit runs out and fails the job", async () => {
    const a = aufgebaut();
    const fertig = a.empfangen(auftrag({ aktion: "langsam" }));
    await weiter();
    expect(a.plaene.map((p) => p.ms)).toEqual([1000]);
    a.plaene[0]?.lauf();
    await fertig;
    expect(a.laeufe[0]?.signal.aborted).toBe(true);
    expect(a.gesendet.at(-1)).toMatchObject({
      ergebnis: { ok: false, fehler: "Zeitlimit von 1 s überschritten, Befehl beendet" },
    });
  });

  it("is the shorter of the manifest's and the job's", async () => {
    const a = aufgebaut();
    void a.empfangen(auftrag({ zeitlimitS: 30 }));
    void a.empfangen(auftrag({ auftragId: "a2", aktion: "langsam", zeitlimitS: 30 }));
    await weiter();
    // migrieren names no limit: the standard of 900 s, shortened by the job to 30 s
    expect(a.plaene.map((p) => p.ms)).toEqual([30_000, 1000]);
  });
});

describe("after a restart of the agent", () => {
  const nachAbsturz = async (aktion: string) => {
    const fs = speicher();
    const vorher = aufgebaut({}, fs);
    void vorher.empfangen(auftrag({ aktion }));
    await weiter();
    expect(vorher.record().auftraege.a1).toMatchObject({ zustand: "laeuft" });
    // the process is gone; a new one starts on the same record, and the Zentrale sends the job again
    const nachher = aufgebaut({}, fs);
    const fertig = nachher.empfangen(auftrag({ aktion }));
    return { nachher, fertig };
  };

  it("a job that was running is reported failed, not run again", async () => {
    const { nachher, fertig } = await nachAbsturz("migrieren");
    await fertig;
    expect(nachher.laeufe).toEqual([]);
    expect(nachher.gesendet).toEqual([
      { typ: "bestaetigt", protokoll: PROTOKOLL_VERSION, auftragId: "a1" },
      expect.objectContaining({ typ: "ergebnis", ergebnis: { ok: false, fehler: NEU_GESTARTET } }),
    ]);
    expect(nachher.record().auftraege.a1).toMatchObject({ zustand: "fertig" });
  });

  it("a command the manifest marks idempotent runs again", async () => {
    const { nachher, fertig } = await nachAbsturz("pruefen");
    await weiter();
    expect(nachher.laeufe.map((l) => l.argv.at(-1))).toEqual(["pruefen"]);
    nachher.laeufe[0]?.ende(0);
    await fertig;
    expect(nachher.gesendet.at(-1)).toMatchObject({ ergebnis: { ok: true } });
  });
});

// BAULISTE.md Z-1102: on a server that is only observed the agent refuses every job that changes
// anything, also when the Zentrale sends one: every built-in kind and a command of the manifest,
// before it checks or runs anything; only its own update goes on to its checks
describe("a server that is only observed", () => {
  const AENDERND = [...AUFTRAGS_ARTEN.filter((a) => a !== AGENT_UPDATE_AKTION), "migrieren"];

  it.each(AENDERND)("refuses %s and runs nothing", async (aktion) => {
    const a = aufgebaut({ nurBeobachten: true });
    await a.empfangen(auftrag({ aktion }));
    await weiter();
    expect(a.laeufe).toEqual([]);
    expect(a.gesendet).toEqual([
      expect.objectContaining({ typ: "bestaetigt", auftragId: "a1" }),
      expect.objectContaining({
        typ: "ergebnis",
        auftragId: "a1",
        ergebnis: { ok: false, fehler: "abgelehnt: der Server wird nur beobachtet" },
      }),
    ]);
  });

  it("takes its own update to its checks", async () => {
    const a = aufgebaut({ nurBeobachten: true });
    await a.empfangen(auftrag({ aktion: AGENT_UPDATE_AKTION, installationId: null }));
    await weiter();
    const ergebnis = a.gesendet.find((n) => n.typ === "ergebnis") as
      | { ergebnis: { fehler?: string } }
      | undefined;
    expect(ergebnis?.ergebnis.fehler).not.toBe("abgelehnt: der Server wird nur beobachtet");
  });

  it("runs the manifest's command on a managed server, as before", async () => {
    const a = aufgebaut({ nurBeobachten: false });
    void a.empfangen();
    await weiter();
    expect(a.laeufe).toHaveLength(1);
  });
});
