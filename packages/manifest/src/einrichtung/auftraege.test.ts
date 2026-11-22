import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beispielManifest, testManifest } from "../quadlet/testeingabe.ts";
import {
  EINRICHTUNG_AKTIONEN,
  type EinrichtungAnfrage,
  einrichtungAuftragPruefen,
  istEinrichtungAktion,
} from "./auftraege.ts";

/*
 * BAULISTE.md Z-402 (docs/plan.md, "Einrichtungsaufträge"): a setup job names the installation and
 * carries what the agent needs to render its units itself from the signed manifest; it never
 * carries a unit, an image or an argv. Zentrale and agent check it with this one function.
 */
const ROOT = join(import.meta.dirname, "../../../..");
const VORLAGE = readFileSync(join(ROOT, "manifeste/beispiel/manifest.vorlage.yml"), "utf8");
const beispiel = beispielManifest(VORLAGE);

const einrichten = (teil: Partial<EinrichtungAnfrage> = {}): EinrichtungAnfrage => ({
  aktion: EINRICHTUNG_AKTIONEN.einrichten,
  installationId: "beispiel-x7k2p9",
  argumente: {},
  einrichtung: {
    installation: {
      kundeId: "k-1",
      optionen: [],
      httpPort: 20001,
      ports: { "app:9000": 20002 },
      host: "beispiel.kunde.example",
      ipv4: null,
    },
    einstellungen: {
      betreiber: {},
      installation: {},
      auto: { BEISPIEL_SCHLUESSEL: "dGVzdA==" },
    },
  },
  ...teil,
});

const mitInstallation = (i: Record<string, unknown>) => {
  const a = einrichten();
  if (!a.einrichtung) throw new Error("test");
  return einrichten({
    einrichtung: { ...a.einrichtung, installation: { ...a.einrichtung.installation, ...i } },
  });
};

const grund = (a: EinrichtungAnfrage) => {
  const r = einrichtungAuftragPruefen(beispiel, a);
  return r.ok ? "ok" : r.grund;
};

describe("the setup jobs, built into the Steuerzentrale", () => {
  it("are no command any manifest can name: a command's name has no underscore", () => {
    for (const aktion of Object.values(EINRICHTUNG_AKTIONEN)) {
      expect(istEinrichtungAktion(aktion)).toBe(true);
      expect(aktion).toContain("_");
    }
    expect(istEinrichtungAktion("migrieren")).toBe(false);
    expect(() =>
      testManifest(
        VORLAGE.replaceAll("{{VERSION}}", "1.0.0").replace(
          "migrieren:",
          "installation_einrichten:",
        ),
      ),
    ).toThrow();
  });

  it("renders the units from the manifest and names the setup steps", () => {
    const r = einrichtungAuftragPruefen(beispiel, einrichten());
    if (!r.ok || r.auftrag.art !== "einrichten") throw new Error(r.ok ? "art" : r.grund);
    expect(r.auftrag.name).toBe("beispiel-x7k2p9");
    expect(Object.keys(r.auftrag.quadlets.units)).toContain("beispiel-x7k2p9-app.container");
    expect(r.auftrag.quadlets.units["beispiel-x7k2p9-app.container"]).toContain(
      "BEISPIEL_SCHLUESSEL=dGVzdA==",
    );
    expect(r.auftrag.schritte).toEqual(["migrieren"]);
    expect(r.auftrag.units).toEqual(["beispiel-x7k2p9-app.service"]);
  });

  it("starts the units of the chosen options too", () => {
    const r = einrichtungAuftragPruefen(beispiel, mitInstallation({ optionen: ["worker"] }));
    if (!r.ok || r.auftrag.art !== "einrichten") throw new Error(r.ok ? "art" : r.grund);
    expect(r.auftrag.units).toEqual([
      "beispiel-x7k2p9-app.service",
      "beispiel-x7k2p9-worker.service",
    ]);
  });

  it.each([
    ["the Pforte's name", { installationId: "pforte" }, "named installation"],
    ["a name starting with a dash", { installationId: "-x" }, "named installation"],
    ["no name", { installationId: null }, "named installation"],
    ["an argument", { argumente: { image: "x" } }, "unknown argument image"],
    ["no installation data", { einrichtung: undefined }, "einrichtung"],
  ] as const)("refuses %s", (_fall, teil, erwartet) => {
    expect(grund(einrichten(teil as Partial<EinrichtungAnfrage>))).toContain(erwartet);
  });

  it.each([
    ["an HTTP port below 1024", { httpPort: 80 }, "httpPort"],
    ["an HTTP port above 65535", { httpPort: 70000 }, "httpPort"],
    ["a port below 1024", { ports: { "app:9000": 22 } }, "app:9000"],
    [
      "a port of a service the manifest has not",
      { ports: { "app:9000": 20002, "x:1": 20003 } },
      "x:1",
    ],
    ["an unknown option", { optionen: ["root"] }, "no option named root"],
    ["a host with a path", { host: "a.example/x" }, "host"],
  ] as const)("refuses %s, as rendering does", (_fall, teil, erwartet) => {
    expect(grund(mitInstallation(teil))).toContain(erwartet);
  });

  it("refuses a missing generated value instead of rendering without it", () => {
    const a = einrichten();
    if (!a.einrichtung) throw new Error("test");
    const ohne = einrichten({
      einrichtung: {
        ...a.einrichtung,
        einstellungen: { ...a.einrichtung.einstellungen, auto: {} },
      },
    });
    expect(grund(ohne)).toContain("BEISPIEL_SCHLUESSEL");
  });

  it("removes by the installation's name, with nothing else", () => {
    expect(
      einrichtungAuftragPruefen(
        beispiel,
        einrichten({ aktion: EINRICHTUNG_AKTIONEN.entfernen, einrichtung: undefined }),
      ),
    ).toEqual({ ok: true, auftrag: { art: "entfernen", name: "beispiel-x7k2p9" } });
    expect(grund(einrichten({ aktion: EINRICHTUNG_AKTIONEN.entfernen }))).toContain(
      "takes no installation data",
    );
  });

  it("is not a job of another kind", () => {
    expect(grund(einrichten({ aktion: "pforte_route_setzen" }))).toContain("not a setup job");
  });
});
