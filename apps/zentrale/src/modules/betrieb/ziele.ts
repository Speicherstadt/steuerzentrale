import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { installationen, kunden, server } from "../../db/schema.ts";

/*
 * The page an event's or audit entry's target has, with the name the lists show (BAULISTE.md
 * Z-406): an installation as "customer · app", a server and a customer by name. Targets are written
 * `art:id`: events name `installation:` and `server:` (modules/bewertung/lesen.ts), the audit log
 * the table (`installationen:`, `server:`, `kunden:`; modules/audit/schreiben.ts). Only the
 * operator's own rows are looked up.
 */

export type ZielVerweis = { art: "installation" | "server" | "kunde"; id: string; name: string };

const ARTEN: Record<string, ZielVerweis["art"]> = {
  installation: "installation",
  installationen: "installation",
  server: "server",
  kunden: "kunde",
};

const teilen = (ziel: string) => {
  const [vorne = "", ...rest] = ziel.split(":");
  return { art: ARTEN[vorne], id: rest.join(":") };
};

const idsDer = (ziele: string[], art: ZielVerweis["art"]) => [
  ...new Set(ziele.map(teilen).flatMap((z) => (z.art === art && z.id ? [z.id] : []))),
];

/** The names of the targets on a page, by target */
export const zielVerweise = (
  db: Db,
  betreiberId: string,
  ziele: string[],
): Map<string, ZielVerweis> => {
  const namen = new Map<string, string>();
  const inst = idsDer(ziele, "installation");
  const sv = idsDer(ziele, "server");
  const ku = idsDer(ziele, "kunde");
  if (inst.length)
    for (const z of db
      .select({ id: installationen.installationId, app: installationen.app, kunde: kunden.name })
      .from(installationen)
      .innerJoin(
        kunden,
        and(
          eq(kunden.betreiberId, installationen.betreiberId),
          eq(kunden.kundeId, installationen.kundeId),
        ),
      )
      .where(
        and(
          eq(installationen.betreiberId, betreiberId),
          inArray(installationen.installationId, inst),
        ),
      )
      .all())
      namen.set(`installation:${z.id}`, `${z.kunde} · ${z.app}`);
  if (sv.length)
    for (const z of db
      .select({ id: server.serverId, name: server.name })
      .from(server)
      .where(and(eq(server.betreiberId, betreiberId), inArray(server.serverId, sv)))
      .all())
      namen.set(`server:${z.id}`, z.name);
  if (ku.length)
    for (const z of db
      .select({ id: kunden.kundeId, name: kunden.name })
      .from(kunden)
      .where(and(eq(kunden.betreiberId, betreiberId), inArray(kunden.kundeId, ku)))
      .all())
      namen.set(`kunde:${z.id}`, z.name);
  return new Map(
    ziele.flatMap((ziel) => {
      const { art, id } = teilen(ziel);
      const name = art && namen.get(`${art}:${id}`);
      return art && name ? [[ziel, { art, id, name }] as const] : [];
    }),
  );
};
