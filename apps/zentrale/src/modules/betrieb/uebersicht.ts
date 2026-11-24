import { PRUEF_RESTORE_AKTION, WIEDERHERSTELLEN_AKTION } from "@steuerzentrale/manifest";
import { bewertungJetzt } from "@steuerzentrale/planung";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { installationen, kunden } from "../../db/schema.ts";
import { backupEingerichtet } from "../backups/auftraege.ts";
import { STOERUNG_ART, standVon } from "../bewertung/index.ts";
import { stoerungOffen } from "../bewertung/lesen.ts";
import { pruefRestoreAufmerksamkeit } from "../pruef-restore/lesen.ts";
import { pruefungenLesen } from "../pruefungen/index.ts";
import { letzteHeartbeats, serverListe } from "../server/index.ts";
import { verbindungsZustand } from "../verbindung/zustand.ts";
import { auftraegeSeite } from "./auftraege.ts";
import { ereignisseSeite } from "./ereignisse.ts";
import { type Eintrag, type MitVerweis, ordnen, type Schwere } from "./ordnen.ts";

/*
 * The overview (BAULISTE.md Z-406; docs/plan.md, "Echte Daten (Z-406)"): open faults, installations
 * red, yellow or unknown, agents disconnected or silent, checks of a server red or yellow (Z-702),
 * test restores failed or older than 8 days
 * (Z-602), failed jobs of the last 7 days (a test restore's own job aside: its entry stands for it;
 * a restore's too, Z-603: its event `wiederherstellen_gescheitert` does),
 * events of severity `fehler` and `warn` of the last 24 h; each within the operator, ordered by
 * ordnen.ts.
 */

export const AUFTRAEGE_TAGE = 7;
export const EREIGNISSE_STUNDEN = 24;
/** At most this many failed jobs and events each: the newest; the full lists have their pages */
export const HOECHSTENS = 100;

export type UebersichtDeps = {
  db: Db;
  jetzt: number;
  /** Since when the server's agent is connected; undefined without a connection */
  verbundenSeit: (betreiberId: string, serverId: string) => number | undefined;
};

const SCHWERE_DER_BEWERTUNG = { rot: "stoerung", gelb: "warnung", unbekannt: "hinweis" } as const;

/** The operator's installations not removed, with their customer's name */
const mitKunde = (deps: UebersichtDeps, betreiberId: string) =>
  deps.db
    .select({ i: installationen, kunde: kunden.name })
    .from(installationen)
    .innerJoin(
      kunden,
      and(
        eq(kunden.betreiberId, installationen.betreiberId),
        eq(kunden.kundeId, installationen.kundeId),
      ),
    )
    .where(and(eq(installationen.betreiberId, betreiberId), ne(installationen.zustand, "entfernt")))
    .all();

/** What an entry names of an installation, with its customer's name and its server */
const verweisAuf = (
  i: { installationId: string; app: string; host: string; serverId: string },
  kunde: string,
) => ({ installationId: i.installationId, app: i.app, host: i.host, kunde, serverId: i.serverId });

/** Running installations whose rating is not green, or that have an open fault */
const installationsEintraege = (deps: UebersichtDeps, betreiberId: string): Eintrag[] =>
  mitKunde(deps, betreiberId).flatMap(({ i, kunde }): Eintrag[] => {
    const installation = verweisAuf(i, kunde);
    const stand = bewertungJetzt(standVon(i), deps.jetzt);
    if (stoerungOffen(deps.db, betreiberId, i.installationId))
      return [
        {
          art: "stoerung",
          schwere: "stoerung",
          installation,
          grund: stand.grund,
          seit: stand.seit,
        },
      ];
    if (i.zustand !== "laeuft" || stand.bewertung === "gruen") return [];
    return [
      {
        art: "installation",
        schwere: SCHWERE_DER_BEWERTUNG[stand.bewertung],
        installation,
        zustand: stand.bewertung,
        grund: stand.grund,
        seit: stand.seit,
      },
    ];
  });

/** Running installations with backups whose test restore failed or is older than 8 days */
const pruefRestoreEintraege = (deps: UebersichtDeps, betreiberId: string): Eintrag[] =>
  mitKunde(deps, betreiberId).flatMap(({ i, kunde }): Eintrag[] => {
    if (i.zustand !== "laeuft" || !backupEingerichtet(deps.db, betreiberId, i.installationId))
      return [];
    const a = pruefRestoreAufmerksamkeit(deps.db, i, deps.jetzt);
    if (!a) return [];
    const installation = verweisAuf(i, kunde);
    return [
      { art: "pruef_restore", schwere: a.gescheitert ? "warnung" : "hinweis", installation, ...a },
    ];
  });

