import { signieren, vorsignieren } from "@steuerzentrale/manifest";
import { describe, expect, it } from "vitest";
import {
  FRAGMENT_BYTES,
  madminEntschluesseln,
  madminVerschluesseln,
  sioOeffnen,
  sioVersiegeln,
} from "./madmin-daten.ts";

/*
 * BAULISTE.md Z-601: the Zentrale signs its requests to MinIO and encrypts the bodies of the admin
 * API itself, without a dependency. Checked against published vectors: AWS Signature V4 with the
 * examples of the AWS documentation ("Signature Calculations for the Authorization Header:
 * Transferring Payload in a Single Chunk", Amazon S3 API reference), the sio stream with
 * test_vectors.json of secure-io/sio-go (commit 2e9ca5aa4469, AES-128-GCM with fragments of 16
 * bytes, the same construction as madmin's AES-256-GCM with 16 KiB).
 */

const AWS = {
  accessKey: "AKIAIOSFODNN7EXAMPLE",
  secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const LEER = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const JETZT = Date.UTC(2013, 4, 24);

const signatur = (autorisierung: string | undefined) =>
  /Signature=([0-9a-f]{64})$/.exec(autorisierung ?? "")?.[1];

describe("AWS Signature V4", () => {
  it("signs the documentation's GET Object", async () => {
    const k = await signieren({
      methode: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      kopf: { range: "bytes=0-9" },
      inhaltHash: LEER,
      zugang: AWS,
      region: "us-east-1",
      jetzt: JETZT,
    });
    expect(signatur(k.authorization)).toBe(
      "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(k.authorization).toContain(
      "Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,",
    );
    expect(k).toMatchObject({ "x-amz-date": "20130524T000000Z", "x-amz-content-sha256": LEER });
  });

  it("signs the documentation's PUT Object, with an encoded path", async () => {
    const k = await signieren({
      methode: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
      kopf: {
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
      },
      inhaltHash: "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
      zugang: AWS,
      region: "us-east-1",
      jetzt: JETZT,
    });
    expect(signatur(k.authorization)).toBe(
      "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
  });

  it("signs the documentation's GET Bucket with a query", async () => {
    const k = await signieren({
      methode: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J"),
      inhaltHash: LEER,
      zugang: AWS,
      region: "us-east-1",
      jetzt: JETZT,
    });
    expect(signatur(k.authorization)).toBe(
      "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
    );
  });

  // "Authenticating Requests: Using Query Parameters", the example GET of test.txt for 24 hours
  it("pre-signs the documentation's GET Object in the query (Z-604)", async () => {
    const url = await vorsignieren({
      methode: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      zugang: AWS,
      region: "us-east-1",
      jetzt: JETZT,
      gueltigS: 86_400,
    });
    expect(url.searchParams.get("X-Amz-Signature")).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
    expect(url.searchParams.get("X-Amz-Credential")).toBe(
      "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request",
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("86400");
  });

  it("refuses a pre-signed URL valid for longer than seven days", async () => {
    const neu = (gueltigS: number) =>
      vorsignieren({
        methode: "GET",
        url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
        zugang: AWS,
        region: "us-east-1",
        jetzt: JETZT,
        gueltigS,
      });
    await expect(neu(604_801)).rejects.toThrow();
    await expect(neu(0)).rejects.toThrow();
    await expect(neu(604_800)).resolves.toBeInstanceOf(URL);
  });
});

const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => Number.parseInt(x, 16));
const hex = (b: Uint8Array | undefined) =>
  [...(b ?? [])].map((x) => x.toString(16).padStart(2, "0")).join("");
const aes = (h: string) =>
  globalThis.crypto.subtle.importKey("raw", bytes(h), "AES-GCM", false, ["encrypt", "decrypt"]);

// secure-io/sio-go, test_vectors.json, the AES-128-GCM vectors with BufSize 16 used here
const VEKTOREN = [
  [
    "00000000000000000000000000000000",
    "0000000000000000",
    "",
    "",
    "e0247a864e783cecb1f7996c13cd3f64",
  ],
  [
    "00000000000000000000000000000000",
    "0000000000000000",
    "0000000000000000",
    "0000000000000000",
    "4661d681f92680d7a307c7a036700edde4697a1f3ba7e01b",
  ],
  [
    "0a7a6d49e4ad042f1e1ffa168849d651",
    "4a9ba500be169ab3",
    "d40703848d887a01664c30734fa370581c5f8f6d0ea7bfdd",
    "424d6d60d7e08b3b41e968fc4557b93c",
    "aa4b4ca42d587b98d0d5f009c0efbc4fcaaefdc1c79a3cfe07801ed8c708d259",
  ],
  [
    "20000000000000000000000000000000",
    "2000000000000000",
    "00",
    "0000000000000000000000000000000000000000000000000000000000000000",
    "f58d8fef7ac7782a4361a79c07f5e6c4672d8a45e6cb9ef67cb7177897358deb8d338d313d44f78e0b68a3723d7ca0fe5f62aa8af0a72e508f5d5f8491ecedb2",
  ],
] as const;

describe("the sio stream", () => {
  it.each(VEKTOREN)("seals and opens sio-go's vector %#", async (k, nonce, ad, klar, geheim) => {
    const key = await aes(k);
    expect(hex(await sioVersiegeln(key, bytes(nonce), bytes(klar), bytes(ad), 16))).toBe(geheim);
    expect(hex(await sioOeffnen(key, bytes(nonce), bytes(geheim), bytes(ad), 16))).toBe(klar);
  });

  it("refuses a stream cut at a fragment's end or changed", async () => {
    const [k, nonce, ad, , geheim] = VEKTOREN[3];
    const key = await aes(k);
    expect(await sioOeffnen(key, bytes(nonce), bytes(geheim).slice(0, 32), bytes(ad), 16)).toBe(
      undefined,
    );
    const geaendert = bytes(geheim);
    geaendert[3] = (geaendert[3] ?? 0) ^ 1;
    expect(await sioOeffnen(key, bytes(nonce), geaendert, bytes(ad), 16)).toBe(undefined);
  });
});

describe("madmin's encrypted bodies", () => {
  it("are salt, the id of PBKDF2 with AES-GCM, nonce and the stream, and open with the password", async () => {
    const json = JSON.stringify({ accessKey: "sz1", policy: "x".repeat(FRAGMENT_BYTES + 5) });
    const daten = await madminVerschluesseln("admin-geheim", json);
    expect(daten[32]).toBe(0x02);
    // two fragments of 16 KiB at most, each with its tag
    expect(daten.length).toBe(32 + 1 + 8 + json.length + 2 * 16);
    expect(await madminEntschluesseln("admin-geheim", daten)).toBe(json);
    expect(await madminEntschluesseln("anderes", daten)).toBe(undefined);
    expect(new TextDecoder().decode(daten)).not.toContain("sz1");
  });

  it("refuse madmin's Argon2id ids, which the Zentrale never writes", async () => {
    const daten = await madminVerschluesseln("admin-geheim", "{}");
    daten[32] = 0x00;
    expect(await madminEntschluesseln("admin-geheim", daten)).toBe(undefined);
  });
});
