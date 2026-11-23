import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SIGNATUR_TOLERANZ_MS, signaturPruefen, signieren } from "./signatur.ts";

/*
 * BAULISTE.md Z-703: a webhook carries `X-Steuerzentrale-Signatur: t=<ms>,v1=<hex>`, the HMAC-SHA256
 * with the recipient's key over "<t>.<body>"; a receiver checks it with `signaturPruefen` and refuses
 * a forged, altered, foreign or stale one.
 */
const SCHLUESSEL = "test-schluessel-0123456789abcdef0123456789";
const T = Date.UTC(2026, 10, 23, 12);
const BODY = JSON.stringify({ typ: "ereignis", text: "Störung i1" });

describe("the signature of a webhook", () => {
  it("is the HMAC-SHA256 over time and body, in hex, with the time in milliseconds", () => {
    const erwartet = createHmac("sha256", SCHLUESSEL).update(`${T}.${BODY}`).digest("hex");
    expect(signieren(SCHLUESSEL, T, BODY)).toBe(`t=${T},v1=${erwartet}`);
  });

  it("holds for the body it was made for", () => {
    expect(signaturPruefen(SCHLUESSEL, signieren(SCHLUESSEL, T, BODY), BODY, T + 1000)).toEqual({
      ok: true,
    });
  });

  it("fails for a forged one, another key, a changed body or a changed time", () => {
    const echt = signieren(SCHLUESSEL, T, BODY);
    const gefaelscht = echt.replace(/v1=([0-9a-f])/, (_, z) => `v1=${z === "0" ? "1" : "0"}`);
    expect(signaturPruefen(SCHLUESSEL, gefaelscht, BODY, T)).toEqual({
      ok: false,
      grund: "falsch",
    });
    expect(
      signaturPruefen(
        SCHLUESSEL,
        signieren("anderer-schluessel-0000000000000000", T, BODY),
        BODY,
        T,
      ),
    ).toEqual({ ok: false, grund: "falsch" });
    expect(signaturPruefen(SCHLUESSEL, echt, `${BODY} `, T)).toEqual({
      ok: false,
      grund: "falsch",
    });
    expect(signaturPruefen(SCHLUESSEL, echt.replace(`t=${T}`, `t=${T + 1}`), BODY, T)).toEqual({
      ok: false,
      grund: "falsch",
    });
  });

  it("fails without a header or with one of another form", () => {
    for (const kaputt of [
      null,
      "",
      "v1=abc",
      `t=${T}`,
      `t=jetzt,v1=${"0".repeat(64)}`,
      `t=${T},v1=${"0".repeat(63)}`,
      `t=${T},v1=${"z".repeat(64)}`,
    ])
      expect(signaturPruefen(SCHLUESSEL, kaputt, BODY, T).ok, String(kaputt)).toBe(false);
  });

  it("fails when older or newer than five minutes, so a recorded one cannot be replayed later", () => {
    const echt = signieren(SCHLUESSEL, T, BODY);
    expect(signaturPruefen(SCHLUESSEL, echt, BODY, T + SIGNATUR_TOLERANZ_MS).ok).toBe(true);
    expect(signaturPruefen(SCHLUESSEL, echt, BODY, T + SIGNATUR_TOLERANZ_MS + 1)).toEqual({
      ok: false,
      grund: "zeit",
    });
    expect(signaturPruefen(SCHLUESSEL, echt, BODY, T - SIGNATUR_TOLERANZ_MS - 1)).toEqual({
      ok: false,
      grund: "zeit",
    });
  });
});
