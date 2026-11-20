import { describe, expect, it } from "vitest";
import { bits, ganzzahl, oid, tlv } from "./der.ts";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("DER", () => {
  it("writes short and long lengths (X.690 8.1.3)", () => {
    expect(hex(tlv(0x04, new Uint8Array(3)))).toBe("0403000000");
    expect(hex(tlv(0x04, new Uint8Array(200))).slice(0, 6)).toBe("0481c8");
    expect(hex(tlv(0x04, new Uint8Array(300))).slice(0, 8)).toBe("0482012c");
  });

  it("writes an integer without leading zeros, with one before a high bit", () => {
    expect(hex(ganzzahl(new Uint8Array([0, 0, 1])))).toBe("020101");
    expect(hex(ganzzahl(new Uint8Array([0x80])))).toBe("02020080");
    expect(hex(ganzzahl(new Uint8Array([0, 0x7f])))).toBe("02017f");
    expect(hex(ganzzahl(new Uint8Array([0])))).toBe("020100");
  });

  it("writes object identifiers, also with arcs past 127", () => {
    // commonName and ecdsa-with-SHA256, as openssl asn1parse shows them
    expect(hex(oid("2.5.4.3"))).toBe("0603550403");
    expect(hex(oid("1.2.840.10045.4.3.2"))).toBe("06082a8648ce3d040302");
  });

  it("writes a bit string with no unused bits", () => {
    expect(hex(bits(new Uint8Array([0xab])))).toBe("030200ab");
  });
});
