import { describe, expect, it } from "vitest";
import type { DnsEintrag } from "./cloudflare.ts";
import {
  istOeffentlicheAdresse,
  istOeffentlicheIpv6,
  loeschPlan,
  naechsterVersuch,
  setzPlan,
  sollAus,
} from "./plan.ts";

// Z-407: what the Zentrale does to the records of a name, decided from what is there

const EIGEN = "steuerzentrale:probe-abc123";
const e = (
  id: string,
  type: string,
  content: string,
  comment: string | null = EIGEN,
): DnsEintrag => ({
  id,
  type,
  name: "probe.k.apps.example.de",
  content,
  comment,
});

describe("the addresses of the records", () => {
  it("are the server's first public IPv4 and IPv6", () => {
    expect(
      sollAus({ ipv4: ["10.0.0.2", "203.0.113.10"], ipv6: ["fe80::1", "2a01:4f8::10"] }),
    ).toEqual({
      A: "203.0.113.10",
      AAAA: "2a01:4f8::10",
    });
    expect(sollAus({ ipv4: ["203.0.113.10"], ipv6: ["fd00::1", "::1"] })).toEqual({
      A: "203.0.113.10",
      AAAA: null,
    });
    expect(sollAus(null)).toEqual({ A: null, AAAA: null });
  });

  it("count an IPv6 as public only in 2000::/3", () => {
    for (const ip of ["2a01:4f8::1", "2001:db8::10", "3fff::1"])
      expect(istOeffentlicheIpv6(ip)).toBe(true);
    for (const ip of ["::1", "fe80::1", "fd12::1", "ff02::1", "::", "203.0.113.1"])
      expect(istOeffentlicheIpv6(ip)).toBe(false);
  });
});

describe("istOeffentlicheAdresse", () => {
  // One rule for webhooks (Z-703) and the check from outside (Z-704), with the cases of both
  it("allows public unicast addresses only", () => {
    for (const ja of ["203.0.113.7", "8.8.8.8", "2a01:4f8::1"])
      expect(istOeffentlicheAdresse(ja), ja).toBe(true);
    for (const nein of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "169.254.1.1",
      "169.254.169.254",
      "0.1.2.3",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "kein",
    ])
      expect(istOeffentlicheAdresse(nein), nein).toBe(false);
  });
});

describe("setting the records", () => {
  const soll = { A: "203.0.113.10", AAAA: "2a01:4f8::10" };

  it("adds what is missing and keeps what fits", () => {
    expect(setzPlan([], EIGEN, soll)).toEqual({
      ok: true,
      schritte: [
        { art: "anlegen", typ: "A", inhalt: "203.0.113.10" },
        { art: "anlegen", typ: "AAAA", inhalt: "2a01:4f8::10" },
      ],
    });
    expect(
      setzPlan([e("1", "A", "203.0.113.10"), e("2", "AAAA", "2a01:4f8::10")], EIGEN, soll),
    ).toEqual({
      ok: true,
      schritte: [],
    });
  });

  it("changes its own record to a new address and drops its doubles and an AAAA no longer wanted", () => {
    const vorhanden = [
      e("1", "A", "198.51.100.1"),
      e("2", "A", "198.51.100.2"),
      e("3", "AAAA", "2a01::1"),
    ];
    expect(setzPlan(vorhanden, EIGEN, { A: "203.0.113.10", AAAA: null })).toEqual({
      ok: true,
      schritte: [
        { art: "aendern", id: "1", inhalt: "203.0.113.10" },
        { art: "loeschen", id: "2" },
        { art: "loeschen", id: "3" },
      ],
    });
  });

  it("never joins or touches a record without the Zentrale's comment", () => {
    for (const fremd of [
      e("9", "A", "198.51.100.9", null),
      e("9", "AAAA", "2a01::9", "von Hand"),
      e("9", "CNAME", "elsewhere.example", "steuerzentrale:andere-xyz"),
    ])
      expect(setzPlan([fremd], EIGEN, soll)).toEqual({
        ok: false,
        fehler: `a record not made by the Zentrale exists: ${fremd.type} ${fremd.name}`,
      });
    // a TXT record of a person beside it is no obstacle, and stays
    expect(setzPlan([e("8", "TXT", "v=spf1 -all", null)], EIGEN, soll)).toMatchObject({ ok: true });
  });

  it("needs at least one public address", () => {
    expect(setzPlan([], EIGEN, { A: null, AAAA: null })).toEqual({
      ok: false,
      fehler: "the server reports no public address",
    });
  });
});

describe("deleting the records", () => {
  it("deletes only the Zentrale's own records of the installation", () => {
    const vorhanden = [
      e("1", "A", "203.0.113.10"),
      e("2", "AAAA", "2a01::1"),
      e("3", "TXT", "von Hand", null),
      e("4", "A", "198.51.100.4", "steuerzentrale:andere-xyz"),
    ];
    expect(loeschPlan(vorhanden, EIGEN)).toEqual([
      { art: "loeschen", id: "1" },
      { art: "loeschen", id: "2" },
    ]);
  });
});

describe("the next attempt", () => {
  it("waits 1, 2, 4 … minutes, at most an hour", () => {
    expect([1, 2, 3, 4, 7, 20].map((n) => naechsterVersuch(n, 0) / 60_000)).toEqual([
      1, 2, 4, 8, 60, 60,
    ]);
  });
});
