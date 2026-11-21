import { describe, expect, it } from "vitest";
import { ausfuehren, echtSpawn } from "./ausfuehren.ts";

/*
 * BAULISTE.md Z-305: the real spawn starts a fixed argv without a shell and kills it when the time
 * limit runs out; tried with real processes, not through podman.
 */
const echtPlanen = (lauf: () => void, ms: number) => {
  const t = setTimeout(lauf, ms);
  return () => clearTimeout(t);
};

describe("echtSpawn", () => {
  it("kills a process that runs past the abort", async () => {
    const abbruch = new AbortController();
    const beginn = Date.now();
    const lauf = echtSpawn(["sleep", "30"], abbruch.signal);
    setTimeout(() => abbruch.abort(), 50);
    const { code } = await lauf;
    expect(code).not.toBe(0);
    expect(Date.now() - beginn).toBeLessThan(5000);
  });

  it("hands each word over as it is, with no shell to read it", async () => {
    const { code } = await echtSpawn(
      ["test", "$(false)", "=", "$(false)"],
      new AbortController().signal,
    );
    expect(code).toBe(0);
  });

  it("throws for a program that is not there", async () => {
    await expect(
      echtSpawn(["/nicht/da/steuerzentrale"], new AbortController().signal),
    ).rejects.toThrow();
  });
});

describe("ausfuehren with the real spawn", () => {
  it("reports the time limit when it had to kill", async () => {
    // podman is not here: a stand-in that runs the plan's argv without the prefix
    const ergebnis = await ausfuehren(
      { spawn: (argv, signal) => echtSpawn(argv.slice(3), signal), planen: echtPlanen },
      {
        aktion: "langsam",
        installationId: "i",
        container: "app",
        argv: ["sleep", "30"],
        zeitlimitMs: 100,
        idempotent: false,
      },
    );
    expect(ergebnis).toEqual({
      ok: false,
      fehler: "Zeitlimit von 0.1 s überschritten, Befehl beendet",
    });
  });
});
