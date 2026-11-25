import { describe, expect, it } from "vitest";
import { darf, type Recht, ROLLEN, ROLLEN_ZUGRIFF, rollenVon } from "./rollen.ts";

/*
 * BAULISTE.md Z-1204: two roles. The owner may do everything; a member sees everything and may
 * restart an installation and take its log excerpt, nothing else.
 */
const LESEN: Recht[] = [
  "betreiber:lesen",
  "mitglieder:lesen",
  "kunden:lesen",
  "server:lesen",
  "installationen:lesen",
  "audit:lesen",
  "dns:lesen",
  "backups:lesen",
  "manifeste:lesen",
  "benachrichtigungen:lesen",
];
const MITGLIED: Recht[] = [...LESEN, "installationen:neustart", "installationen:log_auszug"];
const SCHREIBEN: Recht[] = [
  "betreiber:betriebsart",
  "mitglieder:einladen",
  "mitglieder:rolle",
  "mitglieder:entfernen",
  "kunden:schreiben",
  "kunden:intern",
  "server:anlegen",
  "server:sperren",
  "server:neustart",
  "installationen:schreiben",
  "installationen:sperrzeit",
  "dns:schreiben",
  "backups:schreiben",
  "manifeste:importieren",
  "manifeste:abfragen",
  "benachrichtigungen:schreiben",
];

describe("darf", () => {
  it("knows exactly two roles: owner and member", () => {
    expect([...ROLLEN]).toEqual(["inhaber", "mitglied"]);
  });

  it("lets the owner do everything", () => {
    for (const recht of [...MITGLIED, ...SCHREIBEN])
      expect(darf("inhaber", recht), recht).toBe(true);
  });

  it("lets a member see everything, restart and take a log excerpt", () => {
    for (const recht of MITGLIED) expect(darf("mitglied", recht), recht).toBe(true);
  });

  it("lets a member change nothing else: no install, removal, notice, restore, setting, secret or invitation", () => {
    for (const recht of SCHREIBEN) expect(darf("mitglied", recht), recht).toBe(false);
  });

  it("knows the old roles technik and support no more", () => {
    for (const rolle of ["technik", "support"])
      for (const recht of [...MITGLIED, ...SCHREIBEN])
        expect(darf(rolle, recht), rolle).toBe(false);
  });

  it("gives a member with several roles the rights of each", () => {
    expect(rollenVon("mitglied, inhaber")).toEqual(["mitglied", "inhaber"]);
    expect(darf("mitglied,inhaber", "mitglieder:einladen")).toBe(true);
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
