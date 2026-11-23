import { describe, expect, it } from "vitest";
import { auftragEinfuegen, ereignisEinfuegen, serverEinfuegen } from "../../testhilfen/betrieb.ts";
import { bewertungsUmgebung, installationEinfuegen } from "../../testhilfen/bewertung.ts";
import { bewertungSetzen } from "../audit/index.ts";
import { type Eintrag, ordnen } from "./ordnen.ts";
import { uebersichtLesen } from "./uebersicht.ts";

/*
 * BAULISTE.md Z-406: the overview orders what needs attention by severity (fault, warning, note) and
 * leads each entry to its cause.
 */

const JETZT = 10_000_000_000;

const bewerten = (
  offen: ReturnType<typeof bewertungsUmgebung>,
  installationId: string,
  bewertung: "gruen" | "gelb" | "rot",
  seit = JETZT - 60_000,
) =>
  bewertungSetzen(offen.schreibDb, {
    betreiberId: "b1",
    installationId,
    bewertung,
    grund: JSON.stringify({ code: "health", werte: { text: `HTTP ${bewertung}` } }),
    seit,
    gemeldetAm: JETZT - 1000,
    meldung: "{}",
    wechsel: true,
  });

describe("uebersichtLesen", () => {
  it("puts faults first, then warnings, then notes, each leading to its cause", () => {
    const offen = bewertungsUmgebung();
    // i1 red with an open fault, i2 yellow, i3 green, i4 never reported (unknown)
    installationEinfuegen(offen.schreibDb, "b1", "i3", "s1");
    installationEinfuegen(offen.schreibDb, "b1", "i4", "s2");
    bewerten(offen, "i1", "rot", JETZT - 600_000);
    bewerten(offen, "i2", "gelb");
    bewerten(offen, "i3", "gruen");
    ereignisEinfuegen(offen.schreibDb, "b1", {
      zeitpunkt: JETZT - 300_000,
      schwere: "fehler",
      art: "stoerung",
      ziel: "installation:i1",
    });
    // s3 joined and has no connection; a failed job; a warning event of the last day
    serverEinfuegen(offen.schreibDb, "b1", "s3", { beigetretenAm: JETZT - 3_600_000 });
    auftragEinfuegen(offen.schreibDb, "b1", "s1", {
      angelegtAm: JETZT - 7200_000,
      zustand: "gescheitert",
    });
    ereignisEinfuegen(offen.schreibDb, "b1", {
      zeitpunkt: JETZT - 100,
      schwere: "warn",
      art: "ssh_anmeldung",
      ziel: "server:s1",
    });

    const eintraege = uebersichtLesen(
      {
        db: offen.db,
        jetzt: JETZT,
        verbundenSeit: (_b, s) => (s === "s3" ? undefined : JETZT - 1000),
      },
      "b1",
    );
    expect(eintraege.map((e) => [e.schwere, e.art, e.verweis])).toEqual([
      ["stoerung", "stoerung", { art: "installation", id: "i1" }],
      ["stoerung", "agent", { art: "server", id: "s3" }],
      ["warnung", "installation", { art: "installation", id: "i2" }],
      ["warnung", "auftrag", { art: "auftrag", id: expect.any(String) }],
      ["warnung", "ereignis", { art: "server", id: "s1" }],
      ["hinweis", "installation", { art: "installation", id: "i4" }],
    ]);
    expect(eintraege[0]).toMatchObject({
      installation: {
        installationId: "i1",
        app: "probe",
        host: "i1.kanzlei.example",
        kunde: "Kanzlei",
      },
      grund: { code: "health", werte: { text: "HTTP rot" } },
    });
  });

  it("leaves out what is past: old jobs and events, a fixed fault, removed installations", () => {
    const offen = bewertungsUmgebung();
    installationEinfuegen(offen.schreibDb, "b1", "weg", "s1", { zustand: "entfernt" });
    bewerten(offen, "i1", "gruen");
    bewerten(offen, "i2", "gruen");
    for (const [zeitpunkt, art, schwere] of [
      [JETZT - 600_000, "stoerung", "fehler"],
      [JETZT - 60_000, "stoerung_behoben", "info"],
    ] as const)
      ereignisEinfuegen(offen.schreibDb, "b1", {
        zeitpunkt,
        art,
        schwere,
        ziel: "installation:i1",
      });
    ereignisEinfuegen(offen.schreibDb, "b1", {
      zeitpunkt: JETZT - 25 * 3_600_000,
      schwere: "fehler",
    });
    auftragEinfuegen(offen.schreibDb, "b1", "s1", {
      angelegtAm: JETZT - 8 * 86_400_000,
      zustand: "gescheitert",
    });
    expect(
      uebersichtLesen({ db: offen.db, jetzt: JETZT, verbundenSeit: () => JETZT }, "b1"),
    ).toEqual([]);
  });
});

describe("ordnen", () => {
  const installation = { installationId: "i1", app: "probe", host: "h", kunde: "K" };
  const grund = { code: "health" as const, werte: {} };

  it("leaves out an event whose target an entry already names, and keeps the newest first", () => {
    const eintraege: Eintrag[] = [
      {
        art: "ereignis",
        schwere: "warnung",
        ereignisId: "e1",
        ereignisArt: "x",
        ziel: "installation:i1",
        text: "",
        seit: 5,
      },
      {
        art: "ereignis",
        schwere: "warnung",
        ereignisId: "e2",
        ereignisArt: "x",
        ziel: "app:probe",
        text: "",
        seit: 3,
      },
      {
        art: "ereignis",
        schwere: "warnung",
        ereignisId: "e3",
        ereignisArt: "x",
        ziel: "server:s9",
        text: "",
        seit: 4,
      },
      {
        art: "installation",
        schwere: "hinweis",
        installation,
        zustand: "unbekannt",
        grund,
        seit: null,
      },
    ];
    expect(ordnen(eintraege).map((e) => [e.art, e.verweis])).toEqual([
      ["ereignis", { art: "server", id: "s9" }],
      ["ereignis", { art: "ereignisse" }],
      ["installation", { art: "installation", id: "i1" }],
    ]);
  });
});
