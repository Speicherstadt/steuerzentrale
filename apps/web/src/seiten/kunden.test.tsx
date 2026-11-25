import { render } from "@solidjs/web";
import { setLocale } from "@steuerzentrale/ui";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/solid-router";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiKunden, kundenQuelleEinsetzen } from "../daten/kunden.ts";
import { kunden } from "../demo/kunden.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { routeTree } from "../routeTree.gen.ts";
import { menuePunkt } from "./test-dom.tsx";

// BAULISTE.md Z-801: the customer pages create, change and give notice through their dialogs, each
// with a reason, against the demo source; with the API source they show what the Zentrale answers
let dispose = () => {};
beforeEach(() => {
  setLocale("de", { reload: false });
  kundenQuelleEinsetzen(demoKunden(kunden, () => 0));
});
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const warten = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((fertig) => setTimeout(fertig, 0));
    flush();
  }
};

const oeffne = async (pfad: string) => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [pfad] }),
  });
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <RouterProvider router={router} />, root);
  await router.load();
  await warten();
  return { root, router };
};

const knopf = (root: HTMLElement, text: string) => {
  const treffer = [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!treffer) throw new Error(`no button "${text}"`);
  return treffer;
};

/** Fills the open dialog's fields by their labels and sends its form */
const ausfuellen = async (root: HTMLElement, werte: Record<string, string>) => {
  const dialog = root.querySelector<HTMLDialogElement>("dialog[open]");
  if (!dialog) throw new Error("no open dialog");
  // Z-1207: no dialog asks for a reason
  expect(dialog.textContent).not.toContain("Grund");
  for (const [label, wert] of Object.entries(werte)) {
    const marke = [...dialog.querySelectorAll("label")].find((l) => l.textContent === label);
    const feld = dialog.querySelector<HTMLInputElement>(`#${CSS.escape(marke?.htmlFor ?? "")}`);
    if (!feld) throw new Error(`no field "${label}"`);
    feld.value = wert;
    feld.dispatchEvent(new Event("input", { bubbles: true }));
  }
  flush();
  dialog.querySelector("form")?.requestSubmit();
  await warten();
};

const ueberschrift = (root: HTMLElement) => root.querySelector("main h1")?.textContent;

