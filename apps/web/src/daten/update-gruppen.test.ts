import { describe, expect, it } from "vitest";
import { berlin } from "../format/zeit.ts";
import type { InstallationsAngebot } from "./apps.ts";
import { aufDemNeuesten, nachApp, sperrzeitBald } from "./update-gruppen.ts";

const angebot = (
  installationId: string,
  app: string,
  angeboten: { version: string; vorabversion?: boolean }[],
): InstallationsAngebot => ({
  installationId,
  kundeId: installationId,
  app,
  version: "1.0.0",
  intern: false,
  angeboten: angeboten.map((v) => ({ dringend: false, vorabversion: false, ...v })),
  plan: null,
  update: { letzter: null, laeuft: false },
});

describe("the page Updates sorted for a person", () => {
  const liste = [
    angebot("a-haben", "haben", [{ version: "1.2.0" }, { version: "1.1.0" }]),
    angebot("b-belegt", "belegt", [{ version: "0.0.7" }]),
    angebot("c-haben", "haben", [
      { version: "1.3.0-rc.1", vorabversion: true },
      { version: "1.2.0" },
    ]),
    angebot("d-haben", "haben", []),
  ];

  it("groups the installations that can update by app, the newest final version first", () => {
    expect(
      nachApp(liste).map((g) => [g.app, g.neueste, g.installationen.map((i) => i.installationId)]),
    ).toEqual([
      ["haben", "1.2.0", ["a-haben", "c-haben"]],
      ["belegt", "0.0.7", ["b-belegt"]],
    ]);
  });

  it("names a pre-release only when nothing else is offered", () => {
    const vorab = [angebot("x", "haben", [{ version: "2.0.0-rc.1", vorabversion: true }])];
    expect(nachApp(vorab)[0]?.neueste).toBe("2.0.0-rc.1");
  });

  it("keeps the current installations apart", () => {
    expect(aufDemNeuesten(liste).map((i) => i.installationId)).toEqual(["d-haben"]);
  });
});

describe("a freeze window worth a banner", () => {
  const jetzt = berlin("2026-11-24", "10:00");

  it("is active today or begins within 7 days", () => {
    expect(sperrzeitBald({ von: 20, bis: 25, grund: "" }, jetzt)).toBe(true);
    expect(sperrzeitBald({ von: 1, bis: 1, grund: "" }, jetzt)).toBe(true);
    expect(sperrzeitBald({ von: 7, bis: 12, grund: "" }, jetzt)).toBe(false);
  });

  it("reaches over the month's end", () => {
    expect(sperrzeitBald({ von: 28, bis: 3, grund: "" }, jetzt)).toBe(true);
    expect(sperrzeitBald({ von: 28, bis: 3, grund: "" }, berlin("2026-11-10", "10:00"))).toBe(
      false,
    );
  });
});
