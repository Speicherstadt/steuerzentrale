import { describe, expect, it } from "vitest";
import { hostAusAdresse, pfadGueltig } from "./adresse.ts";

/*
 * BAULISTE.md Z-1101: the address of an observed service is `https://<host>` on port 443, nothing
 * else; the check connects to the host's public addresses on 443 (modules/aussen/sonde.ts).
 */

describe("hostAusAdresse", () => {
  it.each([
    ["https://status.example.de", "status.example.de"],
    ["https://status.example.de/", "status.example.de"],
    ["https://Status.Example.DE", "status.example.de"],
    ["  https://wiki.teufel-it.de  ", "wiki.teufel-it.de"],
  ])("takes %s as %s", (adresse, host) => {
    expect(hostAusAdresse(adresse)).toBe(host);
  });

  it.each([
    "http://status.example.de",
    "status.example.de",
    "https://status.example.de:8443",
    "https://status.example.de:443",
    "https://status.example.de/health",
    "https://status.example.de/?a=1",
    "https://status.example.de/#oben",
    "https://kim:geheim@status.example.de",
    "https://203.0.113.10",
    "https://[2001:db8::1]",
    "https://localhost",
    "https://-boese.example.de",
    "https://a..b.example.de",
    "https://status example.de",
    "",
    `https://${"a".repeat(64)}.example.de`,
  ])("refuses %s", (adresse) => {
    expect(hostAusAdresse(adresse)).toBeUndefined();
  });
});

describe("pfadGueltig", () => {
  it.each(["/", "/health", "/api/v1/health", "/-/ready", "/status.json"])("takes %s", (pfad) => {
    expect(pfadGueltig(pfad)).toBe(true);
  });

  it.each(["", "health", "/a b", "/health?x=1", "/#a", "//andere.example/", `/${"a".repeat(300)}`])(
    "refuses %s",
    (pfad) => {
      expect(pfadGueltig(pfad)).toBe(false);
    },
  );
});
