import { randomUUID } from "node:crypto";
import { BACKUP_AKTIONEN } from "@steuerzentrale/manifest";
import { BACKUP_FRIST_MS, FAKTEN_FRIST_MS } from "@steuerzentrale/planung";
import { describe, expect, it } from "vitest";
import { ereignisse } from "../../db/schema.ts";
import { auftragEinfuegen, serverEinfuegen } from "../../testhilfen/betrieb.ts";
import { bewertungsUmgebung, installationEinfuegen } from "../../testhilfen/bewertung.ts";
import { faktenAnfuegen, schreiben } from "../audit/index.ts";
import { serverLesen } from "../server/index.ts";
import { pruefEingabe } from "./eingabe.ts";
import { pruefungenFortschreiben } from "./fortschreiben.ts";
import { pruefungenLesen } from "./lesen.ts";

/*
 * BAULISTE.md Z-702; docs/plan.md, "Prüfungen eines Servers": the Zentrale checks each joined server
 * from its newest facts, its installations and their backups, within its operator; a finding is an
 * event when it begins, gets worse to red, and ends, never on each run.
 */

const JETZT = 10_000_000_000;

/** Facts of s1 as its agent reports them, `teil` overriding */
const fakten = (
  offen: ReturnType<typeof bewertungsUmgebung>,
  teil: Record<string, unknown> = {},
  am = JETZT - 60_000,
  betreiberId = "b1",
  serverId = "s1",
) =>
  faktenAnfuegen(offen.schreibDb, {
    betreiberId,
    serverId,
    zeitpunkt: am,
    daten: JSON.stringify({
      typ: "fakten",
      protokoll: 1,
      zeit: am,
      cpuKerne: 2,
      ramMb: 4096,
      platten: [{ mount: "/", gesamtMb: 1000, freiMb: 500 }],
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
      portsOffen: [{ port: 443, proto: "tcp" }],
      zertifikate: [{ host: "i1.kanzlei.example", gueltigBis: JETZT + 60 * 86_400_000 }],
      uhrSynchron: true,
      ...teil,
    }),
  });

const umgebung = () => {
  const offen = bewertungsUmgebung();
  for (const [b, s] of [
    ["b1", "s1"],
    ["b1", "s2"],
    ["b2", "s1"],
  ] as const)
    schreiben(offen.schreibDb, { betreiberId: b, akteur: "test", jetzt: 1, grund: "T" }, "t", (w) =>
      w.aendern("server", { betreiberId: b, serverId: s }, { beigetretenAm: 1 }),
    );
  return offen;
};

const sv = (offen: ReturnType<typeof umgebung>, betreiberId = "b1", serverId = "s1") => {
  const s = serverLesen(offen.db, betreiberId, serverId);
  if (!s) throw new Error("no server");
  return s;
};

/** Backups of the installation set up at `am`, with a good run at `erfolg` */
const backupEinrichten = (
  offen: ReturnType<typeof umgebung>,
  installationId: string,
  am: number,
  erfolg?: number,
) => {
  const k = { betreiberId: "b1", akteur: "test", jetzt: am, grund: "T" };
  schreiben(offen.schreibDb, k, "t", (w) => {
    w.einfuegen("backupZugaenge", {
      betreiberId: "b1",
      installationId,
      zustand: "angelegt",
      geheim: "-",
      angelegtAm: am,
      geaendertAm: am,
    });
    if (erfolg !== undefined)
      w.einfuegen("backups", {
        betreiberId: "b1",
        backupId: randomUUID(),
        installationId,
        serverId: "s1",
        zeitpunkt: erfolg,
        ok: true,
        teile: "[]",
        gemeldetAm: erfolg,
      });
  });
  auftragEinfuegen(offen.schreibDb, "b1", "s1", {
    angelegtAm: am,
    zustand: "erfolgreich",
    installationId,
    aktion: BACKUP_AKTIONEN.einrichten,
  });
};

