import { setLocale } from "@steuerzentrale/ui";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import { supportQuelle, supportQuelleEinsetzen } from "../daten/support.ts";
import type { Rolle } from "../daten/typen.ts";
import { demo } from "../demo/index.ts";
import { demoSupport } from "../demo/support-quelle.ts";
import { aufraeumen, dialog, eintragen, feld, knopf, oeffne, warten } from "./test-dom.tsx";

// BAULISTE.md Z-802: the page "Support-Zugänge" against the demo source, which answers as the
// Zentrale does: running accesses with their time left, ended ones with what happened, starting
// one with installation, duration and reason, ending one early
const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

beforeEach(() => {
  setLocale("de", { reload: false });
  supportQuelleEinsetzen(
    demoSupport(demo.zugaenge, () => demo.jetzt, {
      name: "Jana Beispiel",
      kundeVon: (id) => demo.installationen.find((i) => i.id === id)?.kunde,
    }),
  );
  rolle("inhaber");
});
afterEach(aufraeumen);

describe("the page Support-Zugänge", () => {
  it("shows the running access with its time left and the ended ones with what happened", async () => {
    const { root } = await oeffne("/support");
    expect(root.textContent).toContain("Ole Kamp · seit");
    expect(root.textContent).toContain("noch 76 Min.");
    expect(root.textContent).toContain("Backup schlägt fehl, Platte prüfen");
    expect(root.textContent).toContain("Log-Auszug, Neustart");
    expect(root.textContent).toContain("Dokumente laden nicht, Log ansehen");
  });

  it("starts an access with installation, duration and reason", async () => {
    const { root } = await oeffne("/support");
    knopf(root, "Zugang starten")?.click();
    await warten();
    expect(dialog().textContent).toContain("Endet von selbst");
    const installation = feld<HTMLSelectElement>("Installation");
    installation.value = "berger-schreibzeug";
    installation.dispatchEvent(new Event("change", { bubbles: true }));
    const dauer = feld<HTMLSelectElement>("Dauer");
    expect(dauer.value).toBe("120");
    dauer.value = "60";
    eintragen("Grund", "Anfrage aus dem Portal: Dokumente fehlen");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.textContent).toContain("Anfrage aus dem Portal: Dokumente fehlen");
    expect(root.textContent).toContain("noch 60 Min.");
    const liste = await supportQuelle().liste({ installationId: "berger-schreibzeug" });
    expect(liste.ok && liste.daten[0]).toMatchObject({
      grund: "Anfrage aus dem Portal: Dokumente fehlen",
      ende: demo.jetzt + 60 * 60_000,
      eigen: true,
    });
  });

  it("refuses a start without a reason in the dialog", async () => {
    const { root } = await oeffne("/support");
    knopf(root, "Zugang starten")?.click();
    await warten();
    const form = dialog().querySelector("form");
    expect(form?.checkValidity()).toBe(false);
  });

  it("lets owner and technik end another's access, and it moves to the ended ones", async () => {
    const { root } = await oeffne("/support");
    knopf(root, "Zugang beenden")?.click();
    await warten();
    expect(root.textContent).toContain("Gerade kein Zugang aktiv.");
    expect(root.textContent).toContain("Backup schlägt fehl, Platte prüfen");
  });

  it("does not offer support to end another's access", async () => {
    rolle("support");
    const { root } = await oeffne("/support");
    expect(root.textContent).toContain("noch 76 Min.");
    expect(knopf(root, "Zugang beenden")).toBeUndefined();
  });
});
