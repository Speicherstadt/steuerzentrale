import { randomBytes } from "node:crypto";
import { manifestPruefen } from "@steuerzentrale/manifest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { backupZugaenge } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import type { Schreiber } from "../audit/index.ts";
import { spalteEntschluesseln, spalteVerschluesseln } from "../geheim/spalten.ts";

/*
 * An installation's own S3 access and restic password (BAULISTE.md Z-601; docs/plan.md, "S3-Ziel und
 * Zugang je Installation (Z-601)"): made in the transaction that records its setup succeeded, for a
 * manifest with parts to back up, due at MinIO at once (abgleich.ts makes it there); due for
 * deletion once the installation is removed. The access and the password are made here and stored
 * encrypted before MinIO hears of them, so an attempt whose answer was lost tries the same access
 * again. Lengths as MinIO allows them for a service account: access key 3 to 20, secret key 8 to 40.
 */

export type ZugangGeheim = { accessKey: string; secretKey: string; passwort: string };

export type Zugang = typeof backupZugaenge.$inferSelect;

export type Zufall = (n: number) => Uint8Array;
const zufallVonNode: Zufall = (n) => new Uint8Array(randomBytes(n));

const ZEICHEN = "abcdefghijklmnopqrstuvwxyz0123456789";
const ZEICHEN_GROSS = `${ZEICHEN}ABCDEFGHIJKLMNOPQRSTUVWXYZ`;

/** `n` characters of `alphabet`, each byte below the largest multiple of its length (no bias) */
const zeichen = (zufall: Zufall, alphabet: string, n: number): string => {
  const grenze = 256 - (256 % alphabet.length);
  let aus = "";
  while (aus.length < n)
    for (const b of zufall(n))
      if (b < grenze && aus.length < n) aus += alphabet[b % alphabet.length];
  return aus;
};

export const zugangErzeugen = (zufall: Zufall = zufallVonNode): ZugangGeheim => ({
  accessKey: `sz${zeichen(zufall, ZEICHEN, 18)}`,
  secretKey: zeichen(zufall, ZEICHEN_GROSS, 40),
  passwort: zeichen(zufall, ZEICHEN_GROSS, 48),
});

const verschluesseln = (
  bund: Schluesselbund,
  betreiberId: string,
  installationId: string,
  g: ZugangGeheim,
) =>
  spalteVerschluesseln(bund, "backupZugaenge", betreiberId, { installationId }, JSON.stringify(g));

export const zugangLesen = (db: Db, betreiberId: string, installationId: string) =>
  db
    .select()
    .from(backupZugaenge)
    .where(
      and(
        eq(backupZugaenge.betreiberId, betreiberId),
        eq(backupZugaenge.installationId, installationId),
      ),
    )
    .get();

export type GeheimGelesen = { ok: true; geheim: ZugangGeheim } | { ok: false; grund: string };

/** The access and password of the row, decrypted; only for MinIO and the installation's server */
export const zugangGeheim = (bund: Schluesselbund, z: Zugang): GeheimGelesen => {
  const klar = spalteEntschluesseln(bund, "backupZugaenge", z.betreiberId, z, z.geheim);
  return klar.ok
    ? { ok: true, geheim: JSON.parse(klar.wert) as ZugangGeheim }
    : { ok: false, grund: `the backup access of ${z.installationId}: ${klar.grund}` };
};

type Eingerichtet = { betreiberId: string; installationId: string; manifest: string };

/** Within the transaction of a setup that succeeded: the row of a new access, due at once */
export const zugangNachEinrichten = (
  w: Schreiber,
  deps: { schluessel: Schluesselbund },
  i: Eingerichtet,
  jetzt: number,
  zufall?: Zufall,
): void => {
  const m = manifestPruefen(i.manifest);
  if (!m.ok || m.manifest.backup.length === 0) return;
  if (w.vorhanden("backupZugaenge", { installationId: i.installationId })) return;
  w.einfuegen("backupZugaenge", {
    betreiberId: i.betreiberId,
    installationId: i.installationId,
    zustand: "anlegen",
    versuche: 0,
    naechsterVersuch: jetzt,
    geheim: verschluesseln(
      deps.schluessel,
      i.betreiberId,
      i.installationId,
      zugangErzeugen(zufall),
    ),
    angelegtAm: jetzt,
    geaendertAm: jetzt,
  });
};

/** Within the transaction that removed the installation: its access is due for deletion */
export const zugangNachEntfernen = (
  w: Schreiber,
  db: Db,
  i: { betreiberId: string; installationId: string },
  jetzt: number,
): void => {
  const z = zugangLesen(db, i.betreiberId, i.installationId);
  if (!z || (z.zustand !== "anlegen" && z.zustand !== "angelegt")) return;
  w.aendern(
    "backupZugaenge",
    { installationId: i.installationId },
    { zustand: "loeschen", versuche: 0, naechsterVersuch: jetzt, geaendertAm: jetzt },
  );
};
