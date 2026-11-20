import { describe, expect, it } from "vitest";
import { clientAdresse } from "./adresse.ts";

describe("clientAdresse", () => {
  it("takes the socket address of a client that connects directly", () => {
    expect(clientAdresse("203.0.113.7", undefined)).toBe("203.0.113.7");
  });

  it("ignores an X-Forwarded-For a client sends itself", () => {
    expect(clientAdresse("203.0.113.7", "198.51.100.1")).toBe("203.0.113.7");
  });

  it("believes the Pforte on the loopback address, with the entry Caddy added last", () => {
    expect(clientAdresse("127.0.0.1", "198.51.100.1")).toBe("198.51.100.1");
    expect(clientAdresse("::1", "10.0.0.1, 198.51.100.2")).toBe("198.51.100.2");
    expect(clientAdresse("::ffff:127.0.0.1", "2001:db8::1")).toBe("2001:db8::1");
  });

  it("keeps the loopback address when the Pforte sent no header", () => {
    expect(clientAdresse("127.0.0.1", null)).toBe("127.0.0.1");
    expect(clientAdresse("127.0.0.1", " , ")).toBe("127.0.0.1");
  });

  it("has no address when the socket gives none", () => {
    expect(clientAdresse(undefined, "198.51.100.1")).toBeUndefined();
  });
});
