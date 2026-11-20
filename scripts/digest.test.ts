import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  apiBasis,
  challengeLesen,
  digestAbfragen,
  MANIFEST_ACCEPT,
  plattformenLesen,
  quelleText,
  referenzLesen,
  tokenUrl,
} from "./digest.ts";

const INDEX = JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: [
    { digest: `sha256:${"a".repeat(64)}`, platform: { os: "linux", architecture: "amd64" } },
    { digest: `sha256:${"b".repeat(64)}`, platform: { os: "linux", architecture: "arm64" } },
    { digest: `sha256:${"c".repeat(64)}`, platform: { os: "unknown", architecture: "unknown" } },
  ],
});
const DIGEST = `sha256:${createHash("sha256").update(INDEX).digest("hex")}`;
const JETZT = () => new Date("2026-11-20T23:30:00Z");

type Anfrage = { url: string; methode: string; kopf: Record<string, string> };

/**
 * A registry as ghcr.io answers (OCI Distribution Spec): 401 with a bearer challenge, a token
 * endpoint, and the manifest under its tag and digest only with the token
 */
const registry = (optionen: { mitKopf?: boolean; kopfDigest?: string } = {}) => {
  const anfragen: Anfrage[] = [];
  const f = (async (eingabe: string | URL | Request, init?: RequestInit) => {
    const url = String(eingabe);
    const kopf = (init?.headers ?? {}) as Record<string, string>;
    const methode = init?.method ?? "GET";
    anfragen.push({ url, methode, kopf });
    if (url.startsWith("https://ghcr.io/token"))
      return Response.json({
        token: url.includes("scope=repository%3Aspeicherstadt%2Fhaben%3Apull") ? "t" : "x",
      });
    if (kopf.Authorization !== "Bearer t")
      return new Response(null, {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:speicherstadt/haben:pull"',
        },
      });
    const pfad = new URL(url).pathname;
    if (pfad !== "/v2/speicherstadt/haben/manifests/0.12.0" && !pfad.endsWith(DIGEST))
      return new Response(null, { status: 404 });
    const headers: Record<string, string> = {
      "Content-Type": "application/vnd.oci.image.index.v1+json",
    };
    if (optionen.mitKopf !== false)
      headers["Docker-Content-Digest"] = optionen.kopfDigest ?? DIGEST;
    return new Response(methode === "HEAD" ? null : INDEX, { status: 200, headers });
  }) as typeof fetch;
  return { f, anfragen };
};

describe("reading an image reference", () => {
  it("takes registry, name and tag, and Docker Hub's official images under library/", () => {
    expect(referenzLesen("ghcr.io/speicherstadt/haben:0.12.0")).toEqual({
      ok: true,
      referenz: { registry: "ghcr.io", name: "speicherstadt/haben", tag: "0.12.0" },
    });
    expect(referenzLesen("docker.io/postgres:18")).toMatchObject({
      referenz: { name: "library/postgres" },
    });
    expect(referenzLesen("localhost:5000/beispiel:1.0.0")).toMatchObject({
      referenz: { registry: "localhost:5000", name: "beispiel", tag: "1.0.0" },
    });
  });

  it("refuses a reference without registry or tag, or one that already has a digest", () => {
    for (const text of [
      "tristanteu/haben:0.12.0",
      "ghcr.io/speicherstadt/haben",
      `ghcr.io/speicherstadt/haben@${DIGEST}`,
    ])
      expect(referenzLesen(text)).toMatchObject({ ok: false });
  });

  it("asks Docker Hub on its API host and a local registry over plain HTTP", () => {
    expect(apiBasis("docker.io")).toBe("https://registry-1.docker.io");
    expect(apiBasis("ghcr.io")).toBe("https://ghcr.io");
    expect(apiBasis("localhost:5000")).toBe("http://localhost:5000");
    expect(apiBasis("127.0.0.1:5000")).toBe("http://127.0.0.1:5000");
  });
});

