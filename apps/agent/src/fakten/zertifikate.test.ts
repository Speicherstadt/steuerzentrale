import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { echteQuellen, type FaktenQuellen } from "./quellen.ts";
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

  /*
   * The volume belongs to the rootless user sz-pforte, and Caddy inside it may write anything there;
   * the agent reads it as root. The real file system, with the volume moved to a temporary directory.
   */
  describe("in storage the Pforte's user controls", () => {
    let wurzel = "";
    afterEach(() => rmSync(wurzel, { recursive: true, force: true }));

    /** The real sources with every path under the Pforte's data moved below `nach` */
    const umgeleitet = (nach: string): FaktenQuellen => {
      const daten = ZERTIFIKATE.replace(/\/caddy\/certificates$/, "");
      const pfad = (p: unknown) =>
        typeof p === "string" && p.startsWith(daten) ? nach + p.slice(daten.length) : p;
      return Object.fromEntries(
        Object.entries(echteQuellen()).map(([name, f]) => [
          name,
          (erstes: unknown, ...rest: unknown[]) =>
            (f as (...argumente: unknown[]) => unknown)(pfad(erstes), ...rest),
        ]),
      ) as FaktenQuellen;
    };

    const ablage = () => {
      wurzel = mkdtempSync(join(tmpdir(), "sz-zertifikate-"));
      const ordner = join(wurzel, "daten", "caddy", "certificates", LE, HOST);
      mkdirSync(ordner, { recursive: true });
      return { daten: join(wurzel, "daten"), datei: join(ordner, `${HOST}.crt`) };
    };

    it("reads a certificate Caddy wrote as a regular file", async () => {
      const { daten, datei } = ablage();
      writeFileSync(datei, PEM);
      expect(await zertifikateLesen(umgeleitet(daten))).toEqual([{ host: HOST, gueltigBis: BIS }]);
    });

    it("does not wait on a FIFO in place of a certificate", async () => {
      const { daten, datei } = ablage();
      execFileSync("mkfifo", [datei]);
      // Reading a FIFO waits for a writer, and Bun's readFile blocks the event loop meanwhile: a
      // writer 3 s later lets a reading agent go on, so the test ends either way
      spawn("timeout", ["10", "sh", "-c", 'sleep 3; echo x > "$1"', "sh", datei], {
        detached: true,
        stdio: "ignore",
      }).unref();
      const beginn = Date.now();
      expect(await zertifikateLesen(umgeleitet(daten))).toEqual([]);
      expect(Date.now() - beginn).toBeLessThan(1000);
    });

    it("does not follow a symbolic link out of the volume", async () => {
      const { daten, datei } = ablage();
      const draussen = join(wurzel, "draussen.crt");
      writeFileSync(draussen, PEM);
      symlinkSync(draussen, datei);
      expect(await zertifikateLesen(umgeleitet(daten))).toEqual([]);
    });

    it("reads no file larger than a certificate chain", async () => {
      const { daten, datei } = ablage();
      // a valid certificate followed by 2 MiB: Caddy's files are a few KiB
      writeFileSync(datei, PEM + "\n".repeat(2 * 1024 * 1024));
      expect(await zertifikateLesen(umgeleitet(daten))).toEqual([]);
    });
  });
});
