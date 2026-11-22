import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PFORTE_AKTIONEN,
  pforteGrundkonfiguration,
  schluesselLesen,
  UNBEKANNT_ID,
} from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { speicher, TEST_PUB } from "../beitritt/testhilfen.ts";
import type { Admin } from "../pforte/admin.ts";
import { testCaddy } from "../pforte/testcaddy.ts";
import { auftraegeAnnehmen } from "./auftraege.ts";
import type { AuftragNachricht } from "./pruefen.ts";

/*
 * BAULISTE.md Z-401 in the job model of Z-305 (docs/plan.md, "Pforte-Aufträge"): a job of the
 * Pforte carries the signed manifest of the installation's app; the agent checks key, signature and
 * the job's fixed shape, renders the route from the manifest and calls the admin API, never a
 * process. The manifest is packages/manifest/test/auftrag.yml, signed with the public test key.
 */
const FIXTURES = join(import.meta.dirname, "../../../../packages/manifest/test");
const MANIFEST = readFileSync(join(FIXTURES, "auftrag.yml"), "utf8");
const SIGNATUR = readFileSync(join(FIXTURES, "auftrag.yml.minisig"), "utf8");
const PFAD = "/z/auftraege.json";

const auftrag = (teil: Partial<AuftragNachricht> = {}): AuftragNachricht => ({
  typ: "auftrag",
  protokoll: PROTOKOLL_VERSION,
  auftragId: "p1",
  installationId: "auftrag-k1",
  aktion: PFORTE_AKTIONEN.setzen,
  argumente: { host: "auftrag.kunde.example", port: 20001 },
  manifest: MANIFEST,
  signatur: SIGNATUR,
  zeitlimitS: 1800,
  ...teil,
});

const aufgebaut = (admin?: Admin, fs = speicher()) => {
  const schluessel = schluesselLesen(TEST_PUB);
  if (!schluessel) throw new Error("test key");
  const caddy = testCaddy();
  const spawns: unknown[] = [];
  const plaene: number[] = [];
  const agent = auftraegeAnnehmen({
    dateien: fs.dateien,
    pfad: PFAD,
    vertrauen: { schluessel, zweck: "test" },
    spawn: async (argv) => {
      spawns.push(argv);
      return { code: 0 };
    },
    pforte: { admin: admin ?? caddy.admin, grund: pforteGrundkonfiguration() },
    planen: (_lauf, ms) => {
      plaene.push(ms);
      return () => {};
    },
    jetzt: () => 1_800_000_000_000,
    log: () => {},
  });
  const gesendet: Record<string, unknown>[] = [];
  const empfangen = (n = auftrag()) => agent.empfangen(n, (t) => gesendet.push(JSON.parse(t)));
  return { caddy, spawns, plaene, gesendet, empfangen, fs };
};

