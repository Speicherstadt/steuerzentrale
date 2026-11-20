import { describe, expect, it } from "vitest";
import { darf, ROLLEN, ROLLEN_ZUGRIFF, rollenVon } from "./rollen.ts";

describe("darf", () => {
  it("lets every role read its operator and its members", () => {
    for (const rolle of ROLLEN) {
      expect(darf(rolle, "betreiber:lesen"), rolle).toBe(true);
      expect(darf(rolle, "mitglieder:lesen"), rolle).toBe(true);
    }
  });

  it("lets only the owner invite, change roles and remove members", () => {
    for (const recht of [
      "mitglieder:einladen",
      "mitglieder:rolle",
      "mitglieder:entfernen",
    ] as const) {
      expect(darf("inhaber", recht), recht).toBe(true);
      expect(darf("technik", recht), recht).toBe(false);
      expect(darf("support", recht), recht).toBe(false);
    }
  });

  it("gives a member with several roles the rights of each", () => {
    expect(rollenVon("support, inhaber")).toEqual(["support", "inhaber"]);
    expect(darf("support,inhaber", "mitglieder:einladen")).toBe(true);
  });

  it("refuses Better Auth's own roles and unknown ones", () => {
    for (const rolle of ["owner", "admin", "member", "", "inhaber2"])
      expect(darf(rolle, "betreiber:lesen"), rolle).toBe(false);
  });

  it("grants no role a right in Better Auth's own organization routes", () => {
    for (const rolle of ROLLEN)
      for (const anweisung of [
        { organization: ["update"] },
        { organization: ["delete"] },
        { member: ["create"] },
        { member: ["update"] },
        { member: ["delete"] },
        { invitation: ["create"] },
        { ac: ["read"] },
      ])
        expect(ROLLEN_ZUGRIFF[rolle].authorize(anweisung as never).success, rolle).toBe(false);
  });
});
