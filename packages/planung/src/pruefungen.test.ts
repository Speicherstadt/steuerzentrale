import { describe, expect, it } from "vitest";
import {
  BACKUP_FRIST_MS,
  backupsPruefen,
  befundFortschreiben,
  FAKTEN_FRIST_MS,
  type PruefEingabe,
  plattePruefen,
  portsPruefen,
  SYSTEM_PORTS,
  serverPruefen,
  UHR_GRENZE_MS,
  uhrzeitPruefen,
  ZERTIFIKAT_FRIST_MS,
  zertifikatePruefen,
} from "./pruefungen.ts";

/*
 * BAULISTE.md Z-702; docs/plan.md, "Prüfungen eines Servers": disk over 80/90 %, a certificate
 * within 14 days, a backup older than 26 h, a port open that no manifest names, the clock. Each
 * check with its boundary: the limit itself and the step past it.
 */

const JETZT = Date.UTC(2026, 10, 23, 12, 0, 0);
const TAG = 86_400_000;

/** A disk of 1000 MiB with `frei` available */
const platte = (frei: number, mount = "/") => ({ mount, gesamtMb: 1000, freiMb: frei });

describe("plattePruefen", () => {
  it("is green up to 80 % used, the limit included", () => {
    expect(plattePruefen([platte(200)])).toEqual({
      pruefung: "platte",
      ergebnis: "gruen",
      platten: [{ mount: "/", prozent: 80 }],
    });
  });

  it("is yellow over 80 % and up to 90 %, the limit included", () => {
    expect(plattePruefen([platte(199)]).ergebnis).toBe("gelb");
    expect(plattePruefen([platte(100)]).ergebnis).toBe("gelb");
  });

  it("is red over 90 %", () => {
    expect(plattePruefen([platte(99)])).toMatchObject({
      ergebnis: "rot",
      platten: [{ mount: "/", prozent: 90.1 }],
    });
  });

  it("takes the fullest disk and lists the fullest first", () => {
    const p = plattePruefen([platte(500, "/"), platte(50, "/home")]);
    expect(p.ergebnis).toBe("rot");
    expect(p.platten?.map((x) => x.mount)).toEqual(["/home", "/"]);
  });

  it("counts space only root may use as taken: installations run as users", () => {
    // statfs's bavail, as the agent reports `freiMb`; a disk of size 0 says nothing
    expect(
      plattePruefen([{ mount: "/boot/efi", gesamtMb: 0, freiMb: 0 }, platte(900)]),
    ).toMatchObject({ ergebnis: "gruen", platten: [{ mount: "/", prozent: 10 }] });
  });

  it("is unknown without readable disks", () => {
    expect(plattePruefen(null)).toEqual({
      pruefung: "platte",
      ergebnis: "unbekannt",
      platten: null,
    });
    expect(plattePruefen([]).ergebnis).toBe("unbekannt");
  });
});

describe("zertifikatePruefen", () => {
  const hosts = ["haben.mueller.apps.example.org"];
  const zert = (gueltigBis: number, host = hosts[0] ?? "") => ({ host, gueltigBis });

  it("is green while the next certificate expires later than in 14 days", () => {
    expect(zertifikatePruefen([zert(JETZT + ZERTIFIKAT_FRIST_MS + 1)], hosts, JETZT)).toEqual({
      pruefung: "zertifikate",
      ergebnis: "gruen",
      zertifikate: [zert(JETZT + ZERTIFIKAT_FRIST_MS + 1)],
    });
  });

  it("is yellow when it expires in 14 days or less", () => {
    expect(zertifikatePruefen([zert(JETZT + ZERTIFIKAT_FRIST_MS)], hosts, JETZT).ergebnis).toBe(
      "gelb",
    );
    expect(zertifikatePruefen([zert(JETZT + 1)], hosts, JETZT).ergebnis).toBe("gelb");
  });

  it("is red once it has expired", () => {
    expect(zertifikatePruefen([zert(JETZT)], hosts, JETZT).ergebnis).toBe("rot");
  });

  it("judges only the hosts of the server's installations, by their newest certificate", () => {
    const alt = zertifikatePruefen(
      [zert(JETZT - TAG, "alt.example.org"), zert(JETZT + 2 * TAG), zert(JETZT + 60 * TAG)],
      hosts,
      JETZT,
    );
    expect(alt).toEqual({
      pruefung: "zertifikate",
      ergebnis: "gruen",
      zertifikate: [zert(JETZT + 60 * TAG)],
    });
  });

  it("compares host names without case", () => {
    expect(
      zertifikatePruefen([zert(JETZT, "HABEN.mueller.apps.example.org")], hosts, JETZT).ergebnis,
    ).toBe("rot");
  });

  it("is green without a certificate to judge, unknown when the agent could not read them", () => {
    expect(zertifikatePruefen([], hosts, JETZT).ergebnis).toBe("gruen");
    expect(zertifikatePruefen(null, hosts, JETZT)).toEqual({
      pruefung: "zertifikate",
      ergebnis: "unbekannt",
      zertifikate: null,
    });
  });
});

