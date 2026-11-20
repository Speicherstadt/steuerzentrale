import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { anfrageErzeugen, ecdsaDer, privatPem, schluesselErzeugen } from "./csr.ts";

// OpenSSL, independent of this code, reads what the agent makes (on every runner and Linux machine)
const openssl = (args: string[], datei: string, inhalt: string) => {
  const ordner = mkdtempSync(join(tmpdir(), "sz-test-csr-"));
  onTestFinished(() => rmSync(ordner, { recursive: true, force: true }));
  writeFileSync(join(ordner, datei), inhalt);
  const lauf = Bun.spawnSync(["openssl", ...args, "-in", join(ordner, datei)]);
  return { code: lauf.exitCode, aus: `${lauf.stdout}${lauf.stderr}` };
};

describe("the agent's certificate request", () => {
  it("is a PKCS#10 request whose signature OpenSSL verifies", async () => {
    const csr = await anfrageErzeugen(await schluesselErzeugen(), "steuerzentrale-agent");
    const lauf = openssl(["req", "-verify", "-noout", "-subject"], "agent.csr", csr);
    expect(lauf.aus).toContain("verify OK");
    expect(lauf.aus).toMatch(/CN ?= ?steuerzentrale-agent/);
    expect(lauf.code).toBe(0);
  });

  it("keeps the private key as PKCS#8 PEM of a P-256 key", async () => {
    const pem = await privatPem(await schluesselErzeugen());
    expect(pem.startsWith("-----BEGIN PRIVATE KEY-----\n")).toBe(true);
    const lauf = openssl(["pkey", "-noout", "-text"], "agent.key", pem);
    expect(lauf.code).toBe(0);
    expect(lauf.aus).toContain("P-256");
  });

  it("turns WebCrypto's r ‖ s into a DER sequence of two integers", () => {
    const roh = new Uint8Array(64);
    roh[0] = 0x80;
    roh[63] = 1;
    const der = Buffer.from(ecdsaDer(roh)).toString("hex");
    expect(der.slice(0, 10)).toBe("3026022100");
    expect(der.endsWith("020101")).toBe(true);
  });
});
