import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { benannt, echtRestic, namenloseDatei } from "./echt.ts";

/*
 * BAULISTE.md Z-601: how restic gets password and access for real, with harmless programs in
 * restic's place: as descriptors 3 and 4 of files that have no name any more, never in an argv;
 * a source's output on its standard input; the end of its output read back.
 */
const ORDNER = mkdtempSync(join(tmpdir(), "sz-test-sichern-"));
afterAll(() => rmSync(ORDNER, { recursive: true, force: true }));

describe("namenloseDatei", () => {
  it("leaves a readable descriptor and no file behind", () => {
    const fd = namenloseDatei("geheim\n", ORDNER);
    expect(readFileSync(fd, "utf8")).toBe("geheim\n");
    expect(readdirSync(ORDNER)).toEqual([]);
  });
});

describe("benannt", () => {
  it("names the container of podman run, so an aborted run can remove it", () => {
    expect(benannt(["podman", "run", "--rm", "img"], "sz-sichern-1")).toEqual([
      "podman",
      "run",
      "--name",
      "sz-sichern-1",
      "--rm",
      "img",
    ]);
    expect(benannt(["sh", "-c", "x"], "n")).toEqual(["sh", "-c", "x"]);
  });
});

describe("echtRestic", () => {
  const lauf = echtRestic(ORDNER);

  it("hands password and access on descriptors 3 and 4 and the source on standard input", async () => {
    const r = await lauf(
      {
        argv: ["sh", "-c", 'printf "%s|" "$(cat /dev/fd/3)" "$(cat /dev/fd/4)" "$(cat)"'],
        quelle: ["printf", "daten"],
      },
      { passwort: "pw-1", zugang: "[default]" },
      new AbortController().signal,
    );
    expect(r).toEqual({ code: 0, aus: "pw-1|[default]|daten|", quelleCode: 0 });
    expect(readdirSync(ORDNER)).toEqual([]);
  });

  it("reports the exit codes of restic and the source", async () => {
    const r = await lauf(
      { argv: ["sh", "-c", "cat >/dev/null; exit 12"], quelle: ["sh", "-c", "exit 3"] },
      { passwort: "p", zugang: "z" },
      new AbortController().signal,
    );
    expect(r).toEqual({ code: 12, aus: "", quelleCode: 3 });
  });

  it("kills restic when the signal aborts", async () => {
    const abbruch = new AbortController();
    const laufend = lauf({ argv: ["sleep", "30"] }, { passwort: "p", zugang: "z" }, abbruch.signal);
    setTimeout(() => abbruch.abort(), 50);
    expect((await laufend).code).not.toBe(0);
  }, 10_000);

  it("throws when restic cannot start, and leaves no file", async () => {
    await expect(
      lauf(
        { argv: ["/gibt/es/nicht"] },
        { passwort: "p", zugang: "z" },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(readdirSync(ORDNER)).toEqual([]);
  });
});
