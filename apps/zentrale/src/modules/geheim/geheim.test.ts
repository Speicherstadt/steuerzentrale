import { describe, expect, it } from "vitest";
import { entschluesseln, schluesselAus, schluesselId, verschluesseln } from "./verschluesseln.ts";

const eins = schluesselAus(Buffer.alloc(32, 7).toString("base64"));
const zwei = schluesselAus(Buffer.alloc(32, 8).toString("base64"));

describe("schluesselAus", () => {
  it("takes 32 bytes in base64 and names them by an id", () => {
    expect(eins.ok && eins.schluessel.id).toBe(schluesselId(Buffer.alloc(32, 7)));
    expect(eins.ok && eins.schluessel.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("refuses a key of another length or no base64", () => {
    expect(schluesselAus(Buffer.alloc(16).toString("base64")).ok).toBe(false);
    expect(schluesselAus("kein schlüssel").ok).toBe(false);
    expect(schluesselAus("").ok).toBe(false);
  });
});

const k1 = eins.ok ? eins.schluessel : (undefined as never);
const k2 = zwei.ok ? zwei.schluessel : (undefined as never);

describe("encrypted values", () => {
  it("return the plain text with the same key and purpose", () => {
    const wert = verschluesseln(k1, "geheimnisse:b1:s3", "streng geheim");
    expect(wert).not.toContain("streng geheim");
    expect(wert.startsWith(`v1.${k1.id}.`)).toBe(true);
    expect(entschluesseln([k1], "geheimnisse:b1:s3", wert)).toEqual({
      ok: true,
      wert: "streng geheim",
    });
  });

  it("pick the key by the id on the value", () => {
    const wert = verschluesseln(k2, "z", "a");
    expect(entschluesseln([k1, k2], "z", wert)).toEqual({ ok: true, wert: "a" });
  });

  it("differ each time (random nonce)", () => {
    expect(verschluesseln(k1, "z", "a")).not.toBe(verschluesseln(k1, "z", "a"));
  });

  it("refuse another key, another purpose, a changed value or a changed key id", () => {
    const wert = verschluesseln(k1, "z", "streng geheim");
    expect(entschluesseln([k2], "z", wert)).toEqual({ ok: false, grund: "unbekannter_schluessel" });
    expect(entschluesseln([k1], "y", wert).ok).toBe(false);
    // one bit of the cipher text flipped: always a change, whatever the random nonce made
    const teile = wert.split(".");
    const roh = Buffer.from(teile[2] ?? "", "base64url");
    roh[roh.length - 1] = (roh[roh.length - 1] ?? 0) ^ 1;
    const geaendert = [teile[0], teile[1], roh.toString("base64url")].join(".");
    expect(entschluesseln([k1], "z", geaendert).ok).toBe(false);
    expect(entschluesseln([k1, k2], "z", wert.replace(k1.id, k2.id)).ok).toBe(false);
    expect(entschluesseln([k1], "z", "klartext").ok).toBe(false);
  });
});