describe("token auth", () => {
  it("reads a bearer challenge and builds the token URL with service and scope", () => {
    const c = challengeLesen(
      'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/postgres:pull"',
    );
    expect(c).toEqual({
      realm: "https://auth.docker.io/token",
      parameter: { service: "registry.docker.io", scope: "repository:library/postgres:pull" },
    });
    if (!c) throw new Error("challenge");
    expect(tokenUrl(c, "library/postgres")).toBe(
      "https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Fpostgres%3Apull",
    );
  });

  it("asks for a pull scope when the challenge names none, and ignores other schemes", () => {
    expect(tokenUrl({ realm: "https://r.example/token", parameter: {} }, "a/b")).toBe(
      "https://r.example/token?scope=repository%3Aa%2Fb%3Apull",
    );
    expect(challengeLesen('Basic realm="x"')).toBeNull();
    expect(challengeLesen(null)).toBeNull();
  });
});

describe("asking a registry for a digest", () => {
  it("translates a tag into registry/name@sha256 with the source: registry, tag, date (UTC)", async () => {
    const { f, anfragen } = registry();
    const a = await digestAbfragen("ghcr.io/speicherstadt/haben:0.12.0", {
      fetch: f,
      jetzt: JETZT,
    });
    expect(a).toEqual({
      ok: true,
      image: `ghcr.io/speicherstadt/haben@${DIGEST}`,
      digest: DIGEST,
      quelle: { registry: "ghcr.io", tag: "0.12.0", abgefragt_am: "2026-11-20" },
      plattformen: ["linux/amd64", "linux/arm64"],
    });
    if (a.ok)
      expect(quelleText(a.quelle)).toBe("Registry ghcr.io, Tag 0.12.0, abgefragt am 2026-11-20");
    // HEAD first (Docker Hub does not count it), with the index and manifest list types accepted
    const ersteMitToken = anfragen.find((x) => x.kopf.Authorization === "Bearer t");
    expect(ersteMitToken?.methode).toBe("HEAD");
    expect(ersteMitToken?.kopf.Accept).toBe(MANIFEST_ACCEPT);
    expect(MANIFEST_ACCEPT).toContain("application/vnd.oci.image.index.v1+json");
    expect(MANIFEST_ACCEPT).toContain("application/vnd.docker.distribution.manifest.list.v2+json");
  });

  it("hashes the manifest itself when the registry sends no Docker-Content-Digest", async () => {
    const { f } = registry({ mitKopf: false });
    const a = await digestAbfragen("ghcr.io/speicherstadt/haben:0.12.0", {
      fetch: f,
      jetzt: JETZT,
    });
    expect(a).toMatchObject({ ok: true, digest: DIGEST });
  });

  it("gives no platforms when the manifest under the digest does not hash to it", async () => {
    const { f } = registry({ kopfDigest: `sha256:${"d".repeat(64)}` });
    const a = await digestAbfragen("ghcr.io/speicherstadt/haben:0.12.0", {
      fetch: f,
      jetzt: JETZT,
    });
    expect(a).toMatchObject({ ok: true, plattformen: null });
  });

  it("returns an error with the URL and status for an unknown tag, never a digest", async () => {
    const { f } = registry();
    const a = await digestAbfragen("ghcr.io/speicherstadt/haben:9.9.9", { fetch: f, jetzt: JETZT });
    expect(a).toEqual({
      ok: false,
      fehler:
        "ghcr.io/speicherstadt/haben:9.9.9: HEAD https://ghcr.io/v2/speicherstadt/haben/manifests/9.9.9: HTTP 404",
    });
  });

  it("returns an error when the network fails or the digest header is no sha256", async () => {
    const kaputt = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    expect(
      await digestAbfragen("localhost:5000/beispiel:1.0.0", { fetch: kaputt, jetzt: JETZT }),
    ).toEqual({ ok: false, fehler: "localhost:5000/beispiel:1.0.0: connection refused" });
    const { f } = registry({ kopfDigest: "sha512:abc" });
    expect(
      await digestAbfragen("ghcr.io/speicherstadt/haben:0.12.0", { fetch: f, jetzt: JETZT }),
    ).toMatchObject({ ok: false });
  });
});

describe("platforms", () => {
  it("lists os/arch of an index without attestations, nothing for a single manifest", () => {
    expect(plattformenLesen(JSON.parse(INDEX))).toEqual(["linux/amd64", "linux/arm64"]);
    expect(plattformenLesen({ schemaVersion: 2, config: {} })).toEqual([]);
  });
});
