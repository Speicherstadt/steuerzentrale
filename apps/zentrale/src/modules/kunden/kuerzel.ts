import { freiesKuerzel, kuerzelVorschlag } from "@steuerzentrale/manifest";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { installationen, kunden } from "../../db/schema.ts";

/*
 * A customer's short name (BAULISTE.md Z-407; docs/plan.md, "Adresse einer Installation"): unique
 * within the operator (and a unique index besides), suggested from the name when none is given,
 * changed only while no installation of the customer runs or is being set up, so the addresses of
 * running installations keep matching it.
 */

/** The states in which an installation holds its customer's short name */
const HAELT_KUERZEL = ["wird_eingerichtet", "laeuft"] as const;

/** Whether another customer of the operator has this short name */
export const kuerzelVergeben = (
  db: Db,
  betreiberId: string,
  kuerzel: string,
  ausser?: string,
): boolean =>
  db
    .select({ id: kunden.kundeId })
    .from(kunden)
    .where(
      and(
        eq(kunden.betreiberId, betreiberId),
        eq(kunden.kuerzel, kuerzel),
        ...(ausser === undefined ? [] : [ne(kunden.kundeId, ausser)]),
      ),
    )
    .get() !== undefined;

/** The short name a new customer gets: the one given, or a free one suggested from its name */
export const kuerzelFuerNeu = (db: Db, betreiberId: string, name: string): string =>
  freiesKuerzel(kuerzelVorschlag(name), (k) => kuerzelVergeben(db, betreiberId, k));

/** The operator's customers with an installation that runs or is being set up */
export const kundenMitFestemKuerzel = (db: Db, betreiberId: string): Set<string> =>
  new Set(
    db
      .selectDistinct({ kundeId: installationen.kundeId })
      .from(installationen)
      .where(
        and(
          eq(installationen.betreiberId, betreiberId),
          inArray(installationen.zustand, [...HAELT_KUERZEL]),
        ),
      )
      .all()
      .map((z) => z.kundeId),
  );
