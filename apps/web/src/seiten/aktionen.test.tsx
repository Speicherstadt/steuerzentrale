import { setLocale } from "@steuerzentrale/ui";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installationenQuelleEinsetzen } from "../daten/installationen.ts";
import { kundenQuelleEinsetzen } from "../daten/kunden.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import { serverQuelleEinsetzen } from "../daten/server.ts";
import type { Rolle } from "../daten/typen.ts";
import { demo } from "../demo/index.ts";
import { demoInstallationenQuelle } from "../demo/installationen-quelle.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { demoServerQuelle } from "../demo/server-quelle.ts";
import { aufraeumen, dialog, eintragen, knopf, oeffne, warten } from "./test-dom.tsx";

// BAULISTE.md Z-405: the actions of an installation against the demo sources, which answer as the
// Zentrale does: only the offered ones, restart only for owner and technik, each with a reason; a
// log excerpt shows its lines once they came
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
      betreiberWerte: [],
    }),
  );
  rolle("technik");
});
afterEach(aufraeumen);

const absenden = async (grund: string) => {
  eintragen("Grund", grund);
  flush();
  dialog().querySelector("form")?.requestSubmit();
  await warten();
};

describe("the actions of an installation", () => {
  it("offers only what the manifest offers", async () => {
    const { root } = await oeffne(`/installationen/${ohneSperrzeit()}`);
    expect(knopf(root, "Log-Auszug")).toBeDefined();
    expect(knopf(root, "Neustart")).toBeDefined();
    // no demo app has a command for "nur lesen"
    expect(knopf(root, "Nur lesen")).toBeUndefined();
  });

  it("restarts with a reason, and the job shows", async () => {
    const { root } = await oeffne(`/installationen/${ohneSperrzeit()}`);
    knopf(root, "Neustart")?.click();
    await warten();
    expect(dialog().textContent).toContain("nie in einer Sperrzeit");
    await absenden("Health rot seit 10:31");
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.textContent).toContain("Neustart");
    expect(root.textContent).toContain("an den Agenten zugestellt");
  });

  it("shows the lines of a log excerpt, the secrets replaced", async () => {
    const { root } = await oeffne(`/installationen/${ohneSperrzeit()}`);
    knopf(root, "Log-Auszug")?.click();
    await warten();
    await absenden("Anmeldung langsam");
    const zeilen = dialog().querySelector("[data-testid=log-zeilen]")?.textContent ?? "";
    expect(zeilen).toContain("started");
    expect(zeilen).toContain("OIDC_CLIENT_SECRET=[geheim]");
    expect(dialog().textContent).toContain("4 Zeilen");
  });

  it("lets support take a log excerpt, but not restart", async () => {
    rolle("support");
    const { root } = await oeffne(`/installationen/${ohneSperrzeit()}`);
    expect(knopf(root, "Log-Auszug")).toBeDefined();
    expect(knopf(root, "Neustart")).toBeUndefined();
  });
});
