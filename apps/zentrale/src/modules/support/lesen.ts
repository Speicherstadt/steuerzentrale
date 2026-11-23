import { AKTIONS_AUFTRAEGE } from "@steuerzentrale/manifest";
import { and, desc, eq, gt, inArray, isNull, lte, type SQL } from "drizzle-orm";
import { user } from "../../db/auth-schema.ts";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege, installationen, supportZugaenge } from "../../db/schema.ts";

/*
 * Reading support accesses (BAULISTE.md Z-802; docs/plan.md, "Support-Zugang"), always within one
 * operator. Whether an access runs is decided against the instant asked for, never remembered: the
 * guard of every route it opens asks `aktiverZugang` with the request's clock.
 */

export type Zeile = typeof supportZugaenge.$inferSelect;

/** What an access allows besides reading: the built-in jobs of a log excerpt and a restart */
export type ZugangsAktion = keyof typeof AKTIONS_AUFTRAEGE;

export type SupportZugang = Omit<Zeile, "betreiberId" | "nutzerId" | "endeGemeldetAm"> & {
  kundeId: string;
  nutzer: { id: string; name: string };
  /** When it ended or ends: the earlier of its planned end and an early end */
  endetAm: number;
  aktiv: boolean;
  /** What its holder did on the installation during it, each once, in the order of the jobs */
  aktionen: ZugangsAktion[];
};

/** Most accesses a list names; the newest first */
export const LISTE_HOECHSTENS = 200;

export const endeVon = (z: Pick<Zeile, "ende" | "beendetAm">): number =>
  z.beendetAm === null ? z.ende : Math.min(z.ende, z.beendetAm);

export const laeuft = (z: Pick<Zeile, "beginn" | "ende" | "beendetAm">, jetzt: number): boolean =>
  z.beginn <= jetzt && jetzt < endeVon(z);

/** The access of the member to the installation that runs at `jetzt`, if any */
export const aktiverZugang = (
  db: Db,
  betreiberId: string,
  nutzerId: string,
  installationId: string,
  jetzt: number,
): Zeile | undefined =>
  db
    .select()
    .from(supportZugaenge)
    .where(
      and(
        eq(supportZugaenge.betreiberId, betreiberId),
        eq(supportZugaenge.nutzerId, nutzerId),
        eq(supportZugaenge.installationId, installationId),
        isNull(supportZugaenge.beendetAm),
        lte(supportZugaenge.beginn, jetzt),
        gt(supportZugaenge.ende, jetzt),
      ),
    )
    .get();

export const zugangLesen = (db: Db, betreiberId: string, zugangId: string): Zeile | undefined =>
  db
    .select()
    .from(supportZugaenge)
    .where(
      and(eq(supportZugaenge.betreiberId, betreiberId), eq(supportZugaenge.zugangId, zugangId)),
    )
    .get();

/** The name of a member's account, for events and lists */
export const nameVon = (db: Db, nutzerId: string): string =>
  db.select({ name: user.name }).from(user).where(eq(user.id, nutzerId)).get()?.name ?? nutzerId;

const AKTION_ZU_JOB = Object.entries(AKTIONS_AUFTRAEGE) as [ZugangsAktion, string][];

/** The actions each access's holder took on its installation during it, by access */
const aktionenWaehrend = (
  db: Db,
  betreiberId: string,
  zeilen: Zeile[],
): Map<string, ZugangsAktion[]> => {
  const ids = [...new Set(zeilen.map((z) => z.installationId))];
  const jobs =
    ids.length === 0
      ? []
      : db
          .select({
            installationId: auftraege.installationId,
            aktion: auftraege.aktion,
            angelegtVon: auftraege.angelegtVon,
            angelegtAm: auftraege.angelegtAm,
          })
          .from(auftraege)
          .where(
            and(
              eq(auftraege.betreiberId, betreiberId),
              inArray(auftraege.installationId, ids),
              inArray(
                auftraege.aktion,
                AKTION_ZU_JOB.map(([, job]) => job),
              ),
            ),
          )
          .orderBy(auftraege.angelegtAm)
          .all();
  return new Map(
    zeilen.map((z) => {
      const getan = jobs
        .filter(
          (j) =>
            j.installationId === z.installationId &&
            j.angelegtVon === z.nutzerId &&
            j.angelegtAm >= z.beginn &&
            j.angelegtAm < endeVon(z),
        )
        .map((j) => AKTION_ZU_JOB.find(([, job]) => job === j.aktion)?.[0])
        .filter((a): a is ZugangsAktion => a !== undefined);
      return [z.zugangId, [...new Set(getan)]];
    }),
  );
};

export type ListenFilter = {
  kundeId?: string | undefined;
  installationId?: string | undefined;
  zugangId?: string | undefined;
};

/** The operator's accesses, newest first, at most LISTE_HOECHSTENS */
export const zugaengeListe = (
  db: Db,
  betreiberId: string,
  filter: ListenFilter,
  jetzt: number,
): SupportZugang[] => {
  const bedingungen: (SQL | undefined)[] = [
    eq(supportZugaenge.betreiberId, betreiberId),
    filter.installationId === undefined
      ? undefined
      : eq(supportZugaenge.installationId, filter.installationId),
    filter.kundeId === undefined ? undefined : eq(installationen.kundeId, filter.kundeId),
    filter.zugangId === undefined ? undefined : eq(supportZugaenge.zugangId, filter.zugangId),
  ];
  const gefunden = db
    .select({ zugang: supportZugaenge, kundeId: installationen.kundeId, name: user.name })
    .from(supportZugaenge)
    .innerJoin(
      installationen,
      and(
        eq(installationen.betreiberId, supportZugaenge.betreiberId),
        eq(installationen.installationId, supportZugaenge.installationId),
      ),
    )
    .leftJoin(user, eq(user.id, supportZugaenge.nutzerId))
    .where(and(...bedingungen))
    .orderBy(desc(supportZugaenge.beginn), desc(supportZugaenge.zugangId))
    .limit(LISTE_HOECHSTENS)
    .all();
  const aktionen = aktionenWaehrend(
    db,
    betreiberId,
    gefunden.map((g) => g.zugang),
  );
  return gefunden.map((g) => ansicht(g.zugang, g.kundeId, g.name, aktionen, jetzt));
};

const ansicht = (
  z: Zeile,
  kundeId: string,
  name: string | null,
  aktionen: Map<string, ZugangsAktion[]>,
  jetzt: number,
): SupportZugang => {
  const { betreiberId: _b, nutzerId, endeGemeldetAm: _e, ...rest } = z;
  return {
    ...rest,
    kundeId,
    nutzer: { id: nutzerId, name: name ?? nutzerId },
    endetAm: endeVon(z),
    aktiv: laeuft(z, jetzt),
    aktionen: aktionen.get(z.zugangId) ?? [],
  };
};

/** One access as the list shows it */
export const zugangAnsicht = (
  db: Db,
  betreiberId: string,
  zugangId: string,
  jetzt: number,
): SupportZugang | undefined => zugaengeListe(db, betreiberId, { zugangId }, jetzt)[0];
