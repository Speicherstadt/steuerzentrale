import { describe, expect, it } from "vitest";
import { demo } from "../demo/index.ts";
import type { Updateplan } from "./typen.ts";
import { nurVonHand, planStand, wellen } from "./wellen.ts";

const belegt: Updateplan = { app: "belegt", version: "0.10.0", vorher: "0.9.0", seit: 0 };

describe("update waves", () => {
  it("put our own installations into 'intern' and the rest into 'alle'", () => {
    const [intern, alle] = wellen(demo, belegt);
    expect(intern?.installationen.map((i) => i.id)).toEqual(["intern-belegt"]);
    expect(alle?.installationen.map((i) => i.id)).toEqual(["atelier-belegt", "holm-belegt"]);
  });

  it("report each wave's state", () => {
    expect(wellen(demo, belegt).map((w) => w.zustand)).toEqual(["fertig", "laeuft"]);
    expect(planStand(demo, belegt)).toMatchObject({ fertig: 1, gesamt: 3, welle: "alle" });
  });

  it("leave cancelled installations out", () => {
    const haben: Updateplan = { app: "haben", version: "1.9.0", vorher: "1.8.2", seit: 0 };
    const ids = wellen(demo, haben).flatMap((w) => w.installationen.map((i) => i.id));
    expect(ids).not.toContain("sonne-haben");
  });

  it("is empty for an app without installations", () => {
    const soll: Updateplan = { app: "kontext", version: "1.0.0", vorher: "", seit: 0 };
    expect(wellen(demo, soll).map((w) => w.zustand)).toEqual(["leer", "leer"]);
  });

  it("leave apps without health to a person (docs/plan.md)", () => {
    const vonHand = nurVonHand(demo);
    expect(vonHand.map((x) => x.app.id)).toEqual(["haben"]);
    expect(vonHand[0]?.zurueck.map((i) => i.id)).toEqual(["roth-haben", "berger-haben"]);
  });
});
