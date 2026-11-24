import { describe, expect, it } from "vitest";
import { demoAppsQuelle } from "../demo/apps-quelle.ts";
import { demo } from "../demo/index.ts";
import type { InstallationsAngebot } from "./apps.ts";
import { type AppGruppe, updateTabelle } from "./update-tabelle.ts";

/*
 * The table of the page "Updates" against the demo: one group per app with something to do, the
 * running wave of Belegt row by row, the others from the offers, all-current apps in one row.
 */

const laden = async () => {
  const q = demoAppsQuelle(() => demo.jetzt);
  const [a, l] = await Promise.all([q.angebote(), q.liste()]);
  if (!a.ok || !l.ok) throw new Error("demo source failed");
  return { angebote: a.daten, apps: l.daten };
};

const gruppe = (gruppen: ReturnType<typeof updateTabelle>, app: string) =>
  gruppen.find((g): g is AppGruppe => g.art === "app" && g.app === app);

describe("the update table", () => {
  it("groups per app: the running wave first, then apps with something to do", async () => {
    const { angebote, apps } = await laden();
    const g = updateTabelle(demo, angebote, apps);
    expect(g.map((x) => (x.art === "app" ? x.app : "aktuell"))).toEqual([
      "belegt",
      "haben",
      "kontext",
      "stellwerk",
      "aktuell",
    ]);
  });

  it("shows each installation of a running wave with its step", async () => {
    const { angebote, apps } = await laden();
    const belegt = gruppe(updateTabelle(demo, angebote, apps), "belegt");
    expect(belegt?.kopf).toEqual({ art: "welle", fertig: 1, gesamt: 3 });
    expect(belegt?.neueste).toBe("0.0.7");
    expect(
      belegt?.zeilen.map((z) => [z.installationId, z.stand.art === "welle" && z.stand.zustand]),
    ).toEqual([
      ["intern-belegt", "fertig"],
      ["atelier-belegt", "laeuft"],
      ["holm-belegt", "wartet"],
    ]);
    const holm = belegt?.zeilen[2]?.stand;
    // the maintenance window of the server "holm" (22:00) on the demo's day
    expect(holm?.art === "welle" && holm.ab).toBeGreaterThan(demo.jetzt);
  });

  it("offers no update by hand to an installation a wave is updating", async () => {
    const { angebote, apps } = await laden();
    const belegt = gruppe(updateTabelle(demo, angebote, apps), "belegt");
    expect(belegt?.zeilen.every((z) => z.angebot === null)).toBe(true);
  });

  it("counts who can update and who is current", async () => {
    const { angebote, apps } = await laden();
    const haben = gruppe(updateTabelle(demo, angebote, apps), "haben");
    expect(haben?.kopf).toEqual({ art: "koennen", n: 3, gesamt: 9 });
    expect(haben?.zeilen.map((z) => [z.installationId, z.stand.art])).toEqual([
      ["roth-haben", "verfuegbar"],
      ["sonne-haben", "verfuegbar"],
      ["berger-haben", "verfuegbar"],
    ]);
    expect(haben?.zeilen.find((z) => z.installationId === "sonne-haben")?.gekuendigt).toBe(true);
    expect(haben?.weitere).toEqual({ n: 6, version: "0.12.0" });
  });

  it("names a registry tag without manifest in the app's group", async () => {
    const { angebote, apps } = await laden();
    const g = updateTabelle(demo, angebote, apps);
    expect(gruppe(g, "haben")?.manifestFehlt).toBe("0.13.0");
    // an app without installations still gets a group for the notice
    expect(gruppe(g, "kontext")).toMatchObject({ manifestFehlt: "0.1.40", zeilen: [] });
    expect(gruppe(g, "kontext")?.kopf).toBeNull();
  });

  it("leaves apps without health to a person (docs/plan.md)", async () => {
    const { angebote, apps } = await laden();
    const stellwerk = gruppe(updateTabelle(demo, angebote, apps), "stellwerk");
    expect(stellwerk?.kopf).toEqual({ art: "von_hand" });
    expect(stellwerk?.zeilen.map((z) => z.installationId)).toEqual(["kraft-stellwerk"]);
  });

  it("puts all apps whose installations are current into one row", async () => {
    const { angebote, apps } = await laden();
    const letzte = updateTabelle(demo, angebote, apps).at(-1);
    expect(letzte?.art === "aktuell" && letzte.namen).toEqual(["Schreibzeug", "Kennwort"]);
    expect(letzte?.art === "aktuell" && letzte.n).toBe(3);
  });

  it("shows a running and a failed update by hand, without waves when signed in", () => {
    const basis: InstallationsAngebot = {
      installationId: "probe-1",
      kundeId: "k",
      app: "probe",
      version: "1.0.0",
      intern: false,
      angeboten: [],
      plan: null,
      update: { letzter: null, laeuft: true },
    };
    const zurueck: InstallationsAngebot = {
      ...basis,
      installationId: "probe-2",
      angeboten: [{ version: "1.1.0", dringend: false, vorabversion: false }],
      update: {
        laeuft: false,
        letzter: {
          vonVersion: "1.0.0",
          nachVersion: "1.1.0",
          anlass: "hand",
          welle: null,
          sperrzeitUebergangen: false,
          angefordertAm: 0,
          phase: "zurueckgenommen",
          endeAm: 1,
          fehler: "Health blieb rot",
          dauerMs: 1,
        },
      },
    };
    const leer = { ...demo, plaene: [], kunden: [], server: [], installationen: [] };
    const probe = gruppe(updateTabelle(leer, [basis, zurueck], []), "probe");
    expect(probe?.zeilen.map((z) => z.stand.art)).toEqual(["laeuft", "misslungen"]);
    expect(probe?.zeilen[0]?.kunde).toBeNull();
  });
});
