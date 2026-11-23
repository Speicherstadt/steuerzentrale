import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import {
  type Leistungen,
  type LeistungsBackup,
  type LeistungsEingaben,
  leistungenImMonat,
  type Monat,
  monatsGrenzen,
  monatText,
} from "@steuerzentrale/planung";
import { and, asc, eq, gte, lt, min } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import {
  auftraege,
  backups,
  installationen,
  kunden,
  supportZugaenge,
  verfuegbarkeit,
  vertraege,
} from "../../db/schema.ts";
import { endeVon } from "../support/lesen.ts";

/*
 * The services of an operator's customers in a month (BAULISTE.md Z-804; docs/plan.md,
 * "Leistungen"): the rows of what happened in that month, always within one operator, summed by
 * the pure function in packages/planung.
 */

type Grenzen = { von: number; bis: number };

/** Customers by name with their contract; one without a contract row from when it was made */
const kundenLesen = (db: Db, betreiberId: string) =>
  db
    .select({
      kundeId: kunden.kundeId,
      name: kunden.name,
      kuerzel: kunden.kuerzel,
      intern: kunden.intern,
      angelegtAm: kunden.angelegtAm,
      beginn: vertraege.beginn,
      ende: vertraege.ende,
    })
    .from(kunden)
    .leftJoin(
      vertraege,
      and(eq(vertraege.betreiberId, kunden.betreiberId), eq(vertraege.kundeId, kunden.kundeId)),
    )
    .where(eq(kunden.betreiberId, betreiberId))
    .orderBy(asc(kunden.name), asc(kunden.kundeId))
    .all();

/** Installations whose setup job succeeded, since the end of that job */
const laufendeLesen = (db: Db, betreiberId: string) =>
  db
    .select({
      installationId: installationen.installationId,
      kundeId: installationen.kundeId,
      app: installationen.app,
      laeuftSeit: min(auftraege.geaendertAm),
    })
    .from(installationen)
    .innerJoin(
      auftraege,
      and(
        eq(auftraege.betreiberId, installationen.betreiberId),
        eq(auftraege.installationId, installationen.installationId),
        eq(auftraege.aktion, EINRICHTUNG_AKTIONEN.einrichten),
        eq(auftraege.zustand, "erfolgreich"),
      ),
    )
    .where(eq(installationen.betreiberId, betreiberId))
    .groupBy(installationen.installationId, installationen.kundeId, installationen.app)
    .orderBy(asc(installationen.installationId))
    .all()
    .flatMap((i) => (i.laeuftSeit === null ? [] : [{ ...i, laeuftSeit: i.laeuftSeit }]));

const scheibenLesen = (db: Db, betreiberId: string, g: Grenzen) =>
  db
    .select({
      installationId: verfuegbarkeit.installationId,
      stunde: verfuegbarkeit.stunde,
      gemessen: verfuegbarkeit.gemessen,
      rot: verfuegbarkeit.rot,
    })
    .from(verfuegbarkeit)
    .where(
      and(
        eq(verfuegbarkeit.betreiberId, betreiberId),
        gte(verfuegbarkeit.stunde, g.von),
        lt(verfuegbarkeit.stunde, g.bis),
      ),
    )
    .all();

const backupsLesen = (db: Db, betreiberId: string, g: Grenzen): LeistungsBackup[] =>
  db
    .select({
      installationId: backups.installationId,
      zeitpunkt: backups.zeitpunkt,
      ok: backups.ok,
      teile: backups.teile,
    })
    .from(backups)
    .where(
      and(
        eq(backups.betreiberId, betreiberId),
        eq(backups.ok, true),
        gte(backups.zeitpunkt, g.von),
        lt(backups.zeitpunkt, g.bis),
      ),
    )
    .all()
    .map((b) => ({ ...b, teile: JSON.parse(b.teile) as LeistungsBackup["teile"] }));

const zugaengeLesen = (db: Db, betreiberId: string, g: Grenzen) =>
  db
    .select({ zugang: supportZugaenge, kundeId: installationen.kundeId })
    .from(supportZugaenge)
    .innerJoin(
      installationen,
      and(
        eq(installationen.betreiberId, supportZugaenge.betreiberId),
        eq(installationen.installationId, supportZugaenge.installationId),
      ),
    )
    .where(
      and(
        eq(supportZugaenge.betreiberId, betreiberId),
        gte(supportZugaenge.beginn, g.von),
        lt(supportZugaenge.beginn, g.bis),
      ),
    )
    .all()
    .map((z) => ({ kundeId: z.kundeId, beginn: z.zugang.beginn, endetAm: endeVon(z.zugang) }));

export const leistungenLesen = (
  db: Db,
  betreiberId: string,
  monat: Monat,
  jetzt: number,
): Leistungen => {
  const g = monatsGrenzen(monat);
  const gelesen = kundenLesen(db, betreiberId);
  const eingaben: LeistungsEingaben = {
    kunden: gelesen.map((k) => ({
      kundeId: k.kundeId,
      intern: k.intern,
      vertragBeginn: k.beginn ?? k.angelegtAm,
      vertragEnde: k.ende ?? null,
    })),
    installationen: laufendeLesen(db, betreiberId),
    scheiben: scheibenLesen(db, betreiberId, g),
    backups: backupsLesen(db, betreiberId, g),
    zugaenge: zugaengeLesen(db, betreiberId, g),
  };
  const namen = new Map(gelesen.map((k) => [k.kundeId, k]));
  return {
    monat: monatText(monat),
    kunden: leistungenImMonat(eingaben, monat, jetzt).map((l) => ({
      ...l,
      name: namen.get(l.kundeId)?.name ?? l.kundeId,
      kuerzel: namen.get(l.kundeId)?.kuerzel ?? "",
    })),
  };
};
