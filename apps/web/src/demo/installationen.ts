import type { Installation, Snapshot } from "../daten/typen.ts";
import { berlin, heute, JETZT } from "./zeit.ts";

/** One installation per app and customer, under its own Linux user sz-<id> (design/mockup/) */

const TAG = 86_400_000;

/** The last five nightly snapshots; a failed backup leaves the newest without a size */
const snapshots = (i: Pick<Installation, "backup" | "pruefRestore" | "datenGb">): Snapshot[] =>
  [0, 1, 2, 3, 4].map((n) => {
    const gescheitert = n === 0 && !i.backup.ok;
    const gb = gescheitert ? null : Math.round(i.datenGb * 0.92 * 10) / 10;
    const snapshot: Snapshot = { zeitpunkt: heute("03:15") - n * TAG, gb };
    return n === 1 ? { ...snapshot, pruefRestore: i.pruefRestore } : snapshot;
  });

type Angaben = Partial<Omit<Installation, "id" | "app" | "kunde" | "server" | "version">>;

const I = (
  id: string,
  app: string,
  kunde: string,
  server: string,
  version: string,
  adresse: string,
  angaben: Angaben = {},
): Installation => {
  const basis = {
    id,
    app,
    kunde,
    server,
    version,
    adresse,
    optionen: [],
    health: "gruen" as const,
    backup: { zeitpunkt: heute("03:15"), ok: true },
    pruefRestore: "ok" as const,
    datenGb: 1,
    laeuftSeit: JETZT - 12 * TAG,
    verfuegbarkeit: { "2026-10": 100, "2026-11": 100 },
    werte: {},
    ...angaben,
  };
  return { snapshots: snapshots(basis), ...basis };
};

const bh = (app: string, kunde: string) => `${app}.${kunde}.beispiel-hosting.de`;

export const installationen: Installation[] = [
  I("intern-haben", "haben", "intern", "shared-1", "1.9.0", bh("haben", "intern"), {
    datenGb: 0.4,
  }),
  I("intern-belegt", "belegt", "intern", "shared-1", "0.10.0", bh("belegt", "intern"), {
    datenGb: 0.2,
  }),
  I("atelier-haben", "haben", "atelier-nord", "shared-1", "1.9.0", bh("haben", "atelier-nord"), {
    datenGb: 1.2,
    werte: { LAYOUTS_MAX_COUNT: "20" },
  }),
  I("atelier-belegt", "belegt", "atelier-nord", "shared-1", "0.9.0", bh("belegt", "atelier-nord"), {
    optionen: ["journal"],
    datenGb: 0.4,
    updateLaeuft: true,
  }),
  I(
    "atelier-schreibzeug",
    "schreibzeug",
    "atelier-nord",
    "shared-1",
    "0.6.0",
    bh("schreibzeug", "atelier-nord"),
    { datenGb: 0.2, werte: { SCHREIBZEUG_OPEN_SIGNUP: "false" } },
  ),
  I("weber-haben", "haben", "praxis-weber", "shared-1", "1.9.0", bh("haben", "praxis-weber"), {
    datenGb: 3.4,
  }),
  I("roth-haben", "haben", "roth", "shared-1", "1.8.2", bh("haben", "roth"), {
    datenGb: 0.6,
    updateLaeuft: true,
  }),
  I("sonne-haben", "haben", "sonne", "shared-1", "1.8.2", bh("haben", "sonne"), { datenGb: 1.9 }),
  I("aust-haben", "haben", "aust", "shared-2", "1.9.0", bh("haben", "aust"), { datenGb: 2.2 }),
  I("berger-haben", "haben", "it-berger", "shared-2", "1.8.2", bh("haben", "it-berger"), {
    datenGb: 0.8,
  }),
  I(
    "berger-schreibzeug",
    "schreibzeug",
    "it-berger",
    "shared-2",
    "0.6.0",
    bh("schreibzeug", "it-berger"),
    {
      datenGb: 0.5,
      backup: { zeitpunkt: heute("03:24"), ok: true },
      health: "rot",
      roteUnit: "app",
      grund: "Unit app beendet, Neustart zweimal gescheitert",
      verfuegbarkeit: { "2026-10": 100, "2026-11": 99.71 },
    },
  ),
  I("lind-haben", "haben", "studio-lind", "lind", "1.9.0", bh("haben", "studio-lind"), {
    datenGb: 7.9,
    health: "gelb",
    grund: "Backup älter als 26 h: Platte zu 91 % voll",
    backup: { zeitpunkt: berlin("2026-11-17", "03:15"), ok: false },
    pruefRestore: "offen",
    verfuegbarkeit: { "2026-10": 99.98, "2026-11": 99.95 },
  }),
  I("holm-haben", "haben", "holm", "holm", "1.9.0", "haben.schreinerei-holm.de", { datenGb: 5.1 }),
  I("holm-belegt", "belegt", "holm", "holm", "0.9.0", "archiv.schreinerei-holm.de", {
    datenGb: 1.1,
    pruefRestore: "gescheitert",
  }),
  I("kraft-fixpunkt", "fixpunkt", "kraft", "kraft", "0.3.0", "aufmass.ib-kraft.de", {
    optionen: ["nodeodm"],
    datenGb: 112,
    backup: { zeitpunkt: heute("03:30"), ok: true },
    health: "unbekannt",
    grund: "Agent seit 6 Min. still",
    werte: { FIXPUNKT_MAX_UPLOAD_GB: "20", FIXPUNKT_MAX_JOBS: "1" },
    verfuegbarkeit: { "2026-11": 99.9 },
  }),
];
