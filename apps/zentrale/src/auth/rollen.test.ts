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

  it("lets every role read customers, and only owner and technik write them (Z-801)", () => {
    for (const rolle of ROLLEN) expect(darf(rolle, "kunden:lesen"), rolle).toBe(true);
    expect(darf("inhaber", "kunden:schreiben")).toBe(true);
    expect(darf("technik", "kunden:schreiben")).toBe(true);
    expect(darf("support", "kunden:schreiben")).toBe(false);
  });

  it("lets owner and technik add servers, not support (BAULISTE.md Z-302)", () => {
    expect(darf("inhaber", "server:anlegen")).toBe(true);
    expect(darf("technik", "server:anlegen")).toBe(true);
    expect(darf("support", "server:anlegen")).toBe(false);
  });

  it("lets every role take a log excerpt, and only owner and technik restart (Z-405)", () => {
    for (const rolle of ROLLEN) expect(darf(rolle, "installationen:log_auszug"), rolle).toBe(true);
    expect(darf("inhaber", "installationen:schreiben")).toBe(true);
    expect(darf("technik", "installationen:schreiben")).toBe(true);
    expect(darf("support", "installationen:schreiben")).toBe(false);
  });

  it("lets owner and technik read the audit log, not support (Z-406)", () => {
    expect(darf("inhaber", "audit:lesen")).toBe(true);
    expect(darf("technik", "audit:lesen")).toBe(true);
    expect(darf("support", "audit:lesen")).toBe(false);
  });

  it("lets every role read manifests, owner and technik import and ask (Z-501)", () => {
    for (const rolle of ROLLEN) expect(darf(rolle, "manifeste:lesen"), rolle).toBe(true);
    for (const recht of ["manifeste:importieren", "manifeste:abfragen"] as const) {
      expect(darf("inhaber", recht), recht).toBe(true);
      expect(darf("technik", recht), recht).toBe(true);
      expect(darf("support", recht), recht).toBe(false);
    }
  });

  it("lets only the owner mark a customer as internal (Z-501)", () => {
    expect(darf("inhaber", "kunden:intern")).toBe(true);
    expect(darf("technik", "kunden:intern")).toBe(false);
    expect(darf("support", "kunden:intern")).toBe(false);
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
