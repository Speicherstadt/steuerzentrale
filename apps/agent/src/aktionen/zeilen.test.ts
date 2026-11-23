import { describe, expect, it } from "vitest";
import { zeilenSammler } from "./zeilen.ts";

/* The lines of journalctl's output as the agent keeps them (Z-405): the last ones, each bounded */

describe("collecting the lines of an output", () => {
  it("splits pieces into lines wherever the pieces end", () => {
    const s = zeilenSammler(10, 100);
    s.hinzu("eins\nzw");
    s.hinzu("ei\n");
    s.hinzu("\ndrei");
    expect(s.ende()).toEqual([
      { text: "eins", abgeschnitten: false },
      { text: "zwei", abgeschnitten: false },
      { text: "", abgeschnitten: false },
      { text: "drei", abgeschnitten: false },
    ]);
  });

  it("keeps only the last lines", () => {
    const s = zeilenSammler(2, 100);
    s.hinzu("a\nb\nc\nd\n");
    expect(s.ende().map((z) => z.text)).toEqual(["c", "d"]);
  });

  it("keeps the start of a long line and marks it cut off, across pieces", () => {
    const s = zeilenSammler(10, 5);
    s.hinzu("abc");
    s.hinzu("defgh\nkurz\n");
    s.hinzu("123456");
    expect(s.ende()).toEqual([
      { text: "abcde", abgeschnitten: true },
      { text: "kurz", abgeschnitten: false },
      { text: "12345", abgeschnitten: true },
    ]);
  });
});
