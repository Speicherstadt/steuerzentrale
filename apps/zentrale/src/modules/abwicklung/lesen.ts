import { fristen, type Vertragsphase, vertragsphase } from "@steuerzentrale/planung";
import { and, eq, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/oeffnen.ts";
import { abwicklungen, installationen, kunden, vertraege } from "../../db/schema.ts";

/*
 * Reading what follows the end of a contract (BAULISTE.md Z-604; docs/plan.md, "Kündigung und
 * Löschung"): the rows of `abwicklungen`, always within one operator for a person, across operators
 * only for the loop, and the view the interface shows.
 */

export type Abwicklung = typeof abwicklungen.$inferSelect;

export const ArchivObjekt = z.object({
  tag: z.string().min(1).max(200),
  datei: z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/),
  bytes: z.number().int().nonnegative(),
});
export type ArchivObjekt = z.output<typeof ArchivObjekt>;

const Archiv = z.object({ am: z.number().int(), objekte: z.array(ArchivObjekt).max(100) });
export type Archiv = z.output<typeof Archiv>;

/** What the agent reports in `daten` of a successful `installation_archiv` */
export const ArchivDaten = z.object({ objekte: z.array(ArchivObjekt).min(1).max(100) });

export type Eintrag = { schritt: string; zeitpunkt: number; detail: string };

export const archivVon = (a: Pick<Abwicklung, "archiv">): Archiv | null => {
  if (a.archiv === null) return null;
  const g = Archiv.safeParse(JSON.parse(a.archiv));
  return g.success ? g.data : null;
};

export const protokollVon = (a: Pick<Abwicklung, "protokoll">): Eintrag[] =>
  JSON.parse(a.protokoll) as Eintrag[];

export const abwicklungLesen = (db: Db, betreiberId: string, installationId: string) =>
  db
    .select()
    .from(abwicklungen)
    .where(
      and(
        eq(abwicklungen.betreiberId, betreiberId),
        eq(abwicklungen.installationId, installationId),
      ),
    )
    .get();

/** The rows of one customer */
export const abwicklungenDesKunden = (db: Db, betreiberId: string, kundeId: string) =>
  db
    .select()
    .from(abwicklungen)
    .where(and(eq(abwicklungen.betreiberId, betreiberId), eq(abwicklungen.kundeId, kundeId)))
    .all();

/** Every row not yet done, of every operator (the loop) */
export const offeneAbwicklungen = (db: Db): Abwicklung[] =>
  db.select().from(abwicklungen).where(ne(abwicklungen.schritt, "geloescht")).all();

/** The end of the installation's customer's contract, or null */
export const vertragsendeVon = (db: Db, betreiberId: string, kundeId: string): number | null =>
  db
    .select({ ende: vertraege.ende })
    .from(vertraege)
    .where(and(eq(vertraege.betreiberId, betreiberId), eq(vertraege.kundeId, kundeId)))
    .get()?.ende ?? null;

export type Beendet = {
  betreiberId: string;
  installationId: string;
  kundeId: string;
  ende: number;
};

/**
 * The running installations, of every operator, whose customer's contract ended by `jetzt` and
 * that have no row yet; an internal customer has no notice (docs/kunden.md)
 */
export const beendeteOhneAbwicklung = (db: Db, jetzt: number): Beendet[] => {
  const kandidaten = db
    .select({
      betreiberId: installationen.betreiberId,
      installationId: installationen.installationId,
      kundeId: installationen.kundeId,
      ende: vertraege.ende,
    })
    .from(installationen)
    .innerJoin(
      vertraege,
      and(
        eq(vertraege.betreiberId, installationen.betreiberId),
        eq(vertraege.kundeId, installationen.kundeId),
      ),
    )
    .innerJoin(
      kunden,
      and(
        eq(kunden.betreiberId, installationen.betreiberId),
        eq(kunden.kundeId, installationen.kundeId),
      ),
    )
    .where(
      and(
        eq(installationen.zustand, "laeuft"),
        eq(kunden.intern, false),
        isNotNull(vertraege.ende),
        lte(vertraege.ende, jetzt),
      ),
    )
    .all();
  if (kandidaten.length === 0) return [];
  const da = new Set(
    db
      .select({ b: abwicklungen.betreiberId, i: abwicklungen.installationId })
      .from(abwicklungen)
      .where(
        inArray(
          abwicklungen.installationId,
          kandidaten.map((k) => k.installationId),
        ),
      )
      .all()
      .map((r) => `${r.b}/${r.i}`),
  );
  return kandidaten
    .filter((k) => !da.has(`${k.betreiberId}/${k.installationId}`))
    .map((k) => ({ ...k, ende: k.ende as number }));
};

/** What the interface shows of an installation after its contract (GET …/abwicklung) */
export type AbwicklungAnsicht = {
  phase: Vertragsphase;
  vertragsende: number | null;
  nurLesenBis: number | null;
  loeschenAb: number | null;
  schritt: Abwicklung["schritt"] | null;
  archiv: Archiv | null;
  linkBis: number | null;
  geloeschtAm: number | null;
  protokoll: Eintrag[];
};

export const abwicklungAnsicht = (
  db: Db,
  betreiberId: string,
  i: { installationId: string; kundeId: string },
  jetzt: number,
): AbwicklungAnsicht => {
  const ende = vertragsendeVon(db, betreiberId, i.kundeId);
  const a = abwicklungLesen(db, betreiberId, i.installationId);
  const f = ende === null ? null : fristen(ende);
  return {
    phase: a?.schritt === "geloescht" ? "loeschen" : vertragsphase(ende, jetzt),
    vertragsende: ende,
    nurLesenBis: f?.nurLesenBis ?? null,
    loeschenAb: f?.loeschenAb ?? null,
    schritt: a?.schritt ?? null,
    archiv: a ? archivVon(a) : null,
    linkBis: a?.linkBis ?? null,
    geloeschtAm: a?.geloeschtAm ?? null,
    protokoll: a ? protokollVon(a) : [],
  };
};
