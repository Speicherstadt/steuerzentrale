import { describe, expect, it } from "vitest";
import { datum, uhrzeit } from "../format/zeit.ts";
import { berlin } from "./zeit.ts";

describe("berlin wall-clock times of the fixtures", () => {
  it("hit the asked time in the night of a DST change", () => {
    // 29.03.2026: 02:00 CET becomes 03:00 CEST; 25.10.2026: 03:00 CEST becomes 02:00 CET
    for (const [tag, zeit] of [
      ["2026-03-29", "01:30"],
      ["2026-03-29", "03:30"],
      ["2026-10-25", "00:30"],
      ["2026-10-25", "01:30"],
      ["2026-10-25", "03:30"],
    ] as const) {
      const instant = berlin(tag, zeit);
      expect(`${datum(instant)} ${uhrzeit(instant)}`, `${tag} ${zeit}`).toBe(
        `${tag.split("-").reverse().join(".")} ${zeit}`,
      );
    }
  });
});
