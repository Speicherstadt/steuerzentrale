import { describe, expect, it } from "vitest";
import { serverAngaben } from "./server-angaben.ts";

describe("what the dialog sends", () => {
  const felder = { name: "Gemeinsamer Server 3", von: "03:30", bis: "04:30", grund: "neu" };

  it("sends name, a daily maintenance window and the reason, no kind and no customer (Z-1205)", () => {
    expect(serverAngaben({ ...felder, art: "eigen", kunde: "berger" })).toEqual({
      name: "Gemeinsamer Server 3",
      wartungsfenster: { tage: [0, 1, 2, 3, 4, 5, 6], von: "03:30", bis: "04:30" },
      grund: "neu",
    });
  });
});
