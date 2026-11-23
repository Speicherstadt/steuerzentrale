import { OHNE_HASH, sha256Hex, signieren, vorsignieren } from "@steuerzentrale/manifest";

/*
 * The S3 part of the MinIO stand-in (minio.ts; BAULISTE.md Z-604): objects in memory, PutObject,
 * GetObject, DeleteObject and ListObjectsV2, each signed in the header or pre-signed in the query
 * (AWS SigV4) by the admin or a service account. A service account reaches only the objects below
 * the prefix of its policy (`arn:aws:s3:::<bucket>/<prefix>*`, backupPolicy). A pre-signed URL is
 * refused once `X-Amz-Date` plus `X-Amz-Expires` lies behind the stand-in's clock, with 403
 * `AccessDenied` "Request has expired", as MinIO answers (cmd/signature-v4.go, doesPresignedSignatureMatch).
 */

export type Wer = { accessKey: string; praefix: string | null };

const fehler = (status: number, code: string, message: string) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`,
    { status, headers: { "content-type": "application/xml" } },
  );

export const zeitAus = (amz: string): number => {
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amz);
  if (!t) return Number.NaN;
  const [, j, mo, d, h, mi, s] = t.map(Number) as number[];
  return Date.UTC(j as number, (mo as number) - 1, d, h, mi, s);
};

const KOPF =
  /^AWS4-HMAC-SHA256 Credential=([^/]+)\/\d{8}\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=[0-9a-f]{64}$/;

/** The access key whose valid signature the header carries, over this body or UNSIGNED-PAYLOAD */
export const kopfSignatur = async (
  anfrage: Request,
  body: Uint8Array<ArrayBuffer>,
  region: string,
  geheimVon: (accessKey: string) => string | undefined,
): Promise<string | undefined> => {
  const autorisierung = anfrage.headers.get("authorization") ?? "";
  const hash = anfrage.headers.get("x-amz-content-sha256") ?? "";
  if (hash !== OHNE_HASH && hash !== (await sha256Hex(body))) return undefined;
  const m = KOPF.exec(autorisierung);
  const geheim = m ? geheimVon(m[1] ?? "") : undefined;
  if (!m || geheim === undefined || m[2] !== region) return undefined;
  const weitere = (m[3] ?? "")
    .split(";")
    .filter((k) => !["host", "x-amz-content-sha256", "x-amz-date"].includes(k));
  const erwartet = await signieren({
    methode: anfrage.method,
    url: new URL(anfrage.url),
    kopf: Object.fromEntries(weitere.map((k) => [k, anfrage.headers.get(k) ?? ""])),
    inhaltHash: hash,
    zugang: { accessKey: m[1] ?? "", secretKey: geheim },
    region,
    jetzt: zeitAus(anfrage.headers.get("x-amz-date") ?? ""),
  });
  return erwartet.authorization === autorisierung ? m[1] : undefined;
};

type Vorsigniert = { ok: true; accessKey: string } | { ok: false; antwort: Response } | undefined;

/** A pre-signed GET or PUT: its signature, then its expiry against the stand-in's clock */
const vorsigniert = async (
  anfrage: Request,
  region: string,
  geheimVon: (accessKey: string) => string | undefined,
  jetzt: number,
): Promise<Vorsigniert> => {
  const url = new URL(anfrage.url);
  const q = url.searchParams;
  if (q.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256") return undefined;
  const nein = { ok: false, antwort: fehler(403, "SignatureDoesNotMatch", "signature") } as const;
  const [accessKey, , bereichRegion] = (q.get("X-Amz-Credential") ?? "").split("/");
  const geheim = geheimVon(accessKey ?? "");
  if (geheim === undefined || bereichRegion !== region) return nein;
  const datum = zeitAus(q.get("X-Amz-Date") ?? "");
  const gueltigS = Number(q.get("X-Amz-Expires"));
  const ohne = new URL(url);
  for (const k of [...q.keys()].filter((k) => k.startsWith("X-Amz-"))) ohne.searchParams.delete(k);
  const methode = anfrage.method === "PUT" ? "PUT" : "GET";
  const erwartet = await vorsignieren({
    methode,
    url: ohne,
    zugang: { accessKey: accessKey ?? "", secretKey: geheim },
    region,
    jetzt: datum,
    gueltigS,
  }).catch(() => undefined);
  if (erwartet?.searchParams.get("X-Amz-Signature") !== q.get("X-Amz-Signature")) return nein;
  if (jetzt > datum + gueltigS * 1000)
    return { ok: false, antwort: fehler(403, "AccessDenied", "Request has expired") };
  return { ok: true, accessKey: accessKey ?? "" };
};

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const liste = (bucket: string, schluessel: string[]) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><KeyCount>${schluessel.length}</KeyCount><IsTruncated>false</IsTruncated>${schluessel.map((k) => `<Contents><Key>${xml(k)}</Key></Contents>`).join("")}</ListBucketResult>`,
    { status: 200, headers: { "content-type": "application/xml" } },
  );

export type S3Lage = {
  region: string;
  objekte: Map<string, Uint8Array<ArrayBuffer>>;
  geheimVon: (accessKey: string) => string | undefined;
  /** The prefix a service account may reach, null for the admin, undefined for an unknown key */
  praefixVon: (accessKey: string) => string | null | undefined;
  jetzt: () => number;
};

/** One S3 call on `/<bucket>[/<key>]` */
export const s3Behandeln = async (
  lage: S3Lage,
  anfrage: Request,
  body: Uint8Array<ArrayBuffer>,
): Promise<Response> => {
  const url = new URL(anfrage.url);
  const vor = await vorsigniert(anfrage, lage.region, lage.geheimVon, lage.jetzt());
  if (vor && !vor.ok) return vor.antwort;
  const accessKey =
    vor?.accessKey ?? (await kopfSignatur(anfrage, body, lage.region, lage.geheimVon));
  if (accessKey === undefined) return fehler(403, "SignatureDoesNotMatch", "signature");
  const erlaubt = lage.praefixVon(accessKey);
  const [, bucket = "", ...teile] = url.pathname.split("/").map(decodeURIComponent);
  const schluessel = teile.join("/");
  const reicht = (k: string) =>
    erlaubt === null || (erlaubt !== undefined && k.startsWith(erlaubt));
  if (schluessel === "" && anfrage.method === "GET") {
    const praefix = url.searchParams.get("prefix") ?? "";
    if (!reicht(praefix)) return fehler(403, "AccessDenied", "Access Denied.");
    const ort = `${bucket}/`;
    const keys = [...lage.objekte.keys()]
      .filter((k) => k.startsWith(ort + praefix))
      .map((k) => k.slice(ort.length))
      .sort();
    return liste(bucket, keys);
  }
  if (!reicht(schluessel)) return fehler(403, "AccessDenied", "Access Denied.");
  const ort = `${bucket}/${schluessel}`;
  if (anfrage.method === "PUT") {
    lage.objekte.set(ort, body);
    return new Response(null, { status: 200 });
  }
  if (anfrage.method === "DELETE") {
    lage.objekte.delete(ort);
    return new Response(null, { status: 204 });
  }
  const objekt = lage.objekte.get(ort);
  if (anfrage.method === "GET" && objekt) return new Response(objekt, { status: 200 });
  return fehler(404, "NoSuchKey", "The specified key does not exist.");
};
