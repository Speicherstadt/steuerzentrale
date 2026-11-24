import { describe, expect, it } from "vitest";
import { demoAppsQuelle } from "./apps-quelle.ts";
import { demo } from "./index.ts";
import { GESCHEITERT } from "./installationen-bestand.ts";
import { demoInstallationenQuelle } from "./installationen-quelle.ts";
import { demoKunden } from "./kunden-quelle.ts";
import { demoServerQuelle } from "./server-quelle.ts";

// BAULISTE.md Z-402: the demo answers the dialog as the Zentrale would (routes/installationen.ts),
// so `bun run dev:demo` and the component tests show the same flow as the e2e tests
const quelle = () => {
  const kunden = demoKunden(demo.kunden, () => demo.jetzt);
  const server = demoServerQuelle(demo.server, () => demo.jetzt);
  return demoInstallationenQuelle({
    jetzt: () => demo.jetzt,
    kunden: kunden.liste,
    server: server.liste,
    manifest: demoAppsQuelle(() => demo.jetzt).manifest,
    betreiberWerte: [],
  });
};

const wunsch = {
  kundeId: "atelier-nord",
  serverId: "shared-1",
  app: "probe",
  version: "1.0.0",
  optionen: [],
};
const neu = { ...wunsch, host: "probe.atelier-nord.example", einstellungen: {} };

describe("the demo's installations", () => {
  it("place the manifest on a server, with every reason when it does not fit", async () => {
    const q = quelle();
    expect(await q.platzierung(wunsch)).toEqual({
      ok: true,
      status: 200,
      daten: { art: "passt", hinweise: [] },
    });
    const nicht = await q.platzierung({ ...wunsch, optionen: ["gibt-es-nicht"] });
    expect(nicht.ok && nicht.daten).toEqual({
      art: "passt_nicht",
      gruende: [{ code: "unbekannte_option", werte: { option: "gibt-es-nicht" } }],
      hinweise: [],
    });
  });

  it("refuse what the Zentrale refuses before placing", async () => {
    const q = quelle();
    expect(await q.platzierung({ ...wunsch, version: "9.9.9" })).toMatchObject({
      status: 404,
      fehler: "kein_manifest",
    });
    // Z-501: a pre-release only for an internal customer
    const vorab = { ...wunsch, version: "1.1.0-rc.1" };
    expect(await q.platzierung(vorab)).toMatchObject({ status: 409, fehler: "nur_intern" });
    expect(await q.platzierung({ ...vorab, kundeId: "intern" })).toMatchObject({ ok: true });
    expect(await q.platzierung({ ...wunsch, kundeId: "x" })).toMatchObject({ status: 404 });
    expect(await q.platzierung({ ...wunsch, serverId: "x" })).toMatchObject({ status: 404 });
  });

  it("make an installation that waits for its agent, without its secret", async () => {
    const q = quelle();
    const a = await q.anlegen(
      { ...neu, einstellungen: { PROBE_TITEL: "Atelier", PROBE_KENNWORT: "geheim-7" } },
      "Auftrag",
    );
    if (!a.ok) throw new Error(a.fehler);
    expect(a).toMatchObject({ status: 201, daten: { app: "probe", zustand: "wird_eingerichtet" } });
    expect(a.daten.installationId).toMatch(/^probe-[a-z0-9]{6}$/);
    expect(a.daten.einstellungen.installation).toEqual({ PROBE_TITEL: "Atelier" });
    const eine = await q.installation(a.daten.installationId);
    expect(eine.ok && eine.daten.auftraege.map((x) => [x.aktion, x.zustand])).toEqual([
      ["installation_einrichten", "zugestellt"],
      ["pforte_route_setzen", "wartend"],
    ]);
    const liste = await q.liste();
    expect(liste.ok && liste.daten.some((i) => i.installationId === a.daten.installationId)).toBe(
      true,
    );
  });

  it("refuse a host given twice and a value of no setting", async () => {
    const q = quelle();
    expect((await q.anlegen(neu, "g")).ok).toBe(true);
    expect(await q.anlegen(neu, "g")).toMatchObject({ status: 409, fehler: "host_vergeben" });
    expect(
      await q.anlegen({ ...neu, host: "b.example.org", einstellungen: { FREMD: "x" } }, "g"),
    ).toMatchObject({ status: 400, fehler: "einstellung_ungueltig" });
    expect(await q.anlegen({ ...neu, optionen: ["nein"] }, "g")).toMatchObject({
      status: 409,
      fehler: "passt_nicht",
      gruende: [{ code: "unbekannte_option", werte: { option: "nein" } }],
    });
  });

  it("remove only a failed setup, once", async () => {
    const q = quelle();
    expect(await q.entfernen("intern-haben", "g")).toMatchObject({
      status: 409,
      fehler: "nicht_gescheitert",
    });
    const weg = await q.entfernen(GESCHEITERT, "neu anlegen");
    expect(weg.ok && weg.daten.auftraege.at(-1)).toMatchObject({
      aktion: "installation_entfernen",
      zustand: "zugestellt",
    });
    expect(await q.entfernen(GESCHEITERT, "noch mal")).toMatchObject({
      status: 409,
      fehler: "entfernen_laeuft",
    });
  });

  // Z-403: the state as the Zentrale reports it, the history only on the page
  it("answer with their state, a red one with its failed unit and its history", async () => {
    const q = quelle();
    const liste = await q.liste();
    const rot = liste.ok
      ? liste.daten.find((i) => i.installationId === "berger-schreibzeug")
      : null;
    expect(rot?.health).toMatchObject({
      zustand: "rot",
      grund: { code: "health", werte: { text: "HTTP 503" } },
      units: [{ name: "app.service", aktiv: "failed" }],
    });
    expect(rot && "verlauf" in rot).toBe(false);
    const eine = await q.installation("berger-schreibzeug");
    expect(eine.ok && eine.daten.verlauf.map((v) => v.bewertung)).toEqual(["rot", "gruen"]);
    const ohne = await q.installation("kraft-stellwerk");
    expect(ohne.ok && ohne.daten.health.grund.code).toBe("keine_meldung");
  });

  it("have no state before the agent reported: a new one or a failed setup", async () => {
    const q = quelle();
    const neueInstallation = await q.anlegen(neu, "g");
    const gescheitert = await q.installation(GESCHEITERT);
    for (const a of [neueInstallation, gescheitert])
      expect(a.ok && a.daten.health).toEqual({
        zustand: "unbekannt",
        grund: { code: "noch_keine_meldung", werte: {} },
        seit: null,
        gemeldetAm: null,
        units: [],
      });
  });
});
