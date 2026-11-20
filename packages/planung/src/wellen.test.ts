import { describe, expect, it } from "vitest";
import { type PlanInstallation, type PlanUpdate, updatePlan, WARTEZEIT_MS } from "./wellen.ts";
import { instantVon } from "./zeit.ts";

const berlin = (j: number, m: number, t: number, h = 12, min = 0) => instantVon(j, m, t, h, min);
const NACHTS = [{ tage: [0, 1, 2, 3, 4, 5, 6], von: "02:00", bis: "04:00" }];
const HABEN_SPERRE = [{ monatlich: "07-12", grund: "Umsatzsteuer-Voranmeldung" }];

const inst = (id: string, extra: Partial<PlanInstallation> = {}): PlanInstallation => ({
  id,
  intern: false,
  automatisch: true,
  sperrzeiten: [],
  wartungsfenster: NACHTS,
  ...extra,
});
const normal: PlanUpdate = { version: "2.0.0", dringend: false, vorabversion: false };
const dringend: PlanUpdate = { ...normal, dringend: true };

const ergebnis = (plan: ReturnType<typeof updatePlan>, id: string) =>
  plan.find((e) => e.installationId === id)?.ergebnis;

describe("the wave intern", () => {
  it("starts at the next maintenance window", () => {
    const plan = updatePlan(
      [inst("eigen", { intern: true }), inst("kunde")],
      normal,
      {},
      [],
      berlin(2026, 11, 20),
    );
    expect(plan.find((e) => e.installationId === "eigen")).toEqual({
      installationId: "eigen",
      welle: "intern",
      ergebnis: { art: "termin", ab: berlin(2026, 11, 21, 2, 0), sperrzeitUebergangen: false },
    });
    expect(ergebnis(plan, "kunde")).toEqual({ art: "wartet", grund: "intern_laeuft" });
  });
});

describe("the wave alle", () => {
  it("starts 24 h after intern finished, at the next window", () => {
    const fertig = berlin(2026, 11, 21, 2, 30);
    const plan = updatePlan(
      [inst("eigen", { intern: true }), inst("kunde")],
      normal,
      { internFertigAm: fertig },
      [],
      fertig,
    );
    expect(ergebnis(plan, "kunde")).toMatchObject({
      art: "termin",
      ab: berlin(2026, 11, 22, 2, 30),
    });
    expect(berlin(2026, 11, 22, 2, 30) - fertig).toBe(WARTEZEIT_MS);
  });

  it("waits for a release by hand when we have no installation of our own", () => {
    const ohne = updatePlan([inst("kunde")], normal, {}, [], berlin(2026, 11, 20));
    expect(ergebnis(ohne, "kunde")).toEqual({ art: "wartet", grund: "freigabe_noetig" });
    const frei = updatePlan(
      [inst("kunde")],
      normal,
      { freigabeAlleAm: berlin(2026, 11, 20) },
      [],
      berlin(2026, 11, 20),
    );
    expect(ergebnis(frei, "kunde")).toMatchObject({
      art: "termin",
      ab: berlin(2026, 11, 21, 2, 0),
    });
  });

  it("never gets a pre-release", () => {
    const vorab = { ...normal, vorabversion: true };
    const plan = updatePlan(
      [inst("eigen", { intern: true }), inst("kunde")],
      vorab,
      { internFertigAm: 0 },
      [],
      berlin(2026, 11, 20),
    );
    expect(ergebnis(plan, "eigen")).toMatchObject({ art: "termin" });
    expect(ergebnis(plan, "kunde")).toEqual({ art: "wartet", grund: "vorabversion" });
  });
});

describe("a failure", () => {
  it("stops both waves, urgent or not", () => {
    for (const update of [normal, dringend]) {
      const plan = updatePlan(
        [inst("eigen", { intern: true }), inst("kunde")],
        update,
        { internFertigAm: 0, stoerungAm: 1 },
        [],
        berlin(2026, 11, 20),
      );
      expect(plan.map((e) => e.ergebnis)).toEqual([
        { art: "wartet", grund: "angehalten" },
        { art: "wartet", grund: "angehalten" },
      ]);
    }
  });
});

