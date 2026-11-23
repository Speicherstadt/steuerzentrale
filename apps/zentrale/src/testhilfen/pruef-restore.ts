import { randomBytes } from "node:crypto";
import { BACKUP_AKTIONEN, PFORTE_AKTIONEN, PRUEF_RESTORE_AKTION } from "@steuerzentrale/manifest";
import { auftraege, installationsPorts } from "../db/schema.ts";
import { type AuftragsMeldung, auftragMelden } from "../modules/auftraege/melden.ts";
import { backupAbgleichen, backupStandAnnehmen } from "../modules/backups/index.ts";
import type { ZeitplanDeps } from "../modules/pruef-restore/index.ts";
import type { Server } from "../modules/server/index.ts";
import { backupUmgebung } from "./backups.ts";

/*
 * For the tests of test restores (Z-602): the backup environment (testhilfen/backups.ts) with an
 * installation of `gesichert` whose backups are set up at the stand-in of MinIO and that has a
 * successful run, and the agent's report of a test restore.
 */

type Nachbau = Parameters<typeof backupUmgebung>[0];

export const SNAPSHOT = "4f2a9c1e".repeat(8);

export const pruefUmgebung = (minio: Nachbau, betreiberId = "b1") => {
  const u = backupUmgebung(minio, betreiberId);
  const deps: ZeitplanDeps = {
    ...u.deps,
    zufall: (n) => new Uint8Array(randomBytes(n)),
    verbunden: (b, s) => u.deps.verbindungen.verbundenSeit(b, s) !== undefined,
  };

  let zielGesetzt = false;

  /** A run of the installation's backup, as its agent reports it */
  const lauf = (installationId: string, ok = true, serverId = "s1") =>
    backupStandAnnehmen(
      u.deps,
      { betreiberId, serverId } as Server,
      {
        typ: "backup_stand",
        protokoll: 1,
        installationId,
        lauf: crypto.randomUUID(),
        beginn: u.uhr.ms - 60_000,
        ende: u.uhr.ms,
        ok,
        teile: [{ tag: "volume:daten", ok, ...(ok ? { snapshot: SNAPSHOT } : {}) }],
      },
      u.uhr.ms,
    );

  /** A running installation with its route, whose backups are set up, without a run yet */
  const eingerichtet = async () => {
    if (!zielGesetzt) u.zielSetzen();
    zielGesetzt = true;
    const id = u.laufend();
    u.melden(u.auftrag(id, PFORTE_AKTIONEN.setzen)?.auftragId ?? "", true);
    await backupAbgleichen(u.deps);
    u.melden(u.auftrag(id, BACKUP_AKTIONEN.einrichten)?.auftragId ?? "", true);
    return id;
  };

  /** A running installation whose backups are set up, with a successful run */
  const gesichert = async () => {
    const id = await eingerichtet();
    lauf(id);
    return id;
  };

  /** The installation's test restores, oldest first */
  const pruefAuftraege = (installationId: string) =>
    u.db
      .select()
      .from(auftraege)
      .all()
      .filter((a) => a.installationId === installationId && a.aktion === PRUEF_RESTORE_AKTION);

  /** The rows of installations_ports kept for a copy */
  const kopiePortZeilen = (kopie: string) =>
    u.db
      .select()
      .from(installationsPorts)
      .all()
      .filter((p) => p.zweck.startsWith(`${kopie}:`));

  /** The agent reports the test restore's result */
  const pruefMelden = (auftragId: string, e: AuftragsMeldung & { typ: "ergebnis" }) => {
    const server = { betreiberId, serverId: "s1" } as Server;
    auftragMelden(u.deps, server, { typ: "bestaetigt", protokoll: 1, auftragId }, u.uhr.ms);
    auftragMelden(u.deps, server, e, u.uhr.ms);
  };

  const ergebnis = (
    auftragId: string,
    e: Extract<AuftragsMeldung, { typ: "ergebnis" }>["ergebnis"],
  ): AuftragsMeldung & { typ: "ergebnis" } => ({
    typ: "ergebnis",
    protokoll: 1,
    auftragId,
    zeit: u.uhr.ms,
    ergebnis: e,
  });

  return {
    ...u,
    deps,
    lauf,
    eingerichtet,
    gesichert,
    pruefAuftraege,
    kopiePortZeilen,
    pruefMelden,
    ergebnis,
  };
};
