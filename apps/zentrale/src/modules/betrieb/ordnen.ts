import type { Grund, Serverpruefung } from "@steuerzentrale/planung";

/*
 * What needs attention, as data (BAULISTE.md Z-406; docs/plan.md, "Übersicht"): each entry with its
 * severity and the cause it leads to, worst first (DESIGN.md, "Grundsätze"). Pure: the overview
 * (uebersicht.ts) reads the rows, this orders them.
 */

export type Schwere = "stoerung" | "warnung" | "hinweis";

export type InstallationVerweis = {
  installationId: string;
  app: string;
  host: string;
  kunde: string;
};
export type ServerVerweis = { serverId: string; name: string };

/** Where an entry leads: the installation, the server, the job or the event list */
export type Verweis =
  | { art: "installation"; id: string }
  | { art: "server"; id: string }
  | { art: "auftrag"; id: string }
  | { art: "ereignisse" };

export type Eintrag =
  | {
      art: "stoerung";
      schwere: Schwere;
      installation: InstallationVerweis;
      grund: Grund;
      seit: number | null;
    }
  | {
      art: "installation";
      schwere: Schwere;
      installation: InstallationVerweis;
      zustand: "rot" | "gelb" | "unbekannt";
      grund: Grund;
      seit: number | null;
    }
  | {
      art: "agent";
      schwere: Schwere;
      server: ServerVerweis;
      zustand: "getrennt" | "still";
      seit: number | null;
    }
  | {
      /** A check of the server is red or yellow (Z-702); `seit` its open finding's event */
      art: "pruefung";
      schwere: Schwere;
      server: ServerVerweis;
      pruefung: Serverpruefung;
      seit: number | null;
    }
  | {
      /** The newest test restore failed, or there was none for 8 days (Z-602) */
      art: "pruef_restore";
      schwere: Schwere;
      installation: InstallationVerweis;
      gescheitert: boolean;
      grund: string | null;
      seit: number | null;
    }
  | {
      art: "auftrag";
      schwere: Schwere;
      auftragId: string;
      aktion: string;
      fehler: string | null;
      server: ServerVerweis;
      installation: InstallationVerweis | null;
      seit: number;
    }
  | {
      art: "ereignis";
      schwere: Schwere;
      ereignisId: string;
      ereignisArt: string;
      ziel: string;
      text: string;
      seit: number;
    };

export type MitVerweis = Eintrag & { verweis: Verweis };

const RANG: Record<Schwere, number> = { stoerung: 0, warnung: 1, hinweis: 2 };

/** Within one severity: faults, installations, agents, checks, test restores, jobs, events */
const FOLGE: Record<Eintrag["art"], number> = {
  stoerung: 0,
  installation: 1,
  agent: 2,
  pruefung: 3,
  pruef_restore: 4,
  auftrag: 5,
  ereignis: 6,
};

/** An event's target as `art:id` (modules/bewertung/lesen.ts, `zielVon`) leads to its page */
export const zielVerweis = (ziel: string): Verweis => {
  const [art, ...rest] = ziel.split(":");
  const id = rest.join(":");
  if (art === "installation" && id) return { art: "installation", id };
  if (art === "server" && id) return { art: "server", id };
  return { art: "ereignisse" };
};

export const verweisVon = (e: Eintrag): Verweis => {
  switch (e.art) {
    case "stoerung":
    case "installation":
    case "pruef_restore":
      return { art: "installation", id: e.installation.installationId };
    case "agent":
    case "pruefung":
      return { art: "server", id: e.server.serverId };
    case "auftrag":
      return { art: "auftrag", id: e.auftragId };
    case "ereignis":
      return zielVerweis(e.ziel);
  }
};

/**
 * Worst first; within a severity by kind, then the newest first (an entry without an instant last).
 * An event whose target an entry of the kinds before already names is left out: that entry leads
 * to the same cause.
 */
export const ordnen = (eintraege: Eintrag[]): MitVerweis[] => {
  const mit = eintraege.map((e) => ({ ...e, verweis: verweisVon(e) }));
  const genannt = new Set(
    mit
      .filter((e) => e.art !== "ereignis" && e.art !== "auftrag")
      .map((e) => JSON.stringify(e.verweis)),
  );
  return mit
    .filter((e) => e.art !== "ereignis" || !genannt.has(JSON.stringify(e.verweis)))
    .sort(
      (a, b) =>
        RANG[a.schwere] - RANG[b.schwere] ||
        FOLGE[a.art] - FOLGE[b.art] ||
        (b.seit ?? -1) - (a.seit ?? -1),
    );
};
