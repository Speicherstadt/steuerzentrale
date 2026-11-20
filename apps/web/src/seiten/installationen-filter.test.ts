import { describe, expect, it } from "vitest";
import { demo } from "../demo/index.ts";
import { gefiltert, nachServer } from "./installationen-filter.ts";

const ids = (filter: Parameters<typeof gefiltert>[1], frage = "") =>
  gefiltert(demo, filter, frage).map((i) => i.id);

describe("installation filters", () => {
  it("filter by state, cancelled installations apart", () => {
    expect(ids("rot")).toEqual(["berger-schreibzeug"]);
    expect(ids("gelb")).toEqual(["lind-haben"]);
    expect(ids("unbekannt")).toEqual(["kraft-fixpunkt"]);
    expect(ids("gekuendigt")).toEqual(["sonne-haben"]);
    expect(ids("alle")).toHaveLength(demo.installationen.length);
  });

  it("search customer, app, address and server, ignoring case", () => {
    expect(ids("alle", "HOLM")).toEqual(["holm-haben", "holm-belegt"]);
    expect(ids("alle", "schreibzeug")).toEqual(["atelier-schreibzeug", "berger-schreibzeug"]);
    expect(ids("alle", "gemeinsamer server 2")).toHaveLength(3);
  });

  it("group by server and leave servers without a match out", () => {
    const gruppen = nachServer(demo, gefiltert(demo, "rot", ""));
    expect(gruppen.map((g) => g.server.id)).toEqual(["shared-2"]);
  });
});
