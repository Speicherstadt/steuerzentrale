import { manifestPruefen } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import { PROBE_MANIFEST } from "../demo/probe-manifest.ts";
import { einstellungenAus, feldName, installationsFelder } from "./einstellungs-formular.ts";

const geprueft = manifestPruefen(PROBE_MANIFEST);
if (!geprueft.ok) throw new Error(geprueft.fehler.join("\n"));
const probe = geprueft.manifest;

describe("the settings form of the dialog", () => {
  it("asks for the settings of the level installation that apply with the options", () => {
    expect(installationsFelder(probe, []).map((f) => [f.name, f.typ, f.noetig])).toEqual([
      ["PROBE_TITEL", "text", false],
      ["PROBE_KENNWORT", "geheim", true],
      ["PROBE_LIMIT", "zahl", false],
      ["PROBE_OFFEN", "ja_nein", false],
    ]);
    expect(installationsFelder(probe, ["extra"]).map((f) => f.name)).toContain("PROBE_EXTRA");
  });

  it("leaves out the other levels and templates", () => {
    const mit = {
      ...probe,
      env: [
        ...probe.env,
        { name: "X_BETREIBER", ebene: "betreiber", typ: "text", pflicht: true },
        {
          name: "X_VORLAGE",
          ebene: "installation",
          typ: "text",
          pflicht: false,
          vorlage: "https://$" + "{host}",
        },
      ],
    } as typeof probe;
    const namen = installationsFelder(mit, []).map((f) => f.name);
    expect(namen).not.toContain("X_BETREIBER");
    expect(namen).not.toContain("X_VORLAGE");
  });

  it("sends values of their type, a yes/no always, an empty field not", () => {
    const felder = installationsFelder(probe, []);
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
});
