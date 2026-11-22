import { setLocale } from "@steuerzentrale/ui";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { einstellungenQuelleEinsetzen } from "../daten/einstellungen.ts";
import { installationenQuelleEinsetzen } from "../daten/installationen.ts";
import { kundenQuelleEinsetzen } from "../daten/kunden.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import { serverQuelleEinsetzen } from "../daten/server.ts";
import type { Rolle } from "../daten/typen.ts";
import { demoEinstellungenQuelle } from "../demo/einstellungen.ts";
import { demo } from "../demo/index.ts";
import { demoInstallationenQuelle } from "../demo/installationen-quelle.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { demoServerQuelle } from "../demo/server-quelle.ts";
import { aufraeumen, dialog, eintragen, feld, knopf, oeffne, warten } from "./test-dom.tsx";

// BAULISTE.md Z-404: the operator's values per app as a form from the schema, and "Einstellungen
// ändern" of an installation, only for owner and technik, against the demo sources
const rolle = (r: Rolle) =>
  rollenQuelleEinsetzen(async () => ({ ok: true, status: 200, daten: r }));

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
  einstellungenQuelleEinsetzen(demoEinstellungenQuelle(demo));
  rolle("technik");
});
afterEach(aufraeumen);

const karte = (root: HTMLElement, titel: string) => {
  const k = [...root.querySelectorAll("section")].find(
    (s) => s.querySelector("h2")?.textContent === titel,
  );
  if (!k) throw new Error(`no card "${titel}"`);
  return k;
};

describe("the operator's values per app", () => {
  it("are a form from the schema, a secret only as set, saved with a reason", async () => {
    const { root } = await oeffne("/einstellungen");
    const haben = karte(root, "Haben");
    expect(feld<HTMLInputElement>("ELSTER_HERSTELLER_ID", haben).value).toBe("12345");
    const schluessel = feld<HTMLInputElement>("ANTHROPIC_API_KEY", haben);
    expect(schluessel.type).toBe("password");
    expect(schluessel.value).toBe("");
    expect(haben.textContent).toContain("gesetzt; leer lassen behält den Wert");
    eintragen("ELSTER_HERSTELLER_ID", "54321", haben);
    eintragen("Grund", "neue Hersteller-ID", haben);
    flush();
    haben.querySelector("form")?.requestSubmit();
    await warten();
    expect(root.textContent).toContain("Werte für Haben gespeichert.");
    expect(feld<HTMLInputElement>("ELSTER_HERSTELLER_ID", karte(root, "Haben")).value).toBe(
      "54321",
    );
  });

  it("are refused without a required value, naming it", async () => {
    const { root } = await oeffne("/einstellungen");
    const haben = karte(root, "Haben");
    feld<HTMLInputElement>("ELSTER_HERSTELLER_ID", haben).required = false;
    eintragen("ELSTER_HERSTELLER_ID", "", haben);
    eintragen("Grund", "weg damit", haben);
    flush();
    haben.querySelector("form")?.requestSubmit();
    await warten();
    expect(haben.querySelector("[role=alert]")?.textContent).toContain("ELSTER_HERSTELLER_ID");
  });

  it("are only read by support", async () => {
    rolle("support");
    const { root } = await oeffne("/einstellungen");
    const haben = karte(root, "Haben");
    expect(haben.querySelector("form")).toBeNull();
    expect(haben.textContent).toContain("12345");
  });
});

describe("changing an installation's settings", () => {
  it("sends the job to configure it anew with a reason", async () => {
    const { root } = await oeffne("/installationen/atelier-haben");
    knopf(root, "Einstellungen ändern")?.click();
    await warten();
    expect(feld<HTMLInputElement>("LAYOUTS_MAX_COUNT").value).toBe("20");
    eintragen("LAYOUTS_MAX_COUNT", "30");
    eintragen("Grund", "Wunsch des Kunden");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.textContent).toContain("Neu konfigurieren");
  });

  it("is not offered to support", async () => {
    rolle("support");
    const { root } = await oeffne("/installationen/atelier-haben");
    expect(knopf(root, "Einstellungen ändern")).toBeUndefined();
  });
});
