import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.ts";

describe("parseEnv", () => {
  it("listens on localhost:8300 by default, behind the Pforte", () => {
    expect(parseEnv({})).toEqual({ port: 8300, host: "127.0.0.1", dataDir: "data" });
  });

  it("takes port and host from the environment", () => {
    expect(
      parseEnv({
        STEUERZENTRALE_PORT: "18300",
        STEUERZENTRALE_HOST: "0.0.0.0",
        STEUERZENTRALE_DATA: "/var/lib/steuerzentrale",
      }),
    ).toEqual({ port: 18300, host: "0.0.0.0", dataDir: "/var/lib/steuerzentrale" });
  });

  it("refuses a port that is no port", () => {
    expect(() => parseEnv({ STEUERZENTRALE_PORT: "70000" })).toThrow();
  });
});
