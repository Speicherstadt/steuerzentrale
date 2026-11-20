import { describe, expect, it } from "vitest";
import { ZEITZONE } from "./index.ts";

describe("planung", () => {
  it("plans windows in Europe/Berlin, a zone the runtime knows", () => {
    expect(
      new Intl.DateTimeFormat("de-DE", { timeZone: ZEITZONE }).resolvedOptions().timeZone,
    ).toBe("Europe/Berlin");
  });
});
