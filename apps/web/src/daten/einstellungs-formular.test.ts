import { einstellungsFormular, manifestPruefen } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { PROBE_MANIFEST } from "../demo/probe-manifest.ts";
import { angehakt, eingetragen, einstellungenAus, feldName } from "./einstellungs-formular.ts";

const geprueft = manifestPruefen(PROBE_MANIFEST);
if (!geprueft.ok) throw new Error(geprueft.fehler.join("\n"));
const felder = einstellungsFormular(geprueft.manifest, "installation", []);

describe("the values of a settings form", () => {
  it("are sent with their type for a new installation, a yes/no always, an empty field not", () => {
    expect(
      einstellungenAus(felder, {
        [feldName("PROBE_KENNWORT")]: "geheim-1",
        [feldName("PROBE_LIMIT")]: "12",
        grund: "nicht dabei",
      }),
    ).toEqual({ PROBE_KENNWORT: "geheim-1", PROBE_LIMIT: 12, PROBE_OFFEN: false });
    expect(einstellungenAus(felder, { [feldName("PROBE_OFFEN")]: "on" })).toEqual({
      PROBE_OFFEN: true,
    });
  });

  it("unset an empty text and keep an empty secret when changed", () => {
    expect(einstellungenAus(felder, { [feldName("PROBE_LIMIT")]: "3" }, { aendern: true })).toEqual(
      { PROBE_TITEL: "", PROBE_LIMIT: 3, PROBE_OFFEN: false },
    );
  });

  it("of the operator in the dialog are only those entered", () => {
    expect(
      eingetragen(
        felder,
        { [feldName("PROBE_LIMIT", "betreiber")]: "7", [feldName("PROBE_TITEL")]: "anderer" },
        "betreiber",
      ),
    ).toEqual({ PROBE_LIMIT: 7 });
  });

  it("tick a yes/no by its value, else by its default", () => {
    const offen = felder.find((f) => f.name === "PROBE_OFFEN");
    if (!offen) throw new Error("PROBE_OFFEN");
    expect(angehakt(offen)).toBe(false);
    expect(angehakt(offen, true)).toBe(true);
  });
});
