import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KEIN_MANIFEST,
  pforteGrundkonfiguration,
  SERVER_NEUSTART_AKTION,
  schluesselLesen,
} from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { speicher, TEST_PUB } from "../beitritt/testhilfen.ts";
import { eingerichtet, INSTALLATIONEN, installationenAuf } from "../einrichtung/testauftraege.ts";
import { testSystem } from "../einrichtung/testsystem.ts";
import { NEUSTART_FRIST_MS, SYSTEMCTL_REBOOT } from "../neustart/neustart.ts";
import { testCaddy } from "../pforte/testcaddy.ts";
import { auftraegeAnnehmen } from "./auftraege.ts";
import type { Spawn } from "./ausfuehren.ts";
import type { AuftragNachricht } from "./pruefen.ts";

/*
 * BAULISTE.md Z-701, the reboot of the server among the agent's jobs: it checks the fixed shape after
 * the key, reboots only out of the boot the job names, takes no job once it asked systemd to reboot,
 * and after the agent started again reports the job done only with another boot id.
 */
const FIXTURES = join(import.meta.dirname, "../../../../packages/manifest/test");
const BOOT = "8f4c1c9e-2d3a-4b5c-9d6e-7f8091a2b3c4";
const NEU = "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9";

const neustart: AuftragNachricht = {
  typ: "auftrag",
  protokoll: PROTOKOLL_VERSION,
  auftragId: "n-1",
  installationId: null,
  aktion: SERVER_NEUSTART_AKTION,
  argumente: { bootId: BOOT },
  manifest: KEIN_MANIFEST,
  signatur: KEIN_MANIFEST,
  zeitlimitS: 600,
};

const befehl: AuftragNachricht = {
  ...neustart,
  auftragId: "a-1",
  installationId: "auftrag-k1",
  aktion: "migrieren",
  argumente: {},
  manifest: readFileSync(join(FIXTURES, "auftrag.yml"), "utf8"),
  signatur: readFileSync(join(FIXTURES, "auftrag.yml.minisig"), "utf8"),
};

type Aufbau = {
  boot?: string | null;
  rebootCode?: number;
  fs?: ReturnType<typeof speicher>;
  zweck?: "release" | "test";
};

const aufgebaut = (o: Aufbau = {}) => {
  const schluessel = schluesselLesen(TEST_PUB);
  if (!schluessel) throw new Error("test key");
  const fs = o.fs ?? speicher();
  if (!o.fs)
    fs.inhalt.set(INSTALLATIONEN, {
      text: eingerichtet({ "auftrag-k1": "fertig" })[INSTALLATIONEN] ?? "",
      modus: 0o600,
    });
  const server = testSystem({
    nutzer: [{ name: "sz-auftrag-k1", uid: 1001, gid: 1001, home: "/home/sz-auftrag-k1" }],
  });
  const aufrufe: string[][] = [];
  // a command in a container runs until the test ends; systemctl answers at once
  const spawn: Spawn = (argv, signal) => {
    aufrufe.push([...argv]);
    if (argv[0] === "systemctl") return Promise.resolve({ code: o.rebootCode ?? 0 });
    return new Promise((fertig) => signal.addEventListener("abort", () => fertig({ code: null })));
  };
  // the reboot never comes in a test: the wait ends when the test lets it
  let fristAbgelaufen: () => void = () => {};
  const gewartet: number[] = [];
  const agent = auftraegeAnnehmen({
    dateien: fs.dateien,
    pfad: "/z/auftraege.json",
    vertrauen: { schluessel, zweck: o.zweck ?? "test" },
    spawn,
    pforte: { admin: testCaddy().admin, grund: pforteGrundkonfiguration() },
    installationen: installationenAuf(server),
    planen: () => () => {},
    jetzt: () => 1_800_000_000_000,
    log: () => {},
    neustart: {
      bootId: async () => (o.boot === undefined ? BOOT : o.boot),
      spawn,
      warten: (ms) => {
        gewartet.push(ms);
        return new Promise((r) => {
          fristAbgelaufen = r;
        });
      },
    },
  });
  const gesendet: Record<string, unknown>[] = [];
  const empfangen = (n: AuftragNachricht) =>
    agent.empfangen(n, (text) => gesendet.push(JSON.parse(text)));
  return { fs, gesendet, empfangen, aufrufe, gewartet, ablaufen: () => fristAbgelaufen() };
};

const ergebnis = (gesendet: Record<string, unknown>[], auftragId: string) =>
  gesendet.filter((n) => n.typ === "ergebnis" && n.auftragId === auftragId).at(-1);

const kurz = () => new Promise((r) => setTimeout(r, 10));

