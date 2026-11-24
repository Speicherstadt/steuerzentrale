import { describe, expect, it } from "vitest";
import { installationAnsicht } from "../daten/installation-ansicht.ts";
import { demo } from "../demo/index.ts";
import { GESCHEITERT, startbestand } from "../demo/installationen-bestand.ts";
import { alsServerDerZentrale } from "../demo/server-quelle.ts";
import { gefiltert, nachServer } from "./installationen-filter.ts";

const namen = {
  kunden: demo.kunden,
  server: demo.server.map((sv) => alsServerDerZentrale(sv, demo.jetzt)),
  apps: demo.apps,
  demo: demo.installationen,
};
const alle = startbestand(demo.jetzt).map((e) => installationAnsicht(e.i, namen));

const ids = (filter: Parameters<typeof gefiltert>[1], frage = "", liste = alle) =>
  gefiltert(liste, filter, frage).map((a) => a.id);

describe("installation filters", () => {
  it("filter by state, cancelled installations apart, a failed setup as red", () => {
    expect(ids("rot")).toEqual(["berger-schreibzeug", GESCHEITERT]);
    expect(ids("gelb")).toEqual(["lind-haben"]);
    expect(ids("unbekannt")).toEqual(["kraft-stellwerk"]);
    expect(ids("gekuendigt")).toEqual(["sonne-haben"]);
    expect(ids("alle")).toHaveLength(demo.installationen.length + 1);
  });

  it("count a setup on its way as without state and leave a removed one out", () => {
    const [eine, zweite] = alle;
    if (!eine || !zweite) throw new Error("no installations");
    const liste = [
      { ...eine, zustand: "wird_eingerichtet" as const, demo: undefined },
      { ...zweite, zustand: "entfernt" as const },
    ];
    expect(ids("unbekannt", "", liste)).toEqual([eine.id]);
    expect(ids("alle", "", liste)).toEqual([eine.id]);
  });

  it("search customer, app, address and server, ignoring case", () => {
    expect(ids("alle", "HOLM")).toEqual(["holm-haben", "holm-belegt"]);
    expect(ids("alle", "schreibzeug")).toEqual(["atelier-schreibzeug", "berger-schreibzeug"]);
    expect(ids("alle", "gemeinsamer server 2")).toHaveLength(4);
  });

  it("group by server and leave servers without a match out", () => {
    const gruppen = nachServer(demo.server, gefiltert(alle, "rot", ""));
    expect(gruppen.map((g) => g.server.id)).toEqual(["shared-2"]);
  });
});
