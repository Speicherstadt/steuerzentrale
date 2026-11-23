import { setLocale } from "@steuerzentrale/ui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AussenDerInstallation, aussenQuelleEinsetzen } from "../daten/aussen.ts";
import { installationenQuelleEinsetzen } from "../daten/installationen.ts";
import { kundenQuelleEinsetzen } from "../daten/kunden.ts";
import { serverQuelleEinsetzen } from "../daten/server.ts";
import { demoAppsQuelle } from "../demo/apps-quelle.ts";
import { demoAussen } from "../demo/aussen.ts";
import { demo } from "../demo/index.ts";
import { demoInstallationenQuelle } from "../demo/installationen-quelle.ts";
import { demoKunden } from "../demo/kunden-quelle.ts";
import { demoServerQuelle } from "../demo/server-quelle.ts";
import { aufraeumen, oeffne, warten } from "./test-dom.tsx";

// BAULISTE.md Z-704: the installation's page shows where its name points, the Pforte's
// certificate, what the health path answered from outside, the availability of this month and of
// every month measured, against the demo source, which answers as the API does
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
  aussenQuelleEinsetzen(demoAussen());
});
afterEach(aufraeumen);

const karte = (root: HTMLElement) => {
  const k = [...root.querySelectorAll("section")].find(
    (s) => s.querySelector("h2")?.textContent === "Adresse und Prüfung von außen",
  );
  if (!k) throw new Error("no card");
  return k;
};

describe("the check from outside on an installation's page", () => {
  it("shows a red installation's status, its address, certificate and availability", async () => {
    const { root } = await oeffne("/installationen/berger-schreibzeug");
    await warten();
    const text = karte(root).textContent ?? "";
    expect(text).toContain(
      "schreibzeug.it-berger.beispiel-hosting.de → 203.0.113.12, 2001:db8::12",
    );
    expect(text).toContain("gültig bis");
    expect(text).toContain("Health: HTTP 503 · seit 10:31");
    expect(text).toContain("Verfügbarkeit November 2026");
    expect(text).toContain("99,71 %");
    const monate = [...root.querySelectorAll('[data-testid="verfuegbarkeit"] tbody tr')].map(
      (r) => r.textContent,
    );
    expect(monate).toHaveLength(2);
    expect(monate[0]).toContain("November 2026");
    expect(monate[1]).toContain("Oktober 2026");
    expect(monate[1]).toContain("100,00 %");
  });

  it("says when an installation was not checked yet and has no month measured", async () => {
    const leer: AussenDerInstallation = {
      aussen: null,
      verfuegbarkeit: [{ jahr: 2026, monat: 11, minuten: 600, gemessen: 0, rot: 0, anteil: null }],
    };
    aussenQuelleEinsetzen({
      derInstallation: async () => ({ ok: true, status: 200, daten: leer }),
    });
    const { root } = await oeffne("/installationen/berger-schreibzeug");
    await warten();
    const text = karte(root).textContent ?? "";
    expect(text).toContain("noch nicht von außen geprüft");
    expect(text).toContain("nicht gemessen");
    expect(text).toContain("Noch keine Prüfung von außen.");
  });

  it("names the addresses when the name points elsewhere than the Zentrale set it", async () => {
    const falsch: AussenDerInstallation = {
      aussen: {
        zustand: "rot",
        grund: {
          code: "dns_abweichung",
          werte: { ist: "198.51.100.7", soll: "203.0.113.12, 2001:db8::12" },
        },
        seit: demo.jetzt - 120_000,
        geprueftAm: demo.jetzt - 20_000,
        ergebnis: { dns: { ok: true, a: ["198.51.100.7"], aaaa: [] } },
      },
      verfuegbarkeit: [],
    };
    aussenQuelleEinsetzen({
      derInstallation: async () => ({ ok: true, status: 200, daten: falsch }),
    });
    const { root } = await oeffne("/installationen/berger-schreibzeug");
    await warten();
    expect(karte(root).textContent).toContain(
      "DNS zeigt auf 198.51.100.7 statt 203.0.113.12, 2001:db8::12",
    );
  });
});
