import { setLocale } from "@steuerzentrale/ui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import type { Rolle } from "../daten/typen.ts";
import { aufraeumen, dialog, knopf, oeffne, warten } from "./test-dom.tsx";

/*
 * The actions of "Zu tun" (docs/plan.md, "Übersicht (Oberfläche 2026-11)") against the demo: a
 * broken app offers "Log ansehen" and "Neustart" with the rights they have on its page (both roles,
 * Z-1204), each through its dialog with a reason; every
 * other row leads to its app or server.
 */

const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

beforeEach(() => setLocale("de", { reload: false }));
afterEach(aufraeumen);

const zeile = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLElement>("main ul.divide-y > li")].find((li) =>
    li.textContent?.includes(text),
  );

const GESTOERT = "Schreibzeug bei IT Berger ist gestört";

describe("the rows of Zu tun", () => {
  it("offer log and restart of a broken app to the owner, through the dialog with a reason", async () => {
    rolle("inhaber");
    const { root } = await oeffne("/");
    await warten();
    const z = zeile(root, GESTOERT) as HTMLElement;
    expect(knopf(z, "Log ansehen")).toBeDefined();
    knopf(z, "Neustart")?.click();
    await warten();
    expect(dialog().textContent).toContain("Grund");
  });

  it("offer a member restart and log too (Z-1204)", async () => {
    rolle("mitglied");
    const { root } = await oeffne("/");
    await warten();
    const z = zeile(root, GESTOERT) as HTMLElement;
    expect(knopf(z, "Neustart")).toBeDefined();
    expect(knopf(z, "Log ansehen")).toBeDefined();
  });

  it("lead a server's row to the server", async () => {
    rolle("inhaber");
    const { root } = await oeffne("/");
    const z = zeile(root, "Server „Ingenieurbüro Kraft“ meldet sich nicht") as HTMLElement;
    const oeffnen = [...z.querySelectorAll("a")].find((a) => a.textContent === "Server öffnen");
    expect(oeffnen?.getAttribute("href")).toBe("/server/kraft");
    // the app without state because of the silent agent stands in the same row
    expect(z.textContent).toContain("Stellwerk bei Ingenieurbüro Kraft ohne Zustand");
  });
});
