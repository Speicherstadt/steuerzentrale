import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { auftraege } from "../db/schema.ts";
import { type AuftragsMeldung, auftragMelden } from "../modules/auftraege/melden.ts";
import type { BackupDeps } from "../modules/backups/index.ts";
import { backupZielSetzen } from "../modules/backups/index.ts";
import { installationAnlegen, type NeueInstallation } from "../modules/installationen/anlegen.ts";
import type { Server } from "../modules/server/index.ts";
import {
  installationsUmgebung,
  neueInstallation,
  signiert,
  TEST_SCHLUESSEL,
} from "./installationen.ts";
import { TEST_ADMIN } from "./minio.ts";

/*
 * For the tests of backups (Z-601): the installation environment with the operator's S3 target at
 * the stand-in of MinIO's admin API (testhilfen/minio.ts), installations of the manifest
 * `gesichert` (two parts to back up) and the agent's reports of their jobs.
 */

export const BUCKET = "backups";

type Nachbau = { url: string; region: string };

export const backupUmgebung = (minio: Nachbau, betreiberId = "b1") => {
  const u = installationsUmgebung();
  const agent = u.bereit(betreiberId);
  const deps: BackupDeps = { ...u.deps, fetch };

  const zielSetzen = (b = betreiberId, zugang: typeof TEST_ADMIN | undefined = TEST_ADMIN) =>
    backupZielSetzen(u.deps, u.kontext(b), {
      endpunkt: minio.url,
      region: minio.region,
      bucket: BUCKET,
      zugang,
    });

  /** The agent of `serverId` reports the job done or failed */
  const melden = (auftragId: string, ok: boolean, serverId = "s1", b = betreiberId) => {
    const server = { betreiberId: b, serverId } as Server;
    const ergebnis: AuftragsMeldung = {
      typ: "ergebnis",
      protokoll: 1,
      auftragId,
      zeit: u.uhr.ms,
      ergebnis: ok ? { ok: true, daten: {} } : { ok: false, fehler: "exit 1" },
    };
    auftragMelden(deps, server, { typ: "bestaetigt", protokoll: 1, auftragId }, u.uhr.ms);
    auftragMelden(deps, server, ergebnis, u.uhr.ms);
  };

  /** The newest job of this action of the installation */
  const auftrag = (installationId: string, aktion: string) =>
    u.db
      .select()
      .from(auftraege)
      .all()
      .filter((a) => a.installationId === installationId && a.aktion === aktion)
      .at(-1);

  /** An installation of `gesichert` whose setup succeeded */
  const laufend = (teil: Partial<NeueInstallation> = {}, b = betreiberId) => {
    const host = `${crypto.randomUUID().slice(0, 8)}.kunde.example`;
    const neu = neueInstallation({ host, ...signiert("gesichert"), ...teil });
    const a = installationAnlegen(u.deps, u.kontext(b), TEST_SCHLUESSEL, neu);
    if (!a.ok) throw new Error(`${a.grund} ${a.detail ?? ""}`);
    const id = a.installation.installationId;
    const einrichten = auftrag(id, EINRICHTUNG_AKTIONEN.einrichten);
    melden(einrichten?.auftragId ?? "", true, a.installation.serverId, b);
    return id;
  };

  return { ...u, agent, deps, zielSetzen, melden, auftrag, laufend };
};
