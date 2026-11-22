import { describe, expect, it } from "vitest";
import { echtLesen } from "./echt.ts";

/*
 * The real reader of `systemctl show` (Z-403). It runs behind `runuser`, which forks: the signal
 * kills runuser, while systemctl, its child, keeps the pipe of the standard output open. The time
 * limit (UNITS_MS) holds only if the reader stops at the signal, not at the end of the output.
 */
describe("echtLesen", () => {
  it("returns at its signal, even while a child of the killed process still holds the output", async () => {
    const abbruch = new AbortController();
    const start = performance.now();
    setTimeout(() => abbruch.abort(), 100);
    // sh forks sleep, which inherits the pipe and outlives the SIGKILL to sh
    await echtLesen(["sh", "-c", "sleep 5; true"], abbruch.signal).catch(() => undefined);
    expect(performance.now() - start).toBeLessThan(2000);
  }, 10_000);

  // no orphan either: the child of the killed process ends with it (as in auftraege/ausfuehren.ts)
  it("kills the children of the process at its signal, not only the process", async () => {
    const dauer = `299.${crypto.getRandomValues(new Uint32Array(1))[0]}`;
    const lebt = () => Bun.spawnSync(["pgrep", "-f", "-x", `sleep ${dauer}`]).exitCode === 0;
    const abbruch = new AbortController();
    try {
      const lauf = echtLesen(["timeout", "--foreground", "300", "sleep", dauer], abbruch.signal);
      for (let i = 0; i < 100 && !lebt(); i++) await Bun.sleep(50);
      abbruch.abort();
      await lauf.catch(() => undefined);
      for (let i = 0; i < 100 && lebt(); i++) await Bun.sleep(50);
      expect(lebt()).toBe(false);
    } finally {
      Bun.spawnSync(["pkill", "-KILL", "-f", "-x", `sleep ${dauer}`]);
    }
  }, 15_000);

  it("reads the output of a process that ends", async () => {
    const r = await echtLesen(["sh", "-c", "echo Id=a.service"], new AbortController().signal);
    expect(r).toEqual({ code: 0, aus: "Id=a.service\n" });
  });
});
