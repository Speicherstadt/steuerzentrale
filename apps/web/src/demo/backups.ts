import type {
  BackupLauf,
  BackupQuelle,
  BackupsDerInstallation,
  BackupTeil,
  BackupZeile,
  BackupZiel,
} from "../daten/backups.ts";
import type { Bestand, Installation } from "../daten/typen.ts";
import { demo } from "./index.ts";

/*
 * The backups of the demo operator in memory, answering as the Zentrale's API does
 * (apps/zentrale, routes/backups.ts): the S3 target with its admin access only as set, and for each
 * installation of the demo its runs from the demo's snapshots, each part with a tag and a snapshot
 * id. "Backup jetzt" makes a job that stays with the agent, as without an agent in the Zentrale. A
 * change lasts until the page reloads.
 */

/** What each app's manifest backs up (manifeste/<app>/<version>/manifest.yml, `backup`) */
export const BACKUP_TEILE: Readonly<Record<string, BackupTeil[]>> = {
  haben: [
    { art: "pg_dump", name: "db" },
    { art: "volume", name: "belege" },
  ],
  belegt: [
    { art: "pg_dump", name: "db" },
    { art: "volume", name: "daten" },
  ],
  kontext: [
    { art: "volume", name: "stalwart-data" },
    { art: "volume", name: "stalwart-config" },
    { art: "volume", name: "kontext-data" },
    { art: "volume", name: "schreibzeug-data" },
  ],
  schreibzeug: [{ art: "volume", name: "daten" }],
  stellwerk: [{ art: "volume", name: "daten" }],
  fixpunkt: [{ art: "volume", name: "daten" }],
  kennwort: [{ art: "volume", name: "daten" }],
  soll: [{ art: "volume", name: "daten" }],
};

/** A restic snapshot id of eight hex digits, the same for the same part and run */
const snapshotId = (text: string): string => {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
};

const laeufeVon = (i: Installation): BackupLauf[] =>
  i.snapshots.map((s) => {
    const ok = s.gb !== null;
    return {
      zeitpunkt: s.zeitpunkt,
      ok,
      grund: ok ? null : (i.grund ?? "restic exit 1"),
      teile: ok
        ? (BACKUP_TEILE[i.app] ?? []).map((t) => ({
            tag: `${t.art}-${t.name}`,
            snapshotId: snapshotId(`${i.id}:${t.name}:${s.zeitpunkt}`),
          }))
        : [],
    };
  });

const derInstallation = (b: Bestand, id: string): BackupsDerInstallation => {
  const i = b.installationen.find((x) => x.id === id);
  return {
    installationId: id,
    teile: i ? (BACKUP_TEILE[i.app] ?? []) : [],
    zugang: i ? "angelegt" : null,
    eingerichtet: i !== undefined,
    laeufe: i ? laeufeVon(i) : [],
  };
};

const zeile = (b: Bestand, i: Installation): BackupZeile => {
  const { laeufe, ...rest } = derInstallation(b, i.id);
  return {
    ...rest,
    app: i.app,
    kundeId: i.kunde,
    kundeName: b.kunden.find((k) => k.id === i.kunde)?.name ?? i.kunde,
    serverId: i.server,
    serverName: b.server.find((s) => s.id === i.server)?.name ?? i.server,
    zustand: "laeuft",
    letzter: laeufe[0] ?? null,
    letzterErfolg: laeufe.find((l) => l.ok)?.zeitpunkt ?? null,
  };
};

const ZIEL: BackupZiel = {
  endpunkt: "https://s3.example.net",
  region: "eu-central-1",
  bucket: "sz-beispiel-hosting",
  zugangGesetzt: true,
};

const ok = <T>(daten: T, status = 200) => ({ ok: true, status, daten }) as const;

export const demoBackups = (b: Bestand = demo, start: BackupZiel = ZIEL): BackupQuelle => {
  let ziel = { ...start };
  let nummer = 0;
  return {
    ziel: async () => ok({ ...ziel }),
    zielSetzen: async (neu) => {
      const zugang = neu.accessKey !== undefined && neu.secretKey !== undefined;
      if (!zugang && !ziel.zugangGesetzt) return { ok: false, status: 422, fehler: "zugang_fehlt" };
      ziel = {
        endpunkt: neu.endpunkt,
        region: neu.region,
        bucket: neu.bucket,
        zugangGesetzt: true,
      };
      return ok({ ...ziel });
    },
    uebersicht: async () => ok(b.installationen.map((i) => zeile(b, i))),
    derInstallation: async (id) => ok(derInstallation(b, id)),
    jetzt: async (id) => {
      if (!derInstallation(b, id).eingerichtet)
        return { ok: false, status: 409, fehler: "nicht_eingerichtet" };
      nummer += 1;
      return ok(
        {
          auftragId: `demo-backup-${nummer}`,
          aktion: "installation_backup",
          zustand: "zugestellt",
        },
        201,
      );
    },
  };
};