describe("the reboot of the server as a job", () => {
  it("asks systemd to reboot with a fixed argv and keeps the job running", async () => {
    const a = aufgebaut();
    void a.empfangen(neustart);
    await kurz();
    expect(a.aufrufe).toEqual([[...SYSTEMCTL_REBOOT]]);
    expect(SYSTEMCTL_REBOOT).toEqual(["systemctl", "reboot"]);
    expect(a.gesendet.map((n) => n.typ)).toEqual(["bestaetigt", "fortschritt"]);
    expect(ergebnis(a.gesendet, "n-1")).toBeUndefined();
    expect(a.gewartet).toEqual([NEUSTART_FRIST_MS]);
    // a job that comes now is left for after the reboot
    await a.empfangen(befehl);
    expect(a.gesendet.filter((n) => n.auftragId === "a-1")).toEqual([]);
  });

  it("reports the job done after the reboot, with the new boot id", async () => {
    const vorher = aufgebaut();
    void vorher.empfangen(neustart);
    await kurz();
    // the agent starts again on a new boot; the Zentrale sends the running job again
    const danach = aufgebaut({ boot: NEU, fs: vorher.fs });
    await danach.empfangen(neustart);
    expect(danach.aufrufe).toEqual([]);
    expect(ergebnis(danach.gesendet, "n-1")).toMatchObject({
      ergebnis: { ok: true, daten: { bootId: NEU } },
    });
  });

  it("reports it failed when the agent started again without a reboot, and reboots no more", async () => {
    const vorher = aufgebaut();
    void vorher.empfangen(neustart);
    await kurz();
    const danach = aufgebaut({ fs: vorher.fs });
    await danach.empfangen(neustart);
    expect(danach.aufrufe).toEqual([]);
    expect(ergebnis(danach.gesendet, "n-1")).toMatchObject({
      ergebnis: { ok: false, fehler: "Neustart nicht erfolgt: Agent neu gestartet" },
    });
  });

  it("reports it failed when the server did not go down in time, and takes jobs again", async () => {
    const a = aufgebaut();
    const laeuft = a.empfangen(neustart);
    await kurz();
    a.ablaufen();
    await laeuft;
    expect(ergebnis(a.gesendet, "n-1")).toMatchObject({
      ergebnis: {
        ok: false,
        fehler: "Neustart nicht erfolgt: der Server lief nach 5 Minuten noch",
      },
    });
    void a.empfangen(befehl);
    await kurz();
    expect(a.gesendet.filter((n) => n.auftragId === "a-1").map((n) => n.typ)).toEqual([
      "bestaetigt",
      "fortschritt",
    ]);
  });

  it("never reboots out of another boot than the job's, nor when systemd refuses", async () => {
    const anders = aufgebaut({ boot: NEU });
    await anders.empfangen(neustart);
    expect(anders.aufrufe).toEqual([]);
    expect(ergebnis(anders.gesendet, "n-1")).toMatchObject({
      ergebnis: { ok: false, fehler: "abgelehnt: the server booted anew since the job was made" },
    });
    const unlesbar = aufgebaut({ boot: null });
    await unlesbar.empfangen(neustart);
    expect(unlesbar.aufrufe).toEqual([]);
    expect(ergebnis(unlesbar.gesendet, "n-1")).toMatchObject({ ergebnis: { ok: false } });
    const verweigert = aufgebaut({ rebootCode: 1 });
    await verweigert.empfangen(neustart);
    expect(ergebnis(verweigert.gesendet, "n-1")).toMatchObject({
      ergebnis: { ok: false, fehler: "systemctl reboot: exit 1" },
    });
  });

  it("is refused while another job runs, and beside a wrong shape", async () => {
    const a = aufgebaut();
    void a.empfangen(befehl);
    await kurz();
    await a.empfangen(neustart);
    expect(ergebnis(a.gesendet, "n-1")).toMatchObject({
      ergebnis: { ok: false, fehler: "abgelehnt: other jobs run on the agent" },
    });
    const b = aufgebaut();
    await b.empfangen({ ...neustart, auftragId: "n-2", argumente: { bootId: BOOT, x: 1 } });
    expect(ergebnis(b.gesendet, "n-2")).toMatchObject({
      ergebnis: { ok: false, fehler: "abgelehnt: unknown argument x" },
    });
    expect([...a.aufrufe, ...b.aufrufe].filter((x) => x[0] === "systemctl")).toEqual([]);
  });

  it("is refused after the key like every job: the test key outside test mode", async () => {
    const a = aufgebaut({ zweck: "release" });
    await a.empfangen(neustart);
    expect(a.aufrufe).toEqual([]);
    expect(ergebnis(a.gesendet, "n-1")).toMatchObject({
      ergebnis: { ok: false, fehler: expect.stringContaining("public test key") },
    });
  });
});
