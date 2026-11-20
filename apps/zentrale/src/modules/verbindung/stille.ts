import { randomUUID } from "node:crypto";
import { and, eq, gte, isNotNull, isNull, max } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { ereignisse, heartbeats, server } from "../../db/schema.ts";
import { schreiben } from "../audit/index.ts";
import type { Planer } from "../aufbewahrung/index.ts";

/*
 * A silent server (BAULISTE.md Z-303): three minutes without a heartbeat make an event, once per
 * silence. Whether one was made already the events themselves tell: an event of this server newer
 * than the start of its silence. When heartbeats come back, the next silence starts later and gets
 * its own. A Zentrale that was down itself does not blame the servers for it: the silence counts at
 * the earliest from the start of the check.
 */
export const STILL_EREIGNIS_MS = 3 * 60_000;
export const STILL_ART = "server_still";
export const STILL_PRUEFUNG_MS = 30_000;

const ziel = (serverId: string) => `server:${serverId}`;

/** The last heartbeat of every server, keyed by operator and server */
const letzteHeartbeats = (db: Db): Map<string, number> =>
  new Map(
    db
      .select({
        betreiberId: heartbeats.betreiberId,
        serverId: heartbeats.serverId,
        zeitpunkt: max(heartbeats.zeitpunkt),
      })
      .from(heartbeats)
      .groupBy(heartbeats.betreiberId, heartbeats.serverId)
      .all()
      .map((z) => [`${z.betreiberId}\u0000${z.serverId}`, z.zeitpunkt ?? 0]),
  );

const schonGemeldet = (db: Db, betreiberId: string, serverId: string, seit: number): boolean =>
  db
    .select({ id: ereignisse.ereignisId })
    .from(ereignisse)
    .where(
      and(
        eq(ereignisse.betreiberId, betreiberId),
        eq(ereignisse.art, STILL_ART),
        eq(ereignisse.ziel, ziel(serverId)),
        gte(ereignisse.zeitpunkt, seit),
      ),
    )
    .get() !== undefined;

/** Makes the event for every joined, unrevoked server silent for three minutes; returns how many */
export const stilleServerMelden = (
  db: Db,
  schreibDb: SchreibDb,
  jetzt: number,
  gestartetAm: number,
  neueId: () => string = randomUUID,
): number => {
  const letzte = letzteHeartbeats(db);
  const kandidaten = db
    .select()
    .from(server)
    .where(and(isNotNull(server.beigetretenAm), isNull(server.gesperrtAm)))
    .all();
  let gemeldet = 0;
  for (const sv of kandidaten) {
    const letzter = letzte.get(`${sv.betreiberId}\u0000${sv.serverId}`) ?? 0;
    const seit = Math.max(letzter, sv.beigetretenAm ?? 0, gestartetAm);
    if (jetzt - seit < STILL_EREIGNIS_MS || schonGemeldet(db, sv.betreiberId, sv.serverId, seit))
      continue;
    const minuten = Math.floor((jetzt - seit) / 60_000);
    const kontext = { betreiberId: sv.betreiberId, akteur: "system", jetzt, grund: "Server still" };
    schreiben(schreibDb, kontext, "ereignis.server-still", (s) =>
      s.einfuegen("ereignisse", {
        betreiberId: sv.betreiberId,
        ereignisId: neueId(),
        zeitpunkt: jetzt,
        art: STILL_ART,
        schwere: "warn",
        ziel: ziel(sv.serverId),
        text: `Agent von ${sv.name} seit ${minuten} Min. still; kein Heartbeat`,
      }),
    );
    gemeldet += 1;
  }
  return gemeldet;
};

/** Checks every 30 seconds, from now on */
export const stilleSchleife = (
  db: Db,
  schreibDb: SchreibDb,
  jetzt: () => number,
  planen: Planer,
  log: (zeile: string) => void,
): void => {
  const gestartetAm = jetzt();
  planen(() => {
    try {
      const gemeldet = stilleServerMelden(db, schreibDb, jetzt(), gestartetAm);
      if (gemeldet > 0) log(JSON.stringify({ msg: "silent servers", gemeldet }));
    } catch (fehler) {
      log(JSON.stringify({ msg: "silence check failed", fehler: String(fehler) }));
    }
  }, STILL_PRUEFUNG_MS);
};
