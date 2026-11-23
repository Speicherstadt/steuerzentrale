import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.ts";
import { schluesselId } from "./modules/geheim/verschluesseln.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ALT = Buffer.alloc(32, 8).toString("base64");
const URL_ = "https://zentrale.example.de";
const AGENT_ = "https://agent.example.de";

const fehlerVon = (env: Record<string, string>): string => {
  try {
    parseEnv(env);
    return "";
  } catch (fehler) {
    return JSON.stringify((fehler as { issues?: unknown }).issues);
  }
};

describe("parseEnv", () => {
  it("listens on localhost:8300 by default, behind the Pforte", () => {
    expect(
      parseEnv({
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
        STEUERZENTRALE_AGENT_URL: AGENT_,
      }),
    ).toMatchObject({
      port: 8300,
      host: "127.0.0.1",
      dataDir: "data",
    });
  });

  it("takes port, host and data directory from the environment", () => {
    expect(
      parseEnv({
        STEUERZENTRALE_PORT: "18300",
        STEUERZENTRALE_HOST: "0.0.0.0",
        STEUERZENTRALE_DATA: "/var/lib/steuerzentrale",
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
        STEUERZENTRALE_AGENT_URL: AGENT_,
      }),
    ).toMatchObject({ port: 18300, host: "0.0.0.0", dataDir: "/var/lib/steuerzentrale" });
  });

  it("refuses a port that is no port", () => {
    expect(() =>
      parseEnv({
        STEUERZENTRALE_PORT: "70000",
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
        STEUERZENTRALE_AGENT_URL: AGENT_,
      }),
    ).toThrow();
  });

  it("reads the key and, while rotating, the old one", () => {
    const env = parseEnv({
      STEUERZENTRALE_SECRET_KEY: KEY,
      STEUERZENTRALE_SECRET_KEY_ALT: ALT,
      STEUERZENTRALE_URL: URL_,
      STEUERZENTRALE_AGENT_URL: AGENT_,
    });
    expect(env.schluessel.aktuell.id).toBe(schluesselId(Buffer.alloc(32, 7)));
    expect(env.schluessel.alt.map((k) => k.id)).toEqual([schluesselId(Buffer.alloc(32, 8))]);
    expect(
      parseEnv({
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
        STEUERZENTRALE_AGENT_URL: AGENT_,
      }).schluessel.alt,
    ).toEqual([]);
  });

  it("refuses to start without a key, with a clear message", () => {
    expect(fehlerVon({})).toContain(
      "STEUERZENTRALE_SECRET_KEY is missing: 32 random bytes in base64",
    );
  });

  it("refuses a key that is not 32 bytes, without repeating its value", () => {
    const kurz = Buffer.alloc(16, 1).toString("base64");
    const meldung = fehlerVon({ STEUERZENTRALE_SECRET_KEY: kurz });
    expect(meldung).toContain("STEUERZENTRALE_SECRET_KEY must be 32 random bytes in base64");
    expect(meldung).not.toContain(kurz);
  });

  it("takes the URL of the interface as its origin", () => {
    expect(
      parseEnv({
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
        STEUERZENTRALE_AGENT_URL: AGENT_,
      }).url,
    ).toBe(URL_);
    expect(
      parseEnv({
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: "http://localhost:5182/",
        STEUERZENTRALE_AGENT_URL: AGENT_,
      }).url,
    ).toBe("http://localhost:5182");
  });

  it("refuses to start without the URL of the interface, with a clear message", () => {
    expect(fehlerVon({ STEUERZENTRALE_SECRET_KEY: KEY })).toContain(
      "STEUERZENTRALE_URL is missing",
    );
  });

  it("refuses a URL with a path or another scheme", () => {
    for (const falsch of [
      "https://zentrale.example.de/ui",
      "ftp://zentrale.example.de",
      "zentrale",
    ])
      expect(
        fehlerVon({ STEUERZENTRALE_SECRET_KEY: KEY, STEUERZENTRALE_URL: falsch }),
        falsch,
      ).toContain("STEUERZENTRALE_URL must be an http(s) origin without a path");
  });

  it("takes where agents reach the Zentrale and refuses to start without it (BAULISTE.md Z-302)", () => {
    const env = parseEnv({
      STEUERZENTRALE_SECRET_KEY: KEY,
      STEUERZENTRALE_URL: URL_,
      STEUERZENTRALE_AGENT_URL: "https://agent.example.de/",
    });
    expect(env.agentUrl).toBe(AGENT_);
    expect(env.agentDateien).toBeUndefined();
    expect(fehlerVon({ STEUERZENTRALE_SECRET_KEY: KEY, STEUERZENTRALE_URL: URL_ })).toContain(
      "STEUERZENTRALE_AGENT_URL is missing",
    );
    expect(
      fehlerVon({
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
        STEUERZENTRALE_AGENT_URL: "https://agent.example.de/x",
      }),
    ).toContain("STEUERZENTRALE_AGENT_URL must be an http(s) origin without a path");
  });

  it("takes the directory of the agent's files", () => {
    expect(
      parseEnv({
        STEUERZENTRALE_SECRET_KEY: KEY,
        STEUERZENTRALE_URL: URL_,
        STEUERZENTRALE_AGENT_URL: AGENT_,
        STEUERZENTRALE_AGENT_DATEIEN: "/opt/steuerzentrale/agent",
      }).agentDateien,
    ).toBe("/opt/steuerzentrale/agent");
  });

  // Z-407: Cloudflare's API, elsewhere only for the stand-in in tests (testhilfen/cloudflare.ts)
  it("talks to Cloudflare's API and lets only a test point it at localhost", () => {
    const basis = {
      STEUERZENTRALE_SECRET_KEY: KEY,
      STEUERZENTRALE_URL: URL_,
      STEUERZENTRALE_AGENT_URL: AGENT_,
    };
    expect(parseEnv(basis).cloudflareApi).toBe("https://api.cloudflare.com/client/v4");
    const test = { ...basis, STEUERZENTRALE_CLOUDFLARE_API: "http://127.0.0.1:28301/client/v4/" };
    expect(parseEnv(test).cloudflareApi).toBe("http://127.0.0.1:28301/client/v4");
    for (const fremd of ["https://evil.example/client/v4", "http://10.0.0.1/", "kein-url"])
      expect(fehlerVon({ ...basis, STEUERZENTRALE_CLOUDFLARE_API: fremd })).toContain(
        "STEUERZENTRALE_CLOUDFLARE_API is for tests only",
      );
  });
});
