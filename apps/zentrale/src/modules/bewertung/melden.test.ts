import { describe, expect, it } from "vitest";
import { auditLog, installationen, installationVerlauf } from "../../db/schema.ts";
import {
  betreiberAnlegen,
  bewertungsUmgebung,
  eintrag,
  installationEinfuegen,
  zustandNachricht,
} from "../../testhilfen/bewertung.ts";
import { verlaufLesen } from "./lesen.ts";
import { zustandAnnehmen } from "./melden.ts";

/*
 * BAULISTE.md Z-403: the Zentrale takes the agent's `zustand` for the installations of its server
 * and operator only, keeps the current rating as a measurement and every change in the history.
 */
const T = Date.UTC(2026, 10, 22, 12);

const umgebung = () => {
  const offen = bewertungsUmgebung();
  const log: string[] = [];
  const deps = { db: offen.db, schreibDb: offen.schreibDb, log: (z: string) => log.push(z) };
  const melden =
    (betreiberId: string, serverId: string, ...e: ReturnType<typeof eintrag>[]) =>
    (jetzt: number) =>
      zustandAnnehmen(deps, { betreiberId, serverId }, zustandNachricht(e), jetzt);
  const zeilen = () =>
    offen.db
      .select()
      .from(installationen)
      .all()
      .map((i) => ({
        betreiberId: i.betreiberId,
        installationId: i.installationId,
        bewertung: i.bewertung,
        grund: i.bewertungGrund === null ? null : JSON.parse(i.bewertungGrund),
        seit: i.bewertungSeit,
        gemeldetAm: i.gemeldetAm,
      }));
  return { ...offen, log, melden, zeilen };
};

describe("zustandAnnehmen", () => {
  it("keeps the rating of an installation of its server, with reason, since and the last report, without an audit entry", () => {
    const u = umgebung();
    const vorher = u.db.select().from(auditLog).all().length;
    u.melden("b1", "s1", eintrag("i1"))(T);
    u.melden("b1", "s1", eintrag("i1"))(T + 30_000);
    expect(u.zeilen()[0]).toEqual({
      betreiberId: "b1",
      installationId: "i1",
      bewertung: "gruen",
      grund: { code: "health", werte: { text: "HTTP 200" } },
      seit: T,
      gemeldetAm: T + 30_000,
    });
    const meldung = u.db.select().from(installationen).get()?.meldung ?? "{}";
    expect(JSON.parse(meldung)).toEqual({
      units: [{ name: "i1-app.service", aktiv: "active" }],
      health: { zustand: "gruen", grund: "HTTP 200" },
    });
    expect(u.db.select().from(auditLog).all()).toHaveLength(vorher);
  });

  it("writes a row of the history for every change of the rating, with its reason", () => {
    const u = umgebung();
    u.melden("b1", "s1", eintrag("i1"))(T);
    u.melden("b1", "s1", eintrag("i1"))(T + 30_000);
    u.melden("b1", "s1", eintrag("i1", "gruen", "failed"))(T + 60_000);
    u.melden("b1", "s1", eintrag("i1", "rot", "failed"))(T + 90_000);
    u.melden("b1", "s1", eintrag("i1", "rot", "failed"))(T + 120_000);
    expect(verlaufLesen(u.db, "b1", "i1")).toEqual([
      {
        zeitpunkt: T + 90_000,
        bewertung: "rot",
        grund: { code: "health", werte: { text: "HTTP 503" } },
      },
      {
        zeitpunkt: T + 60_000,
        bewertung: "gelb",
        grund: { code: "unit", werte: { unit: "i1-app.service", aktiv: "failed" } },
      },
      { zeitpunkt: T, bewertung: "gruen", grund: { code: "health", werte: { text: "HTTP 200" } } },
    ]);
  });

  it("rates an app without a health check by its units alone", () => {
    const u = umgebung();
    installationEinfuegen(u.schreibDb, "b1", "ohne", "s1", { app: "stumm" });
    const ohne = {
      ...eintrag("ohne"),
      health: { zustand: "unbekannt" as const, grund: "keine Prüfung" },
    };
    u.melden("b1", "s1", ohne)(T);
    expect(u.zeilen().find((z) => z.installationId === "ohne")).toMatchObject({
      bewertung: "gruen",
      grund: { code: "nur_units", werte: {} },
    });
    u.melden("b1", "s1", { ...ohne, units: [{ name: "ohne-app.service", aktiv: "inactive" }] })(
      T + 30_000,
    );
    expect(u.zeilen().find((z) => z.installationId === "ohne")?.bewertung).toBe("gelb");
  });

  it("changes nothing for an installation of another server or operator, and logs it", () => {
    const u = umgebung();
    betreiberAnlegen(u.schreibDb, "b3", ["s9"]);
    installationEinfuegen(u.schreibDb, "b1", "weg", "s1", { zustand: "entfernt" });
    const vorher = u.zeilen();
    // i2 runs on b1's s2; "fremd" is nobody's; b2's i1 is reached only by b2's server
    u.melden("b1", "s1", eintrag("i2", "rot"), eintrag("fremd", "rot"), eintrag("weg", "rot"))(T);
    u.melden("b3", "s9", eintrag("i1", "rot"))(T);
    expect(u.zeilen()).toEqual(vorher);
    expect(u.db.select().from(installationVerlauf).all()).toEqual([]);
    expect(u.log.map((z) => JSON.parse(z))).toEqual([
      { msg: "state of an unknown installation dropped", serverId: "s1", installationId: "i2" },
      { msg: "state of an unknown installation dropped", serverId: "s1", installationId: "fremd" },
      { msg: "state of an unknown installation dropped", serverId: "s1", installationId: "weg" },
      { msg: "state of an unknown installation dropped", serverId: "s9", installationId: "i1" },
    ]);
  });

  it("reaches the installation of the same name of its own operator only", () => {
    const u = umgebung();
    u.melden("b2", "s1", eintrag("i1", "rot"))(T);
    expect(u.zeilen().map((z) => [z.betreiberId, z.installationId, z.bewertung])).toEqual([
      ["b1", "i1", null],
      ["b1", "i2", null],
      ["b2", "i1", "rot"],
    ]);
    expect(verlaufLesen(u.db, "b1", "i1")).toEqual([]);
  });
});
