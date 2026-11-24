import { setLocale } from "@steuerzentrale/ui";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiApps, appsQuelleEinsetzen } from "../daten/apps.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import type { Rolle } from "../daten/typen.ts";
import { planText, updateText } from "../daten/update-texte.ts";
import { demoAppsQuelle } from "../demo/apps-quelle.ts";
import { demo } from "../demo/index.ts";
import { aufraeumen, dialog, eintragen, feld, knopf, oeffne, warten } from "./test-dom.tsx";

/*
 * BAULISTE.md Z-503 in the interface, against the demo source: an update by hand on the page
 * "Updates" with a version and a reason, for owner and technik only, its state in the row after
 * it; the plan and the end of an update in words.
 */

const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

beforeEach(() => {
  setLocale("de", { reload: false });
  appsQuelleEinsetzen(demoAppsQuelle(() => demo.jetzt));
  rolle("technik");
});
afterEach(() => {
  aufraeumen();
  vi.unstubAllGlobals();
});

const zeile = (root: HTMLElement, id: string) =>
  [...root.querySelectorAll<HTMLElement>("tbody tr")].find((tr) => tr.textContent?.startsWith(id));

describe("an update by hand", () => {
  it("asks for version and reason, backs up first, and shows it under way", async () => {
    const { root } = await oeffne("/updates");
    const vorher = zeile(root, "atelier-belegt");
    expect(vorher?.textContent).toContain("noch keins");
    knopf(vorher as HTMLElement, "Update")?.click();
    await warten();
    expect(dialog().textContent).toContain("Installation aktualisieren?");
    expect(dialog().querySelector("[role=note]")?.textContent).toContain(
      "Vorher wird der Ist-Zustand gesichert",
    );
    expect(feld<HTMLSelectElement>("Version").value).toBe("0.0.7");
    eintragen("Grund", "Fehlerbehebung laut Hersteller");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.querySelector("[role=status]")?.textContent).toContain("Update angefordert");
    const danach = zeile(root, "atelier-belegt");
    expect(danach?.textContent).toContain("läuft: Backup vor 0.0.7");
    expect(knopf(danach as HTMLElement, "Update")).toBeUndefined();
  });

  it("is not offered to support", async () => {
    rolle("support");
    const { root } = await oeffne("/updates");
    expect(knopf(zeile(root, "atelier-belegt") as HTMLElement, "Update")).toBeUndefined();
  });

  it("sends version and reason to the Zentrale", async () => {
    const anfragen: { pfad: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (pfad: string, init?: RequestInit) => {
      anfragen.push({ pfad, body: JSON.parse(String(init?.body ?? "null")) });
      return Response.json({ backup: {}, update: {} }, { status: 201 });
    });
    appsQuelleEinsetzen(apiApps);
    const r = await apiApps.update("probe-ab12cd", "1.3.0", "Wunsch des Kunden");
    expect(r.ok).toBe(true);
    expect(anfragen).toEqual([
      {
        pfad: "/api/v1/installationen/probe-ab12cd/update",
        body: { version: "1.3.0", grund: "Wunsch des Kunden" },
      },
    ]);
  });
});

describe("plan and update in words", () => {
  const jetzt = Date.UTC(2027, 0, 15, 8, 0);

  it("names the wave's next slot or why it waits", () => {
    expect(planText(null, jetzt)).toBe("aktuell");
    expect(
      planText(
        {
          welle: "intern",
          version: "1.3.0",
          art: "termin",
          ab: jetzt,
          sperrzeitUebergangen: false,
        },
        jetzt,
      ),
    ).toBe("1.3.0, Welle intern: ab 09:00");
    expect(
      planText({ welle: "alle", version: "1.3.0", art: "wartet", grund: "angehalten" }, jetzt),
    ).toBe("1.3.0: angehalten nach einer Störung");
    expect(
      planText({ welle: "alle", version: "1.3.0", art: "wartet", grund: "nur_von_hand" }, jetzt),
    ).toBe("1.3.0: nur von Hand (App ohne Health)");
  });

  it("names a rollback with the old version and the agent's reason", () => {
    const letzter = {
      vonVersion: "1.0.3",
      nachVersion: "1.3.0",
      anlass: "welle" as const,
      welle: "intern",
      sperrzeitUebergangen: false,
      angefordertAm: jetzt - 600_000,
      phase: "zurueckgenommen" as const,
      endeAm: jetzt,
      fehler: "Health blieb rot",
      dauerMs: 300_000,
    };
    expect(updateText({ letzter, laeuft: false }, jetzt)).toBe(
      "09:00: 1.3.0 zurückgenommen, wieder 1.0.3: Health blieb rot",
    );
    expect(
      updateText({ letzter: { ...letzter, phase: "aktualisiert" }, laeuft: false }, jetzt),
    ).toBe("09:00: auf 1.3.0 aktualisiert");
  });
});