describe("a job of the Pforte", () => {
  it("sets the route rendered from the signed manifest, without starting a process", async () => {
    const a = aufgebaut();
    await a.empfangen();
    expect(a.gesendet).toEqual([
      { typ: "bestaetigt", protokoll: PROTOKOLL_VERSION, auftragId: "p1" },
      expect.objectContaining({ typ: "fortschritt", schritt: PFORTE_AKTIONEN.setzen }),
      expect.objectContaining({
        typ: "ergebnis",
        ergebnis: { ok: true, daten: { route: "auftrag-k1", geaendert: "neu" } },
      }),
    ]);
    expect(a.spawns).toEqual([]);
    expect(a.caddy.routen()).toEqual(["auftrag-k1", UNBEKANNT_ID]);
    const put = a.caddy.aufrufe.find((c) => c.methode === "PUT");
    expect(put?.body).toMatchObject({
      match: [{ host: ["auftrag.kunde.example"] }],
      handle: [{ max_size: 10 * 1024 * 1024 }, { upstreams: [{ dial: "127.0.0.1:20001" }] }],
    });
  });

  it("removes the route by the installation's name", async () => {
    const a = aufgebaut();
    await a.empfangen();
    await a.empfangen(
      auftrag({ auftragId: "p2", aktion: PFORTE_AKTIONEN.entfernen, argumente: {} }),
    );
    expect(a.gesendet.at(-1)).toMatchObject({
      ergebnis: { ok: true, daten: { route: "auftrag-k1", geaendert: "entfernt" } },
    });
    expect(a.caddy.routen()).toEqual([UNBEKANNT_ID]);
  });

  it("has at most 60 seconds, however long the Zentrale allows", async () => {
    const a = aufgebaut();
    await a.empfangen();
    await a.empfangen(auftrag({ auftragId: "p3", zeitlimitS: 5 }));
    expect(a.plaene).toEqual([60_000, 5_000]);
  });

  it.each([
    ["a manifest changed in one byte", { manifest: MANIFEST.replace("8080", "8081") }, "signature"],
    ["a host with a path", { argumente: { host: "a.example/x", port: 20001 } }, "argument host"],
    ["a port as text", { argumente: { host: "a.example", port: "20001" } }, "argument port"],
    ["a port below 1024", { argumente: { host: "a.example", port: 22 } }, "argument port"],
    [
      "an upstream of its own",
      { argumente: { host: "a.example", port: 20001, dial: "x:1" } },
      "unknown argument dial",
    ],
    ["no installation", { installationId: null }, "named installation"],
  ] as const)("refuses %s and calls nothing", async (_fall, teil, grund) => {
    const a = aufgebaut();
    await a.empfangen(auftrag(teil as Partial<AuftragNachricht>));
    expect(a.gesendet.at(-1)).toMatchObject({
      ergebnis: { ok: false, fehler: expect.stringMatching(new RegExp(`^abgelehnt: .*${grund}`)) },
    });
    expect(a.caddy.aufrufe).toEqual([]);
    expect(a.spawns).toEqual([]);
  });

  it("is set again after a restart of the agent: setting a route is idempotent", async () => {
    const fs = speicher();
    await fs.dateien.schreiben(
      PFAD,
      JSON.stringify({ auftraege: { p1: { zustand: "laeuft", am: 1 } } }),
      0o600,
    );
    const a = aufgebaut(undefined, fs);
    await a.empfangen();
    expect(a.gesendet.at(-1)).toMatchObject({ ergebnis: { ok: true } });
    expect(a.caddy.routen()).toEqual(["auftrag-k1", UNBEKANNT_ID]);
  });

  it("runs jobs of the Pforte one after another, so two cannot both take one host", async () => {
    const caddy = testCaddy();
    // every answer comes a little later, so that jobs run side by side would interleave
    const langsam: Admin = async (m, p, b, s) => {
      await new Promise((r) => setTimeout(r, 5));
      return caddy.admin(m, p, b, s);
    };
    const a = aufgebaut(langsam);
    await Promise.all([
      a.empfangen(),
      a.empfangen(auftrag({ auftragId: "p2", installationId: "auftrag-k2" })),
    ]);
    const ergebnisse = a.gesendet.filter((n) => n.typ === "ergebnis");
    expect(ergebnisse).toEqual([
      expect.objectContaining({ auftragId: "p1", ergebnis: expect.objectContaining({ ok: true }) }),
      expect.objectContaining({
        auftragId: "p2",
        ergebnis: {
          ok: false,
          fehler: "abgelehnt: Host auftrag.kunde.example gehört schon zur Route auftrag-k1",
        },
      }),
    ]);
    expect(caddy.routen()).toEqual(["auftrag-k1", UNBEKANNT_ID]);
  });

  it("fails with the reason when the Pforte does not answer", async () => {
    const a = aufgebaut(async () => {
      throw new Error("ECONNREFUSED");
    });
    await a.empfangen();
    expect(a.gesendet.at(-1)).toMatchObject({
      ergebnis: { ok: false, fehler: "Pforte nicht erreichbar: Error: ECONNREFUSED" },
    });
  });
});
