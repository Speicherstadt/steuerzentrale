import { and, asc, eq, max } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { heartbeats, server } from "../../db/schema.ts";
import type { Server } from "./server.ts";

/** The operator's servers by name */
export const serverListe = (db: Db, betreiberId: string): Server[] =>
  db
    .select()
    .from(server)
    .where(eq(server.betreiberId, betreiberId))
    .orderBy(asc(server.name))
    .all();

/** The last heartbeat of each of the operator's servers (or of one), by server id */
export const letzteHeartbeats = (
  db: Db,
  betreiberId: string,
  serverId?: string,
): Map<string, number> =>
  new Map(
    db
      .select({ serverId: heartbeats.serverId, zeitpunkt: max(heartbeats.zeitpunkt) })
      .from(heartbeats)
      .where(
        and(
          eq(heartbeats.betreiberId, betreiberId),
          serverId === undefined ? undefined : eq(heartbeats.serverId, serverId),
        ),
      )
      .groupBy(heartbeats.serverId)
      .all()
      .flatMap((z) => (z.zeitpunkt === null ? [] : [[z.serverId, z.zeitpunkt] as const])),
  );
