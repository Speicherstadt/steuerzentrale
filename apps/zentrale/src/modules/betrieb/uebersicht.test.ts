import { describe, expect, it } from "vitest";
import { auftragEinfuegen, ereignisEinfuegen, serverEinfuegen } from "../../testhilfen/betrieb.ts";
import { bewertungsUmgebung, installationEinfuegen } from "../../testhilfen/bewertung.ts";
import { bewertungSetzen, dienstAussenSetzen, faktenAnfuegen, schreiben } from "../audit/index.ts";
import { pruefungenFortschreiben } from "../pruefungen/index.ts";
import { type Eintrag, ordnen, zielVerweis } from "./ordnen.ts";
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
        serverId: "s1",
      },
      grund: { code: "health", werte: { text: "HTTP rot" } },
    });
    // the server it runs on, so the interface can put it beside its server's entries
    expect(eintraege.at(-1)).toMatchObject({
      installation: { installationId: "i4", serverId: "s2" },
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

describe("checks in the overview (Z-702)", () => {
  /** Facts of a joined server: a disk `frei` of 1000 MiB free and port 5432 open */
  const pruefbar = (
    offen: ReturnType<typeof bewertungsUmgebung>,
    b: string,
    s: string,
    frei = 50,
  ) => {
    serverEinfuegen(offen.schreibDb, b, s, { beigetretenAm: 1, name: `Server ${s}` });
    faktenAnfuegen(offen.schreibDb, {
      betreiberId: b,
      serverId: s,
      zeitpunkt: JETZT - 60_000,
      daten: JSON.stringify({
        typ: "fakten",
        protokoll: 1,
        zeit: JETZT - 60_000,
        cpuKerne: 2,
        ramMb: 4096,
        platten: [{ mount: "/", gesamtMb: 1000, freiMb: frei }],
        architektur: "amd64",
        os: null,
        kernel: { laeuft: null, installiert: null },
        neustartNoetig: null,
        updatesAusstehend: null,
        podman: null,
        ipv4: [],
        ipv6: [],
        ptr: {},
        portsBelegt: [],
        port25Ausgehend: null,
        uhrzeitAbweichungMs: 3,
        portsOffen: [{ port: 5432, proto: "tcp" }],
        zertifikate: [],
        uhrSynchron: true,
      }),
    });
  };

  it("names each check that is red or yellow, leading to its server", () => {
    const offen = bewertungsUmgebung();
    pruefbar(offen, "b1", "s9");
    pruefungenFortschreiben(offen.db, offen.schreibDb, JETZT - 30_000);
    const eintraege = uebersichtLesen(
      { db: offen.db, jetzt: JETZT, verbundenSeit: () => JETZT },
      "b1",
    );
    expect(eintraege.map((e) => [e.schwere, e.art, e.verweis])).toEqual([
      ["stoerung", "pruefung", { art: "server", id: "s9" }],
      ["warnung", "pruefung", { art: "server", id: "s9" }],
      ["hinweis", "installation", { art: "installation", id: "i1" }],
      ["hinweis", "installation", { art: "installation", id: "i2" }],
    ]);
    // the checks' own events are left out: the entries lead to the same server
    expect(eintraege[0]).toMatchObject({
      server: { serverId: "s9", name: "Server s9" },
      pruefung: { pruefung: "platte", ergebnis: "rot", platten: [{ mount: "/", prozent: 95 }] },
      seit: JETZT - 30_000,
    });
    expect(eintraege[1]).toMatchObject({
      pruefung: { pruefung: "ports", fremd: [{ port: 5432, proto: "tcp" }] },
    });
  });

  it("shows no operator another's checks, and none of a server not joined", () => {
    const offen = bewertungsUmgebung();
    pruefbar(offen, "b2", "s9");
    const lesen = (b: string) =>
      uebersichtLesen({ db: offen.db, jetzt: JETZT, verbundenSeit: () => JETZT }, b).filter(
        (e) => e.art === "pruefung",
      );
    expect(lesen("b1")).toEqual([]);
    expect(lesen("b2")).toHaveLength(2);
  });

  it("leaves out green and unknown checks", () => {
    const offen = bewertungsUmgebung();
    pruefbar(offen, "b1", "s9", 500);
    const ohne = uebersichtLesen(
      { db: offen.db, jetzt: JETZT + 46 * 60_000, verbundenSeit: () => JETZT },
      "b1",
    );
    expect(ohne.filter((e) => e.art === "pruefung")).toEqual([]);
  });
});

describe("ordnen", () => {
  const installation = {
    installationId: "i1",
    app: "probe",
    host: "h",
    kunde: "K",
    serverId: "s1",
  };
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

describe("observed services in the overview (Z-1101)", () => {
  const umgebung = () => {
    const offen = bewertungsUmgebung();
    const dienst = (dienstId: string, name: string, zustand?: "gruen" | "rot", seit = JETZT) => {
      schreiben(
        offen.schreibDb,
        { betreiberId: "b1", akteur: "test", jetzt: 1, grund: "Test" },
        "test",
        (w) =>
          w.einfuegen("dienste", {
            betreiberId: "b1",
            dienstId,
            name,
            host: `${dienstId}.teufel-it.de`,
            pfad: "/",
            angelegtAm: 1,
          }),
      );
      if (zustand)
        dienstAussenSetzen(
          offen.schreibDb,
          {
            betreiberId: "b1",
            dienstId,
            zustand,
            grund: JSON.stringify(
              zustand === "rot"
                ? { code: "health", werte: { status: "503" } }
                : { code: "erreichbar", werte: {} },
            ),
            seit,
            geprueftAm: JETZT - 30_000,
            ergebnis: "{}",
          },
          0,
        );
    };
    return { ...offen, dienst };
  };

  it("names a service with an open fault, one red outside and one unknown, never a green one", () => {
    const u = umgebung();
    u.dienst("d1", "Wiki", "rot", JETZT - 600_000);
    u.dienst("d2", "Shop", "rot", JETZT - 60_000);
    u.dienst("d3", "Status", "gruen");
    u.dienst("d4", "Mail");
    ereignisEinfuegen(u.schreibDb, "b1", {
      zeitpunkt: JETZT - 300_000,
      art: "stoerung",
      schwere: "fehler",
      ziel: "dienst:d1",
    });
    ereignisEinfuegen(u.schreibDb, "b1", {
      zeitpunkt: JETZT - 60_000,
      art: "aussen_rot",
      schwere: "warn",
      ziel: "dienst:d2",
    });
    const liste = uebersichtLesen(
      { db: u.db, jetzt: JETZT, verbundenSeit: () => JETZT },
      "b1",
    ).filter((e) => e.verweis.art === "dienst");
    expect(liste.map((e) => [e.schwere, e.art, e.verweis])).toEqual([
      ["stoerung", "dienst", { art: "dienst", id: "d1" }],
      ["warnung", "dienst", { art: "dienst", id: "d2" }],
    ]);
    expect(liste[0]).toMatchObject({
      dienst: { dienstId: "d1", name: "Wiki", host: "d1.teufel-it.de" },
      zustand: "stoerung",
      grund: { code: "health", werte: { status: "503" } },
      seit: JETZT - 600_000,
    });
  });

  it("leads an event about a service to the service", () => {
    expect(zielVerweis("dienst:d1")).toEqual({ art: "dienst", id: "d1" });
  });
});
