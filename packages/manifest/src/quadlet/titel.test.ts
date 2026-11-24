import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { geheimeEinstellungen } from "../einstellungen/geheim.ts";
import { quadletsRendern } from "./rendern.ts";
import { testAnfrage, testManifest } from "./testeingabe.ts";

/*
 * The title of a setting (`env[].titel`, docs/manifest.md) is read by people in the settings and
 * nowhere else: a manifest with titles renders the same units, Podman secrets and route of the
 * Pforte as the same manifest without them.
 */

const HABEN = join(import.meta.dirname, "../../../../manifeste/haben/0.12.0/manifest.yml");

const ohneTitel = (text: string): string => {
  const roh = parse(text);
  for (const e of roh.env) delete e.titel;
  return stringify(roh);
};

describe("the title of a setting", () => {
  const text = readFileSync(HABEN, "utf8");
  const mit = testManifest(text);
  const ohne = testManifest(ohneTitel(text));

  it("is in the manifest of Haben, so the comparison below means something", () => {
    expect(mit.env.filter((e) => e.titel !== undefined).length).toBeGreaterThan(0);
    expect(ohne.env.every((e) => e.titel === undefined)).toBe(true);
  });

  it("changes no unit, no Podman secret and no route of the Pforte", () => {
    const gerendert = quadletsRendern(testAnfrage(mit, []));
    expect(gerendert.ok && gerendert.quadlets.pforte).not.toBeNull();
    expect(gerendert).toEqual(quadletsRendern(testAnfrage(ohne, [])));
    expect(geheimeEinstellungen(mit)).toEqual(geheimeEinstellungen(ohne));
  });
});
