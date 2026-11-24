import { describe, expect, it } from "vitest";
import type { UebersichtEintrag } from "./betrieb.ts";
import { brauchtAufmerksamkeit, dazu, ohneManifest, zuTun } from "./zu-tun.ts";

/*
 * "Zu tun" of the overview (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): one row per thing
 * that needs someone, worst first; what follows from a server's fault stands in that server's row;
 * rows of notes only wait ("Ohne Eile").
 */

const inst = (id: string, serverId: string) => ({
  installationId: id,
  app: "haben",
  host: `${id}.example`,
  kunde: "Kunde",
  serverId,
});
const grund = { code: "health" as const, werte: { text: "" } };

const STOERUNG: UebersichtEintrag = {
  art: "stoerung",
  schwere: "stoerung",
  verweis: { art: "installation", id: "a" },
  installation: inst("a", "s1"),
  grund,
  seit: 1,
};
const PLATTE: UebersichtEintrag = {
  art: "pruefung",
  schwere: "stoerung",
  verweis: { art: "server", id: "s2" },
  server: { serverId: "s2", name: "Zwei" },
  pruefung: { pruefung: "platte", ergebnis: "rot", platten: [{ mount: "/", prozent: 91 }] },
  seit: null,
};
const GELB_AUF_S2: UebersichtEintrag = {
  art: "installation",
  schwere: "warnung",
  verweis: { art: "installation", id: "b" },
  installation: inst("b", "s2"),
  zustand: "gelb",
  grund,
  seit: null,
};
const STILL: UebersichtEintrag = {
  art: "agent",
  schwere: "warnung",
  verweis: { art: "server", id: "s3" },
  server: { serverId: "s3", name: "Drei" },
  zustand: "still",
  seit: 5,
};
const ZERTIFIKAT: UebersichtEintrag = {
  art: "pruefung",
  schwere: "warnung",
  verweis: { art: "server", id: "s4" },
  server: { serverId: "s4", name: "Vier" },
  pruefung: { pruefung: "zertifikate", ergebnis: "gelb", zertifikate: [] },
  seit: null,
};
const PRUEF_AUF_S4: UebersichtEintrag = {
  art: "pruef_restore",
  schwere: "warnung",
  verweis: { art: "installation", id: "c" },
  installation: inst("c", "s4"),
  gescheitert: true,
  grund: null,
  seit: 2,
};
const NEUSTART_GESCHEITERT: UebersichtEintrag = {
  art: "auftrag",
  schwere: "warnung",
  verweis: { art: "auftrag", id: "A-1" },
  auftragId: "A-1",
  aktion: "installation_neustart",
  fehler: "exit 1",
  server: { serverId: "s1", name: "Eins" },
  installation: inst("a", "s1"),
  seit: 3,
};
const UNBEKANNT_AUF_S3: UebersichtEintrag = {
  art: "installation",
  schwere: "hinweis",
  verweis: { art: "installation", id: "d" },
  installation: inst("d", "s3"),
  zustand: "unbekannt",
  grund,
  seit: null,
};
const PRUEF_ALT: UebersichtEintrag = {
  art: "pruef_restore",
  schwere: "hinweis",
  verweis: { art: "installation", id: "e" },
  installation: inst("e", "s1"),
  gescheitert: false,
  grund: null,
  seit: null,
};
const SSH: UebersichtEintrag = {
  art: "ereignis",
  schwere: "warnung",
  verweis: { art: "ereignisse" },
  ereignisId: "e1",
  ereignisArt: "x",
  ziel: "app:haben",
  text: "Etwas",
  seit: 4,
};

/** As the Zentrale orders them: severity, then kind, then the newest */
const ALLE = [
  STOERUNG,
  PLATTE,
  GELB_AUF_S2,
  STILL,
  ZERTIFIKAT,
  PRUEF_AUF_S4,
  NEUSTART_GESCHEITERT,
  SSH,
  UNBEKANNT_AUF_S3,
  PRUEF_ALT,
];

const kurz = (g: { haupt: UebersichtEintrag; weitere: UebersichtEintrag[] }) => [
  g.haupt,
  g.weitere,
];

describe("zuTun", () => {
  it("makes one row per installation or server, in the order of its worst entry", () => {
    const { zeilen } = zuTun(ALLE);
    expect(zeilen.map(kurz)).toEqual([
      // the failed restart is about the broken installation: one row
      [STOERUNG, [NEUSTART_GESCHEITERT]],
      // a full disk is the cause of what its installations report
      [PLATTE, [GELB_AUF_S2]],
      // a silent agent too: its installations have no state because of it
      [STILL, [UNBEKANNT_AUF_S3]],
      // a certificate is not the cause of a failed test restore: two rows
      [ZERTIFIKAT, []],
      [PRUEF_AUF_S4, []],
      [SSH, []],
    ]);
  });

  it("keeps rows of notes apart: they can wait", () => {
    const { zeilen, ohneEile } = zuTun(ALLE);
    expect(ohneEile.map(kurz)).toEqual([[PRUEF_ALT, []]]);
    expect(zeilen.every((z) => z.schwere !== "hinweis")).toBe(true);
  });

  it("gives each row the severity of its worst entry", () => {
    expect(zuTun(ALLE).zeilen.map((z) => z.schwere)).toEqual([
      "stoerung",
      "stoerung",
      "warnung",
      "warnung",
      "warnung",
      "warnung",
    ]);
  });

  it("counts the rows for the sidebar, not the entries", () => {
    expect(brauchtAufmerksamkeit(ALLE)).toBe(6);
    expect(brauchtAufmerksamkeit([UNBEKANNT_AUF_S3, PRUEF_ALT])).toBe(0);
    expect(brauchtAufmerksamkeit([])).toBe(0);
  });
});

describe("dazu", () => {
  it("leaves out what is about the row's own app: a failed restart restates why it is broken", () => {
    const [gestoert, platte, still] = zuTun(ALLE).zeilen;
    expect(gestoert && dazu(gestoert)).toEqual([]);
    // a server's row names what its apps report because of it
    expect(platte && dazu(platte)).toEqual([GELB_AUF_S2]);
    expect(still && dazu(still)).toEqual([UNBEKANNT_AUF_S3]);
  });

  it("keeps another app's entries in an app's row", () => {
    const andere = { ...NEUSTART_GESCHEITERT, installation: inst("x", "s1") };
    expect(
      dazu({ haupt: STOERUNG, weitere: [NEUSTART_GESCHEITERT, andere], schwere: "stoerung" }),
    ).toEqual([andere]);
  });
});

describe("ohneManifest", () => {
  const v = (version: string, zustand: "verfuegbar" | "manifest_fehlt") => ({
    version,
    zustand,
    dringend: false,
    vorabversion: false,
    sha256: null,
    importiert: null,
  });

  it("names per app the newest tag of the registry whose manifest is missing", () => {
    expect(
      ohneManifest([
        { app: "haben", versionen: [v("0.13.0", "manifest_fehlt"), v("0.12.0", "verfuegbar")] },
        { app: "belegt", versionen: [v("0.0.7", "verfuegbar")] },
        {
          app: "kontext",
          versionen: [v("0.1.40", "manifest_fehlt"), v("0.1.39", "manifest_fehlt")],
        },
      ]),
    ).toEqual([
      { app: "haben", version: "0.13.0" },
      { app: "kontext", version: "0.1.40" },
    ]);
  });
});
