import { RESTIC_IMAGE } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import type { Geheim, ResticAntwort, ResticAufruf } from "../backup/sichern.ts";
import { lsLesen, type SpielEingabe, spielenBefehl, teilSpielen } from "./spielen.ts";

/*
 * BAULISTE.md Z-602, one part played back as the target's user (docs/plan.md, "Prüf-Restore auf
 * dem Server"): the newest snapshot of the part's tag on the source's host, found with `ls --json`;
 * a volume as tar of its folder into `podman volume import`, then owner and mode of the volume's
 * root as in the snapshot; a dump into `pg_restore` in its container. restic and Podman are
 * passed in; checked against restic v0.20.0 (cmd/restic/cmd_ls.go, cmd/restic/cmd_dump.go,
 * doc/050_restore.rst) and, by hand, Podman 4.9.3.
 */
const SNAPSHOT = "f".repeat(64);
const PASSWORT = "restic-passwort-der-installation";
const GEHEIM = "s3-geheimnis-0815-abc";
const QUELLE = "beispiel-x7k2p9";
const ZIEL = "restore-a1b2c3";

const VOLUME: SpielEingabe = {
  quelle: QUELLE,
  repository: "s3:https://s3.example.org/sicherung/b-1/beispiel-x7k2p9",
  zugang: { schluesselId: "SZBEISPIEL0000000001", geheim: GEHEIM },
  passwort: PASSWORT,
  teil: { art: "volume", tag: "volume:daten", volume: `${ZIEL}-daten`, pfad: "/sicherung/daten" },
};

const PG: SpielEingabe = {
  ...VOLUME,
  teil: {
    art: "pg_dump",
    tag: "pg_dump:db:beispiel",
    container: `${ZIEL}-db`,
    datei: "/db-beispiel.dump",
    argv: ["pg_restore", "--clean", "--if-exists", "-d", "beispiel", "-U", "beispiel"],
  },
};

/** `restic ls --json` of the folder /sicherung, as restic 0.20.0 printed it by hand */
const LS = [
  JSON.stringify({
    id: SNAPSHOT,
    hostname: QUELLE,
    struct_type: "snapshot",
    message_type: "snapshot",
  }),
  JSON.stringify({
    name: "sicherung",
    type: "dir",
    path: "/sicherung",
    uid: 0,
    gid: 0,
    mode: 2147484141,
    struct_type: "node",
  }),
  JSON.stringify({
    name: "daten",
    type: "dir",
    path: "/sicherung/daten",
    uid: 1000,
    gid: 1000,
    mode: 2147484136,
    struct_type: "node",
  }),
].join("\n");

type Antworten = {
  ls?: Partial<ResticAntwort>;
  dump?: Partial<ResticAntwort>;
  podman?: (argv: readonly string[]) => { code: number; aus: string } | undefined;
};

const welt = (a: Antworten = {}) => {
  const restic: { aufruf: ResticAufruf; geheim: Geheim }[] = [];
  const podman: string[][] = [];
  const deps = {
    restic: async (aufruf: ResticAufruf, geheim: Geheim): Promise<ResticAntwort> => {
      restic.push({ aufruf, geheim });
      const ls = aufruf.argv.includes("ls");
      const r = ls ? { code: 0, aus: LS, ...a.ls } : { code: 0, aus: "", zielCode: 0, ...a.dump };
      return r;
    },
    lesen: async (argv: readonly string[]) => {
      podman.push([...argv]);
      const eigen = a.podman?.(argv);
      if (eigen) return eigen;
      if (argv[2] === "inspect")
        return {
          code: 0,
          aus: `/home/sz-${ZIEL}/.local/share/containers/storage/volumes/x/_data\n`,
        };
      return { code: 0, aus: "" };
    },
  };
  return { deps, restic, podman };
};

/** restic's argv after the image: its own options and command */
const nachImage = (argv: string[]) => argv.slice(argv.indexOf(RESTIC_IMAGE.image) + 1);

