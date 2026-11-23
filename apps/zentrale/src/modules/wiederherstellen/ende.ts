import { wiederherstellenDatenLesen } from "@steuerzentrale/manifest";
import {
  type AuftragZustand,
  ENDZUSTAENDE,
  type NachrichtVomAgenten,
} from "@steuerzentrale/protokoll";
import { and, eq, or } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { wiederherstellungen } from "../../db/schema.ts";
import type { Schreiber } from "../audit/index.ts";
import type { Auftrag } from "../auftraege/lesen.ts";

/*
 * The end of a restore (BAULISTE.md Z-603; docs/plan.md, "Wiederherstellen (Z-603)"), within the
 * transaction that records a job's end (modules/auftraege/melden.ts): when the backup of the
 * current state fails or is cancelled, the restore is cancelled with it (abhaengigkeiten.ts) and
 * counts as failed; when the restore itself ends, its row gets the result (the parts as the agent
 * restored them, the duration it measured). A failed one makes the event
 * `wiederherstellen_gescheitert` (severity `fehler`), a good one `wiederherstellen_gelungen`
 * (severity `info`), so it stands in the installation's events; the change of the row stands in
 * the audit log.
 */

export const WIEDERHERSTELLEN_GESCHEITERT_ART = "wiederherstellen_gescheitert";
export const WIEDERHERSTELLEN_GELUNGEN_ART = "wiederherstellen_gelungen";

type Ergebnis = Extract<NachrichtVomAgenten, { typ: "ergebnis" }>["ergebnis"];
type Zeile = typeof wiederherstellungen.$inferSelect;

/** The restore this job belongs to, as its backup or as the restore itself */
const vorgangZu = (db: Db, betreiberId: string, auftragId: string): Zeile | undefined =>
  db
    .select()
    .from(wiederherstellungen)
    .where(
      and(
        eq(wiederherstellungen.betreiberId, betreiberId),
        or(
          eq(wiederherstellungen.auftragId, auftragId),
          eq(wiederherstellungen.backupAuftragId, auftragId),
        ),
      ),
    )
    .get();

const grundVon = (zustand: AuftragZustand, ergebnis: Ergebnis | undefined): string =>
  ergebnis && !ergebnis.ok ? ergebnis.fehler : `Auftrag ${zustand}`;

/** The run's time as the event names it: UTC to the minute */
const stand = (zeitpunkt: number) => `${new Date(zeitpunkt).toISOString().slice(0, 16)} UTC`;

type Ende = { ok: boolean; fehler: string | null; ergebnis: Ergebnis | undefined };

/** What the job's end means for the restore, or undefined while it goes on */
const endeVon = (
  z: Zeile,
  auftragId: string,
  zustand: AuftragZustand,
  ergebnis: Ergebnis | undefined,
): Ende | undefined => {
  if (z.backupAuftragId === auftragId) {
    if (zustand === "erfolgreich") return undefined;
    const fehler = `Backup vom Ist-Zustand gescheitert: ${grundVon(zustand, ergebnis)}`;
    return { ok: false, fehler, ergebnis: undefined };
  }
  const ok = zustand === "erfolgreich";
  return { ok, fehler: ok ? null : grundVon(zustand, ergebnis), ergebnis };
};

export const wiederherstellenFortschreiben = (
  w: Schreiber,
  db: Db,
  a: Pick<Auftrag, "betreiberId" | "auftragId">,
  zustand: AuftragZustand,
  ergebnis: Ergebnis | undefined,
  jetzt: number,
): void => {
  if (!ENDZUSTAENDE.has(zustand)) return;
  const z = vorgangZu(db, a.betreiberId, a.auftragId);
  if (!z || z.endeAm !== null) return;
  const ende = endeVon(z, a.auftragId, zustand, ergebnis);
  if (!ende) return;
  const daten = wiederherstellenDatenLesen(ende.ergebnis?.ok ? ende.ergebnis.daten : undefined);
  w.aendern(
    "wiederherstellungen",
    { auftragId: z.auftragId },
    {
      endeAm: jetzt,
      ok: ende.ok,
      fehler: ende.fehler,
      teile: JSON.stringify(daten.teile),
      dauerMs: daten.dauerMs,
    },
  );
  w.einfuegen("ereignisse", {
    betreiberId: z.betreiberId,
    ereignisId: `wiederherstellen-${z.auftragId}`,
    zeitpunkt: jetzt,
    art: ende.ok ? WIEDERHERSTELLEN_GELUNGEN_ART : WIEDERHERSTELLEN_GESCHEITERT_ART,
    schwere: ende.ok ? "info" : "fehler",
    ziel: `installation:${z.installationId}`,
    text: ende.ok
      ? `Wiederherstellen von ${z.installationId} gelungen: Stand ${stand(z.laufZeitpunkt)}`
      : `Wiederherstellen von ${z.installationId} gescheitert: ${ende.fehler}`,
  });
};
