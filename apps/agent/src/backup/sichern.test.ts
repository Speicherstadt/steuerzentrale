import { describe, expect, it } from "vitest";
import type { BackupDatei } from "./datei.ts";
import { type ResticAntwort, type ResticAufruf, repositoryAnlegen, sichern } from "./sichern.ts";

/*
 * BAULISTE.md Z-601, one run of `sichern` (docs/plan.md, "Backup auf dem Server"): every part with
 * its own tag, then the retention only when all parts went through; a part that fails fails the
 * run with a reason that names the part and restic's exit code, never output; a snapshot of a
 * source that failed is forgotten again. Password and access go to restic beside the argv, never
 * in it. restic is a fake here that answers by argv.
 */
const PASSWORT = "restic-passwort-der-installation";
const GEHEIM = "s3-geheimnis-0815";

const DATEI: BackupDatei = {
  installation: "test-x",
  repository: "s3:http://10.0.2.2:29400/sicherung/test-x",
  zugang: { schluesselId: "SZ01", geheim: GEHEIM },
  passwort: PASSWORT,
  teile: [
    { art: "volume", tag: "volume:daten", volume: "test-x-daten", pfad: "/sicherung/daten" },
    {
      art: "befehl",
      tag: "befehl:export",
      container: "test-x-app",
      argv: ["bun", "/app/server.ts", "export"],
      dateiname: "export",
      zeitlimitS: 60,
    },
    {
      art: "pg_dump",
      tag: "pg_dump:db:beispiel",
      container: "test-x-db",
      argv: ["pg_dump", "-Fc", "-U", "beispiel", "-d", "beispiel"],
      dateiname: "db-beispiel.dump",
    },
  ],
};

const summary = (n: number) =>
  `{"message_type":"summary","snapshot_id":"${String(n).repeat(64).slice(0, 64)}"}\n`;

type Antwort = (a: ResticAufruf) => ResticAntwort | "haengt" | "startet nicht" | undefined;

const fake = (antwort: Antwort = () => undefined) => {
  const aufrufe: { argv: string[]; quelle?: string[]; geheim: unknown }[] = [];
  let n = 0;
  const plaene: { ms: number; lauf: () => void }[] = [];
  let zeit = 1_800_000_000_000;
  const deps = {
    restic: async (a: ResticAufruf, geheim: unknown, signal: AbortSignal) => {
      aufrufe.push({ ...a, geheim });
      const r = antwort(a);
      if (r === "startet nicht") throw new Error("ENOENT podman");
      if (r === "haengt")
        return new Promise<ResticAntwort>((fertig) =>
          signal.addEventListener("abort", () => fertig({ code: null, aus: "" })),
        );
      if (r) return r;
      n += 1;
      return a.argv.includes("backup")
        ? { code: 0, aus: summary(n), ...(a.quelle ? { quelleCode: 0 } : {}) }
        : { code: 0, aus: "" };
    },
    jetzt: () => (zeit += 1000),
    id: () => "lauf-1",
    planen: (lauf: () => void, ms: number) => {
      plaene.push({ ms, lauf });
      return () => {};
    },
  };
  /** restic's subcommand of each call: backup's tag, forget, cat config, init */
  const befehle = () =>
    aufrufe.map((a) => {
      const i = a.argv.indexOf("--repo") + 2;
      const was = a.argv[i] ?? "";
      return was === "backup"
        ? `backup ${a.argv[a.argv.indexOf("--tag") + 1]}`
        : a.argv.slice(i).join(" ");
    });
  return { deps, aufrufe, befehle, plaene };
};

const tagDer = (a: ResticAufruf) => a.argv[a.argv.indexOf("--tag") + 1];

