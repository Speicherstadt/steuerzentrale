import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.ts";
import { schluesselId } from "./modules/geheim/verschluesseln.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ALT = Buffer.alloc(32, 8).toString("base64");

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
    expect(parseEnv({ STEUERZENTRALE_SECRET_KEY: KEY })).toMatchObject({
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
      }),
    ).toMatchObject({ port: 18300, host: "0.0.0.0", dataDir: "/var/lib/steuerzentrale" });
  });

  it("refuses a port that is no port", () => {
    expect(() =>
      parseEnv({ STEUERZENTRALE_PORT: "70000", STEUERZENTRALE_SECRET_KEY: KEY }),
    ).toThrow();
  });

  it("reads the key and, while rotating, the old one", () => {
    const env = parseEnv({ STEUERZENTRALE_SECRET_KEY: KEY, STEUERZENTRALE_SECRET_KEY_ALT: ALT });
    expect(env.schluessel.aktuell.id).toBe(schluesselId(Buffer.alloc(32, 7)));
    expect(env.schluessel.alt.map((k) => k.id)).toEqual([schluesselId(Buffer.alloc(32, 8))]);
    expect(parseEnv({ STEUERZENTRALE_SECRET_KEY: KEY }).schluessel.alt).toEqual([]);
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
});
