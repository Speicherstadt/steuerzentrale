import { describe, expect, it } from "vitest";
import { echtSpawn, MARKE } from "./ausfuehren.ts";

/*
 * Review of PR #25: `podman exec` hands the command to conmon (own process group), which starts it
 * through `runc exec` a moment later. If the time limit kills `podman exec` before the command is
 * there, the single empty look of markierteBeenden returns at once, and the marked command that
 * appears right after runs on. Simulated without Podman: a helper in a session of its own (like
 * conmon) starts the marked command 500 ms later.
 */
const lebt = (argv: string) => Bun.spawnSync(["pgrep", "-f", "-x", argv]).exitCode === 0;

describe("echtSpawn at the time limit", () => {
  it("kills a marked command that appears only shortly after the abort", async () => {
    const marke = crypto.randomUUID();
    const dauer = `299.${crypto.getRandomValues(new Uint32Array(1))[0]}`;
    const spaeter = `sleep 0.5; exec env ${MARKE}=${marke} sleep ${dauer}`;
    const abbruch = new AbortController();
    try {
      const lauf = echtSpawn(
        ["sh", "-c", `setsid -f sh -c '${spaeter}'; exec sleep 30`],
        abbruch.signal,
        { marke },
      );
      await Bun.sleep(100);
      abbruch.abort();
      await lauf;
      await Bun.sleep(1500);
      expect(lebt(`sleep ${dauer}`)).toBe(false);
    } finally {
      Bun.spawnSync(["pkill", "-KILL", "-f", "-x", `sleep ${dauer}`]);
    }
  }, 15_000);
});
