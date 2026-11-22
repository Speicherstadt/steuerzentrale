import {
  LogAuszug,
  MAX_NACHRICHT_BYTES,
  PROTOKOLL_VERSION,
  schreiben,
} from "@steuerzentrale/protokoll";
import { describe, expect, it } from "vitest";
import {
  ERSATZ,
  MAX_ZEICHEN,
  MAX_ZEILEN,
  suchwerte,
  zeilenSchwaerzen,
  zeileSchwaerzen,
} from "./schwaerzen.ts";

/*
 * BAULISTE.md Z-405 (docs/plan.md, "Log-Auszug"): every value of a secret is replaced by [geheim]
 * before a line leaves the server, longer values first, also where values overlap or one holds the
 * other, also at the end of a line cut off while it was read; each line at most 2000 characters;
 * 500 such lines always fit into one message (MAX_NACHRICHT_BYTES).
 */

const ganz = (text: string) => ({ text, abgeschnitten: false });

describe("replacing the values of secrets", () => {
  it("replaces every occurrence of every value", () => {
    expect(
      zeileSchwaerzen(ganz("key=abc123 again abc123, pw=hunter2"), ["abc123", "hunter2"]),
    ).toBe(`key=${ERSATZ} again ${ERSATZ}, pw=${ERSATZ}`);
  });

  it("replaces the longer value when one holds the other, whatever their order", () => {
    for (const werte of [
      ["geheim", "sehr-geheim-2"],
      ["sehr-geheim-2", "geheim"],
    ])
      expect(zeileSchwaerzen(ganz("x sehr-geheim-2 y geheim z"), werte)).toBe(
        `x ${ERSATZ} y ${ERSATZ} z`,
      );
  });

  it("replaces overlapping values as one, so no part of either is left", () => {
    // "abcd" first would leave "ef" of "cdef", "cdef" first would leave "ab" of "abcd"
    expect(zeileSchwaerzen(ganz("<abcdef>"), ["abcd", "cdef"])).toBe(`<${ERSATZ}>`);
    expect(zeileSchwaerzen(ganz("<abcdef>"), ["cdef", "abcd"])).toBe(`<${ERSATZ}>`);
    // a value that occurs overlapping itself
    expect(zeileSchwaerzen(ganz("-aaaaa-"), ["aaa"])).toBe(`-${ERSATZ}-`);
  });

  it("looks in the line as read, not in the replacement and the text around it", () => {
    expect(zeileSchwaerzen(ganz("SECRETx"), ["SECRET", "]x"])).toBe(`${ERSATZ}x`);
    // values side by side become one replacement
    expect(zeileSchwaerzen(ganz("SECRETim]x"), ["SECRET", "im]x"])).toBe(ERSATZ);
  });

  it("replaces the start of a value at the end of a line cut off while it was read", () => {
    expect(zeileSchwaerzen({ text: "token=abc1", abgeschnitten: true }, ["abc123"])).toBe(
      `token=${ERSATZ}`,
    );
    // the earliest start counts, even under a shorter match nearer the end
    expect(zeileSchwaerzen({ text: "x=abab", abgeschnitten: true }, ["ababX", "b"])).toBe(
      `x=${ERSATZ}`,
    );
    // a whole line is not a cut one: its end is the value's end or not
    expect(zeileSchwaerzen(ganz("token=abc1"), ["abc123"])).toBe("token=abc1");
  });

  it("looks for each line of a value with several lines too, never for an empty one", () => {
    expect(suchwerte(["-----BEGIN-----\nAAAA\nBBBB\n", "", "x"])).toEqual([
      "-----BEGIN-----\nAAAA\nBBBB\n",
      "-----BEGIN-----",
      "AAAA",
      "BBBB",
      "x",
    ]);
    // journalctl prints each line of a message as a line of its own
    expect(zeilenSchwaerzen([ganz("    AAAA")], suchwerte(["k\nAAAA"]))).toEqual([`    ${ERSATZ}`]);
  });
});

describe("the lines of a log excerpt", () => {
  it("cut each line to 2000 characters after replacing, never into a value", () => {
    const wert = "w".repeat(50);
    const zeile = `${"a".repeat(1990)}${wert}${"b".repeat(100)}`;
    const [aus] = zeilenSchwaerzen([ganz(zeile)], [wert]);
    expect(aus).toBe(`${"a".repeat(1990)}${ERSATZ}${"b".repeat(2)}`);
    expect(aus).toHaveLength(MAX_ZEICHEN);
    expect(zeilenSchwaerzen([ganz("c".repeat(5000))], [])[0]).toHaveLength(MAX_ZEICHEN);
  });

  it("keep the last 500 lines", () => {
    const zeilen = Array.from({ length: 503 }, (_, i) => ganz(`zeile ${i}`));
    const aus = zeilenSchwaerzen(zeilen, []);
    expect(aus).toHaveLength(MAX_ZEILEN);
    expect(aus[0]).toBe("zeile 3");
    expect(aus.at(-1)).toBe("zeile 502");
  });

  it("carry no control character and no half of a surrogate pair", () => {
    const [aus] = zeilenSchwaerzen([ganz(`a\u0001b\u001bc\td\u007fe\ud800f`)], []);
    expect(aus).toBe("a�b�c\td�e�f");
    // a pair cut in two by the length limit
    const [geschnitten] = zeilenSchwaerzen([ganz(`${"x".repeat(1999)}😀`)], []);
    expect(geschnitten).toBe(`${"x".repeat(1999)}�`);
  });

  it("always fit into one message: 500 lines of the longest the agent sends", () => {
    for (const zeichen of ["\u0001", "€", '"', "\\", "😀", "\ud800"]) {
      const roh = zeichen.repeat(MAX_ZEICHEN);
      const zeilen = zeilenSchwaerzen(
        Array.from({ length: MAX_ZEILEN }, () => ganz(roh)),
        [],
      );
      const text = schreiben(LogAuszug, {
        typ: "log_auszug",
        protokoll: PROTOKOLL_VERSION,
        auftragId: "a".repeat(64),
        zeilen,
      });
      expect(new TextEncoder().encode(text).byteLength).toBeLessThan(MAX_NACHRICHT_BYTES);
    }
  });
});
