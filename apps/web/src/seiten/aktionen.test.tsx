import { setLocale } from "@steuerzentrale/ui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installationenQuelleEinsetzen } from "../daten/installationen.ts";
import { kundenQuelleEinsetzen } from "../daten/kunden.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import { serverQuelleEinsetzen } from "../daten/server.ts";
import type { Rolle } from "../daten/typen.ts";
import { demoAppsQuelle } from "../demo/apps-quelle.ts";
import { demo } from "../demo/index.ts";
import { demoInstallationenQuelle } from "../demo/installationen-quelle.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { demoServerQuelle } from "../demo/server-quelle.ts";
import { aufraeumen, dialog, knopf, oeffne, warten } from "./test-dom.tsx";

// BAULISTE.md Z-405: the actions of an installation against the demo sources, which answer as the
// Zentrale does: only the offered ones, each with a reason, for both roles restart and log excerpt (Z-1204); a log excerpt
// shows its lines once they came
const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

/** A demo installation whose app has no freeze window, so a restart is always allowed */
const ohneSperrzeit = () => {
  const frei = demo.apps.filter((a) => a.sperrzeiten.length === 0).map((a) => a.id);
  const i = demo.installationen.find((x) => frei.includes(x.app));
  if (!i) throw new Error("no installation without a freeze window");
  return i.id;
};

beforeEach(() => {
  setLocale("de", { reload: false });
  const kunden = demoKunden(demo.kunden, () => demo.jetzt);
  const server = demoServerQuelle(demo.server, () => demo.jetzt);
  kundenQuelleEinsetzen(kunden);
  serverQuelleEinsetzen(server);
  installationenQuelleEinsetzen(
    demoInstallationenQuelle({
      jetzt: () => demo.jetzt,
      kunden: kunden.liste,
      server: server.liste,
      manifest: demoAppsQuelle(() => demo.jetzt).manifest,
      betreiberWerte: [],
    }),
  );
  rolle("inhaber");
});
afterEach(aufraeumen);

const absenden = async () => {
  // Z-1207: no dialog asks for a reason
  expect(dialog().textContent).not.toContain("Grund");
  dialog().querySelector("form")?.requestSubmit();
  await warten();
};

describe("the actions of an installation", () => {
  it("offers only what the manifest offers", async () => {
    const { root } = await oeffne(`/apps/${ohneSperrzeit()}`);
    expect(knopf(root, "Log-Auszug")).toBeDefined();
    expect(knopf(root, "Neustart")).toBeDefined();
    // no demo app has a command for "nur lesen"
    expect(knopf(root, "Nur lesen")).toBeUndefined();
  });

  it("restarts without a reason (Z-1207), and the job shows", async () => {
    const { root } = await oeffne(`/apps/${ohneSperrzeit()}`);
    knopf(root, "Neustart")?.click();
    await warten();
    expect(dialog().textContent).toContain("nie in einer Sperrzeit");
    await absenden();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.textContent).toContain("Neustart");
    expect(root.textContent).toContain("an den Agenten zugestellt");
  });

  it("shows the lines of a log excerpt, the secrets replaced", async () => {
    const { root } = await oeffne(`/apps/${ohneSperrzeit()}`);
    knopf(root, "Log-Auszug")?.click();
    await warten();
    await absenden();
    const zeilen = dialog().querySelector("[data-testid=log-zeilen]")?.textContent ?? "";
    expect(zeilen).toContain("started");
    expect(zeilen).toContain("OIDC_CLIENT_SECRET=[geheim]");
    expect(dialog().textContent).toContain("4 Zeilen");
  });

  it("offers a member restart and log excerpt, and nothing else of an owner (Z-1204)", async () => {
    rolle("mitglied");
    const { root } = await oeffne(`/apps/${ohneSperrzeit()}?tab=technik`);
    expect(knopf(root, "Neustart")).toBeDefined();
    expect(knopf(root, "Log-Auszug")).toBeDefined();
    for (const nein of ["Einstellungen ändern", "Backup jetzt", "Prüf-Restore jetzt", "Nur lesen"])
      expect(knopf(root, nein), nein).toBeUndefined();
    expect(root.textContent).not.toContain("Support-Zugang");
  });

  it("offers both roles log excerpt and restart without any access (Z-1203, Z-1204)", async () => {
    for (const r of ["inhaber", "mitglied"] as const) {
      rolle(r);
      const { root } = await oeffne(`/apps/${ohneSperrzeit()}?tab=technik`);
      expect(knopf(root, "Log-Auszug"), r).toBeDefined();
      expect(knopf(root, "Neustart"), r).toBeDefined();
      expect(knopf(root, "Zugang starten"), r).toBeUndefined();
      aufraeumen();
    }
  });
});