describe("the customer pages", () => {
  it("create a customer and lead to its page", async () => {
    const { root, router } = await oeffne("/kunden");
    knopf(root, "Kunde anlegen").click();
    flush();
    await ausfuellen(root, {
      "Name des Kunden": "Muster Design",
      Ansprechperson: "Mia Muster",
      "E-Mail-Adresse": "mia@muster.test",
      Vertragsbeginn: "2026-12-01",
    });
    expect(router.state.location.pathname).toMatch(/^\/kunden\/[\w-]+$/);
    expect(ueberschrift(root)).toBe("Muster Design");
    expect(root.textContent).toContain("noch keine App");
    expect(root.textContent).toContain("Vertrag seit 01.12.2026");
    expect(root.textContent).not.toContain("Basis");
  });

  it("list customers without an SLA (Z-1202)", async () => {
    const { root } = await oeffne("/kunden");
    const kopf = [...root.querySelectorAll("main thead th")].map((th) => th.textContent);
    expect(kopf).toContain("Kunde");
    expect(kopf).not.toContain("SLA");
    expect(root.textContent).not.toContain("Basis");
  });

  it("change a customer's details", async () => {
    const { root } = await oeffne("/kunden/atelier-nord");
    knopf(root, "Ändern").click();
    flush();
    await ausfuellen(root, { "Name des Kunden": "Atelier Nord GmbH" });
    expect(ueberschrift(root)).toBe("Atelier Nord GmbH");
    expect(root.querySelector("dialog[open]")).toBeNull();
  });

  it("give notice with the day of deletion, and take it back", async () => {
    const { root } = await oeffne("/kunden/atelier-nord");
    menuePunkt(root, "Kündigen …")?.click();
    flush();
    await ausfuellen(root, { Vertragsende: "2026-11-30" });
    expect(root.textContent).toContain("Gekündigt zum 30.11.2026");
    expect(root.textContent).toContain("Löschung am 28.02.2027");
    knopf(root, "Kündigung zurücknehmen").click();
    flush();
    await ausfuellen(root, {});
    expect(root.textContent).not.toContain("Gekündigt zum");
    expect(root.textContent).toContain("ungekündigt");
    expect(menuePunkt(root, "Kündigen …")).toBeDefined();
  });

  it("give no notice without the confirmation (Z-1207)", async () => {
    const { root } = await oeffne("/kunden/atelier-nord");
    menuePunkt(root, "Kündigen …")?.click();
    flush();
    const offen = root.querySelector<HTMLDialogElement>("dialog[open]");
    if (!offen) throw new Error("no open dialog");
    const marke = [...offen.querySelectorAll("label")].find(
      (l) => l.textContent === "Vertragsende",
    );
    const ende = offen.querySelector<HTMLInputElement>(`#${CSS.escape(marke?.htmlFor ?? "")}`);
    if (!ende) throw new Error("no field Vertragsende");
    ende.value = "2026-11-30";
    ende.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    knopf(offen, "Abbrechen").click();
    await warten();
    expect(root.querySelector("dialog[open]")).toBeNull();
    expect(root.textContent).not.toContain("Gekündigt zum");
    expect(root.textContent).toContain("ungekündigt");
  });

  it("keep the dialog open with the Zentrale's error", async () => {
    const { root } = await oeffne("/kunden/atelier-nord");
    menuePunkt(root, "Kündigen …")?.click();
    flush();
    await ausfuellen(root, { Vertragsende: "2020-01-01" });
    expect(root.querySelector("dialog[open] [role=alert]")?.textContent).toBe(
      "Das Vertragsende liegt vor dem Vertragsbeginn.",
    );
  });

  it("show the customers the Zentrale answers, and its refusal", async () => {
    kundenQuelleEinsetzen(apiKunden);
    const praxis = kunden.find((k) => k.id === "praxis-weber");
    vi.stubGlobal("fetch", async () => Response.json({ kunden: [praxis] }));
    const liste = await oeffne("/kunden");
    expect(liste.root.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(liste.root.querySelector("tbody")?.textContent).toContain("Praxis Weber");
    dispose();
    vi.stubGlobal("fetch", async () =>
      Response.json({ fehler: "keine_berechtigung" }, { status: 403 }),
    );
    const { root } = await oeffne("/kunden/praxis-weber");
    expect(root.querySelector("main [role=alert]")?.textContent).toBe(
      "Dafür fehlt Ihrer Rolle das Recht.",
    );
  });
});

describe("a customer's short name (Z-407)", () => {
  // Z-407: the short name in the addresses `<app>.<kuerzel>.<domain>`
  it("suggest a short name from the name, or take the one given", async () => {
    const { root } = await oeffne("/kunden");
    knopf(root, "Kunde anlegen").click();
    flush();
    await ausfuellen(root, {
      "Name des Kunden": "Müller & Söhne",
      Ansprechperson: "Mia Muster",
      "E-Mail-Adresse": "mia@muster.test",
      Vertragsbeginn: "2026-12-01",
    });
    expect(root.textContent).toContain("Kürzelmueller-soehne");
    knopf(root, "Ändern").click();
    flush();
    await ausfuellen(root, { Kürzel: "atelier-nord" });
    expect(root.querySelector("dialog[open] [role=alert]")?.textContent).toBe(
      "Dieses Kürzel hat schon ein anderer Kunde.",
    );
  });

  it("keep the short name fixed while an installation runs", async () => {
    const { root } = await oeffne("/kunden/atelier-nord");
    expect(root.textContent).toContain("Kürzelatelier-nord");
    knopf(root, "Ändern").click();
    flush();
    const dialog = root.querySelector("dialog[open]");
    const marke = [...(dialog?.querySelectorAll("label") ?? [])].find(
      (l) => l.textContent === "Kürzel",
    );
    const feld = dialog?.querySelector<HTMLInputElement>(`#${CSS.escape(marke?.htmlFor ?? "")}`);
    expect(feld?.disabled).toBe(true);
    expect(dialog?.textContent).toContain("Fest, solange eine Installation des Kunden läuft");
  });
});
