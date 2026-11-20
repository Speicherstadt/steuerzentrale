import { setLocale } from "@steuerzentrale/ui";
import { describe, expect, it } from "vitest";
import { gb, minuten, prozent, speicher } from "./zahl.ts";

describe("numbers with units", () => {
  it("use the German decimal comma and a space before %", () => {
    setLocale("de", { reload: false });
    expect(gb(1.25)).toBe("1,3 GB");
    expect(prozent(99.71, 2)).toBe("99,71 %");
    expect(minuten(44)).toBe("44 Min.");
  });

  it("use the English decimal point", () => {
    setLocale("en", { reload: false });
    expect(gb(38.5)).toBe("38.5 GB");
    expect(prozent(91)).toBe("91%");
  });

  it("show memory below a gigabyte in MB", () => {
    setLocale("de", { reload: false });
    expect(speicher(512)).toBe("512 MB");
    expect(speicher(8192)).toBe("8 GB");
  });
});
