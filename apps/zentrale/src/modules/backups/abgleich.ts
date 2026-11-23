import { randomUUID } from "node:crypto";
import { BACKUP_AKTIONEN, backupPolicy, backupPraefix } from "@steuerzentrale/manifest";
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { backupZugaenge, ereignisse } from "../../db/schema.ts";
import { schreiben } from "../audit/index.ts";
import type { Planer } from "../aufbewahrung/index.ts";
import { auftragEinfuegen } from "../auftraege/anlegen.ts";
import { type AuftragDeps, zustellen } from "../auftraege/zustellen.ts";
import { naechsterVersuch } from "../dns/index.ts";
import { installationLesen } from "../installationen/lesen.ts";
import { anstossbareSchleife } from "../schleife/index.ts";
import { backupAuftragVorbereiten } from "./auftraege.ts";
import { feldAus } from "./feld.ts";
import { dienstkontoAnlegen, dienstkontoLoeschen, type Ergebnis, type MinioZiel } from "./minio.ts";
import { backupZielStand, backupZielZugang } from "./ziel.ts";
import { type Zugang, type ZugangGeheim, zugangGeheim, zugangLesen } from "./zugaenge.ts";

/*
 * Making and deleting the installations' own S3 accesses at MinIO (BAULISTE.md Z-601; docs/plan.md,
 * "S3-Ziel und Zugang je Installation (Z-601)"), built like the DNS check (modules/dns): an access
 * that is due (`anlegen` or `loeschen`, its next attempt reached) is brought in line with MinIO,
 * one after the other. A made access goes, in the same transaction, with the job
 * `installation_backup_einrichten` to the installation's server. A failed attempt counts up and
 * waits (backoff as for DNS); it makes the event `backup_fehler` (severity `warn`) on the first
 * failure of a series and then at most once a day. An attempt after a failed one deletes the
 * access first, so one made whose answer was lost does not stand in the way.
 */

export const BACKUP_PRUEFUNG_MS = 30_000;
export const BACKUP_FEHLER_ART = "backup_fehler";
const EREIGNIS_ABSTAND_MS = 24 * 60 * 60_000;

export type BackupDeps = AuftragDeps & { fetch: typeof fetch; neueId?: () => string };

/** The accesses due now, of every operator */
export const faelligeZugaenge = (db: Db, jetzt: number): Zugang[] =>
  db
    .select()
    .from(backupZugaenge)
    .where(
      and(
        inArray(backupZugaenge.zustand, ["anlegen", "loeschen"]),
        isNotNull(backupZugaenge.naechsterVersuch),
        lte(backupZugaenge.naechsterVersuch, jetzt),
      ),
    )
    .all();

type Versuch = { ergebnis: Ergebnis; geheim?: ZugangGeheim; ziel?: MinioZiel & { bucket: string } };

const nein = (fehler: string): Versuch => ({ ergebnis: { ok: false, fehler } });

/** One access at MinIO: made (after deleting a half-made one) or deleted */
export const zugangAbgleichen = async (deps: BackupDeps, z: Zugang): Promise<Versuch> => {
  const t = backupZielZugang(deps.db, deps.schluessel, z.betreiberId);
  if (!t.ok) return nein(t.grund);
  const g = zugangGeheim(deps.schluessel, z);
  if (!g.ok) return nein(g.grund);
  const ziel = { fetch: deps.fetch, endpunkt: t.endpunkt, region: t.region, admin: t.admin };
  const minio: MinioZiel = { ...ziel, jetzt: deps.now };
  if (z.zustand === "loeschen")
    return { ergebnis: await dienstkontoLoeschen(minio, g.geheim.accessKey) };
  const ort = backupPraefix({
    bucket: t.bucket,
    betreiberId: z.betreiberId,
    installationId: z.installationId,
  });
  if (!ort.ok) return nein(ort.grund);
  if (z.versuche > 0) {
    const weg = await dienstkontoLoeschen(minio, g.geheim.accessKey);
    if (!weg.ok) return { ergebnis: weg };
  }
  const ergebnis = await dienstkontoAnlegen(minio, {
    zugang: { accessKey: g.geheim.accessKey, secretKey: g.geheim.secretKey },
    policy: backupPolicy(t.bucket, ort.praefix),
    name: `sz-${z.installationId}`.slice(0, 32),
    beschreibung: `Steuerzentrale: Backups von ${z.installationId}`,
  });
  return { ergebnis, geheim: g.geheim, ziel: { ...minio, bucket: t.bucket } };
};

const zielVon = (installationId: string) => `installation:${installationId}`;

const kuerzlichGemeldet = (db: Db, z: Zugang, jetzt: number): boolean =>
  db
    .select({ id: ereignisse.ereignisId })
    .from(ereignisse)
    .where(
      and(
        eq(ereignisse.betreiberId, z.betreiberId),
        eq(ereignisse.art, BACKUP_FEHLER_ART),
        eq(ereignisse.ziel, zielVon(z.installationId)),
        gte(ereignisse.zeitpunkt, jetzt - EREIGNIS_ABSTAND_MS),
      ),
    )
    .get() !== undefined;

