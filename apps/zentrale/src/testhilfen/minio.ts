import { sha256Hex } from "@steuerzentrale/manifest";
import { madminEntschluesseln } from "../modules/backups/madmin-daten.ts";
import { kopfSignatur, type S3Lage, s3Behandeln } from "./minio-s3.ts";

/*
 * A stand-in for MinIO's admin API, service accounts only (docs/plan.md, "Was sich in der CI nicht
 * echt testen lässt"; modules/backups/minio.ts names the calls): a Bun server on a free port of
 * localhost, the accounts in memory. It checks the AWS Signature V4 of the admin's access and the
 * body's hash, decrypts the body of `add-service-account` with the admin's secret key as MinIO
 * does (madmin.DecryptData), and answers as minio/minio's cmd/admin-handlers-users.go: 200 for a
 * new account, 204 for a deleted one, 404 `XMinioInvalidIAMCredentials` for one that is not there,
 * 403 `SignatureDoesNotMatch` for a wrong signature. `scheitern(n)` makes the next n requests fail
 * with 500; `anfragen` keeps every request for the tests to search. Objects (Z-604) are
 * minio-s3.ts. Started by tests and by the e2e
 * run (`bun apps/zentrale/src/testhilfen/minio.ts <port>`). The real MinIO runs in CI with the agent.
 */

export const TEST_ADMIN = {
  accessKey: "minio-admin-e2e",
  secretKey: "minio-admin-geheim-7c1f9b2e",
};
export const TEST_REGION = "eu-central-1";

export type Dienstkonto = {
  accessKey: string;
  secretKey: string;
  policy: unknown;
  name: string;
  description: string;
};

export type MinioAnfrage = {
  methode: string;
  pfad: string;
  autorisierung: string;
  /** The body as it came, bytes as latin1 */
  body: string;
};

const fehler = (status: number, code: string, message: string) =>
  Response.json({ Code: code, Message: message, Resource: "", RequestId: "" }, { status });

/** Whether the request carries the admin's valid signature over exactly this body */
const signiertVomAdmin = async (anfrage: Request, body: Uint8Array<ArrayBuffer>, region: string) =>
  anfrage.headers.get("x-amz-content-sha256") === (await sha256Hex(body)) &&
  (await kopfSignatur(anfrage, body, region, (k) =>
    k === TEST_ADMIN.accessKey ? TEST_ADMIN.secretKey : undefined,
  )) === TEST_ADMIN.accessKey;

/** The prefix a service account's policy grants (backupPolicy), as the stand-in reads it */
const praefixDerPolicy = (policy: unknown): string | undefined => {
  const p = policy as { Statement?: { Resource?: string[] }[] } | undefined;
  for (const s of p?.Statement ?? [])
    for (const r of s.Resource ?? []) {
      const m = /^arn:aws:s3:::[^/]+\/(.+)\*$/.exec(r);
      if (m) return m[1];
    }
  return undefined;
};

export const minioNachbau = (
  optionen: { port?: number; region?: string; jetzt?: () => number } = {},
) => {
  const region = optionen.region ?? TEST_REGION;
  const konten = new Map<string, Dienstkonto>();
  const objekte = new Map<string, Uint8Array<ArrayBuffer>>();
  const s3: S3Lage = {
    region,
    objekte,
    jetzt: optionen.jetzt ?? Date.now,
    geheimVon: (k) =>
      k === TEST_ADMIN.accessKey ? TEST_ADMIN.secretKey : konten.get(k)?.secretKey,
    praefixVon: (k) =>
      k === TEST_ADMIN.accessKey ? null : praefixDerPolicy(konten.get(k)?.policy),
  };
  const anfragen: MinioAnfrage[] = [];
  let scheitert = 0;

  const anlegen = async (body: Uint8Array<ArrayBuffer>): Promise<Response> => {
    const json = await madminEntschluesseln(TEST_ADMIN.secretKey, body);
    const neu = json === undefined ? undefined : (JSON.parse(json) as Partial<Dienstkonto>);
    if (!neu?.accessKey || !neu.secretKey)
      return fehler(
        400,
        "XMinioAdminConfigBadJSON",
        "JSON configuration provided is of incorrect format",
      );
    if (konten.has(neu.accessKey))
      return fehler(409, "XMinioAdminServiceAccountExists", "The service account already exists");
    konten.set(neu.accessKey, {
      accessKey: neu.accessKey,
      secretKey: neu.secretKey,
      policy: neu.policy,
      name: neu.name ?? "",
      description: neu.description ?? "",
    });
    // MinIO answers with the credentials, encrypted; the Zentrale chose them and does not read it
    return new Response(new Uint8Array(64), { status: 200 });
  };

  const behandeln = async (anfrage: Request): Promise<Response> => {
    const url = new URL(anfrage.url);
    const body = new Uint8Array(await anfrage.arrayBuffer());
    anfragen.push({
      methode: anfrage.method,
      pfad: url.pathname + url.search,
      autorisierung: anfrage.headers.get("authorization") ?? "",
      body: Buffer.from(body).toString("latin1"),
    });
    if (scheitert > 0) {
      scheitert -= 1;
      return fehler(500, "InternalError", "We encountered an internal error, please try again.");
    }
    if (!url.pathname.startsWith("/minio/admin/")) return s3Behandeln(s3, anfrage, body);
    if (!(await signiertVomAdmin(anfrage, body, region)))
      return fehler(
        403,
        "SignatureDoesNotMatch",
        "The request signature we calculated does not match",
      );
    const route = `${anfrage.method} ${url.pathname}`;
    if (route === "PUT /minio/admin/v3/add-service-account") return anlegen(body);
    if (route === "DELETE /minio/admin/v3/delete-service-account") {
      const accessKey = url.searchParams.get("accessKey") ?? "";
      if (!konten.delete(accessKey))
        return fehler(
          404,
          "XMinioInvalidIAMCredentials",
          "The specified service account is not found",
        );
      return new Response(null, { status: 204 });
    }
    return fehler(400, "InvalidRequest", "unknown admin call");
  };

  const server = Bun.serve({ port: optionen.port ?? 0, hostname: "127.0.0.1", fetch: behandeln });
  return {
    url: `http://127.0.0.1:${server.port}`,
    region,
    anfragen,
    konten: () => [...konten.values()],
    /** The objects as `<bucket>/<key>` */
    objekte,
    scheitern: (n: number) => {
      scheitert = n;
    },
    stoppen: () => server.stop(true),
  };
};

if (import.meta.main) {
  const port = Number(process.argv[2] ?? "28302");
  const nachbau = minioNachbau({ port });
  console.log(JSON.stringify({ msg: "MinIO stand-in", url: nachbau.url }));
}
