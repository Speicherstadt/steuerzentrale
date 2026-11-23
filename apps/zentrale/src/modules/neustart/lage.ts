import { manifestPruefen, SERVER_NEUSTART_AKTION } from "@steuerzentrale/manifest";
import { type NeustartServer, neustartPruefen } from "@steuerzentrale/planung";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege } from "../../db/schema.ts";
import { backupEingerichtet } from "../backups/auftraege.ts";
import { type Installation, installationenAufServer } from "../installationen/lesen.ts";
import { type Server, serverFakten } from "../server/index.ts";
import { wartungsfensterLesen } from "../updates/plan.ts";
import { sperrzeitenAufServer, VON_DER_PLANUNG } from "./sperrzeiten.ts";

/*
 * Where a server stands for its reboot (BAULISTE.md Z-701; docs/plan.md, "Wann ein Server neu
 * startet"), read from its row, its newest facts, its installations and its jobs, for
 * packages/planung `neustartPruefen`: the same for the plan, the API and a reboot by hand.
 */

/** Whether the installation has data to back up before a reboot: running, with parts */
export const sichertTeile = (i: Installation): boolean => {
  if (i.zustand !== "laeuft") return false;
  const m = manifestPruefen(i.manifest);
  return m.ok && m.manifest.backup.length > 0;
};

/** The installations backed up before a reboot, and how many of those cannot be */
export const zuSichern = (db: Db, betreiberId: string, serverId: string) => {
  const alle = installationenAufServer(db, betreiberId, serverId).filter(sichertTeile);
  const bereit = alle.filter((i) => backupEingerichtet(db, betreiberId, i.installationId));
  return { bereit, ohneBackup: alle.length - bereit.length };
};

const auftraegeDesServers = (db: Db, betreiberId: string, serverId: string) =>
  db
    .select()
    .from(auftraege)
    .where(and(eq(auftraege.betreiberId, betreiberId), eq(auftraege.serverId, serverId)))
    .orderBy(desc(auftraege.angelegtAm))
    .all();

export type NeustartAuftrag = Pick<
  typeof auftraege.$inferSelect,
  "auftragId" | "zustand" | "angelegtVon" | "angelegtAm" | "geaendertAm" | "ergebnis"
>;

/** The newest reboot of the server, ended or not */
export const letzterNeustart = (
  db: Db,
  betreiberId: string,
  serverId: string,
): NeustartAuftrag | undefined =>
  auftraegeDesServers(db, betreiberId, serverId).find((a) => a.aktion === SERVER_NEUSTART_AKTION);

type Verbunden = (betreiberId: string, serverId: string) => boolean;

/** What packages/planung needs to know of one server */
export const neustartServer = (
  db: Db,
  verbunden: Verbunden,
  sv: Pick<Server, "betreiberId" | "serverId" | "wartungsfenster" | "fakten">,
): NeustartServer => {
  const { betreiberId, serverId } = sv;
  const f = serverFakten(sv);
  const jobs = auftraegeDesServers(db, betreiberId, serverId);
  const neustarts = jobs
    .filter((a) => a.aktion === SERVER_NEUSTART_AKTION && ENDZUSTAENDE.has(a.zustand))
    .map((a) => a.geaendertAm);
  return {
    neustartNoetig: f?.neustartNoetig ?? null,
    bootId: f?.bootId ?? null,
    wartungsfenster: wartungsfensterLesen(sv.wartungsfenster),
    sperrzeiten: sperrzeitenAufServer(db, betreiberId, serverId),
    verbunden: verbunden(betreiberId, serverId),
    offeneAuftraege: jobs.filter((a) => !ENDZUSTAENDE.has(a.zustand)).length,
    ohneBackup: zuSichern(db, betreiberId, serverId).ohneBackup,
    ...(neustarts.length > 0 ? { letzterNeustartAm: Math.max(...neustarts) } : {}),
  };
};

/**
 * A server's reboot as the API shows it: whether one is needed, what the plan decides now, and the
 * newest reboot job with why it did not succeed, if it did not
 */
export const neustartStand = (
  db: Db,
  verbunden: Verbunden,
  sv: Parameters<typeof neustartServer>[2],
  jetzt: number,
) => {
  const lage = neustartServer(db, verbunden, sv);
  const letzter = letzterNeustart(db, sv.betreiberId, sv.serverId);
  const ergebnis = letzter?.ergebnis ? (JSON.parse(letzter.ergebnis) as Record<string, unknown>) : {};
  return {
    noetig: lage.neustartNoetig,
    plan: neustartPruefen(lage, jetzt),
    letzter: letzter
      ? {
          auftragId: letzter.auftragId,
          zustand: letzter.zustand,
          vonHand: letzter.angelegtVon !== VON_DER_PLANUNG,
          angelegtAm: letzter.angelegtAm,
          geaendertAm: letzter.geaendertAm,
          fehler: typeof ergebnis.fehler === "string" ? ergebnis.fehler : null,
        }
      : null,
  };
};
