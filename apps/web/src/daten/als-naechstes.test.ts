import { describe, expect, it } from "vitest";
import { berlin } from "../format/zeit.ts";
import { alsNaechstes, type VorschauEingabe } from "./als-naechstes.ts";

/*
 * "Als Nächstes" of the overview (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): what the Zentrale
 * does by itself in the next 7 days, and the deadlines of the next 30, soonest first, only from data
 * the Zentrale has.
 */

const JETZT = berlin("2026-11-20", "10:42");
const TAG = 86_400_000;

const installation = (
  id: string,
  app: string,
  kunde: string,
  angaben: Partial<VorschauEingabe["installationen"][number]> = {},
): VorschauEingabe["installationen"][number] => ({
  id,
  app,
  appName: app[0]?.toUpperCase() + app.slice(1),
  kundeId: kunde.toLowerCase(),
  kundeName: kunde,
  vertragsende: null,
  zustand: "laeuft",
  ...angaben,
});

const server = (
  id: string,
  angaben: Partial<VorschauEingabe["server"][number]> = {},
): VorschauEingabe["server"][number] => ({
  id,
  name: id,
  kernel: { laeuft: "6.12.41", installiert: "6.12.41" },
  neustartStand: { noetig: false, plan: { art: "warten", grund: "nicht_noetig" }, letzter: null },
  zertifikate: [],
  ...angaben,
});

const LEER: VorschauEingabe = {
  installationen: [],
  server: [],
  angebote: [],
  apps: [],
  fuerKunden: true,
};

const termin = (ab: number) => ({
  welle: "alle" as const,
  version: "0.0.7",
  art: "termin" as const,
  ab,
  sperrzeitUebergangen: false,
});

