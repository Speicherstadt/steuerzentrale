import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { echteHausDateien } from "./echt.ts";
import { hausPlan } from "./haus.ts";

/*
 * docs/plan.md, "Einrichten auf dem Server": what goes into a user's home, with which mode, and how
 * root writes there without following what the user may have put in its way.
 */

const QUADLETS = {
  units: { "x.container": "[Container]\n", "x.network": "[Network]\n" },
  systemd: { "x.slice": "[Slice]\n" },
  dateien: { "app/etc/x/a.conf": "a", "worker/b.txt": "b" },
  secrets: { "x-geheim": "nie in einer Datei" },
  pforte: null,
};

describe("hausPlan", () => {
  it("puts units, slice and files where Quadlet and the units look, folders before their files", () => {
    const plan = hausPlan("/home/sz-x", QUADLETS);
    expect(plan.verzeichnisse.map((v) => v.pfad.replace("/home/sz-x/", ""))).toEqual([
      ".config",
      ".config/containers",
      ".config/steuerzentrale",
      ".config/systemd",
      ".config/containers/systemd",
      ".config/steuerzentrale/dateien",
      ".config/systemd/user",
      ".config/steuerzentrale/dateien/app",
      ".config/steuerzentrale/dateien/worker",
      ".config/steuerzentrale/dateien/app/etc",
      ".config/steuerzentrale/dateien/app/etc/x",
    ]);
    expect(plan.dateien).toEqual([
      {
        pfad: "/home/sz-x/.config/containers/systemd/x.container",
        inhalt: "[Container]\n",
        modus: 0o600,
      },
      {
        pfad: "/home/sz-x/.config/containers/systemd/x.network",
        inhalt: "[Network]\n",
        modus: 0o600,
      },
      { pfad: "/home/sz-x/.config/systemd/user/x.slice", inhalt: "[Slice]\n", modus: 0o600 },
      {
        pfad: "/home/sz-x/.config/steuerzentrale/dateien/app/etc/x/a.conf",
        inhalt: "a",
        modus: 0o644,
      },
      { pfad: "/home/sz-x/.config/steuerzentrale/dateien/worker/b.txt", inhalt: "b", modus: 0o644 },
    ]);
    expect(plan.verzeichnisse.every((v) => v.modus === 0o700)).toBe(true);
  });

  it("writes no secret into a file: those go to Podman", () => {
    expect(JSON.stringify(hausPlan("/home/sz-x", QUADLETS))).not.toContain("nie in einer Datei");
  });

  it("refuses a path that leaves its folder", () => {
    expect(() => hausPlan("/h", { ...QUADLETS, dateien: { "app/../../.bashrc": "x" } })).toThrow();
  });
});

describe("echteHausDateien", () => {
  const ordner = mkdtempSync(join(tmpdir(), "sz-test-haus-"));
  afterAll(() => rmSync(ordner, { recursive: true, force: true }));
  const ich = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };

  it("makes a folder with its mode, and narrows one that is there", async () => {
    const pfad = join(ordner, "home");
    await echteHausDateien.verzeichnis(pfad, 0o755, ich);
    await echteHausDateien.verzeichnis(pfad, 0o700, ich);
    expect(statSync(pfad).mode & 0o777).toBe(0o700);
  });

  it("writes a file with its mode, whatever the umask, and replaces one that is there", async () => {
    const pfad = join(ordner, "unit");
    await echteHausDateien.schreiben(pfad, "alt", 0o644, ich);
    await echteHausDateien.schreiben(pfad, "neu", 0o600, ich);
    expect(readFileSync(pfad, "utf8")).toBe("neu");
    expect(statSync(pfad).mode & 0o777).toBe(0o600);
  });

  it("never writes through a symlink in the place of the file or of its temporary file", async () => {
    const ziel = join(ordner, "ziel");
    writeFileSync(ziel, "unberuehrt");
    const pfad = join(ordner, "falle");
    symlinkSync(ziel, pfad);
    symlinkSync(ziel, `${pfad}.sz-neu`);
    await echteHausDateien.schreiben(pfad, "geschrieben", 0o600, ich);
    expect(readFileSync(ziel, "utf8")).toBe("unberuehrt");
    expect(readFileSync(pfad, "utf8")).toBe("geschrieben");
  });

  // two setup jobs at once (the agent tests run their files in parallel, each with its own agent)
  // both make sure the Pforte runs: neither may fail because the other makes the same folder or
  // writes the same unit at the same moment (Z-503, CI run 45134053414)
  it("makes the same folder twice at once", async () => {
    const pfad = join(ordner, "zugleich");
    const r = await Promise.allSettled([
      echteHausDateien.verzeichnis(pfad, 0o700, ich),
      echteHausDateien.verzeichnis(pfad, 0o700, ich),
    ]);
    expect(r).toEqual([
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
    ]);
    expect(statSync(pfad).mode & 0o777).toBe(0o700);
  });

  it("writes the same file twice at once", async () => {
    const pfad = join(ordner, "zugleich.container");
    const r = await Promise.allSettled([
      echteHausDateien.schreiben(pfad, "[Container]\n", 0o600, ich),
      echteHausDateien.schreiben(pfad, "[Container]\n", 0o600, ich),
    ]);
    expect(r).toEqual([
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
    ]);
    expect(readFileSync(pfad, "utf8")).toBe("[Container]\n");
    expect(readdirSync(ordner).filter((n) => n.startsWith("zugleich.container."))).toEqual([]);
  });

  it("refuses a symlink in the place of a folder", async () => {
    const pfad = join(ordner, "ordnerfalle");
    symlinkSync(ordner, pfad);
    await expect(echteHausDateien.verzeichnis(pfad, 0o700, ich)).rejects.toThrow("not a folder");
  });
});
