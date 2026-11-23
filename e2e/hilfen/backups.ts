import { type APIRequestContext, expect } from "@playwright/test";

// The admin access the stand-in of MinIO's admin API accepts (apps/zentrale/src/testhilfen/
// minio.ts, TEST_ADMIN and TEST_REGION); the Zentrale of the e2e run talks only to it
// (playwright.config.ts). One target for every run: the projects share one operator, and endpoint
// and bucket stay once an installation has an access there.
export const ENDPUNKT = "http://127.0.0.1:28302";
export const REGION = "eu-central-1";
export const BUCKET = "e2e-backups";
export const ADMIN = { accessKey: "minio-admin-e2e", secretKey: "minio-admin-geheim-7c1f9b2e" };

/** The operator's S3 target at the stand-in of MinIO, set over the API (Z-601) */
export const zielSetzen = async (request: APIRequestContext) => {
  const antwort = await request.put("/api/v1/backup-ziel", {
    data: { endpunkt: ENDPUNKT, region: REGION, bucket: BUCKET, ...ADMIN, grund: "Test" },
  });
  expect(antwort.status()).toBe(200);
};

export type Backups = {
  eingerichtet: boolean;
  laeufe: { id: string; ok: boolean }[];
  pruefRestore: { letzter: { ok: boolean } | null; laeuft: boolean };
  wiederherstellen: { letzter: { phase: string } | null; laeuft: boolean };
};

/** The backups of an installation as the Zentrale answers them */
export const backups = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/v1/installationen/${id}/backups`)).json()) as Backups;
