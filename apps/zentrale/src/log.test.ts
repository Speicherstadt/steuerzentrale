import { describe, expect, it } from "vitest";
import { formatRequestLog, redactUrl } from "./log.ts";

describe("redactUrl", () => {
  it("keeps a path without query", () => {
    expect(redactUrl("http://x.test/health")).toBe("/health");
  });

  it("marks a query without any of its keys or values", () => {
    expect(redactUrl("http://x.test/install.sh?token=geheim&x=1")).toBe("/install.sh?…");
  });

  it("leaves out a bare token without key", () => {
    expect(redactUrl("/api?c2stZ2VoZWltLTEyMw==")).toBe("/api?…");
  });

  it("drops an empty query", () => {
    expect(redactUrl("/health?")).toBe("/health");
  });

  it("drops the fragment", () => {
    expect(redactUrl("/a#geheim")).toBe("/a");
  });
});

describe("formatRequestLog", () => {
  it("writes one JSON line", () => {
    const line = formatRequestLog({ time: "t", method: "GET", path: "/", status: 200, ms: 1 });
    expect(JSON.parse(line)).toEqual({ time: "t", method: "GET", path: "/", status: 200, ms: 1 });
    expect(line).not.toContain("\n");
  });
});