describe("pruefEingabe", () => {
  it("takes the facts, the hosts, the manifests' ports and the backups of the server", () => {
    const offen = umgebung();
    fakten(offen);
    backupEinrichten(offen, "i1", JETZT - 3 * 86_400_000, JETZT - 3_600_000);
    const e = pruefEingabe(offen.db, sv(offen), JETZT);
    expect(e.fakten).toMatchObject({ am: JETZT - 60_000, uhrSynchron: true });
    expect(e.hosts).toEqual(["i1.kanzlei.example"]);
    expect(e.backups).toEqual([
      {
        installationId: "i1",
        name: "Kanzlei · probe",
        letzterErfolg: JETZT - 3_600_000,
        eingerichtetAm: JETZT - 3 * 86_400_000,
      },
    ]);
  });

  it("never takes another operator's installations, even on a server of the same name", () => {
    const offen = umgebung();
    installationEinfuegen(offen.schreibDb, "b2", "fremd", "s1");
    expect(pruefEingabe(offen.db, sv(offen, "b2"), JETZT).hosts.sort()).toEqual([
      "fremd.kanzlei.example",
      "i1.kanzlei.example",
    ]);
    expect(pruefEingabe(offen.db, sv(offen), JETZT).hosts).toEqual(["i1.kanzlei.example"]);
  });

  it("leaves out removed installations", () => {
    const offen = umgebung();
    installationEinfuegen(offen.schreibDb, "b1", "weg", "s1", { zustand: "entfernt" });
    expect(pruefEingabe(offen.db, sv(offen), JETZT).hosts).toEqual(["i1.kanzlei.example"]);
  });
});

describe("pruefungenLesen", () => {
  it("rates every check of the server", () => {
    const offen = umgebung();
    fakten(offen, {
      platten: [{ mount: "/", gesamtMb: 1000, freiMb: 50 }],
      portsOffen: [{ port: 5432, proto: "tcp" }],
    });
    expect(
      pruefungenLesen(offen.db, sv(offen), JETZT).map((p) => [p.pruefung, p.ergebnis]),
    ).toEqual([
      ["platte", "rot"],
      ["zertifikate", "gruen"],
      ["backups", "gruen"],
      ["ports", "gelb"],
      ["uhrzeit", "gruen"],
      ["arbeitsspeicher", "unbekannt"],
    ]);
  });

  it("is unknown for facts older than 45 minutes", () => {
    const offen = umgebung();
    fakten(offen, {}, JETZT - FAKTEN_FRIST_MS - 1);
    expect(pruefungenLesen(offen.db, sv(offen), JETZT)[0]?.ergebnis).toBe("unbekannt");
  });

  it("names a backup older than 26 h", () => {
    const offen = umgebung();
    fakten(offen);
    backupEinrichten(offen, "i1", JETZT - 3 * 86_400_000, JETZT - BACKUP_FRIST_MS - 1);
    expect(pruefungenLesen(offen.db, sv(offen), JETZT)[2]).toMatchObject({
      pruefung: "backups",
      ergebnis: "gelb",
      alt: [{ installationId: "i1", name: "Kanzlei · probe" }],
    });
  });
});