/** Agents that joined, are not revoked, and are disconnected or silent */
const agentEintraege = (deps: UebersichtDeps, betreiberId: string): Eintrag[] => {
  const letzte = letzteHeartbeats(deps.db, betreiberId);
  return serverListe(deps.db, betreiberId).flatMap((sv): Eintrag[] => {
    if (sv.gesperrtAm !== null || sv.beigetretenAm === null) return [];
    const agent = verbindungsZustand(
      {
        verbundenSeit: deps.verbundenSeit(betreiberId, sv.serverId),
        letzterHeartbeat: letzte.get(sv.serverId),
      },
      deps.jetzt,
    );
    if (agent.zustand === "verbunden") return [];
    return [
      {
        art: "agent",
        schwere: agent.zustand === "getrennt" ? "stoerung" : "warnung",
        server: { serverId: sv.serverId, name: sv.name },
        zustand: agent.zustand,
        seit: agent.letzterHeartbeat ?? sv.beigetretenAm,
      },
    ];
  });
};

const SCHWERE_DER_PRUEFUNG = { rot: "stoerung", gelb: "warnung" } as const;

/** The checks of joined, unrevoked servers that are red or yellow; unknown ones the agent's entry covers */
const pruefungsEintraege = (deps: UebersichtDeps, betreiberId: string): Eintrag[] =>
  serverListe(deps.db, betreiberId).flatMap((sv): Eintrag[] => {
    if (sv.gesperrtAm !== null || sv.beigetretenAm === null) return [];
    return pruefungenLesen(deps.db, sv, deps.jetzt).flatMap(({ seit, ...pruefung }): Eintrag[] =>
      pruefung.ergebnis === "rot" || pruefung.ergebnis === "gelb"
        ? [
            {
              art: "pruefung",
              schwere: SCHWERE_DER_PRUEFUNG[pruefung.ergebnis],
              server: { serverId: sv.serverId, name: sv.name },
              pruefung,
              seit,
            },
          ]
        : [],
    );
  });

/** Jobs whose failure has an entry of its own: a test restore's, a restore's event */
const EIGENER_EINTRAG: readonly string[] = [PRUEF_RESTORE_AKTION, WIEDERHERSTELLEN_AKTION];

const auftragsEintraege = (deps: UebersichtDeps, betreiberId: string): Eintrag[] => {
  const grenze = deps.jetzt - AUFTRAEGE_TAGE * 86_400_000;
  return auftraegeSeite(deps.db, betreiberId, { zustand: ["gescheitert"] }, undefined, HOECHSTENS)
    .eintraege.filter((a) => a.geaendertAm >= grenze && !EIGENER_EINTRAG.includes(a.aktion))
    .map((a) => ({
      art: "auftrag",
      schwere: "warnung",
      auftragId: a.auftragId,
      aktion: a.aktion,
      fehler: a.fehler,
      server: a.server,
      installation: a.installation && {
        ...a.installation,
        app: a.app,
        serverId: a.server.serverId,
      },
      seit: a.geaendertAm,
    }));
};

const SCHWERE_DES_EREIGNISSES: Record<string, Schwere> = { fehler: "stoerung", warn: "warnung" };

/** A fault's own event is left out: an open one is an entry of its own, a fixed one is past */
const ereignisEintraege = (deps: UebersichtDeps, betreiberId: string): Eintrag[] => {
  const grenze = deps.jetzt - EREIGNISSE_STUNDEN * 3_600_000;
  return ereignisseSeite(
    deps.db,
    betreiberId,
    { schwere: ["fehler", "warn"] },
    undefined,
    HOECHSTENS,
  )
    .eintraege.filter((e) => e.zeitpunkt >= grenze && e.art !== STOERUNG_ART)
    .map((e) => ({
      art: "ereignis",
      schwere: SCHWERE_DES_EREIGNISSES[e.schwere] ?? "hinweis",
      ereignisId: e.ereignisId,
      ereignisArt: e.art,
      ziel: e.ziel,
      text: e.text,
      seit: e.zeitpunkt,
    }));
};

export const uebersichtLesen = (deps: UebersichtDeps, betreiberId: string): MitVerweis[] =>
  ordnen([
    ...installationsEintraege(deps, betreiberId),
    ...agentEintraege(deps, betreiberId),
    ...pruefungsEintraege(deps, betreiberId),
    ...pruefRestoreEintraege(deps, betreiberId),
    ...auftragsEintraege(deps, betreiberId),
    ...ereignisEintraege(deps, betreiberId),
  ]);
