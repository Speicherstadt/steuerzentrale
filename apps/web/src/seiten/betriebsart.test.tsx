import { setLocale } from "@steuerzentrale/ui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appsQuelleEinsetzen } from "../daten/apps.ts";
import { betriebsartQuelleEinsetzen } from "../daten/betriebsart.ts";
import { dnsQuelleEinsetzen } from "../daten/dns.ts";
import { installationenQuelleEinsetzen } from "../daten/installationen.ts";
import { kundenQuelleEinsetzen } from "../daten/kunden.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import { serverQuelleEinsetzen } from "../daten/server.ts";
import type { Rolle } from "../daten/typen.ts";
import { demoAppsQuelle } from "../demo/apps-quelle.ts";
import { demoBetriebsart } from "../demo/betriebsart.ts";
import { demoDns } from "../demo/dns.ts";
import { demo } from "../demo/index.ts";
import { demoInstallationenQuelle } from "../demo/installationen-quelle.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { demoServerQuelle } from "../demo/server-quelle.ts";
import { aufraeumen, dialog, eintragen, knopf, oeffne, warten } from "./test-dom.tsx";

// BAULISTE.md Z-805: the Betriebsart in the settings (only the owner changes it, with a reason),
// and "Nur für mich" hiding customers (with them support accesses and services) in menu and dialog
const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

beforeEach(() => {
  setLocale("de", { reload: false });
  const kunden = demoKunden(demo.kunden, () => demo.jetzt);
  const server = demoServerQuelle(demo.server, () => demo.jetzt);
  const apps = demoAppsQuelle(() => demo.jetzt);
  kundenQuelleEinsetzen(kunden);
  serverQuelleEinsetzen(server);
  appsQuelleEinsetzen(apps);
  installationenQuelleEinsetzen(
    demoInstallationenQuelle({
      jetzt: () => demo.jetzt,
      kunden: kunden.liste,
      server: server.liste,
      manifest: apps.manifest,
      betreiberWerte: [],
    }),
  );
  dnsQuelleEinsetzen(demoDns());
  betriebsartQuelleEinsetzen(demoBetriebsart());
  rolle("inhaber");
});
afterEach(aufraeumen);

const menue = (root: HTMLElement) =>
  [...root.querySelectorAll("nav[aria-label] a")].map(
    (a) => a.querySelector("span.truncate")?.textContent ?? "",
  );

const reiter = async (root: HTMLElement) => {
  knopf(root, "Betriebsart")?.click();
  await warten();
};

describe("the Betriebsart", () => {
  it("is switched by the owner with a reason and hides customers in the menu", async () => {
    const { root } = await oeffne("/einstellungen?tab=betriebsart");
    await reiter(root);
    // support accesses are reached through Kunden, not the menu (Navigation 2026-11)
    expect(menue(root)).toContain("Kunden");
    const selbst = root.querySelector<HTMLInputElement>("input[name=betriebsart][value=selbst]");
    expect(root.querySelector<HTMLInputElement>("input[value=kunden]")?.checked).toBe(true);
    selbst?.click();
    eintragen("Grund", "Nur noch eigene Apps", root);
    root.querySelector("form")?.requestSubmit();
    await warten();
    expect(root.textContent).toContain("Betriebsart gespeichert.");
    const danach = menue(root);
    for (const name of ["Kunden", "Support-Zugänge"]) expect(danach).not.toContain(name);
    expect(danach).toContain("Apps");
  });

  it.each(["technik", "support"] as const)("is read-only for %s", async (r) => {
    rolle(r);
    const { root } = await oeffne("/einstellungen?tab=betriebsart");
    await reiter(root);
    expect(root.querySelector("input[name=betriebsart]")).toBeNull();
    expect(root.textContent).toContain("Für Kunden");
  });

  it('asks no customer in "App installieren" in "Nur für mich"', async () => {
    betriebsartQuelleEinsetzen(
      demoBetriebsart({ betriebsart: "selbst", eigenerKundeId: "intern" }),
    );
    const { root } = await oeffne("/apps");
    knopf(root, "App installieren")?.click();
    await warten();
    const labels = [...dialog().querySelectorAll("label")].map((l) => l.textContent);
    expect(labels).not.toContain("Kunde");
    expect(labels).toContain("Server");
  });
});
