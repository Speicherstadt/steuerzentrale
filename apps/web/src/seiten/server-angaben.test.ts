import { describe, expect, it } from "vitest";
import { serverAngaben } from "./server-angaben.ts";

describe("what the dialog sends", () => {
  const felder = { name: "Gemeinsamer Server 3", von: "03:30", bis: "04:30", grund: "neu" };

  it("sends a shared server without a customer, maintenance every day", () => {
    expect(serverAngaben({ ...felder, art: "gemeinsam", kunde: "berger" })).toEqual({
      name: "Gemeinsamer Server 3",
      art: "gemeinsam",
      wartungsfenster: { tage: [0, 1, 2, 3, 4, 5, 6], von: "03:30", bis: "04:30" },
      grund: "neu",
    });
  });

  it("names the server at the customer as the API does, with its customer", () => {
    expect(serverAngaben({ ...felder, art: "kunde", kunde: "berger" })).toMatchObject({
      art: "beim_kunden",
      kundeId: "berger",
    });
    expect(serverAngaben({ ...felder, art: "eigen", kunde: "berger" })).toMatchObject({
      art: "eigen",
      kundeId: "berger",
    });
  });
});
