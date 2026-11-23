import {
  ARCHIV_ORDNER,
  archivDatei,
  type BackupTeil,
  INSTALLATIONS_NAME,
  OHNE_HASH,
  signieren,
} from "@steuerzentrale/manifest";
import { dateiLesen, type SichernBefehlDeps } from "../backup/befehl.ts";
import type { BackupDatei } from "../backup/datei.ts";
import { archivArgv, resticGrund, zugangIni } from "../backup/restic.ts";
import type { ResticLauf } from "../backup/sichern.ts";

/*
 * `steuerzentrale-agent archivieren <installation> <region>` (BAULISTE.md Z-604; docs/plan.md,
 * "Kündigung und Löschung"), started by the agent as the installation's user after the last backup:
 * for each part of backup.json, the newest snapshot as one file (restic.ts, archivArgv) into the
 * user's own folder, then uploaded with the installation's own S3 access to
 * `<prefix>archiv/<file>` beside its repository (PutObject, SigV4 with an unsigned body), then the
 * file removed. Only the user's own access and files: its policy reaches nothing outside its
 * prefix. The last line of the output is the answer, with the files and their sizes; it names no
 * value of backup.json.
 */

export type ArchivDeps = Pick<SichernBefehlDeps, "uid" | "home" | "dateien"> & {
  restic: ResticLauf;
  jetzt: () => number;
  /** The folder of the user's own where each file lies until it is uploaded */
  ordner: () => Promise<string>;
  /** The size of a file in bytes */
  groesse: (pfad: string) => Promise<number>;
  /** PUT of the file with these headers; the HTTP status */
  hochladen: (url: URL, pfad: string, koepfe: Record<string, string>) => Promise<number>;
  entfernen: (pfad: string) => Promise<void>;
};

export type Objekt = { tag: string; datei: string; bytes: number };
export type Archiviert = { ok: true; objekte: Objekt[] } | { ok: false; grund: string };

export const ARCHIVIEREN_USAGE = "usage: steuerzentrale-agent archivieren <installation> <region>";

/** A single PUT holds 5 GiB at most (Amazon S3, PutObject) */
const PUT_MAX = 5 * 1024 ** 3;

const REGION = /^[a-z0-9-]{1,32}$/;

/** `s3:<endpoint>/<bucket>/<prefix>` (backupRepository) taken apart */
export const repositoryOrt = (
  repository: string,
): { endpunkt: string; bucket: string; praefix: string } | undefined => {
  const m = /^s3:(https?:\/\/[^/]+)\/([^/]+)\/(.+)$/.exec(repository);
  return m ? { endpunkt: m[1] as string, bucket: m[2] as string, praefix: `${m[3]}/` } : undefined;
};

const teilArchivieren = async (
  deps: ArchivDeps,
  d: BackupDatei,
  t: BackupTeil,
  region: string,
  ordner: string,
): Promise<Objekt | string> => {
  const ort = repositoryOrt(d.repository);
  if (!ort) return "the repository is not on S3";
  const datei = archivDatei(t);
  const pfad = `${ordner}/${datei}`;
  try {
    const a = await deps.restic(
      {
        argv: archivArgv({ installation: d.installation, repository: d.repository }, t),
        datei: pfad,
      },
      { passwort: d.passwort, zugang: zugangIni(d.zugang) },
      new AbortController().signal,
    );
    if (a.code !== 0) return `${t.tag}: ${resticGrund(a.code)}`;
    const bytes = await deps.groesse(pfad);
    if (bytes > PUT_MAX) return `${t.tag}: ${bytes} bytes, more than one upload holds (5 GiB)`;
    const url = new URL(`${ort.endpunkt}/${ort.bucket}`);
    url.pathname += `/${`${ort.praefix}${ARCHIV_ORDNER}${datei}`.split("/").map(encodeURIComponent).join("/")}`;
    const koepfe = await signieren({
      methode: "PUT",
      url,
      inhaltHash: OHNE_HASH,
      zugang: { accessKey: d.zugang.schluesselId, secretKey: d.zugang.geheim },
      region,
      jetzt: deps.jetzt(),
    });
    const status = await deps.hochladen(url, pfad, koepfe);
    if (status !== 200) return `${t.tag}: upload HTTP ${status}`;
    return { tag: t.tag, datei, bytes };
  } catch (e) {
    return `${t.tag}: ${String(e).replaceAll(d.zugang.geheim, "[geheim]").slice(0, 300)}`;
  } finally {
    await deps.entfernen(pfad).catch(() => {});
  }
};

/** Every part, one after the other; the first that fails ends it */
export const archivieren = async (
  deps: ArchivDeps,
  d: BackupDatei,
  region: string,
): Promise<Archiviert> => {
  const ordner = await deps.ordner();
  const objekte: Objekt[] = [];
  for (const t of d.teile) {
    const o = await teilArchivieren(deps, d, t as BackupTeil, region, ordner);
    if (typeof o === "string") return { ok: false, grund: o };
    objekte.push(o);
  }
  return { ok: true, objekte };
};

export const archivierenBefehl = async (
  args: string[],
  deps: ArchivDeps,
): Promise<{ code: number; out: string }> => {
  const [installation = "", region = "", ...rest] = args;
  if (!INSTALLATIONS_NAME.test(installation) || !REGION.test(region) || rest.length > 0)
    return { code: 2, out: ARCHIVIEREN_USAGE };
  const antwort = (a: Archiviert) => ({ code: a.ok ? 0 : 1, out: JSON.stringify(a) });
  if (deps.uid() === 0)
    return antwort({ ok: false, grund: "archivieren runs as the installation's user" });
  const d = await dateiLesen(deps, installation);
  if (typeof d === "string") return antwort({ ok: false, grund: d });
  return antwort(await archivieren(deps, d, region));
};