describe("teilSpielen", () => {
  it("plays a volume back as tar of its folder into podman volume import, then its root's owner and mode", async () => {
    const w = welt();
    expect(await teilSpielen(w.deps, ZIEL, VOLUME)).toEqual({ ok: true, snapshot: SNAPSHOT });
    const [ls, dump] = w.restic.map((r) => r.aufruf);
    expect(nachImage(ls?.argv ?? [])).toEqual([
      "--no-cache",
      "--repo",
      VOLUME.repository,
      "ls",
      "--json",
      "latest",
      "--host",
      QUELLE,
      "--tag",
      "volume:daten",
      "/sicherung",
    ]);
    // restic runs in the target's network
    expect(ls?.argv.slice(0, 6)).toEqual([
      "podman",
      "run",
      "--rm",
      "--network",
      ZIEL,
      "--preserve-fds",
    ]);
    expect(nachImage(dump?.argv ?? []).slice(3)).toEqual([
      "dump",
      "--archive",
      "tar",
      `${SNAPSHOT}:/sicherung/daten`,
      "/",
    ]);
    expect(dump?.ziel).toEqual(["podman", "volume", "import", `${ZIEL}-daten`, "-"]);
    const pfad = `/home/sz-${ZIEL}/.local/share/containers/storage/volumes/x/_data`;
    expect(w.podman).toEqual([
      ["podman", "volume", "inspect", "--format", "{{.Mountpoint}}", `${ZIEL}-daten`],
      ["podman", "unshare", "chown", "1000:1000", "--", pfad],
      ["podman", "unshare", "chmod", "750", "--", pfad],
    ]);
  });

  it("restores a dump through pg_restore in its container, from the dump's file", async () => {
    const w = welt();
    expect(await teilSpielen(w.deps, ZIEL, PG)).toEqual({ ok: true, snapshot: SNAPSHOT });
    const [ls, dump] = w.restic.map((r) => r.aufruf);
    expect(nachImage(ls?.argv ?? []).at(-1)).toBe("/");
    expect(nachImage(dump?.argv ?? []).slice(3)).toEqual(["dump", SNAPSHOT, "/db-beispiel.dump"]);
    expect(dump?.ziel).toEqual([
      "podman",
      "exec",
      "-i",
      `${ZIEL}-db`,
      ...["pg_restore", "--clean", "--if-exists", "-d", "beispiel", "-U", "beispiel"],
    ]);
    expect(w.podman).toEqual([]);
  });

  it("hands password and access to restic beside its argv, never in it", async () => {
    const w = welt();
    await teilSpielen(w.deps, ZIEL, VOLUME);
    for (const { aufruf, geheim } of w.restic) {
      expect(geheim.passwort).toBe(PASSWORT);
      expect(geheim.zugang).toContain(GEHEIM);
      expect(JSON.stringify(aufruf)).not.toContain(PASSWORT);
      expect(JSON.stringify(aufruf)).not.toContain(GEHEIM);
    }
  });

  it.each([
    [
      "a wrong password",
      { ls: { code: 12 } },
      "Snapshot suchen: falsches Passwort des Repositorys",
    ],
    ["no snapshot of the part", { ls: { aus: "" } }, "kein Snapshot mit volume:daten"],
    ["a damaged pack", { dump: { code: 1 } }, "restic dump: restic endete mit Code 1"],
    [
      "an import that fails",
      { dump: { zielCode: 125 } },
      "podman volume import endete mit Code 125",
    ],
  ] as const)("fails for %s with its reason", async (_was, a, grund) => {
    const r = await teilSpielen(welt(a).deps, ZIEL, VOLUME);
    expect(r).toMatchObject({ ok: false, grund });
  });

  it("fails when the folder of the volume is not in the snapshot", async () => {
    const ls = { aus: LS.split("\n").slice(0, 2).join("\n") };
    expect(await teilSpielen(welt({ ls }).deps, ZIEL, VOLUME)).toEqual({
      ok: false,
      grund: "/sicherung/daten fehlt im Snapshot",
      snapshot: SNAPSHOT,
    });
  });

  it("fails when the owner of the volume's root cannot be set", async () => {
    const podman = (argv: readonly string[]) =>
      argv[2] === "chown" ? { code: 1, aus: "" } : undefined;
    expect(await teilSpielen(welt({ podman }).deps, ZIEL, VOLUME)).toMatchObject({
      ok: false,
      grund: "podman unshare chown endete mit Code 1",
    });
  });

  it("names pg_restore when the restore fails", async () => {
    expect(await teilSpielen(welt({ dump: { zielCode: 1 } }).deps, ZIEL, PG)).toMatchObject({
      ok: false,
      grund: "pg_restore endete mit Code 1",
    });
  });
});

