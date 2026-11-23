import { randomUUID } from "node:crypto";
import { PRUEF_RESTORE_AKTION } from "@steuerzentrale/manifest";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege, ereignisse, installationen } from "../../db/schema.ts";
import { schreiben } from "../audit/index.ts";
import type { Planer } from "../aufbewahrung/index.ts";
import type { Installation } from "../installationen/lesen.ts";
import { type PruefDeps, pruefRestoreAnlegen } from "./anlegen.ts";

/*
 * The schedule of test restores (BAULISTE.md Z-602; docs/plan.md, "Prüf-Restore (Z-602)"): every
 * hour each running installation of every operator whose backups are set up and which had no test
 * restore for 7 days gets one (pruefRestoreAnlegen decides the rest: a successful run, no open job of
 * the installation, none on its server, room for the copy there). Without room it gets the event
 * `pruef_restore_kein_platz` (severity `warn`) at most once a week and no job. Like the silent
 * server (modules/verbindung/stille.ts) the jobs and events themselves are the state, so a restart
 * of the Zentrale changes nothing.
 */

export const PRUEF_RESTORE_PRUEFUNG_MS = 60 * 60_000;
export const PRUEF_RESTORE_ABSTAND_MS = 7 * 24 * 60 * 60_000;
export const PRUEF_RESTORE_KEIN_PLATZ_ART = "pruef_restore_kein_platz";

export type ZeitplanDeps = PruefDeps & { neueId?: () => string };

const zielVon = (installationId: string) => `installation:${installationId}`;

/** Whether the installation had a test restore made less than a week ago, by whomever */
const kuerzlichGeprueft = (db: Db, i: Installation, jetzt: number): boolean =>
  db
    .select({ id: auftraege.auftragId })
    .from(auftraege)
    .where(
      and(
        eq(auftraege.betreiberId, i.betreiberId),
        eq(auftraege.installationId, i.installationId),
        eq(auftraege.aktion, PRUEF_RESTORE_AKTION),
        gt(auftraege.angelegtAm, jetzt - PRUEF_RESTORE_ABSTAND_MS),
      ),
    )
    .get() !== undefined;

const keinPlatzGemeldet = (db: Db, i: Installation, jetzt: number): boolean =>
  db
    .select({ id: ereignisse.ereignisId })
    .from(ereignisse)
    .where(
      and(
        eq(ereignisse.betreiberId, i.betreiberId),
        eq(ereignisse.art, PRUEF_RESTORE_KEIN_PLATZ_ART),
        eq(ereignisse.ziel, zielVon(i.installationId)),
        gt(ereignisse.zeitpunkt, jetzt - PRUEF_RESTORE_ABSTAND_MS),
      ),
    )
    .get() !== undefined;

const keinPlatzMelden = (deps: ZeitplanDeps, i: Installation, warum: string, jetzt: number) => {
  if (keinPlatzGemeldet(deps.db, i, jetzt)) return;
  const kontext = { betreiberId: i.betreiberId, akteur: "system", jetzt, grund: "Prüf-Restore" };
  schreiben(deps.schreibDb, kontext, "ereignis.pruef-restore-kein-platz", (w) =>
    w.einfuegen("ereignisse", {
      betreiberId: i.betreiberId,
      ereignisId: (deps.neueId ?? randomUUID)(),
      zeitpunkt: jetzt,
      art: PRUEF_RESTORE_KEIN_PLATZ_ART,
      schwere: "warn",
      ziel: zielVon(i.installationId),
      text: `Kein Platz für den Prüf-Restore von ${i.installationId} auf seinem Server: ${warum}`,
    }),
  );
};

export type Runde = { angelegt: number; keinPlatz: number };

/** One round of the schedule over every operator; returns what it made */
export const pruefRestorePlanen = (deps: ZeitplanDeps): Runde => {
  const jetzt = deps.now();
  const runde: Runde = { angelegt: 0, keinPlatz: 0 };
  const laufend = deps.db
    .select()
    .from(installationen)
    .where(eq(installationen.zustand, "laeuft"))
    .all();
  for (const i of laufend) {
    if (kuerzlichGeprueft(deps.db, i, jetzt)) continue;
    const kontext = {
      betreiberId: i.betreiberId,
      akteur: "system",
      jetzt,
      grund: "Prüf-Restore nach Zeitplan",
    };
    const r = pruefRestoreAnlegen(deps, kontext, i.installationId);
    if (r.ok) runde.angelegt += 1;
    else if (r.grund === "kein_platz") {
      const warum = r.gruende?.map((g) => g.code).join(", ") || r.detail || "passt nicht";
      keinPlatzMelden(deps, i, warum, jetzt);
      runde.keinPlatz += 1;
    } else if (r.grund === "keine_ports" || r.grund === "nicht_ausfuehrbar")
      deps.log(
        JSON.stringify({
          msg: "test restore not made",
          installationId: i.installationId,
          grund: r.grund,
          detail: r.detail,
        }),
      );
  }
  return runde;
};

/** Every hour, from now on */
export const pruefRestoreSchleife = (deps: ZeitplanDeps, planen: Planer): void => {
  planen(() => {
    try {
      const r = pruefRestorePlanen(deps);
      if (r.angelegt + r.keinPlatz > 0) deps.log(JSON.stringify({ msg: "test restores", ...r }));
    } catch (fehler) {
      deps.log(JSON.stringify({ msg: "test restore schedule failed", fehler: String(fehler) }));
    }
  }, PRUEF_RESTORE_PRUEFUNG_MS);
};