describe("sichern", () => {
  it("backs up each part with its tag, then forgets by the retention", async () => {
    const f = fake();
    const lauf = await sichern(f.deps, DATEI);
    expect(f.befehle()).toEqual([
      "backup volume:daten",
      "backup befehl:export",
      "backup pg_dump:db:beispiel",
      "forget --host test-x --group-by host,tags --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune",
    ]);
    expect(lauf).toEqual({
      lauf: "lauf-1",
      beginn: 1_800_000_001_000,
      ende: 1_800_000_002_000,
      ok: true,
      teile: [
        { tag: "volume:daten", ok: true, snapshot: "1".repeat(64) },
        { tag: "befehl:export", ok: true, snapshot: "2".repeat(64) },
        { tag: "pg_dump:db:beispiel", ok: true, snapshot: "3".repeat(64) },
      ],
    });
  });

  it("reports the bytes restic read for a part (Z-804), none where its summary names none", async () => {
    const f = fake((a) =>
      tagDer(a) === "volume:daten"
        ? {
            code: 0,
            aus: `{"message_type":"summary","total_bytes_processed":4096,"snapshot_id":"${"9".repeat(64)}"}\n`,
          }
        : undefined,
    );
    const lauf = await sichern(f.deps, DATEI);
    expect(lauf.teile[0]).toEqual({
      tag: "volume:daten",
      ok: true,
      snapshot: "9".repeat(64),
      bytes: 4096,
    });
    expect(lauf.teile[1]).not.toHaveProperty("bytes");
  });

  it("hands password and access beside the argv, never in it", async () => {
    const f = fake();
    await sichern(f.deps, DATEI);
    for (const a of f.aufrufe) {
      expect(a.geheim).toEqual({
        passwort: PASSWORT,
        zugang: `[default]\naws_access_key_id = SZ01\naws_secret_access_key = ${GEHEIM}\n`,
      });
      expect(JSON.stringify([a.argv, a.quelle])).not.toContain(PASSWORT);
      expect(JSON.stringify([a.argv, a.quelle])).not.toContain(GEHEIM);
    }
  });

  it("reads a dump and a command from their containers", async () => {
    const f = fake();
    await sichern(f.deps, DATEI);
    expect(f.aufrufe.map((a) => a.quelle)).toEqual([
      undefined,
      ["podman", "exec", "test-x-app", "bun", "/app/server.ts", "export"],
      ["podman", "exec", "test-x-db", "pg_dump", "-Fc", "-U", "beispiel", "-d", "beispiel"],
      undefined,
    ]);
  });

  it("fails the run with the part and restic's reason, goes on with the others, and keeps the snapshots", async () => {
    const f = fake((a) =>
      tagDer(a) === "volume:daten"
        ? { code: 1, aus: "Fatal: unable to open repository at s3:… secret output" }
        : undefined,
    );
    const lauf = await sichern(f.deps, DATEI);
    expect(lauf.ok).toBe(false);
    expect(lauf.fehler).toBe("volume:daten: restic endete mit Code 1");
    expect(lauf.teile[0]).toEqual({
      tag: "volume:daten",
      ok: false,
      fehler: "restic endete mit Code 1",
    });
    expect(lauf.teile.slice(1).every((t) => t.ok)).toBe(true);
    // no retention while a part fails: the snapshots before stay as they are
    expect(f.befehle().some((b) => b.startsWith("forget"))).toBe(false);
    expect(JSON.stringify(lauf)).not.toContain("secret output");
  });

  it("names a wrong password by restic's exit code", async () => {
    const f = fake(() => ({ code: 12, aus: "" }));
    const lauf = await sichern(f.deps, DATEI);
    expect(lauf.teile.map((t) => t.fehler)).toEqual([
      "falsches Passwort des Repositorys",
      "falsches Passwort des Repositorys",
      "falsches Passwort des Repositorys",
    ]);
  });

  it("forgets the snapshot of a command that failed and fails the part", async () => {
    const f = fake((a) =>
      tagDer(a) === "befehl:export" ? { code: 0, aus: summary(7), quelleCode: 2 } : undefined,
    );
    const lauf = await sichern(f.deps, DATEI);
    expect(lauf.teile[1]).toEqual({
      tag: "befehl:export",
      ok: false,
      fehler: "die Quelle endete mit Code 2",
    });
    expect(f.befehle()).toContain(`forget ${"7".repeat(64)}`);
  });

  it("fails a part without a snapshot, and one restic could not start", async () => {
    const f = fake((a) => {
      if (tagDer(a) === "volume:daten") return { code: 0, aus: "" };
      if (tagDer(a) === "befehl:export") return "startet nicht";
      return undefined;
    });
    const lauf = await sichern(f.deps, DATEI);
    expect(lauf.teile.map((t) => t.fehler)).toEqual([
      "restic nannte keinen Snapshot",
      "restic startete nicht",
      undefined,
    ]);
  });

  it("fails the run when the retention fails", async () => {
    const f = fake((a) => (a.argv.includes("--prune") ? { code: 11, aus: "" } : undefined));
    const lauf = await sichern(f.deps, DATEI);
    expect(lauf).toMatchObject({ ok: false, fehler: "Aufbewahrung: das Repository ist gesperrt" });
    expect(lauf.teile.every((t) => t.ok)).toBe(true);
  });

  it("stops a command at its own time limit", async () => {
    const f = fake((a) => (tagDer(a) === "befehl:export" ? "haengt" : undefined));
    const laufend = sichern(f.deps, DATEI);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    f.plaene.find((p) => p.ms === 60_000)?.lauf();
    const lauf = await laufend;
    expect(lauf.teile[1]).toEqual({
      tag: "befehl:export",
      ok: false,
      fehler: "Zeitlimit von 60 s überschritten",
    });
    expect(lauf.teile[2]?.ok).toBe(true);
  });

  it("stops the run before the service's limit so it can still write its result", async () => {
    const f = fake((a) => (tagDer(a) === "volume:daten" ? "haengt" : undefined));
    const laufend = sichern(f.deps, DATEI);
    await new Promise((r) => setTimeout(r, 0));
    const gesamt = f.plaene.find((p) => p.ms === (4 * 3600 - 300) * 1000);
    gesamt?.lauf();
    const lauf = await laufend;
    expect(lauf.fehler).toContain("volume:daten: Zeitlimit des Laufs überschritten");
    expect(lauf.teile.slice(1).map((t) => t.fehler)).toEqual([
      "Zeitlimit des Laufs überschritten",
      "Zeitlimit des Laufs überschritten",
    ]);
  });
});

describe("repositoryAnlegen", () => {
  it("leaves a repository that is there", async () => {
    const f = fake();
    expect(await repositoryAnlegen(f.deps, DATEI)).toEqual({ ok: true, repository: "vorhanden" });
    expect(f.befehle()).toEqual(["cat config"]);
  });

  it("creates one when restic says there is none", async () => {
    const f = fake((a) => (a.argv.at(-1) === "config" ? { code: 10, aus: "" } : undefined));
    expect(await repositoryAnlegen(f.deps, DATEI)).toEqual({ ok: true, repository: "angelegt" });
    expect(f.befehle()).toEqual(["cat config", "init"]);
  });

  it("creates none for a wrong password or an unreachable S3", async () => {
    const falsch = fake(() => ({ code: 12, aus: "" }));
    expect(await repositoryAnlegen(falsch.deps, DATEI)).toEqual({
      ok: false,
      grund: "Repository: falsches Passwort des Repositorys",
    });
    const weg = fake(() => ({ code: 1, aus: "dial tcp: connection refused" }));
    expect(await repositoryAnlegen(weg.deps, DATEI)).toEqual({
      ok: false,
      grund: "Repository: restic endete mit Code 1",
    });
    expect(weg.befehle()).toEqual(["cat config"]);
  });
});