describe("backupsPruefen", () => {
  const inst = (letzterErfolg: number | null, eingerichtetAm = JETZT - 30 * TAG) => ({
    installationId: "haben-a1b2c3",
    name: "Müller · Haben",
    letzterErfolg,
    eingerichtetAm,
  });

  it("is green while the last good backup is 26 h old or younger", () => {
    expect(backupsPruefen([inst(JETZT - BACKUP_FRIST_MS)], JETZT)).toEqual({
      pruefung: "backups",
      ergebnis: "gruen",
      alt: [],
    });
  });

  it("is yellow when one is older than 26 h, naming it", () => {
    expect(backupsPruefen([inst(JETZT - BACKUP_FRIST_MS - 1)], JETZT)).toEqual({
      pruefung: "backups",
      ergebnis: "gelb",
      alt: [
        {
          installationId: "haben-a1b2c3",
          name: "Müller · Haben",
          seit: JETZT - BACKUP_FRIST_MS - 1,
        },
      ],
    });
  });

  it("counts from the setup of the backups when none succeeded yet", () => {
    expect(backupsPruefen([inst(null, JETZT - BACKUP_FRIST_MS)], JETZT).ergebnis).toBe("gruen");
    expect(backupsPruefen([inst(null, JETZT - BACKUP_FRIST_MS - 1)], JETZT).ergebnis).toBe("gelb");
  });

  it("is green without installations that back up", () => {
    expect(backupsPruefen([], JETZT).ergebnis).toBe("gruen");
  });
});

describe("portsPruefen", () => {
  it("is green when every open port is named by a manifest or the system", () => {
    expect(
      portsPruefen(
        [...SYSTEM_PORTS, { port: 22001, proto: "tcp" }],
        [{ port: 22001, proto: "tcp" }],
      ),
    ).toEqual({ pruefung: "ports", ergebnis: "gruen", fremd: [] });
  });

  it("is yellow for a port no manifest names, the protocol counting", () => {
    expect(
      portsPruefen(
        [
          { port: 5432, proto: "tcp" },
          { port: 22001, proto: "udp" },
          { port: 22001, proto: "tcp" },
        ],
        [{ port: 22001, proto: "tcp" }],
      ),
    ).toEqual({
      pruefung: "ports",
      ergebnis: "gelb",
      fremd: [
        { port: 5432, proto: "tcp" },
        { port: 22001, proto: "udp" },
      ],
    });
  });

  it("allows SSH, the Pforte and the DHCP clients and nothing else of the system", () => {
    expect(SYSTEM_PORTS).toEqual([
      { port: 22, proto: "tcp" },
      { port: 68, proto: "udp" },
      { port: 80, proto: "tcp" },
      { port: 443, proto: "tcp" },
      { port: 443, proto: "udp" },
      { port: 546, proto: "udp" },
    ]);
  });

  it("is unknown when the agent did not report open ports", () => {
    expect(portsPruefen(null, [])).toEqual({
      pruefung: "ports",
      ergebnis: "unbekannt",
      fremd: null,
    });
  });
});

describe("uhrzeitPruefen", () => {
  it("is green below 500 ms and synchronised", () => {
    expect(uhrzeitPruefen(UHR_GRENZE_MS - 1, true)).toEqual({
      pruefung: "uhrzeit",
      ergebnis: "gruen",
      abweichungMs: 499,
      synchron: true,
    });
    expect(uhrzeitPruefen(-(UHR_GRENZE_MS - 1), null).ergebnis).toBe("gruen");
  });

  it("is yellow from 500 ms, ahead or behind", () => {
    expect(uhrzeitPruefen(UHR_GRENZE_MS, true).ergebnis).toBe("gelb");
    expect(uhrzeitPruefen(-UHR_GRENZE_MS, true).ergebnis).toBe("gelb");
  });

  it("is yellow when the server's time service is not synchronised", () => {
    expect(uhrzeitPruefen(3, false).ergebnis).toBe("gelb");
    expect(uhrzeitPruefen(null, false).ergebnis).toBe("gelb");
  });

  it("is unknown without a measurement", () => {
    expect(uhrzeitPruefen(null, null).ergebnis).toBe("unbekannt");
    expect(uhrzeitPruefen(null, true).ergebnis).toBe("unbekannt");
  });
});

