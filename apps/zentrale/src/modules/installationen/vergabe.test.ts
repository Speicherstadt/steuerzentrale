import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nameErzeugen, namensteil, PORT_BEREICH, portsVergeben } from "./vergabe.ts";

/* BAULISTE.md Z-402: names and ports an installation gets, as pure functions */

const zufall = (n: number) => new Uint8Array(randomBytes(n));

describe("the name of an installation", () => {
  it("is <app>- and 6 characters a-z, 0-9", () => {
    for (let i = 0; i < 50; i++) expect(namensteil(zufall)).toMatch(/^[a-z0-9]{6}$/);
  });

  it("skips bytes that would favour some characters", () => {
    const bytes = [255, 252, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(namensteil((n) => new Uint8Array(bytes.slice(0, n)))).toBe("abcdef");
  });

  it("is drawn again while taken, and given up after a few tries", () => {
    const vergeben = new Set(["app-aaaaaa"]);
    const immerA = (n: number) => new Uint8Array(n);
    expect(nameErzeugen("app", immerA, (n) => vergeben.has(n))).toBeUndefined();
    expect(nameErzeugen("app", zufall, (n) => vergeben.has(n))).toMatch(/^app-[a-z0-9]{6}$/);
  });
});

describe("the ports of an installation", () => {
  it("are the lowest free ones from 20000, a range as one block", () => {
    expect(
      portsVergeben(
        [
          { zweck: "http", anzahl: 1 },
          { zweck: "rtc:50000", anzahl: 3 },
        ],
        new Set([20_000, 20_002]),
      ),
    ).toEqual([
      { zweck: "http", von: 20_001, anzahl: 1 },
      { zweck: "rtc:50000", von: 20_003, anzahl: 3 },
    ]);
  });

  it("are none when the range is full", () => {
    const fast = new Set(
      Array.from({ length: PORT_BEREICH.bis - PORT_BEREICH.von }, (_, i) => PORT_BEREICH.von + i),
    );
    expect(portsVergeben([{ zweck: "http", anzahl: 1 }], fast)).toEqual([
      { zweck: "http", von: PORT_BEREICH.bis, anzahl: 1 },
    ]);
    expect(portsVergeben([{ zweck: "http", anzahl: 2 }], fast)).toBeUndefined();
  });
});
