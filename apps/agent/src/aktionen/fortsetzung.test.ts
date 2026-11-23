import { describe, expect, it } from "vitest";
import { fortgesetzt, fortsetzungen, LANG_AB_BYTES, UNBEKANNT_AB } from "./fortsetzung.ts";

/*
 * Review of Z-405: an entry may continue a line conmon or journald split (fortsetzung.ts); from the
 * start of its message, the rest of a value is replaced too.
 */

const KOPF_A = "2026-11-22T12:00:00+0000 server app[42]: ";
const KOPF_B = "2026-11-22T12:00:00+0000 server db[43]: ";
const ganz = (text: string) => ({ text, abgeschnitten: false });
const nachLang = (kopf: string) => ({ anfang: kopf.length, mindestens: 1 });
const unbekannt = (kopf: string) => ({ anfang: kopf.length, mindestens: UNBEKANNT_AB });

describe("entries that may continue a split line", () => {
  it("are those after a long entry of the same source, or the first of a source", () => {
    const lang = `${KOPF_A}${"x".repeat(LANG_AB_BYTES)}`;
    expect(
      fortsetzungen([
        ganz(`${KOPF_A}kurz`),
        ganz(`${KOPF_A}nach kurz`),
        ganz(lang),
        ganz(`${KOPF_B}andere Quelle dazwischen`),
        ganz(`${KOPF_A}nach lang`),
        ganz(`${KOPF_B}nach kurz`),
      ]),
    ).toEqual([
      unbekannt(KOPF_A),
      undefined,
      undefined,
      unbekannt(KOPF_B),
      nachLang(KOPF_A),
      undefined,
    ]);
  });

  it("count a line cut while it was read, or long in bytes, as long", () => {
    const zeilen = [
      { text: `${KOPF_A}x`, abgeschnitten: true },
      ganz(`${KOPF_A}a`),
      ganz(`${KOPF_A}${"€".repeat(LANG_AB_BYTES / 3)}`),
      ganz(`${KOPF_A}b`),
    ];
    expect(fortsetzungen(zeilen)).toEqual([
      unbekannt(KOPF_A),
      nachLang(KOPF_A),
      undefined,
      nachLang(KOPF_A),
    ]);
  });

  it("are never the further lines of a message or journalctl's own lines", () => {
    expect(fortsetzungen([ganz("                    AAAA"), ganz("-- No entries --")])).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("the rest of a value at the start of a message", () => {
  it("is covered to the end of the longest text that ends a value", () => {
    const text = `${KOPF_A}C123==","x":1`;
    expect(fortgesetzt(text, nachLang(KOPF_A), ["Zufall/AbC123==", "3=="])).toEqual([
      [KOPF_A.length, KOPF_A.length + 6],
    ]);
  });

  it("after a long entry from one character, at a source's first from UNBEKANNT_AB on", () => {
    const text = `${KOPF_A}1 Verbindung`;
    expect(fortgesetzt(text, nachLang(KOPF_A), ["geheim4711"])).toEqual([
      [KOPF_A.length, KOPF_A.length + 1],
    ]);
    expect(fortgesetzt(text, unbekannt(KOPF_A), ["geheim4711"])).toEqual([]);
    expect(fortgesetzt(`${KOPF_A}4711 x`, unbekannt(KOPF_A), ["geheim4711"])).toEqual([
      [KOPF_A.length, KOPF_A.length + 4],
    ]);
  });

  it("is nothing when the message starts with no end of a value", () => {
    expect(fortgesetzt(`${KOPF_A}listening`, nachLang(KOPF_A), ["geheim4711"])).toEqual([]);
  });
});
