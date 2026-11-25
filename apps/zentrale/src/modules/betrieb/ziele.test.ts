import { describe, expect, it } from "vitest";
import { bewertungsUmgebung } from "../../testhilfen/bewertung.ts";
import { schreiben } from "../audit/index.ts";
import { zielVerweise } from "./ziele.ts";

/*
 * BAULISTE.md Z-1101: an event or audit entry about an observed service names it by its name, as
 * one about an installation or a server does; another operator's service is not looked up.
 */

describe("zielVerweise of observed services", () => {
  it("names the operator's service by its name, in events and in the audit log", () => {
    const offen = bewertungsUmgebung();
    for (const betreiberId of ["b1", "b2"])
      schreiben(
        offen.schreibDb,
        { betreiberId, akteur: "test", jetzt: 1, grund: "Test" },
        "test",
        (w) =>
          w.einfuegen("dienste", {
            betreiberId,
            dienstId: `d-${betreiberId}`,
            name: `Wiki ${betreiberId}`,
            host: "wiki.teufel-it.de",
            pfad: "/",
            angelegtAm: 1,
          }),
      );
    const verweise = zielVerweise(offen.db, "b1", ["dienst:d-b1", "dienste:d-b1", "dienst:d-b2"]);
    expect([...verweise]).toEqual([
      ["dienst:d-b1", { art: "dienst", id: "d-b1", name: "Wiki b1" }],
      ["dienste:d-b1", { art: "dienst", id: "d-b1", name: "Wiki b1" }],
    ]);
  });
});
