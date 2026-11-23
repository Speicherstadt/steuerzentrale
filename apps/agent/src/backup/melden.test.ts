import { vomAgentenLesen } from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import { speicher } from "../beitritt/testhilfen.ts";
import { gedaechtnisOeffnen } from "../einrichtung/gedaechtnis.ts";
import type { Nutzer } from "../einrichtung/nutzer.ts";
import type { SpawnMitAusgabe } from "../zustand/pruefen.ts";
import type { Lauf } from "./datei.ts";
import { backupMelder } from "./melden.ts";

/*
 * BAULISTE.md Z-601: the agent reports each backup run of an installation it finished once, as
 * `backup_stand`, also runs made while it was disconnected, and remembers what it sent; at the
 * start of a connection the newest run goes out again, since one in flight may have been lost.
 * The stand file is read as the installation's user.
 */
const INSTALLATIONEN = "/z/installationen.json";
const GEMELDET = "/z/backup-gemeldet.json";

const lauf = (id: string, ok = true): Lauf => ({
  lauf: id,
  beginn: 1_800_000_000_000,
  ende: 1_800_000_001_000,
  ok,
  ...(ok ? {} : { fehler: "volume:daten: das Repository fehlt" }),
  teile: [{ tag: "volume:daten", ok, ...(ok ? { snapshot: "f".repeat(64) } : {}) }],
});

const aufgebaut = (zustaende: Record<string, "angelegt" | "fertig"> = { "test-a": "fertig" }) => {
  const fs = speicher({
    [INSTALLATIONEN]: JSON.stringify({
      installationen: Object.fromEntries(
        Object.entries(zustaende).map(([n, zustand]) => [n, { zustand, am: 0 }]),
      ),
    }),
  });
  const staende = new Map<string, Lauf[] | string>();
  const gelesen: { argv: readonly string[] }[] = [];
  const lesen: SpawnMitAusgabe = async (argv) => {
    gelesen.push({ argv });
    const name = argv[2]?.replace(/^sz-/, "") ?? "";
    const s = staende.get(name);
    if (s === undefined) return { code: 1, aus: "" };
    return { code: 0, aus: typeof s === "string" ? s : JSON.stringify({ laeufe: s }) };
  };
  const nutzer = async (name: string): Promise<Nutzer> => ({
    name,
    uid: 2000,
    gid: 2000,
    home: `/home/${name}`,
  });
  const runde = backupMelder({
    gedaechtnis: gedaechtnisOeffnen(fs.dateien, INSTALLATIONEN, () => 0),
    nutzer,
    lesen,
    dateien: fs.dateien,
    pfad: GEMELDET,
    log: () => {},
  });
  const gesendet: Record<string, unknown>[] = [];
  let offen = true;
  const senden = (text: string) => {
    if (!offen) return false;
    const r = vomAgentenLesen(text);
    if (!r.ok) throw new Error(r.grund);
    gesendet.push(r.nachricht);
    return true;
  };
  const trennen = () => {
    offen = false;
  };
  const verbinden = () => {
    offen = true;
  };
  return {
    fs,
    staende,
    gelesen,
    runde: (erste = false) => runde(senden, erste),
    gesendet,
    trennen,
    verbinden,
  };
};

const laeufe = (g: Record<string, unknown>[]) => g.map((n) => `${n.installationId}:${n.lauf}`);

describe("backupMelder", () => {
  it("sends each run once as backup_stand, read as the installation's user", async () => {
    const a = aufgebaut();
    a.staende.set("test-a", [lauf("l1"), lauf("l2", false)]);
    await a.runde();
    expect(a.gesendet).toEqual([
      { typ: "backup_stand", protokoll: 1, installationId: "test-a", ...lauf("l1") },
      { typ: "backup_stand", protokoll: 1, installationId: "test-a", ...lauf("l2", false) },
    ]);
    expect(a.gelesen[0]?.argv.slice(0, 3)).toEqual(["runuser", "-u", "sz-test-a"]);
    expect(a.gelesen[0]?.argv.slice(-3)).toEqual([
      "cat",
      "--",
      "/home/sz-test-a/.config/steuerzentrale/backup-stand.json",
    ]);
    await a.runde();
    expect(a.gesendet).toHaveLength(2);
    expect(a.fs.inhalt.get(GEMELDET)?.modus).toBe(0o600);
  });

  it("sends the runs made while disconnected after the connection is back", async () => {
    const a = aufgebaut();
    a.staende.set("test-a", [lauf("l1")]);
    await a.runde(true);
    a.trennen();
    a.staende.set("test-a", [lauf("l1"), lauf("l2"), lauf("l3")]);
    await a.runde();
    expect(laeufe(a.gesendet)).toEqual(["test-a:l1"]);
    a.verbinden();
    await a.runde(true);
    expect(laeufe(a.gesendet)).toEqual(["test-a:l1", "test-a:l2", "test-a:l3"]);
  });

  it("sends the newest run again at the start of a connection", async () => {
    const a = aufgebaut();
    a.staende.set("test-a", [lauf("l1"), lauf("l2")]);
    await a.runde(true);
    await a.runde(true);
    expect(laeufe(a.gesendet)).toEqual(["test-a:l1", "test-a:l2", "test-a:l2"]);
  });

  it("remembers what it sent across a restart of the agent", async () => {
    const a = aufgebaut();
    a.staende.set("test-a", [lauf("l1")]);
    await a.runde();
    const b = aufgebaut();
    b.fs.inhalt.set(GEMELDET, a.fs.inhalt.get(GEMELDET) ?? { text: "", modus: 0 });
    b.staende.set("test-a", [lauf("l1"), lauf("l2")]);
    await b.runde();
    expect(laeufe(b.gesendet)).toEqual(["test-a:l2"]);
  });

  it("reads only installations it finished, and skips a stand that is not one", async () => {
    const a = aufgebaut({ "test-a": "fertig", "test-b": "angelegt", "test-c": "fertig" });
    a.staende.set("test-a", "{kaputt");
    a.staende.set("test-b", [lauf("b1")]);
    a.staende.set("test-c", [lauf("c1")]);
    await a.runde();
    expect(laeufe(a.gesendet)).toEqual(["test-c:c1"]);
    expect(a.gelesen.map((g) => g.argv[2])).toEqual(["sz-test-a", "sz-test-c"]);
  });
});
