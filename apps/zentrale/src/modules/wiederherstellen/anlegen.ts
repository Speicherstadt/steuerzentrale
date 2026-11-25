import {
  BACKUP_AKTIONEN,
  manifestPruefen,
  WIEDERHERSTELLEN_AKTION,
  wiederherstellenArgumente,
} from "@steuerzentrale/manifest";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { backups } from "../../db/schema.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { auftragEinfuegen, auftragVorbereiten, type Vorbereitet } from "../auftraege/anlegen.ts";
import { type Auftrag, auftragLesen } from "../auftraege/lesen.ts";
import { type AuftragDeps, zustellen } from "../auftraege/zustellen.ts";
import { backupAuftragVorbereiten, backupEingerichtet } from "../backups/auftraege.ts";
import {
  auftraegeDerInstallation,
  type Installation,
  installationLesen,
} from "../installationen/lesen.ts";

/*
 * Making a restore (BAULISTE.md Z-603; docs/plan.md, "Wiederherstellen (Z-603)"), with a reason,
 * by the owner: only for a running installation whose backups are set up and that has no
 * open job, from a successful run of this installation and operator. Two jobs in one change of the
 * audit log: `installation_backup` keeps the current state first, so a wrong choice can be undone;
 * `installation_wiederherstellen` with the run's snapshot of each part waits for it and is
 * cancelled when it fails (modules/auftraege, abhaengigkeiten.ts). A row of `wiederherstellungen`
 * ties both to the chosen run. A freeze window does not hold it back: it is a repair asked for,
 * not an update.
 */

export type WiederherstellenFehler =
  | "keine_installation"
  | "laeuft_nicht"
  | "nicht_eingerichtet"
  | "auftrag_offen"
  | "lauf_unbekannt"
  | "lauf_gescheitert"
  | "nicht_ausfuehrbar";

export type WiederherstellenAngelegt =
  | { ok: true; backup: Auftrag; wiederherstellen: Auftrag }
  | { ok: false; grund: WiederherstellenFehler; detail?: string };

type Fehler = Extract<WiederherstellenAngelegt, { ok: false }>;

type Lauf = typeof backups.$inferSelect;

/** The run of this installation within the operator; one of any other is unknown here */
const laufLesen = (db: Db, i: Installation, backupId: string): Lauf | undefined =>
  db
    .select()
    .from(backups)
    .where(
      and(
        eq(backups.betreiberId, i.betreiberId),
        eq(backups.installationId, i.installationId),
        eq(backups.backupId, backupId),
      ),
    )
    .get();

/** Why the installation cannot be restored now, before its run is looked at */
const gesperrt = (db: Db, i: Installation | undefined): Fehler | undefined => {
  if (!i) return { ok: false, grund: "keine_installation" };
  if (i.zustand !== "laeuft") return { ok: false, grund: "laeuft_nicht" };
  if (!backupEingerichtet(db, i.betreiberId, i.installationId))
    return { ok: false, grund: "nicht_eingerichtet" };
  const offen = auftraegeDerInstallation(db, i.betreiberId, i.installationId).some(
    (a) => !ENDZUSTAENDE.has(a.zustand),
  );
  return offen ? { ok: false, grund: "auftrag_offen" } : undefined;
};

const nichtAusfuehrbar = (detail: string): Fehler => ({
  ok: false,
  grund: "nicht_ausfuehrbar",
  detail,
});

type Bereit = Extract<Vorbereitet, { ok: true }>;

const vorbereitetOderFehler = (v: Vorbereitet): Bereit | Fehler =>
  v.ok ? v : nichtAusfuehrbar(v.detail ?? v.grund);

/** The restore's job with the run's snapshot of each part, waiting for the backup */
const wiederherstellenVorbereiten = (
  deps: AuftragDeps,
  kontext: Kontext,
  i: Installation,
  lauf: Lauf,
  backup: Auftrag,
): Bereit | Fehler => {
  const m = manifestPruefen(i.manifest);
  if (!m.ok) return nichtAusfuehrbar("manifest_ungueltig");
  const teile = (JSON.parse(lauf.teile) as { tag: string; snapshot?: string }[]).map((t) => ({
    tag: t.tag,
    snapshot: t.snapshot ?? null,
  }));
  const argumente = wiederherstellenArgumente(m.manifest, i.installationId, teile);
  if (!argumente.ok) return nichtAusfuehrbar(argumente.grund);
  return vorbereitetOderFehler(
    auftragVorbereiten(
      deps,
      kontext,
      {
        serverId: i.serverId,
        installationId: i.installationId,
        aktion: WIEDERHERSTELLEN_AKTION,
        argumente: argumente.argumente,
        manifest: i.manifest,
        signatur: i.signatur,
        wartetAuf: [backup.auftragId],
      },
      [backup],
    ),
  );
};

/** The backup of the current state, then the restore of the run `backupId` after it */
export const wiederherstellenAnlegen = (
  deps: AuftragDeps,
  kontext: Kontext,
  installationId: string,
  backupId: string,
): WiederherstellenAngelegt => {
  const i = installationLesen(deps.db, kontext.betreiberId, installationId);
  const nein = gesperrt(deps.db, i);
  if (nein || !i) return nein ?? { ok: false, grund: "keine_installation" };
  const lauf = laufLesen(deps.db, i, backupId);
  if (!lauf) return { ok: false, grund: "lauf_unbekannt" };
  if (!lauf.ok) return { ok: false, grund: "lauf_gescheitert" };
  const backup = vorbereitetOderFehler(
    backupAuftragVorbereiten(deps, kontext, i, BACKUP_AKTIONEN.jetzt),
  );
  if (!backup.ok) return backup;
  const zurueck = wiederherstellenVorbereiten(deps, kontext, i, lauf, backup.zeile);
  if (!zurueck.ok) return zurueck;
  const geschrieben = schreiben(deps.schreibDb, kontext, "installation.wiederherstellen", (w) => {
    const b = auftragEinfuegen(w, backup.zeile);
    const z = auftragEinfuegen(w, zurueck.zeile);
    w.einfuegen("wiederherstellungen", {
      betreiberId: i.betreiberId,
      auftragId: z.auftragId,
      backupAuftragId: b.auftragId,
      installationId: i.installationId,
      serverId: i.serverId,
      backupId: lauf.backupId,
      laufZeitpunkt: lauf.zeitpunkt,
      angefordertAm: kontext.jetzt,
      teile: "[]",
    });
    return [b, z] as const;
  });
  zustellen(deps, geschrieben);
  const lesen = (a: Auftrag) => auftragLesen(deps.db, kontext.betreiberId, a.auftragId) ?? a;
  return { ok: true, backup: lesen(geschrieben[0]), wiederherstellen: lesen(geschrieben[1]) };
};
