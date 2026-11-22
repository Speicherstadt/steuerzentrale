import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { installationKonfigurationen } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import type { Schreiber } from "../audit/index.ts";
import { spalteEntschluesseln, spalteVerschluesseln } from "../geheim/spalten.ts";
import {
  type EinrichtungGelesen,
  einrichtungAus,
  type GeheimeEinstellungen,
  geheimVerschluesseln,
  type OffeneEinstellungen,
} from "./einrichtung.ts";
import { installationLesen } from "./lesen.ts";

/*
 * The values a job `installation_konfigurieren` asks for (BAULISTE.md Z-404; docs/plan.md, "Neu
 * konfigurieren"), kept apart from the installation's own until the job succeeded: the
 * installation's columns always hold what it runs with, the job's row in
 * `installation_konfigurationen` what it was asked to run with. The job is sent with the asked
 * values; once it succeeded they become the installation's, and the row goes at the job's end.
 */

type Deps = { db: Db; schluessel: Schluesselbund };

export type Konfiguration = typeof installationKonfigurationen.$inferSelect;

const lesen = (db: Db, betreiberId: string, auftragId: string): Konfiguration | undefined =>
  db
    .select()
    .from(installationKonfigurationen)
    .where(
      and(
        eq(installationKonfigurationen.betreiberId, betreiberId),
        eq(installationKonfigurationen.auftragId, auftragId),
      ),
    )
    .get();

/** The row of a new job's asked values, its secrets encrypted and bound to the job */
export const konfigurationZeile = (
  bund: Schluesselbund,
  ziel: { betreiberId: string; auftragId: string; installationId: string; jetzt: number },
  offen: OffeneEinstellungen,
  geheim: GeheimeEinstellungen,
): Konfiguration => ({
  betreiberId: ziel.betreiberId,
  auftragId: ziel.auftragId,
  installationId: ziel.installationId,
  einstellungen: JSON.stringify(offen),
  geheim: spalteVerschluesseln(
    bund,
    "installationKonfigurationen",
    ziel.betreiberId,
    { auftragId: ziel.auftragId },
    JSON.stringify(geheim),
  ),
  angelegtAm: ziel.jetzt,
});

const geheimLesen = (
  bund: Schluesselbund,
  k: Konfiguration,
): { ok: true; geheim: GeheimeEinstellungen } | { ok: false; grund: string } => {
  const klar = spalteEntschluesseln(
    bund,
    "installationKonfigurationen",
    k.betreiberId,
    k,
    k.geheim,
  );
  return klar.ok
    ? { ok: true, geheim: JSON.parse(klar.wert) as GeheimeEinstellungen }
    : { ok: false, grund: `the secrets of job ${k.auftragId}: ${klar.grund}` };
};

/** The data of a job `installation_konfigurieren`: the installation with the asked values */
export const konfigurationFuer = (
  deps: Deps,
  betreiberId: string,
  a: { auftragId: string; installationId: string | null },
): EinrichtungGelesen => {
  const k = lesen(deps.db, betreiberId, a.auftragId);
  if (!k) return { ok: false, grund: `no asked values for job ${a.auftragId}` };
  const i = installationLesen(deps.db, betreiberId, k.installationId);
  if (!i || k.installationId !== a.installationId)
    return { ok: false, grund: `no installation ${a.installationId}` };
  const g = geheimLesen(deps.schluessel, k);
  if (!g.ok) return g;
  return {
    ok: true,
    einrichtung: einrichtungAus({ ...i, einstellungen: k.einstellungen }, g.geheim),
  };
};

/**
 * At the end of a job `installation_konfigurieren`, within the change that records it: after
 * success its asked values become the installation's (the secrets encrypted anew, bound to the
 * installation's row); whatever the end, the job's row goes. A secret no key opens stops the change,
 * so the job's end is not recorded without its values.
 */
export const konfigurationAbschliessen = (
  w: Schreiber,
  deps: Deps,
  a: { betreiberId: string; auftragId: string },
  erfolgreich: boolean,
  jetzt: number,
): void => {
  const k = lesen(deps.db, a.betreiberId, a.auftragId);
  if (!k) return;
  if (erfolgreich) {
    const g = geheimLesen(deps.schluessel, k);
    if (!g.ok) throw new Error(g.grund);
    w.aendern(
      "installationen",
      { installationId: k.installationId },
      {
        einstellungen: k.einstellungen,
        geheim: geheimVerschluesseln(deps.schluessel, k.betreiberId, k.installationId, g.geheim),
        geaendertAm: jetzt,
      },
    );
  }
  w.loeschen("installationKonfigurationen", { auftragId: k.auftragId });
};
