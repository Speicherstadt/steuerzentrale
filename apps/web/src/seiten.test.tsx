import { render } from "@solidjs/web";
import { setLocale } from "@steuerzentrale/ui";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/solid-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routeTree } from "./routeTree.gen.ts";

// The pages in the router, rendered from the demo fixtures: heading, path and content
let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
});
beforeEach(() => setLocale("de", { reload: false }));

const oeffne = async (pfad: string) => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [pfad] }),
  });
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <RouterProvider router={router} />, root);
  await router.load();
  await new Promise((fertig) => setTimeout(fertig, 0));
  return root;
};

const ueberschrift = (root: HTMLElement) => root.querySelector("main h1")?.textContent;

// Every route once on Solid's dev build: a 1.x-style read or write fails here (vitest.solid-diagnostics.ts)
const ALLE = [
  ["/", "Übersicht"],
  ["/server", "Server"],
  ["/server/holm", "Schreinerei Holm"],
  ["/installationen", "Installationen"],
  ["/installationen/kraft-fixpunkt", "Ingenieurbüro Kraft · Fixpunkt"],
  ["/updates", "Updates"],
  ["/backups", "Backups"],
  ["/auftraege", "Aufträge"],
  ["/kunden", "Kunden"],
  ["/kunden/sonne", "Café Sonne"],
  ["/support", "Support-Zugänge"],
  ["/leistungen", "Leistungen"],
  ["/apps", "Apps"],
  ["/ereignisse", "Ereignisse"],
  ["/audit", "Audit-Log"],
  ["/einstellungen", "Einstellungen"],
] as const;

describe("every page", () => {
  it.each(ALLE)("%s renders its heading", async (pfad, titel) => {
    expect(ueberschrift(await oeffne(pfad))).toBe(titel);
  });
});

describe("pages", () => {
  it("open the overview with what needs attention, worst first", async () => {
    const root = await oeffne("/");
    expect(ueberschrift(root)).toBe("Übersicht");
    const erster = root.querySelector("main ul li a");
    expect(erster?.textContent).toContain("Studio Lind");
    expect(erster?.querySelector("svg")?.getAttribute("aria-label")).toBe("Störung");
  });

  it("show all eight apps on the apps page", async () => {
    const root = await oeffne("/apps");
    const namen = [...root.querySelectorAll("main h2")].map((h) => h.textContent);
    expect(namen).toEqual([
      "Haben",
      "Belegt",
      "Kontext",
      "Schreibzeug",
      "Stellwerk",
      "Fixpunkt",
      "Kennwort",
      "Soll",
    ]);
    expect(root.textContent).toContain("Haben#947");
  });

  it("name the object of a detail page in the path", async () => {
    const root = await oeffne("/server/shared-2");
    expect(ueberschrift(root)).toBe("Gemeinsamer Server 2");
    const pfad = root.querySelector('nav[aria-label="Pfad"]');
    expect(pfad?.textContent).toContain("Server");
    expect(pfad?.querySelector('[aria-current="page"]')?.textContent).toBe("Gemeinsamer Server 2");
  });

  it("mark the current area in the sidebar, also on a detail page", async () => {
    const root = await oeffne("/installationen/lind-haben");
    const aktiv = root.querySelector('nav[aria-label="Bereiche"] a[aria-current="page"]');
    expect(aktiv?.textContent).toContain("Installationen");
    expect(ueberschrift(root)).toBe("Studio Lind · Haben");
  });

  it("claim no check as OK on a server whose agent is silent", async () => {
    // kraft: agent silent for 6 minutes, the checks run every 5; as on the installation page,
    // the last known values are no fresh check (no green without a check)
    const root = await oeffne("/server/kraft");
    const karte = [...root.querySelectorAll("main section")].find(
      (s) => s.querySelector("h2")?.textContent === "Prüfungen",
    );
    expect(karte).toBeDefined();
    const zustaende = [...(karte?.querySelectorAll("span.inline-flex") ?? [])].map(
      (z) => z.textContent,
    );
    expect(zustaende).not.toContain("OK");
    expect(karte?.textContent).toContain("Agent still: letzter bekannter Stand");
  });

  it("say so for an unknown object", async () => {
    const root = await oeffne("/kunden/gibt-es-nicht");
    expect(ueberschrift(root)).toBe("Nicht gefunden");
  });
});