describe("serverPruefen", () => {
  const eingabe = (teil: Partial<PruefEingabe> = {}): PruefEingabe => ({
    jetzt: JETZT,
    fakten: {
      am: JETZT - 60_000,
      platten: [platte(500)],
      portsOffen: [{ port: 443, proto: "tcp" }],
      zertifikate: [],
      uhrzeitAbweichungMs: 4,
      uhrSynchron: true,
    },
    hosts: [],
    erlaubtePorts: [],
    backups: [],
    ...teil,
  });

  it("runs every check in a fixed order", () => {
    expect(serverPruefen(eingabe()).map((p) => [p.pruefung, p.ergebnis])).toEqual([
      ["platte", "gruen"],
      ["zertifikate", "gruen"],
      ["backups", "gruen"],
      ["ports", "gruen"],
      ["uhrzeit", "gruen"],
    ]);
  });

  it("reports no foreign port on a server that is only observed (Z-1102)", () => {
    const fakten = {
      ...eingabe().fakten,
      portsOffen: [
        { port: 80, proto: "tcp" },
        { port: 5432, proto: "tcp" },
      ],
      nurBeobachten: true,
    } as PruefEingabe["fakten"];
    expect(serverPruefen(eingabe({ fakten })).find((p) => p.pruefung === "ports")).toEqual({
      pruefung: "ports",
      ergebnis: "gruen",
      fremd: [],
    });
    const verwaltet = { ...fakten, nurBeobachten: false } as PruefEingabe["fakten"];
    expect(
      serverPruefen(eingabe({ fakten: verwaltet })).find((p) => p.pruefung === "ports"),
    ).toMatchObject({ ergebnis: "gelb" });
  });

  it("does not judge facts older than 45 minutes; the backups are the Zentrale's own", () => {
    const fakten = { ...eingabe().fakten, am: JETZT - FAKTEN_FRIST_MS } as PruefEingabe["fakten"];
    expect(serverPruefen(eingabe({ fakten })).every((p) => p.ergebnis === "gruen")).toBe(true);
    const alt = { ...eingabe().fakten, am: JETZT - FAKTEN_FRIST_MS - 1 } as PruefEingabe["fakten"];
    expect(serverPruefen(eingabe({ fakten: alt })).map((p) => p.ergebnis)).toEqual([
      "unbekannt",
      "unbekannt",
      "gruen",
      "unbekannt",
      "unbekannt",
    ]);
    expect(serverPruefen(eingabe({ fakten: null }))[0]?.ergebnis).toBe("unbekannt");
  });

  it("takes facts an older agent does not send as not read", () => {
    const fakten = {
      am: JETZT,
      platten: [platte(500)],
      uhrzeitAbweichungMs: 4,
    } as PruefEingabe["fakten"];
    expect(serverPruefen(eingabe({ fakten })).map((p) => p.ergebnis)).toEqual([
      "gruen",
      "unbekannt",
      "gruen",
      "unbekannt",
      "gruen",
    ]);
  });
});

describe("befundFortschreiben", () => {
  it("reports a check that turns yellow or red, once", () => {
    expect(befundFortschreiben(null, "gelb")).toEqual({ art: "auffaellig", stufe: "gelb" });
    expect(befundFortschreiben(null, "rot")).toEqual({ art: "auffaellig", stufe: "rot" });
    expect(befundFortschreiben("gelb", "gelb")).toBeUndefined();
    expect(befundFortschreiben("rot", "rot")).toBeUndefined();
  });

  it("reports yellow turning red, but not red easing to yellow", () => {
    expect(befundFortschreiben("gelb", "rot")).toEqual({ art: "auffaellig", stufe: "rot" });
    expect(befundFortschreiben("rot", "gelb")).toBeUndefined();
  });

  it("reports the fix once green, never on unknown", () => {
    expect(befundFortschreiben("gelb", "gruen")).toEqual({ art: "behoben" });
    expect(befundFortschreiben("rot", "gruen")).toEqual({ art: "behoben" });
    expect(befundFortschreiben("rot", "unbekannt")).toBeUndefined();
    expect(befundFortschreiben(null, "gruen")).toBeUndefined();
    expect(befundFortschreiben(null, "unbekannt")).toBeUndefined();
  });
});
