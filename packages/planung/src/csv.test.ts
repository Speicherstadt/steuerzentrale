import { describe, expect, it } from "vitest";
import { csvFeld, csvText } from "./csv.ts";

/*
 * BAULISTE.md Z-804: the export is valid CSV after RFC 4180 (section 2): CRLF after every record,
 * a header row, fields with a comma, a quote or a line break in quotes, a quote inside doubled.
 * A text that a spreadsheet would run as a formula starts with an apostrophe (docs/plan.md,
 * "Leistungen").
 */

/** A reader after RFC 4180, section 2, to read back what the writer wrote */
const lesen = (text: string): string[][] => {
  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let feld = "";
  let i = 0;
  let zitiert = false;
  while (i < text.length) {
    const z = text[i];
    if (zitiert) {
      if (z === '"' && text[i + 1] === '"') {
        feld += '"';
        i += 2;
        continue;
      }
      if (z === '"') zitiert = false;
      else feld += z;
      i += 1;
      continue;
    }
    if (z === '"' && feld === "") zitiert = true;
    else if (z === ",") {
      zeile.push(feld);
      feld = "";
    } else if (z === "\r" && text[i + 1] === "\n") {
      zeile.push(feld);
      zeilen.push(zeile);
      zeile = [];
      feld = "";
      i += 1;
    } else if (z === '"' || z === "\r" || z === "\n") throw new Error(`stray ${z} at ${i}`);
    else feld += z;
    i += 1;
  }
  if (feld !== "" || zeile.length > 0) throw new Error("last record without CRLF");
  return zeilen;
};

describe("csvFeld", () => {
  it("leaves a plain field as it is", () => {
    expect(csvFeld("Kanzlei Weber")).toBe("Kanzlei Weber");
    expect(csvFeld(42)).toBe("42");
    expect(csvFeld(null)).toBe("");
  });

  it("quotes a comma, a quote and a line break, the quote doubled", () => {
    expect(csvFeld("Müller, Lang & Co.")).toBe('"Müller, Lang & Co."');
    expect(csvFeld('Café "Sonne"')).toBe('"Café ""Sonne"""');
    expect(csvFeld("Zeile 1\nZeile 2")).toBe('"Zeile 1\nZeile 2"');
    expect(csvFeld("Zeile 1\r\nZeile 2")).toBe('"Zeile 1\r\nZeile 2"');
  });

  it("disarms a text a spreadsheet would run as a formula, not a number", () => {
    expect(csvFeld("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvFeld("+49 40")).toBe("'+49 40");
    expect(csvFeld("-1")).toBe("'-1");
    expect(csvFeld("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvFeld("\tTab")).toBe("'\tTab");
    expect(csvFeld("\r=1")).toBe('"\'\r=1"');
    expect(csvFeld('=1,"2"')).toBe('"\'=1,""2"""');
    expect(csvFeld(-1)).toBe("-1");
  });
});

describe("csvText", () => {
  it("writes a header row and every record with CRLF, readable after RFC 4180", () => {
    const tueckisch = ['Café "Sonne", Hamburg', "zwei\nZeilen", "=1+1", "", "ä€😀"];
    const text = csvText(["a", "b", "c", "d", "e"], [tueckisch, [1, 2.5, null, 0, "x"]]);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(lesen(text)).toEqual([
      ["a", "b", "c", "d", "e"],
      ['Café "Sonne", Hamburg', "zwei\nZeilen", "'=1+1", "", "ä€😀"],
      ["1", "2.5", "", "0", "x"],
    ]);
  });

  it("refuses a record whose fields do not match the header", () => {
    expect(() => csvText(["a", "b"], [["1"]])).toThrow();
  });
});
