import { describe, expect, it } from "vitest";
import { testQuellen } from "./testquellen.ts";
import { ZERTIFIKATE, zertifikateLesen } from "./zertifikate.ts";

/*
 * The Pforte's certificates (BAULISTE.md Z-702): Caddy keeps each as
 * certificates/<issuer>/<host>/<host>.crt in its data directory (certmagic, StorageKeys.SiteCert),
 * here the volume sz-pforte-daten of the rootless user sz-pforte. A self-signed certificate for the
 * test, valid until 5 February 2027, 09:07:03 UTC (openssl: "Feb  5 09:07:03 2027 GMT").
 */
const PEM = `-----BEGIN CERTIFICATE-----
MIIBQjCB6aADAgECAgEBMAoGCCqGSM49BAMCMCkxJzAlBgNVBAMTHmhhYmVuLm11
ZWxsZXIuYXBwcy5leGFtcGxlLm9yZzAeFw0yNjExMDEwMDAwMDBaFw0yNzAyMDUw
OTA3MDNaMCkxJzAlBgNVBAMTHmhhYmVuLm11ZWxsZXIuYXBwcy5leGFtcGxlLm9y
ZzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKLe+JPpMYLIh1akySKp+uI7eU58
oE34GQ2l1NJsrymfU6tmfE0ZSxO6bH4KvKz0LHGwvPmI7QKJNLP8VinZ/yOjAjAA
MAoGCCqGSM49BAMCA0gAMEUCIDarHnjwFS8f5ZxxtqtTHDuQbe8ZlGCuRnsF9sHM
NeONAiEAw9YJSPVGCsbaBiQJvNxtMFmzRFsk3IY4T/f3MfBcopo=
-----END CERTIFICATE-----
`;
const BIS = Date.UTC(2027, 1, 5, 9, 7, 3);
const LE = "acme-v02.api.letsencrypt.org-directory";
const HOST = "haben.mueller.apps.example.org";

describe("certificates of the Pforte", () => {
  it("reads the end of each host's certificate, per issuer", async () => {
    const q = testQuellen({
      ordner: {
        [ZERTIFIKATE]: [LE, "acme.zerossl.com-v2-dv90"],
        [`${ZERTIFIKATE}/${LE}`]: [HOST, "kaputt.example.org"],
        [`${ZERTIFIKATE}/acme.zerossl.com-v2-dv90`]: [HOST],
      },
      dateien: {
        [`${ZERTIFIKATE}/${LE}/${HOST}/${HOST}.crt`]: PEM,
        [`${ZERTIFIKATE}/${LE}/kaputt.example.org/kaputt.example.org.crt`]: "kein Zertifikat",
        [`${ZERTIFIKATE}/acme.zerossl.com-v2-dv90/${HOST}/${HOST}.crt`]: PEM,
      },
    });
    expect(await zertifikateLesen(q)).toEqual([
      { host: HOST, gueltigBis: BIS },
      { host: HOST, gueltigBis: BIS },
    ]);
  });

  it("is an empty list while Caddy has none yet, null without the Pforte's data", async () => {
    const daten = ZERTIFIKATE.replace(/\/caddy\/certificates$/, "");
    expect(await zertifikateLesen(testQuellen({ ordner: { [daten]: ["caddy"] } }))).toEqual([]);
    expect(await zertifikateLesen(testQuellen())).toBeNull();
  });

  it("reads only the storage of the Pforte's data volume", () => {
    expect(ZERTIFIKATE).toBe(
      "/home/sz-pforte/.local/share/containers/storage/volumes/sz-pforte-daten/_data/caddy/certificates",
    );
  });
});
