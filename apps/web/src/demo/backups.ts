import type {
  BackupLauf,
  BackupQuelle,
  BackupsDerInstallation,
  BackupTeil,
  BackupZeile,
  BackupZiel,
  PruefRestoreStand,
  WiederherstellenStand,
  Wiederherstellung,
} from "../daten/backups.ts";
import type { Bestand, Installation } from "../daten/typen.ts";
import { demo } from "./index.ts";

/*
 * The backups of the demo operator in memory, answering as the Zentrale's API does
 * (apps/zentrale, routes/backups.ts): the S3 target with its admin access only as set, and for each
 * installation of the demo its runs from the demo's snapshots, each part with a tag and a snapshot
 * id, and its newest test restore (Z-602) from the demo's `pruefRestore`: done the night after the
 * last but one snapshot, failed last night with the mockup's reason, or `offen`, done 9 days ago
 * and so due. "Backup jetzt" and "Prüf-Restore jetzt" make a job that stays with the agent, as without
 * an agent in the Zentrale; restoring a run (Z-603) makes its two jobs and stays at backing up the
 * current state. A change lasts until the page reloads.
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

/** Eight hex digits of FNV-1a, the same for the same text */
const fnv = (text: string): string => {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
};

/** A restic snapshot id (64 hex digits), the same for the same part and run */
const snapshot = (text: string): string =>
  Array.from({ length: 8 }, (_, n) => fnv(`${n}:${text}`)).join("");

/**
 * The tag the agent gives a part (packages/manifest, backup/auftraege.ts); the database of a dump
 * is named like its app in the manifests of Haben and Belegt
 */
const tagVon = (app: string, t: BackupTeil): string =>
  t.art === "pg_dump" ? `pg_dump:${t.name}:${app}` : `${t.art}:${t.name}`;

const laeufeVon = (i: Installation): BackupLauf[] =>
  i.snapshots.map((s) => {
    const ok = s.gb !== null;
    return {
      id: `backup-${snapshot(`${i.id}:${s.zeitpunkt}`).slice(0, 32)}`,
      zeitpunkt: s.zeitpunkt,
      ok,
      grund: ok ? null : (i.grund ?? "restic exit 1"),
      teile: (BACKUP_TEILE[i.app] ?? []).map((t) =>
        ok
          ? { tag: tagVon(i.app, t), ok, snapshot: snapshot(`${i.id}:${t.name}:${s.zeitpunkt}`) }
          : { tag: tagVon(i.app, t), ok, fehler: i.grund ?? "restic exit 1" },
      ),
    };
  });

const TAG = 86_400_000;

/** The reason the mockup gives a failed test restore (design/mockup/, holm-belegt) */
const PRUEF_GRUND = "Health der Kopie blieb rot";

export const pruefRestoreVon = (i: Installation): PruefRestoreStand => {
  const ok = i.pruefRestore !== "gescheitert";
  // a failed one tried the night's snapshot, a good one the night's before
  const basis = i.snapshots[ok ? 1 : 0]?.zeitpunkt ?? i.backup.zeitpunkt;
  const zeitpunkt = i.pruefRestore === "offen" ? basis - 8 * TAG : basis + 45 * 60_000;
  const teile = (BACKUP_TEILE[i.app] ?? []).map((t) => ({
    tag: tagVon(i.app, t),
    snapshot: ok ? snapshot(`${i.id}:${t.name}:${basis}`) : null,
    zurueckgespielt: ok,
    grund: null,
  }));
  return {
    letzter: {
      zeitpunkt,
      ok,
      grund: ok ? null : PRUEF_GRUND,
      kopie: `restore-${fnv(i.id).slice(0, 6)}`,
      teile: ok ? teile : [],
      dauerMs: ok ? Math.round(60_000 + i.datenGb * 20_000) : null,
    },
    laeuft: false,
  };
};

/** The demo's restores by installation, kept until the page reloads */
type Wiederherstellungen = Map<string, Wiederherstellung>;

const OHNE: WiederherstellenStand = { letzter: null, laeuft: false };

const derInstallation = (
  b: Bestand,
  id: string,
  wh: Wiederherstellungen = new Map(),
): BackupsDerInstallation => {
  const i = b.installationen.find((x) => x.id === id);
  const w = wh.get(id);
  return {
    installationId: id,
    teile: i ? (BACKUP_TEILE[i.app] ?? []) : [],
    zugang: i ? "angelegt" : null,
    eingerichtet: i !== undefined,
    laeufe: i ? laeufeVon(i) : [],
    pruefRestore: i ? pruefRestoreVon(i) : { letzter: null, laeuft: false },
    wiederherstellen: w ? { letzter: w, laeuft: w.endeAm === null } : OHNE,
  };
};

const zeile = (b: Bestand, i: Installation, wh: Wiederherstellungen): BackupZeile => {
  const { laeufe, ...rest } = derInstallation(b, i.id, wh);
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

const nein = (status: number, fehler: string) => ({ ok: false, status, fehler }) as const;

export const demoBackups = (b: Bestand = demo, start: BackupZiel = ZIEL): BackupQuelle => {
  let ziel = { ...start };
  let nummer = 0;
  const wh: Wiederherstellungen = new Map();
  const neuerAuftrag = (aktion: string, zustand = "zugestellt") => {
    nummer += 1;
    return { auftragId: `demo-${aktion}-${nummer}`, aktion, zustand };
  };
  const auftrag = (id: string, aktion: string) =>
    derInstallation(b, id).eingerichtet
      ? ok(neuerAuftrag(aktion), 201)
      : nein(409, "nicht_eingerichtet");
  /** Like the Zentrale: a successful run of this installation, nothing under way */
  const wiederherstellen = (id: string, laufId: string) => {
    const stand = derInstallation(b, id, wh);
    if (!stand.eingerichtet) return nein(409, "nicht_eingerichtet");
    if (stand.wiederherstellen.laeuft) return nein(409, "auftrag_offen");
    const lauf = stand.laeufe.find((l) => l.id === laufId);
    if (!lauf) return nein(422, "lauf_unbekannt");
    if (!lauf.ok) return nein(422, "lauf_gescheitert");
    wh.set(id, {
      angefordertAm: b.jetzt,
      laufZeitpunkt: lauf.zeitpunkt,
      phase: "sichern",
      endeAm: null,
      fehler: null,
      teile: [],
      dauerMs: null,
    });
    const backup = neuerAuftrag("installation_backup");
    const zurueck = neuerAuftrag("installation_wiederherstellen", "wartend");
    return ok({ backup, wiederherstellen: zurueck }, 201);
  };
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
    uebersicht: async () => ok(b.installationen.map((i) => zeile(b, i, wh))),
    derInstallation: async (id) => ok(derInstallation(b, id, wh)),
    jetzt: async (id) => auftrag(id, "installation_backup"),
    pruefRestore: async (id) => auftrag(id, "installation_pruef_restore"),
    wiederherstellen: async (id, lauf) => wiederherstellen(id, lauf),
  };
};
