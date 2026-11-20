import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { pruefsummen, testSignieren } from "./agent-dateien.ts";
import { geheimenSchluesselLesen, signieren } from "./minisign.ts";

/*
 * BAULISTE.md Z-302: install/install.sh checks the agent binary against SHA256SUMS and its minisign
 * signature, and refuses the test key outside test mode. Its functions run here in a POSIX shell
 * (SZ_INSTALL_NUR_LADEN=1 only defines them) with the real minisign and sha256sum; the whole script
 * runs in CI's Incus VMs (job `server`).
 */
const ROOT = join(import.meta.dirname, "..");
const SKRIPT = join(ROOT, "install/install.sh");
const TEST_PUB = readFileSync(join(ROOT, "test/schluessel/test.pub"), "utf8").split("\n")[1] ?? "";
const BINARY = "steuerzentrale-agent-linux-x64";

/** Runs `befehle` after sourcing the script; the arguments are $1, $2, … */
const shell = (befehle: string, ...args: string[]) => {
  const lauf = Bun.spawnSync(["sh", "-c", `. "$0"; ${befehle}`, SKRIPT, ...args], {
    env: { ...process.env, SZ_INSTALL_NUR_LADEN: "1" },
  });
  return { code: lauf.exitCode, fehler: lauf.stderr.toString() };
};

/** A directory as agent_laden leaves it: the binary, SHA256SUMS and its signature */
const geladen = () => {
  const ordner = mkdtempSync(join(tmpdir(), "sz-test-install-"));
  onTestFinished(() => rmSync(ordner, { recursive: true, force: true }));
  writeFileSync(join(ordner, BINARY), "the agent\n");
  testSignieren(ordner, [BINARY], "test");
  return ordner;
};

const pruefen = (ordner: string, schluessel = TEST_PUB) =>
  shell('SCHLUESSEL="$1"; agent_pruefen "$2" x64', schluessel, ordner);

describe("install.sh checks the agent before it installs it", () => {
  it("accepts a binary whose checksum the signature covers", () => {
    expect(pruefen(geladen())).toEqual({ code: 0, fehler: "" });
  });

  it("refuses a changed binary", () => {
    const ordner = geladen();
    writeFileSync(join(ordner, BINARY), "another agent\n");
    const lauf = pruefen(ordner);
    expect(lauf.code).toBe(1);
    expect(lauf.fehler).toContain(`the checksum of ${BINARY} does not match`);
  });

  it("refuses checksums changed after signing", () => {
    const ordner = geladen();
    writeFileSync(join(ordner, BINARY), "another agent\n");
    const neu = pruefsummen([
      { name: BINARY, inhalt: new TextEncoder().encode("another agent\n") },
    ]);
    writeFileSync(join(ordner, "SHA256SUMS"), neu);
    const lauf = pruefen(ordner);
    expect(lauf.code).toBe(1);
    expect(lauf.fehler).toContain("the signature of SHA256SUMS does not hold");
  });

  it("refuses a signature of another key under the same key id", () => {
    const ordner = geladen();
    const echt = geheimenSchluesselLesen(
      readFileSync(join(ROOT, "test/schluessel/test.key"), "utf8"),
    );
    const fremd = { id: echt.id, seed: crypto.getRandomValues(new Uint8Array(32)) };
    const summen = readFileSync(join(ordner, "SHA256SUMS"));
    writeFileSync(join(ordner, "SHA256SUMS.minisig"), signieren(summen, fremd, "test"));
    expect(pruefen(ordner).fehler).toContain("the signature of SHA256SUMS does not hold");
  });

  it("refuses a binary without a checksum", () => {
    const ordner = geladen();
    const lauf = shell('SCHLUESSEL="$1"; agent_pruefen "$2" arm64', TEST_PUB, ordner);
    expect(lauf.code).toBe(1);
    expect(lauf.fehler).toContain(
      "SHA256SUMS has no checksum for steuerzentrale-agent-linux-arm64",
    );
  });
});

describe("install.sh trusts the key and the Zentrale it was served with", () => {
  const schluessel = (wert: string, zentrale: string, ...args: string[]) =>
    shell(
      'SCHLUESSEL="$1"; ZENTRALE="$2"; shift 2; argumente_lesen "$@"; schluessel_pruefen',
      wert,
      zentrale,
      "--token",
      "abcdefghijklmnopqrstuvwxyz012345",
      ...args,
    );

  it("refuses the public test key outside test mode", () => {
    const lauf = schluessel(TEST_PUB, "https://agent.example.de");
    expect(lauf.code).toBe(1);
    expect(lauf.fehler).toContain("public test key");
    expect(schluessel(TEST_PUB, "https://agent.example.de", "--testmodus").code).toBe(0);
  });

  it("speaks plain HTTP only in test mode", () => {
    const andererSchluessel = `RW${"A".repeat(54)}`;
    expect(schluessel(andererSchluessel, "https://agent.example.de").code).toBe(0);
    const lauf = schluessel(andererSchluessel, "http://agent.example.de");
    expect(lauf.code).toBe(1);
    expect(lauf.fehler).toContain("must be reached over https");
  });

  it("refuses to run as the unfilled template, without a key", () => {
    const lauf = shell('argumente_lesen --token "$1"; schluessel_pruefen', "a".repeat(43));
    expect(lauf.code).toBe(1);
    expect(lauf.fehler).toContain("carries no public key");
  });

  it("keeps the manifest key a server trusts already", () => {
    const ordner = mkdtempSync(join(tmpdir(), "sz-test-install-"));
    onTestFinished(() => rmSync(ordner, { recursive: true, force: true }));
    const datei = join(ordner, "manifest.pub");
    const ablegen = (wert: string) =>
      shell('SCHLUESSEL="$1"; manifest_schluessel_ablegen "$2"', wert, datei);
    expect(ablegen(TEST_PUB).code).toBe(0);
    expect(readFileSync(datei, "utf8").split("\n")[1]).toBe(TEST_PUB);
    expect(ablegen(TEST_PUB).code).toBe(0);
    const lauf = ablegen(`RW${"B".repeat(54)}`);
    expect(lauf.code).toBe(1);
    expect(lauf.fehler).toContain("holds another key");
    expect(readFileSync(datei, "utf8").split("\n")[1]).toBe(TEST_PUB);
  });

  it("needs a token of the right form", () => {
    expect(shell("argumente_lesen").fehler).toContain("--token is missing");
    expect(shell('argumente_lesen --token "$1"', "a b; rm -rf /").code).toBe(1);
    expect(shell("argumente_lesen --token x --bogus").fehler).toContain(
      "unknown argument: --bogus",
    );
  });

  it("refuses a token with a second line, which grep -x would let pass line by line", () => {
    const lauf = shell(
      'argumente_lesen --token "$1"',
      "abcdefghijklmnopqrstuvwxyz012345\n$(id); rm -rf /",
    );
    expect(lauf.code).toBe(1);
    expect(lauf.fehler).toContain("--token is missing or is no one-time token");
  });
});