describe("teilSpielen with the snapshot of a job (Z-603)", () => {
  /** `ls --json` of a snapshot of this host with these tags */
  const lsVon = (hostname: string, tags: string[]) => ({
    aus: [JSON.stringify({ ...JSON.parse(LS.split("\n")[0] ?? ""), hostname, tags })]
      .concat(LS.split("\n").slice(1))
      .join("\n"),
  });
  const MIT: SpielEingabe = { ...VOLUME, snapshot: SNAPSHOT, unit: true };

  it("lists that snapshot by its ID and keeps restic's container in the unit's cgroup", async () => {
    const w = welt({ ls: lsVon(QUELLE, ["volume:daten"]) });
    expect(await teilSpielen(w.deps, ZIEL, MIT)).toEqual({ ok: true, snapshot: SNAPSHOT });
    const [ls, dump] = w.restic.map((r) => r.aufruf);
    expect(nachImage(ls?.argv ?? []).slice(3)).toEqual(["ls", "--json", SNAPSHOT, "/sicherung"]);
    for (const a of [ls, dump])
      expect(a?.argv.slice(0, 5)).toEqual(["podman", "run", "--rm", "--cgroups", "split"]);
    expect(nachImage(dump?.argv ?? []).slice(3)).toEqual([
      "dump",
      "--archive",
      "tar",
      `${SNAPSHOT}:/sicherung/daten`,
      "/",
    ]);
  });

  it.each([
    ["of another installation", lsVon("andere-a1b2c3", ["volume:daten"])],
    ["of another part", lsVon(QUELLE, ["pg_dump:db:beispiel"])],
    ["without tags", lsVon(QUELLE, [])],
    ["another than asked", { aus: LS.replace(SNAPSHOT, "e".repeat(64)) }],
  ])("plays nothing back from a snapshot %s", async (_was, ls) => {
    const w = welt({ ls });
    expect(await teilSpielen(w.deps, ZIEL, MIT)).toEqual({
      ok: false,
      grund: `Snapshot ${SNAPSHOT} ist keiner von volume:daten dieser Installation`,
    });
    expect(w.restic).toHaveLength(1);
    expect(w.podman).toEqual([]);
  });

  it("refuses a snapshot that is no full ID", async () => {
    const w = welt();
    const r = await spielenBefehl([ZIEL], {
      ...w.deps,
      uid: () => 1000,
      eingabe: async () => JSON.stringify({ ...MIT, snapshot: "latest" }),
    });
    expect(r.code).toBe(1);
    expect(w.restic).toEqual([]);
  });
});

describe("lsLesen", () => {
  it("reads the snapshot and the folder's owner and permission bits", () => {
    expect(lsLesen(LS, "/sicherung/daten")).toEqual({
      snapshot: SNAPSHOT,
      wurzel: { uid: 1000, gid: 1000, modus: 0o750 },
    });
    expect(lsLesen("kein json\n", "/")).toBeUndefined();
  });
});

describe("steuerzentrale-agent zurueckspielen", () => {
  const befehl = (eingabe: string, uid = 1000) => {
    const w = welt();
    return spielenBefehl([ZIEL], { ...w.deps, uid: () => uid, eingabe: async () => eingabe });
  };

  it("answers with the snapshot as its last line", async () => {
    expect(await befehl(JSON.stringify(VOLUME))).toEqual({
      code: 0,
      out: JSON.stringify({ ok: true, snapshot: SNAPSHOT }),
    });
  });

  it("refuses to run as root, and input that is no part", async () => {
    expect((await befehl(JSON.stringify(VOLUME), 0)).code).toBe(1);
    const falsch = await befehl(JSON.stringify({ ...VOLUME, teil: { art: "befehl" } }));
    expect(falsch.code).toBe(1);
    expect(falsch.out).not.toContain(PASSWORT);
    expect((await befehl("kein json")).code).toBe(1);
  });

  it("refuses a target that is no installation's name", async () => {
    const w = welt();
    const r = await spielenBefehl(["-x"], { ...w.deps, uid: () => 1, eingabe: async () => "" });
    expect(r.code).toBe(2);
  });
});
