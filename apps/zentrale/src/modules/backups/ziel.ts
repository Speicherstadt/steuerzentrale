import { and, eq, inArray } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { backupZiele, backupZugaenge, geheimnisse } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { geheimnisLesen, geheimnisSetzen } from "../geheim/index.ts";
import type { S3Zugang } from "./minio.ts";

/*
 * The operator's S3 target (BAULISTE.md Z-601; docs/plan.md, "S3-Ziel und Zugang je Installation
 * (Z-601)"): endpoint, region and bucket in `backup_ziele`, the admin access (access key and secret
 * key) as one secret of the operator in `geheimnisse`, encrypted. The API shows of the access only
 * whether it is set; only the Zentrale's own calls to MinIO read it (`backupZielZugang`), never an
 * answer and never a message to an agent. Endpoint and bucket change only while no installation has
 * an access there; new settings make every waiting attempt due at once, as for DNS.
 */

export const ADMIN_GEHEIMNIS = "backup-s3-admin";
const ADMIN_ZWECK = "backup:s3-admin";

export type BackupZiel = {
  endpunkt: string | null;
  region: string | null;
  bucket: string | null;
  zugangGesetzt: boolean;
};

export type NeuesBackupZiel = {
  endpunkt: string;
  region: string;
  bucket: string;
  /** Left out: the admin access set before stays */
  zugang?: S3Zugang | undefined;
};

type Deps = { db: Db; schreibDb: SchreibDb; schluessel: Schluesselbund };

const zeileVon = (db: Db, betreiberId: string) =>
  db.select().from(backupZiele).where(eq(backupZiele.betreiberId, betreiberId)).get();

const adminZeile = (db: Db, betreiberId: string) =>
  db
    .select({ wert: geheimnisse.wert })
    .from(geheimnisse)
    .where(
      and(eq(geheimnisse.betreiberId, betreiberId), eq(geheimnisse.geheimnisId, ADMIN_GEHEIMNIS)),
    )
    .get();

export const backupZielLesen = (db: Db, betreiberId: string): BackupZiel => {
  const zeile = zeileVon(db, betreiberId);
  return {
    endpunkt: zeile?.endpunkt ?? null,
    region: zeile?.region ?? null,
    bucket: zeile?.bucket ?? null,
    zugangGesetzt: adminZeile(db, betreiberId) !== undefined,
  };
};

/** The operator's installations with an access made, due or not yet deleted at the target */
const mitZugang = (db: Db, betreiberId: string) =>
  db
    .select({ id: backupZugaenge.installationId, zustand: backupZugaenge.zustand })
    .from(backupZugaenge)
    .where(
      and(
        eq(backupZugaenge.betreiberId, betreiberId),
        inArray(backupZugaenge.zustand, ["anlegen", "angelegt", "loeschen"]),
      ),
    )
    .all();

export type ZielGesetzt =
  | { ok: true; ziel: BackupZiel }
  | { ok: false; grund: "ziel_in_benutzung" | "zugang_fehlt" };

/** Sets endpoint, region and bucket, and the admin access when given; the audit log marks it only */
export const backupZielSetzen = (
  deps: Deps,
  kontext: Kontext,
  neu: NeuesBackupZiel,
): ZielGesetzt => {
  const { betreiberId, jetzt } = kontext;
  const alt = zeileVon(deps.db, betreiberId);
  if (!neu.zugang && !adminZeile(deps.db, betreiberId)) return { ok: false, grund: "zugang_fehlt" };
  const zeile = {
    endpunkt: neu.endpunkt,
    region: neu.region,
    bucket: neu.bucket,
    geaendertAm: jetzt,
  };
  const ortNeu = !alt || alt.endpunkt !== neu.endpunkt || alt.bucket !== neu.bucket;
  const geaendert = ortNeu || alt?.region !== neu.region;
  const zugaenge = mitZugang(deps.db, betreiberId);
  if (alt && ortNeu && zugaenge.some((z) => z.zustand !== "anlegen"))
    return { ok: false, grund: "ziel_in_benutzung" };
  if (geaendert || neu.zugang)
    schreiben(deps.schreibDb, kontext, "backup.ziel", (w) => {
      for (const z of zugaenge.filter((z) => z.zustand !== "angelegt"))
        w.aendern("backupZugaenge", { installationId: z.id }, { naechsterVersuch: jetzt });
      if (alt && geaendert) w.aendern("backupZiele", {}, zeile);
      else if (!alt) w.einfuegen("backupZiele", { betreiberId, ...zeile });
      if (neu.zugang)
        geheimnisSetzen(w, deps.schluessel, {
          betreiberId,
          geheimnisId: ADMIN_GEHEIMNIS,
          zweck: ADMIN_ZWECK,
          klartext: JSON.stringify(neu.zugang),
          jetzt,
        });
    });
  return { ok: true, ziel: backupZielLesen(deps.db, betreiberId) };
};

/** What the settings stand at, the access as its ciphertext: as `dnsStand` (modules/dns) */
export const backupZielStand = (db: Db, betreiberId: string): string => {
  const z = zeileVon(db, betreiberId);
  return JSON.stringify([z?.endpunkt, z?.region, z?.bucket, adminZeile(db, betreiberId)?.wert]);
};

export type ZielZugang =
  | { ok: true; endpunkt: string; region: string; bucket: string; admin: S3Zugang }
  | { ok: false; grund: string };

/** Everything a call to MinIO needs, the admin access decrypted, or what is missing */
export const backupZielZugang = (db: Db, bund: Schluesselbund, betreiberId: string): ZielZugang => {
  const zeile = zeileVon(db, betreiberId);
  if (!zeile) return { ok: false, grund: "no S3 target set" };
  const admin = geheimnisLesen(db, bund, betreiberId, ADMIN_GEHEIMNIS);
  if (!admin.ok)
    return {
      ok: false,
      grund: admin.grund === "fehlt" ? "no admin access set" : "the admin access does not decrypt",
    };
  const { endpunkt, region, bucket } = zeile;
  return { ok: true, endpunkt, region, bucket, admin: JSON.parse(admin.wert) as S3Zugang };
};
