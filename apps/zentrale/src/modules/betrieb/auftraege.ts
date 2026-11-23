import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege, installationen, kunden, server } from "../../db/schema.ts";
import { einer, nachMarke } from "./ereignisse.ts";
import { type Marke, type Seite, seiteBilden } from "./seite.ts";

/*
 * The operator's jobs page by page (BAULISTE.md Z-406), newest first, with the names the list
 * shows: server, and for a job of an installation its customer and host. Never the manifest's text,
 * its signature or the arguments (a setup's settings stand there).
 */

export type AuftragFilter = { zustand?: string[]; serverId?: string[]; installationId?: string[] };

export type AuftragZeile = {
  auftragId: string;
  aktion: string;
  app: string;
  version: string;
  zustand: string;
  fortschritt: string | null;
  fehler: string | null;
  server: { serverId: string; name: string };
  installation: { installationId: string; host: string; kunde: string } | null;
  angelegtVon: string;
  angelegtAm: number;
  geaendertAm: number;
};

/** The reason of a failed job from its result, else null */
export const fehlerVon = (ergebnis: string | null): string | null => {
  if (!ergebnis) return null;
  const e = JSON.parse(ergebnis) as { ok?: boolean; fehler?: string };
  return e.ok === false ? (e.fehler ?? null) : null;
};

export const auftraegeSeite = (
  db: Db,
  betreiberId: string,
  filter: AuftragFilter,
  marke: Marke | undefined,
  groesse: number,
): Seite<AuftragZeile> =>
  seiteBilden(
    db
      .select({
        a: auftraege,
        serverName: server.name,
        host: installationen.host,
        kunde: kunden.name,
      })
      .from(auftraege)
      .innerJoin(
        server,
        and(eq(server.betreiberId, auftraege.betreiberId), eq(server.serverId, auftraege.serverId)),
      )
      .leftJoin(
        installationen,
        and(
          eq(installationen.betreiberId, auftraege.betreiberId),
          eq(installationen.installationId, auftraege.installationId),
        ),
      )
      .leftJoin(
        kunden,
        and(
          eq(kunden.betreiberId, installationen.betreiberId),
          eq(kunden.kundeId, installationen.kundeId),
        ),
      )
      .where(
        and(
          eq(auftraege.betreiberId, betreiberId),
          einer(auftraege.zustand, filter.zustand),
          einer(auftraege.serverId, filter.serverId),
          einer(auftraege.installationId, filter.installationId),
          nachMarke(auftraege.angelegtAm, auftraege.auftragId, marke),
        ),
      )
      .orderBy(desc(auftraege.angelegtAm), desc(auftraege.auftragId))
      .limit(groesse + 1)
      .all(),
    groesse,
    (z) => ({ wert: z.a.angelegtAm, id: z.a.auftragId }),
    (z): AuftragZeile => ({
      auftragId: z.a.auftragId,
      aktion: z.a.aktion,
      app: z.a.app,
      version: z.a.version,
      zustand: z.a.zustand,
      fortschritt: z.a.fortschritt,
      fehler: fehlerVon(z.a.ergebnis),
      server: { serverId: z.a.serverId, name: z.serverName },
      installation:
        z.a.installationId && z.host !== null
          ? { installationId: z.a.installationId, host: z.host, kunde: z.kunde ?? "" }
          : null,
      angelegtVon: z.a.angelegtVon,
      angelegtAm: z.a.angelegtAm,
      geaendertAm: z.a.geaendertAm,
    }),
  );
