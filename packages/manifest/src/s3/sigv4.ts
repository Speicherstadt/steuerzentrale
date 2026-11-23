/*
 * AWS Signature Version 4 for the requests the Zentrale sends to MinIO (BAULISTE.md Z-601;
 * docs/plan.md, "S3-Ziel und Zugang je Installation (Z-601)") and the agent's upload of an archive
 * (Z-604), with Web Crypto and no dependency; pure but for the clock passed in.
 * After the AWS documentation "Signature Calculations for the Authorization Header: Transferring
 * Payload in a Single Chunk" (Amazon S3 API reference): canonical request, string to sign with the
 * scope `<date>/<region>/s3/aws4_request`, the signing key as a chain of HMAC-SHA256, and the header
 * `Authorization: AWS4-HMAC-SHA256 Credential=…, SignedHeaders=…, Signature=…`. The payload's
 * SHA-256 goes into `x-amz-content-sha256`, as MinIO's admin API wants it (madmin-go, api.go).
 */

const subtle = globalThis.crypto.subtle;
const text = (s: string) => new TextEncoder().encode(s);

const hex = (b: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (daten: Uint8Array<ArrayBuffer>): Promise<string> =>
  hex(await subtle.digest("SHA-256", daten));

const hmac = async (
  key: Uint8Array<ArrayBuffer>,
  daten: string,
): Promise<Uint8Array<ArrayBuffer>> => {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, text(daten)));
};

/** RFC 3986: every byte but the unreserved characters percent-encoded, upper-case hex */
const kodieren = (s: string): string =>
  [...text(s)]
    .map((b) => {
      const c = String.fromCharCode(b);
      return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");

/** The path, each segment encoded once (S3 does not encode twice); URL keeps it encoded already */
const kanonischerPfad = (pfad: string): string =>
  pfad
    .split("/")
    .map((teil) => kodieren(decodeURIComponent(teil)))
    .join("/") || "/";

const kanonischeAbfrage = (suche: URLSearchParams): string =>
  [...suche.entries()]
    .map(([k, v]) => [kodieren(k), kodieren(v)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

/** `20130524T000000Z` */
export const amzZeit = (ms: number): string =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

export type Signieren = {
  methode: string;
  url: URL;
  /** Further headers to sign besides host, x-amz-content-sha256 and x-amz-date, lower-case */
  kopf?: Record<string, string>;
  /** The payload's SHA-256 in hex */
  inhaltHash: string;
  zugang: { accessKey: string; secretKey: string };
  region: string;
  jetzt: number;
};

const bereichVon = (tag: string, region: string) => `${tag}/${region}/s3/aws4_request`;

/** The signature of a canonical request (the string to sign and the chain of HMACs) */
const signaturVon = async (
  kanonisch: string,
  zeit: string,
  region: string,
  secretKey: string,
): Promise<string> => {
  const tag = zeit.slice(0, 8);
  const zuSignieren = [
    "AWS4-HMAC-SHA256",
    zeit,
    bereichVon(tag, region),
    await sha256Hex(text(kanonisch)),
  ].join("\n");
  let key = text(`AWS4${secretKey}`);
  for (const teil of [tag, region, "s3", "aws4_request"]) key = await hmac(key, teil);
  return hex(await hmac(key, zuSignieren));
};

const kanonischeAnfrage = (
  methode: string,
  url: URL,
  koepfe: Record<string, string>,
  inhaltHash: string,
): { kanonisch: string; signiert: string } => {
  const namen = Object.keys(koepfe)
    .map((k) => k.toLowerCase())
    .sort();
  const signiert = namen.join(";");
  const kanonisch = [
    methode,
    kanonischerPfad(url.pathname),
    kanonischeAbfrage(url.searchParams),
    namen.map((k) => `${k}:${String(koepfe[k]).trim()}\n`).join(""),
    signiert,
    inhaltHash,
  ].join("\n");
  return { kanonisch, signiert };
};

/** The headers of the signed request: x-amz-content-sha256, x-amz-date, Authorization and `kopf` */
export const signieren = async (s: Signieren): Promise<Record<string, string>> => {
  const zeit = amzZeit(s.jetzt);
  const koepfe: Record<string, string> = {
    ...s.kopf,
    host: s.url.host,
    "x-amz-content-sha256": s.inhaltHash,
    "x-amz-date": zeit,
  };
  const { kanonisch, signiert } = kanonischeAnfrage(s.methode, s.url, koepfe, s.inhaltHash);
  const signatur = await signaturVon(kanonisch, zeit, s.region, s.zugang.secretKey);
  const bereich = bereichVon(zeit.slice(0, 8), s.region);
  const { host: _host, ...ohneHost } = koepfe;
  return {
    ...ohneHost,
    authorization: `AWS4-HMAC-SHA256 Credential=${s.zugang.accessKey}/${bereich}, SignedHeaders=${signiert}, Signature=${signatur}`,
  };
};

/** What a body signed without its hash carries (a pre-signed URL, an upload too large to hash) */
export const OHNE_HASH = "UNSIGNED-PAYLOAD";

export type Vorsignieren = {
  methode: "GET" | "PUT";
  url: URL;
  zugang: { accessKey: string; secretKey: string };
  region: string;
  jetzt: number;
  /** Seconds the link is valid, 1 to 604800 (seven days) */
  gueltigS: number;
};

/** The longest a pre-signed URL may be valid: seven days */
export const VORSIGNIERT_MAX_S = 604_800;

/**
 * A pre-signed URL (AWS documentation "Authenticating Requests: Using Query Parameters"): the
 * signature over host only and the unsigned body, in the query with algorithm, credential, date
 * and expiry. Whoever holds it may make this one request until it expires; S3 refuses it after.
 */
export const vorsignieren = async (v: Vorsignieren): Promise<URL> => {
  if (!Number.isInteger(v.gueltigS) || v.gueltigS < 1 || v.gueltigS > VORSIGNIERT_MAX_S)
    throw new Error(`gueltigS must be 1 to ${VORSIGNIERT_MAX_S}`);
  const zeit = amzZeit(v.jetzt);
  const url = new URL(v.url);
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set(
    "X-Amz-Credential",
    `${v.zugang.accessKey}/${bereichVon(zeit.slice(0, 8), v.region)}`,
  );
  url.searchParams.set("X-Amz-Date", zeit);
  url.searchParams.set("X-Amz-Expires", String(v.gueltigS));
  url.searchParams.set("X-Amz-SignedHeaders", "host");
  const { kanonisch } = kanonischeAnfrage(v.methode, url, { host: url.host }, OHNE_HASH);
  url.searchParams.set(
    "X-Amz-Signature",
    await signaturVon(kanonisch, zeit, v.region, v.zugang.secretKey),
  );
  return url;
};
