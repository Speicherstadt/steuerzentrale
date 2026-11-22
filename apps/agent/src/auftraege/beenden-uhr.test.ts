import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markierteBeenden } from "./beenden.ts";

/*
 * Review of PR #25 (536d7e3): the after-run is measured with the wall clock. When the clock is
 * stepped back while it runs (NTP, an hour), the agent keeps looking for that hour, and the job or
 * health check that waits for echtSpawn waits with it.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

describe("markierteBeenden", () => {
  it("ends its after-run in about 3 s even when the wall clock is stepped back", async () => {
    const proc = mkdtempSync(join(tmpdir(), "sz-proc-"));
    const echt = Date.now.bind(Date);
    let erster = true;
    vi.spyOn(Date, "now").mockImplementation(() => {
      if (erster) {
        erster = false;
        return echt();
      }
      return echt() - 3_600_000;
    });
    const fertig = await Promise.race([
      markierteBeenden("STEUERZENTRALE_LAUF=x", proc).then(() => true),
      Bun.sleep(6000).then(() => false),
    ]);
    expect(fertig).toBe(true);
  }, 10_000);
});
