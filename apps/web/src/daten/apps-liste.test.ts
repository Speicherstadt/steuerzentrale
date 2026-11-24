import { setLocale } from "@steuerzentrale/ui";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { demoAppsQuelle } from "../demo/apps-quelle.ts";
import { demoBackups } from "../demo/backups.ts";
import { demo } from "../demo/index.ts";
import { GESCHEITERT, startbestand } from "../demo/installationen-bestand.ts";
import { alsServerDerZentrale } from "../demo/server-quelle.ts";
import { zustandText } from "../seiten/apps-tabelle.tsx";
import type { InstallationsAngebot } from "./apps.ts";
import {
  type AppZeile,
  appZeilen,
  appZustand,
  gefiltert,
  gruppiert,
  type ListenDaten,
} from "./apps-liste.ts";
import type { BackupZeile } from "./backups.ts";
import { installationAnsicht } from "./installation-ansicht.ts";

// docs/plan.md, "Navigation (Oberfläche 2026-11)": the table of the page "Apps" from the demo's
// sources, which answer as the Zentrale's API does
const namen = {
  kunden: demo.kunden,
  server: demo.server.map((sv) => alsServerDerZentrale(sv, demo.jetzt)),
  apps: demo.apps,
  demo: demo.installationen,
};
const installationen = startbestand(demo.jetzt).map((e) => installationAnsicht(e.i, namen));

let daten: ListenDaten;
beforeAll(async () => {
  const backups = await demoBackups().uebersicht();
  const angebote = await demoAppsQuelle(() => demo.jetzt).angebote();
  if (!backups.ok || !angebote.ok) throw new Error("no demo data");
  daten = { installationen, backups: backups.daten, angebote: angebote.daten, jetzt: demo.jetzt };
});
beforeEach(() => setLocale("de", { reload: false }));

const ids = (zeilen: AppZeile[]) => zeilen.map((z) => z.a.id);

describe("the rows of the page Apps", () => {
  it("put what needs attention first: red, yellow, unknown, on its way, then the rest", () => {
    const zeilen = appZeilen(daten);
    expect(zeilen.map((z) => z.stufe).slice(0, 7)).toEqual([
      "rot",
      "rot",
      "gelb",
      "gelb",
      "unbekannt",
      "unterwegs",
      "unterwegs",
    ]);
    expect(ids(zeilen).slice(0, 5)).toEqual([
      "berger-schreibzeug",
      GESCHEITERT,
      "lind-haben",
      "holm-belegt",
      "kraft-stellwerk",
    ]);
    expect(zeilen.slice(7).every((z) => z.stufe === "gut")).toBe(true);
    expect(zeilen).toHaveLength(demo.installationen.length + 1);
  });

  it("say the state in plain words", () => {
    const text = (id: string) =>
      zustandText(appZeilen(daten).find((z) => z.a.id === id)?.zustand ?? { art: "laeuft" });
    expect(text("berger-schreibzeug")).toBe("Störung: Health: HTTP 503");
    expect(text(GESCHEITERT)).toBe("Einrichtung gescheitert");
    // the last good backup of Studio Lind is from the night before (its last one failed)
    expect(text("lind-haben")).toBe("Backup ist über einen Tag alt");
    expect(text("holm-belegt")).toBe("Prüf-Restore gescheitert");
    expect(text("kraft-stellwerk")).toBe("Keine Meldung des Agenten seit 90 s");
    expect(text("atelier-belegt")).toBe("wird gerade aktualisiert");
    expect(text("weber-haben")).toBe("läuft");
  });

  it("count the days of an old backup", () => {
    const a = installationen.find((i) => i.id === "weber-haben");
    if (!a) throw new Error("missing");
    const alt: BackupZeile = {
      ...(daten.backups.find((b) => b.installationId === a.id) as BackupZeile),
      letzterErfolg: demo.jetzt - 3 * 86_400_000,
    };
    expect(zustandText(appZustand(a, alt, undefined, demo.jetzt))).toBe("Backup ist 3 Tage alt");
  });

  it("show an update under way as its target, one offered as a mark, never both", () => {
    const zeilen = appZeilen(daten);
    const von = (id: string) => zeilen.find((z) => z.a.id === id);
    expect(von("atelier-belegt")).toMatchObject({ ziel: "0.0.7", angeboten: null });
    expect(von("sonne-haben")).toMatchObject({ ziel: null, angeboten: "0.12.0" });
    expect(von("weber-haben")).toMatchObject({ ziel: null, angeboten: null });
  });

  it("filter: all, those that need someone, those with an update offered", () => {
    const zeilen = appZeilen(daten);
    expect(gefiltert(zeilen, "alle", "")).toHaveLength(zeilen.length);
    expect(ids(gefiltert(zeilen, "braucht", ""))).toEqual([
      "berger-schreibzeug",
      GESCHEITERT,
      "lind-haben",
      "holm-belegt",
      "kraft-stellwerk",
    ]);
    const update = gefiltert(zeilen, "update", "");
    expect(update.length).toBeGreaterThan(0);
    expect(update.every((z) => z.angeboten !== null && z.ziel === null)).toBe(true);
  });

  it("search app, customer, address and server, ignoring case", () => {
    const zeilen = appZeilen(daten);
    expect(ids(gefiltert(zeilen, "alle", "HOLM")).sort()).toEqual(["holm-belegt", "holm-haben"]);
    expect(gefiltert(zeilen, "alle", "schreibzeug")).toHaveLength(2);
    expect(gefiltert(zeilen, "alle", "gemeinsamer server 2")).toHaveLength(4);
  });

  it("group by customer or server, the group with the most pressing app first", () => {
    const zeilen = appZeilen(daten);
    const kunden = gruppiert(zeilen, "kunde");
    expect(kunden[0]).toMatchObject({ art: "kunde", id: "it-berger", name: "IT Berger" });
    expect(kunden.reduce((s, g) => s + g.zeilen.length, 0)).toBe(zeilen.length);
    const server = gruppiert(zeilen, "server");
    expect(server.map((g) => g.id)).toEqual(["shared-2", "lind", "holm", "kraft", "shared-1"]);
  });

  it("leave a removed app out and count a setup on its way as not needing anyone", () => {
    const [eine, zweite] = installationen;
    if (!eine || !zweite) throw new Error("no installations");
    const zeilen = appZeilen({
      ...daten,
      installationen: [
        { ...eine, zustand: "wird_eingerichtet" },
        { ...zweite, zustand: "entfernt" },
      ],
      angebote: [] as InstallationsAngebot[],
    });
    expect(ids(zeilen)).toEqual([eine.id]);
    expect(gefiltert(zeilen, "braucht", "")).toHaveLength(0);
  });
});
