import { sha256Hex, signieren } from "@steuerzentrale/manifest";
import { ohneGeheimnis, type S3Zugang } from "./minio.ts";

/*
 * Deleting an installation's restic repository and archive (BAULISTE.md Z-604; docs/plan.md,
 * "Kündigung und Löschung"): every object below its prefix, listed with ListObjectsV2 and deleted
 * one by one with DeleteObject (Amazon S3 API reference), signed with the installation's own access,
 * whose policy reaches nothing outside the prefix (backupPolicy), so no mistake here can touch
 * another installation's backups. The `fetch` is passed in; the tests run it against the stand-in
 * in testhilfen/minio.ts, the agent's CI test against MinIO.
 */

const ZEITLIMIT_MS = 30_000;
const LEER = new Uint8Array(0);

export type S3Ort = {
  fetch: typeof fetch;
  endpunkt: string;
  region: string;
  bucket: string;
  zugang: S3Zugang;
  jetzt: () => number;
};

/** `/<bucket>/<key>`, each segment of the key encoded once */
const objektUrl = (o: Pick<S3Ort, "endpunkt" | "bucket">, schluessel = ""): URL => {
  const url = new URL(`${o.endpunkt.replace(/\/+$/, "")}/${o.bucket}`);
  if (schluessel !== "")
    url.pathname += `/${schluessel.split("/").map(encodeURIComponent).join("/")}`;
  return url;
};

const anfrage = async (o: S3Ort, methode: "GET" | "DELETE", url: URL) => {
  const koepfe = await signieren({
    methode,
    url,
    inhaltHash: await sha256Hex(LEER),
    zugang: o.zugang,
    region: o.region,
    jetzt: o.jetzt(),
  });
  return o.fetch(url, {
    method: methode,
    headers: koepfe,
    redirect: "error",
    signal: AbortSignal.timeout(ZEITLIMIT_MS),
  });
};

const ENTITAETEN: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};
const entschluesseln = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (e) => ENTITAETEN[e] ?? e);

export type Seite = { schluessel: string[]; weiter: string | undefined };

/** One page of ListObjectsV2 (up to 1000 keys) below the prefix */
export const seiteLesen = (xml: string): Seite => {
  const schluessel = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) =>
    entschluesseln(m[1] ?? ""),
  );
  const abgeschnitten = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1];
  return { schluessel, weiter: abgeschnitten && token ? entschluesseln(token) : undefined };
};

const fehler = (o: S3Ort, text: string): { ok: false; fehler: string } => ({
  ok: false,
  fehler: ohneGeheimnis(text, [o.zugang.secretKey]),
});

/** Every key below the prefix, page after page */
export const objekteListen = async (
  o: S3Ort,
  praefix: string,
): Promise<{ ok: true; schluessel: string[] } | { ok: false; fehler: string }> => {
  const alle: string[] = [];
  let weiter: string | undefined;
  try {
    do {
      const url = objektUrl(o);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", praefix);
      if (weiter !== undefined) url.searchParams.set("continuation-token", weiter);
      const a = await anfrage(o, "GET", url);
      const text = await a.text();
      if (a.status !== 200) return fehler(o, `ListObjectsV2: HTTP ${a.status}`);
      const seite = seiteLesen(text);
      alle.push(...seite.schluessel.filter((s) => s.startsWith(praefix)));
      weiter = seite.weiter;
    } while (weiter !== undefined);
  } catch (e) {
    return fehler(o, `ListObjectsV2: ${String(e)}`);
  }
  return { ok: true, schluessel: alle };
};

/**
 * Deletes every object below the prefix, which must end in `/`; returns how many. S3 answers 204
 * for a key that is gone already, so a second run after a lost answer deletes nothing twice
 */
export const praefixLoeschen = async (
  o: S3Ort,
  praefix: string,
): Promise<{ ok: true; geloescht: number } | { ok: false; fehler: string }> => {
  if (!praefix.endsWith("/") || praefix.length < 3)
    return { ok: false, fehler: "the prefix must name one installation and end in /" };
  const liste = await objekteListen(o, praefix);
  if (!liste.ok) return liste;
  try {
    for (const s of liste.schluessel) {
      const a = await anfrage(o, "DELETE", objektUrl(o, s));
      if (a.status !== 204 && a.status !== 200) return fehler(o, `DeleteObject: HTTP ${a.status}`);
    }
  } catch (e) {
    return fehler(o, `DeleteObject: ${String(e)}`);
  }
  const rest = await objekteListen(o, praefix);
  if (!rest.ok) return rest;
  if (rest.schluessel.length > 0)
    return fehler(o, `${rest.schluessel.length} objects are still below the prefix`);
  return { ok: true, geloescht: liste.schluessel.length };
};

/** The URL of an object for a pre-signed link (archive, Z-604) */
export const objektAdresse = objektUrl;