describe("an urgent update", () => {
  it("runs at once through both waves, outside maintenance windows", () => {
    const jetzt = berlin(2026, 11, 20, 12);
    const plan = updatePlan(
      [inst("eigen", { intern: true }), inst("kunde")],
      dringend,
      {},
      [],
      jetzt,
    );
    expect(plan.map((e) => e.ergebnis)).toEqual([
      { art: "termin", ab: jetzt, sperrzeitUebergangen: false },
      { art: "termin", ab: jetzt, sperrzeitUebergangen: false },
    ]);
  });

  it("still waits for the end of a freeze window without the owner's release", () => {
    const plan = updatePlan(
      [inst("haben", { sperrzeiten: HABEN_SPERRE })],
      dringend,
      {},
      [],
      berlin(2026, 11, 9),
    );
    expect(ergebnis(plan, "haben")).toEqual({
      art: "termin",
      ab: berlin(2026, 11, 13, 0, 0),
      sperrzeitUebergangen: false,
    });
  });

  it("passes over a freeze window with the owner's release and reason", () => {
    const jetzt = berlin(2026, 11, 9);
    const freigabe = { installationId: "haben", rolle: "inhaber", grund: "Sicherheitslücke ERiC" };
    const plan = updatePlan(
      [inst("haben", { sperrzeiten: HABEN_SPERRE })],
      dringend,
      {},
      [freigabe],
      jetzt,
    );
    expect(ergebnis(plan, "haben")).toEqual({
      art: "termin",
      ab: jetzt,
      sperrzeitUebergangen: true,
    });
  });
});

describe("Haben", () => {
  const haben = inst("haben", { sperrzeiten: HABEN_SPERRE });

  it("is never updated between the 7th and the 12th without a release, in any month", () => {
    const stand = { freigabeAlleAm: 0 };
    for (let monat = 1; monat <= 12; monat++)
      for (let tag = 1; tag <= 28; tag += 1)
        for (const update of [normal, dringend]) {
          const e = ergebnis(
            updatePlan([haben], update, stand, [], berlin(2026, monat, tag, 3)),
            "haben",
          );
          if (e?.art !== "termin") throw new Error(`no slot on ${tag}.${monat}.`);
          const tagDesTermins = new Intl.DateTimeFormat("de-DE", {
            timeZone: "Europe/Berlin",
            day: "numeric",
          }).format(e.ab);
          expect(
            Number(tagDesTermins) >= 7 && Number(tagDesTermins) <= 12,
            `${tag}.${monat}. → ${tagDesTermins}`,
          ).toBe(false);
        }
  });

  it("ignores a release without reason or by another role", () => {
    const jetzt = berlin(2026, 11, 9);
    for (const freigabe of [
      { installationId: "haben", rolle: "inhaber", grund: "  " },
      { installationId: "haben", rolle: "technik", grund: "eilig" },
      { installationId: "andere", rolle: "inhaber", grund: "eilig" },
    ]) {
      const e = ergebnis(updatePlan([haben], dringend, {}, [freigabe], jetzt), "haben");
      expect(e).toMatchObject({ ab: berlin(2026, 11, 13, 0, 0), sperrzeitUebergangen: false });
    }
  });
});

describe("an app without health", () => {
  it("is updated by hand only, in no wave", () => {
    const plan = updatePlan(
      [inst("ohne", { automatisch: false, intern: true })],
      dringend,
      {},
      [],
      berlin(2026, 11, 20),
    );
    expect(ergebnis(plan, "ohne")).toEqual({ art: "wartet", grund: "nur_von_hand" });
  });
});

describe("a freeze window that never ends", () => {
  it("leaves even an urgent update without a slot instead of inside it", () => {
    const immer = inst("immer", { sperrzeiten: [{ monatlich: "01-31", grund: "x" }] });
    expect(ergebnis(updatePlan([immer], dringend, {}, [], berlin(2026, 11, 20)), "immer")).toEqual({
      art: "wartet",
      grund: "kein_termin",
    });
  });
});
