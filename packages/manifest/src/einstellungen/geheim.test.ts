import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beispielManifest } from "../quadlet/testeingabe.ts";
import { geheimeEinstellungen } from "./geheim.ts";

/* BAULISTE.md Z-405: the names whose values a log excerpt replaces */

const ROOT = join(import.meta.dirname, "../../../..");
const VORLAGE = readFileSync(join(ROOT, "manifeste/beispiel/manifest.vorlage.yml"), "utf8");

describe("geheimeEinstellungen", () => {
  it("names the settings of typ geheim and of ebene auto, nothing else", () => {
    const m = beispielManifest(
      VORLAGE.replace(
        "  - { name: BEISPIEL_SCHLUESSEL, ebene: auto, erzeugen: zufall_32 }",
        [
          "  - { name: BEISPIEL_SCHLUESSEL, ebene: auto, erzeugen: zufall_32 }",
          "  - { name: BEISPIEL_PASSWORT, ebene: installation, typ: geheim }",
          "  - { name: BEISPIEL_ADRESSE, ebene: auto, aus: adresse }",
          "  - { name: BEISPIEL_BETREIBER, ebene: betreiber, vorgabe: x }",
        ].join("\n"),
      ),
    );
    expect(geheimeEinstellungen(m)).toEqual([
      "BEISPIEL_ADRESSE",
      "BEISPIEL_PASSWORT",
      "BEISPIEL_SCHLUESSEL",
    ]);
    expect(geheimeEinstellungen(beispielManifest(VORLAGE))).toEqual(["BEISPIEL_SCHLUESSEL"]);
  });
});
