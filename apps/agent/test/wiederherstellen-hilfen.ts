import { WIEDERHERSTELLEN_AKTION, wiederherstellenDatenLesen } from "@steuerzentrale/manifest";
import { expect } from "vitest";
import type { AuftragNachricht } from "../src/auftraege/pruefen.ts";
import { einrichtenAuftrag, MANIFEST, NAME, NUTZER } from "../src/einrichtung/testauftraege.ts";
import { ersetzen, signiert } from "./einrichtung-hilfen.ts";
import type { Agent } from "./pruef-restore-hilfen.ts";

/*
 * Helpers of the unit tests of restoring (Z-603) on a server in memory: the job with the
 * snapshots of a chosen run, a manifest with a database container beside the app, the result read
 * as the Zentrale reads it, and what ran as the installation's user since it was set up.
 */

export const SNAPSHOT_A = "a".repeat(64);
export const SNAPSHOT_B = "b".repeat(64);
export const UNIT_APP = `${NAME}-app.service`;
export const UNIT_DB = `${NAME}-db.service`;
export const VOLUME_UNIT = `${NAME}-daten-volume.service`;
export const TRANSIENT = "sz_wiederherstellen.service";
export const ZEITLIMIT_S = 16_200;

/** The setup tests' manifest with a Postgres container `db` whose database is backed up by pg_dump */
export const MIT_DB = (() => {
  const mitDb = ersetzen(
    MANIFEST,
    "optionen:\n",
    [
      "  - name: db",
      `    image: "localhost:5000/postgres@sha256:${"c".repeat(64)}"`,
      "    volumes: [{ name: pgdaten, pfad: /var/lib/postgresql }]",
      "optionen:\n",
    ].join("\n"),
  );
  return ersetzen(
    mitDb,
    "  - { art: volume, volume: daten }\n  - { art: befehl, befehl: export }",
    "  - { art: pg_dump, container: db, datenbank: app, nutzer: app }",
  );
})();

export const wiederherstellen = (teil: Partial<AuftragNachricht> = {}): AuftragNachricht =>
  einrichtenAuftrag({
    auftragId: "w1",
    aktion: WIEDERHERSTELLEN_AKTION,
    argumente: { "snapshot:volume:daten": SNAPSHOT_A },
    einrichtung: undefined,
    zeitlimitS: ZEITLIMIT_S,
    ...teil,
  });

export const mitDbWiederherstellen = (teil: Partial<AuftragNachricht> = {}) =>
  wiederherstellen({
    manifest: MIT_DB,
    signatur: signiert(MIT_DB),
    argumente: { "snapshot:pg_dump:db:app": SNAPSHOT_B },
    ...teil,
  });

type Ergebnis = { ok: boolean; daten?: unknown; fehler?: string };

/** A restore's data, exactly as the Zentrale reads them (wiederherstellenDatenLesen) */
export const daten = (a: Pick<Agent, "ergebnis">) => {
  const e = a.ergebnis() as Ergebnis;
  if (!e.ok) throw new Error(e.fehler);
  const gelesen = wiederherstellenDatenLesen(e.daten);
  expect(e.daten).toEqual(gelesen);
  return gelesen;
};

/** What ran as the installation's user since it was set up, the argv inside a transient unit */
export const alsInstallation = (a: Agent) => a.seither().filter((l) => l.als === NUTZER);

/** `systemctl --user <what> <units>` as one string, the way the tests compare them */
export const systemctl = (a: Agent): string[] =>
  alsInstallation(a)
    .filter((l) => l.argv[0] === "systemctl")
    .map((l) => l.argv.slice(2).join(" "));
