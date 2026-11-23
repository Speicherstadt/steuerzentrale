import { describe, expect, it } from "vitest";
import type { KundenLeistung } from "./leistungen.ts";
import { leistungenCsv, leistungenDatei } from "./leistungen-csv.ts";

/*
 * BAULISTE.md Z-804: the services of a month as CSV, one record per customer (docs/plan.md,
 * "Export der Leistungen").
 */

const kunde = (teil: Partial<KundenLeistung> & { name: string; kuerzel?: string }) => ({
  kundeId: "k1",
  kuerzel: "k",
  installationen: [],
  speicherBytes: null,
  supportMinuten: 0,
  verfuegbarkeit: { minuten: 43_200, gemessen: 0, anteil: null },
  ...teil,
});

const ap = (app: string) => ({
  installationId: `${app}-1`,
  app,
  speicherBytes: 1,
  verfuegbarkeit: { jahr: 2026, monat: 11, minuten: 1, gemessen: 1, rot: 0, anteil: 1 },
});

describe("leistungenCsv", () => {
  it("writes one record per customer under fixed column names", () => {
    const text = leistungenCsv({
      monat: "2026-11",
      kunden: [
        kunde({
          name: "Müller, Lang & Co.",
          kuerzel: "mueller",
          installationen: [ap("kontext"), ap("haben"), ap("haben")],
          speicherBytes: 5_368_709_120,
          supportMinuten: 45,
          verfuegbarkeit: { minuten: 43_200, gemessen: 43_180, anteil: 0.99899 },
        }),
        kunde({ name: "=Formel" }),
      ],
    });
    expect(text.split("\r\n")).toEqual([
      "monat,kunde,kuerzel,installationen,apps,speicher_bytes,support_minuten,verfuegbarkeit_prozent,gemessene_minuten,minuten",
      '2026-11,"Müller, Lang & Co.",mueller,3,haben kontext,5368709120,45,99.89,43180,43200',
      "2026-11,'=Formel,k,0,,,0,,0,43200",
      "",
    ]);
  });

  it("cuts the availability to two decimals without a binary rounding error", () => {
    const zeile = (anteil: number) =>
      leistungenCsv({
        monat: "2026-11",
        kunden: [kunde({ name: "a", verfuegbarkeit: { minuten: 1, gemessen: 1, anteil } })],
      }).split("\r\n")[1];
    expect(zeile(0.29)).toContain(",29.00,");
    expect(zeile(1)).toContain(",100.00,");
    expect(zeile(0.999999)).toContain(",99.99,");
  });

  it("names the file by the month", () => {
    expect(leistungenDatei("2026-11")).toBe("leistungen-2026-11.csv");
  });
});