type Kontext = { betreiberId: string; akteur: string; jetzt: number; grund: string };

const fehlschlagSchreiben = (deps: BackupDeps, k: Kontext, z: Zugang, fehler: string) => {
  const versuche = z.versuche + 1;
  const melden = versuche === 1 || !kuerzlichGemeldet(deps.db, z, k.jetzt);
  const was = z.zustand === "anlegen" ? "anlegen" : "löschen";
  schreiben(deps.schreibDb, k, "backup.zugang-fehler", (w) => {
    w.aendern(
      "backupZugaenge",
      { installationId: z.installationId },
      { versuche, naechsterVersuch: naechsterVersuch(versuche, k.jetzt), geaendertAm: k.jetzt },
    );
    if (melden)
      w.einfuegen("ereignisse", {
        betreiberId: z.betreiberId,
        ereignisId: (deps.neueId ?? randomUUID)(),
        zeitpunkt: k.jetzt,
        art: BACKUP_FEHLER_ART,
        schwere: "warn",
        ziel: zielVon(z.installationId),
        text: `S3-Zugang für die Backups von ${z.installationId} (${was}), Versuch ${versuche}: ${fehler}`,
      });
  });
};

/** A made access and, in the same transaction, the job that sets up the backups on the server */
const angelegtSchreiben = (deps: BackupDeps, k: Kontext, z: Zugang, v: Versuch): string | null => {
  const i = installationLesen(deps.db, z.betreiberId, z.installationId);
  if (!i || !v.geheim || !v.ziel) return "the installation is gone";
  const ort = backupPraefix({
    bucket: v.ziel.bucket,
    betreiberId: z.betreiberId,
    installationId: z.installationId,
  });
  if (!ort.ok) return ort.grund;
  const feld = feldAus(v.ziel.endpunkt, v.ziel.bucket, ort.praefix, v.geheim);
  const job = backupAuftragVorbereiten(deps, k, i, BACKUP_AKTIONEN.einrichten, feld);
  if (!job.ok) return `job ${BACKUP_AKTIONEN.einrichten}: ${job.detail ?? job.grund}`;
  const auftrag = schreiben(deps.schreibDb, k, "backup.zugang-angelegt", (w) => {
    w.aendern(
      "backupZugaenge",
      { installationId: z.installationId },
      { zustand: "angelegt", versuche: 0, naechsterVersuch: null, geaendertAm: k.jetzt },
    );
    return auftragEinfuegen(w, job.zeile);
  });
  zustellen(deps, [auftrag]);
  return null;
};

/** Writes what the attempt came to, unless the access's state changed meanwhile */
export const ergebnisSchreiben = (deps: BackupDeps, z: Zugang, v: Versuch, jetzt: number): void => {
  const jetzig = zugangLesen(deps.db, z.betreiberId, z.installationId);
  if (!jetzig || jetzig.zustand !== z.zustand || jetzig.versuche !== z.versuche) return;
  const k = {
    betreiberId: z.betreiberId,
    akteur: "system",
    jetzt,
    grund:
      z.zustand === "anlegen" ? "S3-Zugang für Backups anlegen" : "S3-Zugang für Backups löschen",
  };
  if (!v.ergebnis.ok) {
    fehlschlagSchreiben(deps, k, z, v.ergebnis.fehler);
    return;
  }
  if (z.zustand === "loeschen") {
    schreiben(deps.schreibDb, k, "backup.zugang-geloescht", (w) =>
      w.aendern(
        "backupZugaenge",
        { installationId: z.installationId },
        { zustand: "geloescht", versuche: 0, naechsterVersuch: null, geaendertAm: jetzt },
      ),
    );
    return;
  }
  const fehler = angelegtSchreiben(deps, k, z, v);
  if (fehler) fehlschlagSchreiben(deps, k, z, fehler);
};

/** Every access due now, one after the other; returns how many were tried */
export const backupAbgleichen = async (deps: BackupDeps): Promise<number> => {
  const faellig = faelligeZugaenge(deps.db, deps.now());
  for (const z of faellig) {
    const stand = backupZielStand(deps.db, z.betreiberId);
    const v = await zugangAbgleichen(deps, z);
    // new settings came in while it ran: it stays due and is tried with them, not after a backoff
    if (!v.ergebnis.ok && backupZielStand(deps.db, z.betreiberId) !== stand) continue;
    ergebnisSchreiben(deps, z, v, deps.now());
  }
  return faellig.length;
};

/**
 * Checks every 30 seconds, and at once when `anstossen` is called (a setup that ended, a removed
 * installation, a new target); never two runs at a time: a push during a run makes one more after it
 */
export const backupSchleife = (deps: BackupDeps, planen: Planer): { anstossen: () => void } =>
  anstossbareSchleife(
    () => backupAbgleichen(deps),
    planen,
    BACKUP_PRUEFUNG_MS,
    (fehler) => deps.log(JSON.stringify({ msg: "backup check failed", fehler: String(fehler) })),
  );
