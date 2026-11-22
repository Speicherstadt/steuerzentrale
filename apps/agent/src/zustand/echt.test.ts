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

  it("reads the output of a process that ends", async () => {
    const r = await echtLesen(["sh", "-c", "echo Id=a.service"], new AbortController().signal);
    expect(r).toEqual({ code: 0, aus: "Id=a.service\n" });
  });
});
