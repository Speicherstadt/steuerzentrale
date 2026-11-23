import {
  BACKUP_AKTIONEN,
  type BackupZugang,
  type Einrichtung,
  PRUEF_RESTORE_AKTION,
} from "@steuerzentrale/manifest";
import { PruefRestoreDaten } from "@steuerzentrale/protokoll";
import { expect } from "vitest";
import type { AuftragNachricht } from "../src/auftraege/pruefen.ts";
import {
  EINRICHTUNG,
  einrichtenAuftrag,
  einrichtungsAgent,
  HOME,
  MANIFEST,
  NAME,
  NUTZER,
} from "../src/einrichtung/testauftraege.ts";
import { signiert } from "./einrichtung-hilfen.ts";

/*
 * Helpers of the unit tests of the Prüf-Restore (Z-602) on a server in memory: the original set up
 * by a job with its backup, the job of a Prüf-Restore, its result read with the protocol's schema,
 * and the check that nothing of the copy is left and the original was only read.
 */
export const PASSWORT = "restic-passwort-der-installation";
export const GEHEIM = "s3-geheimnis-0815-abc";
export const ZUGANG: BackupZugang = {
  repository: "s3:https://s3.example.org/sicherung/b-1/beispiel-x7k2p9",
  zugang: { schluesselId: "SZBEISPIEL0000000001", geheim: GEHEIM },
  passwort: PASSWORT,
};
export const KOPIE = "restore-a1b2c3";
export const KOPIE_NUTZER = `sz-${KOPIE}`;
export const KOPIE_HOME = `/home/${KOPIE_NUTZER}`;

export const KOPIE_EINRICHTUNG: Einrichtung = {
  ...EINRICHTUNG,
  installation: { ...EINRICHTUNG.installation, httpPort: 20011, ports: { "app:9000": 20012 } },
};

const backupEinrichten = (manifest = MANIFEST): AuftragNachricht =>
  einrichtenAuftrag({
    auftragId: "b1",
    aktion: BACKUP_AKTIONEN.einrichten,
    manifest,
    signatur: signiert(manifest),
    einrichtung: undefined,
    backup: ZUGANG,
  });

export const pruefRestore = (teil: Partial<AuftragNachricht> = {}): AuftragNachricht =>
  einrichtenAuftrag({
    auftragId: "p1",
    aktion: PRUEF_RESTORE_AKTION,
    argumente: { kopie: KOPIE },
    einrichtung: KOPIE_EINRICHTUNG,
    zeitlimitS: 14_400,
    ...teil,
  });

type Optionen = Parameters<typeof einrichtungsAgent>[0];

/** The original set up by a job, its backup too (unless `ohneBackup`), with the manifest given */
export const eingerichtet = async (
  o: Optionen & { ohneBackup?: boolean; manifest?: string } = {},
) => {
  let nachher = false;
  const manifest = o.manifest ?? MANIFEST;
  const a = einrichtungsAgent({
    ...o,
    scheitern: (l) => (nachher ? o.scheitern?.(l) : undefined),
  });
  await a.empfangen(einrichtenAuftrag({ manifest, signatur: signiert(manifest) }));
  expect(a.ergebnis()).toMatchObject({ ok: true });
  if (!o.ohneBackup) {
    await a.empfangen(backupEinrichten(manifest));
    expect(a.ergebnis()).toMatchObject({ ok: true });
  }
  nachher = true;
  const vorher = a.sys.laeufe.length;
  const backupJson = a.sys.dateien.get(`${HOME}/.config/steuerzentrale/backup.json`);
  /** What ran since the original was set up */
  const seither = () => a.sys.laeufe.slice(vorher);
  return { ...a, seither, backupJson };
};

export type Agent = Awaited<ReturnType<typeof eingerichtet>>;

export const daten = (a: Agent) => {
  const e = a.ergebnis() as { ok: boolean; daten?: unknown; fehler?: string };
  if (!e.ok) throw new Error(e.fehler);
  return PruefRestoreDaten.parse(e.daten);
};

/** Nothing of the copy is left; the original is set up, untouched */
export const kopieWeg = (a: Agent) => {
  expect(a.sys.nutzer.has(KOPIE_NUTZER)).toBe(false);
  expect(a.sys.dateien.has(KOPIE_HOME)).toBe(false);
  expect(a.sys.unter(KOPIE_HOME)).toEqual([]);
  expect(a.sys.linger.has(KOPIE_NUTZER)).toBe(false);
  expect(Object.keys(a.record())).toEqual([NAME]);
  expect(a.record()[NAME]?.zustand).toBe("fertig");
  expect(a.sys.nutzer.has(NUTZER)).toBe(true);
  expect(a.sys.dateien.get(`${HOME}/.config/steuerzentrale/backup.json`)).toEqual(a.backupJson);
  // the original's user ran nothing: its files were only read
  expect(a.seither().filter((l) => l.als === NUTZER)).toEqual([]);
};

export const alsKopie = (a: Agent) =>
  a
    .seither()
    .filter((l) => l.als === KOPIE_NUTZER)
    .map((l) => l.argv.slice(0, 4).join(" "));