describe("pruefungenFortschreiben", () => {
  const ereignisseVon = (offen: ReturnType<typeof umgebung>) =>
    offen.db
      .select()
      .from(ereignisse)
      .all()
      .map((e) => ({
        b: e.betreiberId,
        art: e.art,
        schwere: e.schwere,
        ziel: e.ziel,
        text: e.text,
      }));

  it("writes one event when a check turns yellow, one when red, one when fixed", () => {
    const offen = umgebung();
    fakten(offen, { platten: [{ mount: "/", gesamtMb: 1000, freiMb: 150 }] });
    pruefungenFortschreiben(offen.db, offen.schreibDb, JETZT);
    pruefungenFortschreiben(offen.db, offen.schreibDb, JETZT + 60_000);
    expect(ereignisseVon(offen)).toEqual([
      {
        b: "b1",
        art: "pruefung_platte",
        schwere: "warn",
        ziel: "server:s1",
        text: "Platte auf s1: / zu 85 % belegt",
      },
    ]);
    expect(pruefungenLesen(offen.db, sv(offen), JETZT + 60_000)[0]?.seit).toBe(JETZT);

    fakten(offen, { platten: [{ mount: "/", gesamtMb: 1000, freiMb: 50 }] }, JETZT + 100_000);
    pruefungenFortschreiben(offen.db, offen.schreibDb, JETZT + 120_000);
    fakten(offen, { platten: [{ mount: "/", gesamtMb: 1000, freiMb: 150 }] }, JETZT + 200_000);
    pruefungenFortschreiben(offen.db, offen.schreibDb, JETZT + 240_000);
    fakten(offen, {}, JETZT + 300_000);
    pruefungenFortschreiben(offen.db, offen.schreibDb, JETZT + 360_000);
    pruefungenFortschreiben(offen.db, offen.schreibDb, JETZT + 420_000);
    expect(ereignisseVon(offen).map((e) => [e.art, e.schwere])).toEqual([
      ["pruefung_platte", "warn"],
      ["pruefung_platte", "fehler"],
      ["pruefung_platte_behoben", "info"],
    ]);
    expect(ereignisseVon(offen).at(-1)?.text).toBe("Prüfung Platte auf s1 wieder in Ordnung");
    expect(pruefungenLesen(offen.db, sv(offen), JETZT + 420_000)[0]?.seit).toBeNull();
  });

  it("neither fixes nor repeats a finding while the check is unknown", () => {
    const offen = umgebung();
    fakten(offen, { portsOffen: [{ port: 5432, proto: "tcp" }] });
    pruefungenFortschreiben(offen.db, offen.schreibDb, JETZT);
    // the agent goes silent: its facts grow old, the ports are unknown
    pruefungenFortschreiben(offen.db, offen.schreibDb, JETZT + FAKTEN_FRIST_MS + 1);
    fakten(offen, { portsOffen: [{ port: 5432, proto: "tcp" }] }, JETZT + 2 * FAKTEN_FRIST_MS);
    pruefungenFortschreiben(offen.db, offen.schreibDb, JETZT + 2 * FAKTEN_FRIST_MS);
    expect(ereignisseVon(offen)).toEqual([
      {
        b: "b1",
        art: "pruefung_ports",
        schwere: "warn",
        ziel: "server:s1",
        text: "Offene Ports auf s1, die kein Manifest nennt: 5432/tcp",
      },
    ]);
  });

  it("keeps each operator's findings to itself", () => {
    const offen = umgebung();
    fakten(offen, { uhrzeitAbweichungMs: 900 }, JETZT - 60_000, "b2", "s1");
    fakten(offen);
    pruefungenFortschreiben(offen.db, offen.schreibDb, JETZT);
    expect(ereignisseVon(offen)).toEqual([
      {
        b: "b2",
        art: "pruefung_uhrzeit",
        schwere: "warn",
        ziel: "server:s1",
        text: "Uhrzeit auf s1: Abweichung 900 ms, synchron",
      },
    ]);
    expect(pruefungenLesen(offen.db, sv(offen), JETZT)[4]?.seit).toBeNull();
    expect(pruefungenLesen(offen.db, sv(offen, "b2"), JETZT)[4]?.seit).toBe(JETZT);
  });

  it("checks only joined servers that are not revoked", () => {
    const offen = umgebung();
    serverEinfuegen(offen.schreibDb, "b1", "neu");
    fakten(offen, { uhrzeitAbweichungMs: 900 }, JETZT - 60_000, "b1", "neu");
    schreiben(offen.schreibDb, { betreiberId: "b1", akteur: "t", jetzt: 2, grund: "T" }, "t", (w) =>
      w.aendern("server", { betreiberId: "b1", serverId: "s1" }, { gesperrtAm: 2 }),
    );
    fakten(offen, { uhrzeitAbweichungMs: 900 });
    pruefungenFortschreiben(offen.db, offen.schreibDb, JETZT);
    expect(ereignisseVon(offen)).toEqual([]);
  });
});