describe("alsNaechstes", () => {
  it("names planned update steps of the next 7 days, one per app version and slot", () => {
    const heuteAbend = berlin("2026-11-20", "22:00");
    const liste = alsNaechstes(
      {
        ...LEER,
        installationen: [
          installation("holm-belegt", "belegt", "Holm"),
          installation("aust-belegt", "belegt", "Aust"),
          installation("roth-belegt", "belegt", "Roth"),
        ],
        angebote: [
          { installationId: "holm-belegt", plan: termin(heuteAbend) },
          { installationId: "aust-belegt", plan: termin(heuteAbend) },
          { installationId: "roth-belegt", plan: termin(JETZT + 8 * TAG) },
        ],
      },
      JETZT,
    );
    expect(liste).toEqual([
      {
        art: "update",
        zeit: heuteAbend,
        warn: false,
        installationId: "holm-belegt",
        appName: "Belegt",
        version: "0.0.7",
        welle: "alle",
        kunden: ["Holm", "Aust"],
      },
    ]);
  });

  it("leaves out installations the plan holds back or that run the newest version", () => {
    const liste = alsNaechstes(
      {
        ...LEER,
        installationen: [installation("a", "belegt", "A"), installation("b", "belegt", "B")],
        angebote: [
          {
            installationId: "a",
            plan: { welle: "alle", version: "0.0.7", art: "wartet", grund: "intern_laeuft" },
          },
          { installationId: "b", plan: null },
        ],
      },
      JETZT,
    );
    expect(liste).toEqual([]);
  });

  it("names a server's reboot in its maintenance window, and why", () => {
    const samstag = berlin("2026-11-21", "03:00");
    const liste = alsNaechstes(
      {
        ...LEER,
        server: [
          server("shared-2", {
            name: "Gemeinsamer Server 2",
            kernel: { laeuft: "6.12.41", installiert: "6.12.48" },
            neustartStand: {
              noetig: true,
              plan: { art: "warten", grund: "fenster", ab: samstag },
              letzter: null,
            },
          }),
          // waits for a backup that is missing: nothing the Zentrale does by itself
          server("lind", {
            neustartStand: {
              noetig: true,
              plan: { art: "warten", grund: "backup_fehlt" },
              letzter: null,
            },
          }),
        ],
      },
      JETZT,
    );
    expect(liste).toEqual([
      {
        art: "neustart",
        zeit: samstag,
        warn: false,
        serverId: "shared-2",
        name: "Gemeinsamer Server 2",
        kernel: "6.12.48",
      },
    ]);
  });

  it("names certificates that run out within 30 days, in warn colour under 14", () => {
    const liste = alsNaechstes(
      {
        ...LEER,
        server: [
          server("holm", {
            zertifikate: [
              { host: "haben.schreinerei-holm.de", gueltigBis: JETZT + 12 * TAG },
              { host: "archiv.schreinerei-holm.de", gueltigBis: JETZT + 20 * TAG },
              { host: "alt.schreinerei-holm.de", gueltigBis: JETZT + 61 * TAG },
              // a newer one of the same host counts, as the check of the server counts it
              { host: "neu.schreinerei-holm.de", gueltigBis: JETZT + 2 * TAG },
              { host: "neu.schreinerei-holm.de", gueltigBis: JETZT + 80 * TAG },
            ],
          }),
        ],
      },
      JETZT,
    );
    expect(liste).toEqual([
      {
        art: "zertifikat",
        zeit: JETZT + 12 * TAG,
        warn: true,
        hosts: ["haben.schreinerei-holm.de"],
      },
      {
        art: "zertifikat",
        zeit: JETZT + 20 * TAG,
        warn: false,
        hosts: ["archiv.schreinerei-holm.de"],
      },
    ]);
  });

  it("puts the certificates that run out on the same day in one line", () => {
    const liste = alsNaechstes(
      {
        ...LEER,
        server: [
          server("holm", {
            zertifikate: [
              { host: "haben.schreinerei-holm.de", gueltigBis: JETZT + 12 * TAG },
              { host: "archiv.schreinerei-holm.de", gueltigBis: JETZT + 12 * TAG + 3_600_000 },
            ],
          }),
        ],
      },
      JETZT,
    );
    expect(liste).toEqual([
      {
        art: "zertifikat",
        zeit: JETZT + 12 * TAG,
        warn: true,
        hosts: ["haben.schreinerei-holm.de", "archiv.schreinerei-holm.de"],
      },
    ]);
  });

  it("names the freeze windows of running apps that begin within 7 days", () => {
    const eingabe: VorschauEingabe = {
      ...LEER,
      installationen: [installation("holm-haben", "haben", "Holm")],
      apps: [
        { id: "haben", name: "Haben", sperrzeiten: [{ von: 7, bis: 12, grund: "Voranmeldung" }] },
        {
          id: "kontext",
          name: "Kontext",
          sperrzeiten: [{ von: 22, bis: 23, grund: "läuft nicht" }],
        },
      ],
    };
    expect(alsNaechstes(eingabe, JETZT)).toEqual([]);
    const dezember = berlin("2026-12-02", "10:00");
    expect(alsNaechstes(eingabe, dezember)).toEqual([
      {
        art: "sperrzeit",
        zeit: berlin("2026-12-07"),
        warn: false,
        bis: berlin("2026-12-13"),
        appName: "Haben",
        grund: "Voranmeldung",
      },
    ]);
  });

  it("names a contract's end within 30 days and the deletion after it, for customers only", () => {
    const ende = berlin("2026-11-30");
    const eingabe: VorschauEingabe = {
      ...LEER,
      installationen: [
        installation("sonne-haben", "haben", "Sonne", { vertragsende: ende }),
        installation("sonne-belegt", "belegt", "Sonne", { vertragsende: ende }),
        installation("alt-haben", "haben", "Alt", { vertragsende: berlin("2026-08-24") }),
      ],
    };
    expect(alsNaechstes(eingabe, JETZT)).toEqual([
      {
        art: "loeschung",
        zeit: berlin("2026-11-22"),
        warn: true,
        kundeId: "alt",
        kundeName: "Alt",
      },
      {
        art: "vertrag",
        zeit: ende,
        warn: false,
        kundeId: "sonne",
        kundeName: "Sonne",
        loeschenAb: berlin("2027-02-28"),
      },
    ]);
    expect(alsNaechstes({ ...eingabe, fuerKunden: false }, JETZT)).toEqual([]);
  });

  it("orders everything by time, soonest first", () => {
    const liste = alsNaechstes(
      {
        ...LEER,
        installationen: [installation("holm-belegt", "belegt", "Holm")],
        angebote: [{ installationId: "holm-belegt", plan: termin(JETZT + 2 * TAG) }],
        server: [
          server("s", {
            zertifikate: [{ host: "x.example", gueltigBis: JETZT + TAG }],
            neustartStand: { noetig: true, plan: { art: "jetzt" }, letzter: null },
          }),
        ],
      },
      JETZT,
    );
    expect(liste.map((t) => t.art)).toEqual(["neustart", "zertifikat", "update"]);
  });
});
