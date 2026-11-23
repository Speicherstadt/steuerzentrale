/*
 * AWS Signature Version 4 for the requests the Zentrale sends to MinIO (BAULISTE.md Z-601;
 * docs/plan.md, "S3-Ziel und Zugang je Installation (Z-601)"), with Web Crypto and no dependency.
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

/** The headers of the signed request: x-amz-content-sha256, x-amz-date, Authorization and `kopf` */
export const signieren = async (s: Signieren): Promise<Record<string, string>> => {
  const zeit = amzZeit(s.jetzt);
  const tag = zeit.slice(0, 8);
  const koepfe: Record<string, string> = {
    ...s.kopf,
    host: s.url.host,
    "x-amz-content-sha256": s.inhaltHash,
    "x-amz-date": zeit,
  };
  const namen = Object.keys(koepfe)
    .map((k) => k.toLowerCase())
    .sort();
  const signiert = namen.join(";");
  const kanonisch = [
    s.methode,
    kanonischerPfad(s.url.pathname),
    kanonischeAbfrage(s.url.searchParams),
    namen.map((k) => `${k}:${String(koepfe[k]).trim()}\n`).join(""),
    signiert,
    s.inhaltHash,
  ].join("\n");
  const bereich = `${tag}/${s.region}/s3/aws4_request`;
  const zuSignieren = ["AWS4-HMAC-SHA256", zeit, bereich, await sha256Hex(text(kanonisch))].join(
    "\n",
  );
  let key = text(`AWS4${s.zugang.secretKey}`);
  for (const teil of [tag, s.region, "s3", "aws4_request"]) key = await hmac(key, teil);
  const signatur = hex(await hmac(key, zuSignieren));
  const { host: _host, ...ohneHost } = koepfe;
  return {
    ...ohneHost,
    authorization: `AWS4-HMAC-SHA256 Credential=${s.zugang.accessKey}/${bereich}, SignedHeaders=${signiert}, Signature=${signatur}`,
  };
};
