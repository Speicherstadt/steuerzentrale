import { describe, expect, it } from "vitest";
import { qrPfad, totpGeheimnis } from "./qr.ts";

describe("qrPfad", () => {
  it("draws a square code with a quiet zone as one path of rectangles", () => {
    const { groesse, d } = qrPfad("otpauth://totp/Steuerzentrale:a%40b.test?secret=ABC");
    expect(groesse).toBeGreaterThan(21);
    expect(d).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
    // the border of two modules stays empty
    expect(d.startsWith("M0 ") || d.startsWith("M1 ")).toBe(false);
  });
});

describe("totpGeheimnis", () => {
  it("takes the secret of an otpauth URI", () => {
    expect(totpGeheimnis("otpauth://totp/X:y?secret=JBSWY3DP&issuer=X")).toBe("JBSWY3DP");
    expect(totpGeheimnis("kaputt")).toBe("");
  });
});
