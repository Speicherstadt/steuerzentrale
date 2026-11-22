import { render } from "@solidjs/web";
import { setLocale } from "@steuerzentrale/ui";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/solid-router";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiInstallationen, installationenQuelleEinsetzen } from "../daten/installationen.ts";
import { kundenQuelleEinsetzen } from "../daten/kunden.ts";
import { rollenQuelleEinsetzen } from "../daten/rolle.ts";
import { serverQuelleEinsetzen } from "../daten/server.ts";
import type { Rolle } from "../daten/typen.ts";
import { demo } from "../demo/index.ts";
import { GESCHEITERT } from "../demo/installationen-bestand.ts";
import { demoInstallationenQuelle } from "../demo/installationen-quelle.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { PROBE_MANIFEST, PROBE_SIGNATUR } from "../demo/probe-manifest.ts";
import { demoServerQuelle } from "../demo/server-quelle.ts";
import { routeTree } from "../routeTree.gen.ts";

// BAULISTE.md Z-402: the dialog "Installieren" with the placement live, making an installation
// that waits for its agent, and removing a failed one, against the demo sources
let dispose = () => {};
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
  rolle("technik");
});
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
});

const warten = async () => {
  for (let i = 0; i < 8; i++) {
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

const knopf = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

const dialog = () => {
  const d = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (!d) throw new Error("no open dialog");
  return d;
};

/** The field of the open dialog with this visible label */
const feld = <T extends HTMLElement>(label: string): T => {
  const marke = [...dialog().querySelectorAll("label")].find((l) => l.textContent === label);
  const f = dialog().querySelector<T>(`#${CSS.escape(marke?.htmlFor ?? "")}`);
  if (!f) throw new Error(`no field "${label}"`);
  return f;
};

const waehlen = async (label: string, wert: string) => {
  const s = feld<HTMLSelectElement>(label);
  s.value = wert;
  s.dispatchEvent(new Event("change", { bubbles: true }));
  await warten();
};

const hochladen = async (label: string, text: string, name: string) => {
  const f = feld<HTMLInputElement>(label);
  const uebergabe = new DataTransfer();
  uebergabe.items.add(new File([text], name));
  f.files = uebergabe.files;
  f.dispatchEvent(new Event("change", { bubbles: true }));
  await warten();
};

const eintragen = (label: string, wert: string) => {
  const f = feld<HTMLInputElement>(label);
  f.value = wert;
  f.dispatchEvent(new Event("input", { bubbles: true }));
};

/** Opens the dialog and chooses customer, server and the signed probe manifest */
const auswaehlen = async (root: HTMLElement, kunde: string, server: string) => {
  knopf(root, "App installieren")?.click();
  await warten();
  await waehlen("Kunde", kunde);
  await waehlen("Server", server);
  await hochladen("Manifest (manifest.yml)", PROBE_MANIFEST, "manifest.yml");
  await hochladen("Signatur (manifest.yml.minisig)", PROBE_SIGNATUR, "manifest.yml.minisig");
};

const platzierung = () => dialog().querySelector("[data-testid=platzierung]")?.textContent ?? "";

describe("the dialog Installieren", () => {
  it("shows the placement, the manifest's settings and makes an installation", async () => {
    const { root } = await oeffne("/installationen");
    await auswaehlen(root, "atelier-nord", "shared-1");
    expect(dialog().textContent).toContain("Manifest probe 1.0.0");
    expect(platzierung()).toContain("Passt");
    expect(platzierung()).toContain("probe auf Gemeinsamer Server 1");
    expect(feld<HTMLInputElement>("PROBE_KENNWORT").type).toBe("password");
    expect(feld<HTMLInputElement>("PROBE_KENNWORT").required).toBe(true);
    expect(feld<HTMLInputElement>("PROBE_LIMIT").type).toBe("number");
    eintragen("PROBE_KENNWORT", "geheim-7");
    eintragen("Adresse", "probe.atelier-nord.example");
    eintragen("Grund", "Bestellung vom 20.11.");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(document.querySelector("dialog[open]")).toBeNull();
    const zeile = [...root.querySelectorAll("tbody tr")].find((tr) =>
      tr.textContent?.includes("probe.atelier-nord.example"),
    );
    expect(zeile?.textContent).toContain("wird eingerichtet");
  });

  it("asks again when an option changes, with the option's setting", async () => {
    const { root } = await oeffne("/installationen");
    await auswaehlen(root, "atelier-nord", "shared-1");
    expect(() => feld("PROBE_EXTRA")).toThrow();
    const option = [...dialog().querySelectorAll("label")].find(
      (l) => l.textContent?.trim() === "Zusatzdienst",
    );
    option?.querySelector("input")?.click();
    await warten();
    expect(feld<HTMLInputElement>("PROBE_EXTRA").required).toBe(true);
    expect(platzierung()).toContain("Passt");
  });

  it("names every reason when the app does not fit, and keeps the dialog open", async () => {
    const { root } = await oeffne("/installationen");
    await auswaehlen(root, "atelier-nord", "holm");
    expect(platzierung()).toContain("Passt nicht");
    expect(platzierung()).toContain("Der Server gehört einem anderen Kunden.");
    eintragen("PROBE_KENNWORT", "geheim-7");
    eintragen("Adresse", "probe.atelier-nord.example");
    eintragen("Grund", "Test");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(dialog().querySelector("[role=alert]")?.textContent).toBe(
      "Die App passt nicht auf diesen Server.",
    );
    expect(dialog().textContent).toContain("Der Server gehört einem anderen Kunden.");
  });

  it("says why a manifest cannot be read", async () => {
    const { root } = await oeffne("/installationen");
    knopf(root, "App installieren")?.click();
    await warten();
    await hochladen("Manifest (manifest.yml)", "schema: 2\n", "manifest.yml");
    expect(dialog().querySelector("[data-testid=manifest-befund]")?.textContent).toMatch(
      /^Das Manifest ist ungültig: /,
    );
  });

  it("starts from the customer's page with the customer chosen", async () => {
    const { root } = await oeffne("/kunden/atelier-nord");
    knopf(root, "App installieren")?.click();
    await warten();
    expect(feld<HTMLSelectElement>("Kunde").value).toBe("atelier-nord");
  });

  it("is not offered to support", async () => {
    rolle("support");
    const { root } = await oeffne("/installationen");
    expect(root.querySelector("main h1")?.textContent).toBe("Installationen");
    expect(knopf(root, "App installieren")).toBeUndefined();
  });
});

describe("a failed setup", () => {
  it("is removed with a reason, and the removal job shows", async () => {
    const { root } = await oeffne(`/installationen/${GESCHEITERT}`);
    expect(root.textContent).toContain("Einrichtung gescheitert");
    expect(root.textContent).toContain("Fehler: image ziehen");
    knopf(root, "Entfernen …")?.click();
    await warten();
    eintragen("Grund", "neu anlegen");
    flush();
    dialog().querySelector("form")?.requestSubmit();
    await warten();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(root.textContent).toContain("an den Agenten zugestellt");
  });

  it("offers no removal to support", async () => {
    rolle("support");
    const { root } = await oeffne(`/installationen/${GESCHEITERT}`);
    expect(root.textContent).toContain("Einrichtung gescheitert");
    expect(knopf(root, "Entfernen …")).toBeUndefined();
  });
});

describe("with the Zentrale's API", () => {
  const probe = {
    installationId: "probe-abc123",
    kundeId: "atelier-nord",
    serverId: "shared-1",
    app: "probe",
    version: "1.0.0",
    manifestHash: "0".repeat(64),
    host: "probe.atelier-nord.example",
    httpPort: 20001,
    ports: { "app:9000": 20002 },
    optionen: [],
    einstellungen: { betreiber: {}, installation: { PROBE_TITEL: "Atelier" } },
    zustand: "wird_eingerichtet",
    angelegtVon: "u1",
    angelegtAm: demo.jetzt,
    geaendertAm: demo.jetzt,
  };
  const auftraege = [
    {
      auftragId: "a1",
      aktion: "installation_einrichten",
      zustand: "bestaetigt",
      fortschritt: "image ziehen",
      fehler: null,
      angelegtAm: demo.jetzt,
      geaendertAm: demo.jetzt,
    },
  ];

  beforeEach(() => {
    installationenQuelleEinsetzen(apiInstallationen);
    vi.stubGlobal("fetch", async (pfad: string) =>
      pfad.endsWith("/installationen")
        ? Response.json({ installationen: [probe] })
        : Response.json({ ...probe, auftraege }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists what the Zentrale answers, without inventing health or backups", async () => {
    const { root } = await oeffne("/installationen");
    const zeilen = [...root.querySelectorAll("tbody tr")].filter((tr) =>
      tr.querySelector("a[href^='/installationen/']"),
    );
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.textContent).toContain("Atelier Nord");
    expect(zeilen[0]?.textContent).toContain("wird eingerichtet");
    expect(zeilen[0]?.textContent).toContain("–");
  });

  it("shows an installation with its place, values and jobs", async () => {
    const { root } = await oeffne("/installationen/probe-abc123");
    expect(root.querySelector("main h1")?.textContent).toBe("Atelier Nord · probe");
    expect(root.textContent).toContain("sz-probe-abc123");
    expect(root.textContent).toContain("127.0.0.1:20001");
    expect(root.textContent).toContain("app:9000 → 20002");
    expect(root.textContent).toContain("Einrichten");
    expect(root.textContent).toContain("vom Agenten bestätigt");
    expect(root.textContent).toContain("image ziehen");
  });

  it("shows the Zentrale's refusal", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ fehler: "keine_berechtigung" }, { status: 403 }),
    );
    const { root } = await oeffne("/installationen/probe-abc123");
    expect(root.querySelector("main [role=alert]")?.textContent).toBe(
      "Dafür fehlt Ihrer Rolle das Recht.",
    );
  });
});
