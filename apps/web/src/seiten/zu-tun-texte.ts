import { m } from "@steuerzentrale/ui";
import { suche } from "../daten/ableitungen.ts";
import type { InstallationsVerweis, UebersichtEintrag } from "../daten/betrieb.ts";
import { grundText } from "../daten/bewertung.ts";
import { dienstGrundText } from "../daten/dienste.ts";
import { bestand } from "../daten/quelle.ts";
import { dazu, type ZuTunZeile } from "../daten/zu-tun.ts";
import { vor, zeitpunkt } from "../format/zeit.ts";
import { aktionsText } from "./installieren-texte.ts";
import { pruefungDetail, pruefungName } from "./server-texte.ts";

/*
 * The words of a row of "Zu tun" (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): the title says
 * what is wrong in a sentence, the line under it why and since when, and what else stands in the
 * row.
 */

/** The job that sets an installation up: failed, the installation was not set up */
const EINRICHTEN = "installation_einrichten";

const appName = (app: string) => suche(bestand().apps, app)?.name ?? app;

/** A sentence with app and customer */
type Satz = (w: { app: string; kunde: string }) => string;

const satz = (i: InstallationsVerweis, mit: Satz) => mit({ app: appName(i.app), kunde: i.kunde });

const SATZ_DER_BEWERTUNG: Record<"rot" | "gelb" | "unbekannt", Satz> = {
  rot: m.zutun_gestoert,
  gelb: m.zutun_eingeschraenkt,
  unbekannt: m.zutun_ohne_zustand,
};

const SATZ_DES_DIENSTES: Record<"stoerung" | "rot" | "unbekannt", (w: { name: string }) => string> =
  {
    stoerung: m.zutun_dienst_gestoert,
    rot: m.zutun_dienst_rot,
    unbekannt: m.zutun_dienst_unbekannt,
  };

/** The title of a row named by this entry */
export const zuTunTitel = (e: UebersichtEintrag): string => {
  switch (e.art) {
    case "stoerung":
      return satz(e.installation, m.zutun_gestoert);
    case "installation":
      return satz(e.installation, SATZ_DER_BEWERTUNG[e.zustand]);
    case "dienst":
      return SATZ_DES_DIENSTES[e.zustand]({ name: e.dienst.name });
    case "agent":
      return (e.zustand === "still" ? m.zutun_agent_still : m.zutun_agent_getrennt)({
        server: e.server.name,
      });
    case "pruefung": {
      const p = e.pruefung;
      if (p.pruefung === "platte" && p.platten?.[0])
        return m.zutun_platte({ server: e.server.name, prozent: Math.round(p.platten[0].prozent) });
      return m.zutun_pruefung({ pruefung: pruefungName(p.pruefung), server: e.server.name });
    }
    case "pruef_restore":
      return e.gescheitert
        ? satz(e.installation, m.zutun_pruef_gescheitert)
        : satz(e.installation, m.zutun_pruef_alt);
    case "auftrag":
      if (e.aktion === EINRICHTEN && e.installation)
        return satz(e.installation, m.zutun_nicht_eingerichtet);
      return m.zutun_auftrag({ aktion: aktionsText(e.aktion), ziel: zielName(e) });
    case "ereignis":
      return e.text;
  }
};

/** What a job was about: its installation, or its server */
const zielName = (e: Extract<UebersichtEintrag, { art: "auftrag" }>) =>
  e.installation ? satz(e.installation, m.zutun_app_bei) : e.server.name;

const seit = (t: number | null) =>
  t === null ? [] : [m.zutun_seit({ zeit: zeitpunkt(t, bestand().jetzt) })];
const her = (t: number | null) => (t === null ? [] : [vor(t, bestand().jetzt)]);

/** Why, as short parts the line joins with " · " */
const gruende = (e: UebersichtEintrag): string[] => {
  const jetzt = bestand().jetzt;
  switch (e.art) {
    case "stoerung":
    case "installation":
      return [grundText(e.grund), ...seit(e.seit)];
    case "dienst":
      return [e.dienst.host, dienstGrundText(e.grund), ...seit(e.seit)];
    case "agent":
      return [
        m.zutun_agent_grund({
          zustand: e.zustand === "still" ? m.agent_still() : m.agent_getrennt(),
          seit: e.seit === null ? "–" : vor(e.seit, jetzt),
        }),
      ];
    case "pruefung":
      return [pruefungDetail(e.pruefung, jetzt), ...seit(e.seit)];
    case "pruef_restore":
      return e.gescheitert
        ? [e.grund ?? m.auftrag_gescheitert(), ...her(e.seit)]
        : [m.hinweis_pruef_alt({ seit: e.seit === null ? m.pruef_nie() : vor(e.seit, jetzt) })];
    case "auftrag":
      return [e.fehler ?? m.auftrag_gescheitert(), ...her(e.seit)];
    case "ereignis":
      return her(e.seit);
  }
};

/** How many of the other entries of a row the line names; the rest it counts */
const DAZU_HOECHSTENS = 2;

/** What else stands in the row: the titles of the first two, then how many more */
const dazuText = (z: ZuTunZeile): string[] => {
  const weitere = dazu(z);
  if (weitere.length === 0) return [];
  const genannt = weitere.slice(0, DAZU_HOECHSTENS).map((e) => zuTunTitel(e));
  const rest = weitere.length - genannt.length;
  const liste = genannt.join("; ");
  return [rest > 0 ? m.zutun_dazu_mehr({ liste, n: rest }) : m.zutun_dazu({ liste })];
};

/** The line under the title: why and since when, and what else stands in the row */
export const zuTunGrund = (z: ZuTunZeile): string =>
  [...gruende(z.haupt), ...dazuText(z)].join(" · ");
