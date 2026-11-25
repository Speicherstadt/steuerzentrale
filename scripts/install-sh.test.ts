import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("install.sh makes the Pforte's user (Z-401)", () => {
  // id, useradd and loginctl as shell functions that log what they were asked
  const pforte = (gibtEs: boolean, subuid: string) => {
    const ordner = mkdtempSync(join(tmpdir(), "sz-test-install-"));
    onTestFinished(() => rmSync(ordner, { recursive: true, force: true }));
    writeFileSync(join(ordner, "subuid"), subuid);
    const log = join(ordner, "log");
    const lauf = shell(
      `LOG="$1"; SUBUID="$2"
       id() { ${gibtEs ? "return 0" : "return 1"}; }
       useradd() { echo "useradd $*" >>"$LOG"; }
       loginctl() { echo "loginctl $*" >>"$LOG"; }
       pforte_einrichten`,
      log,
      join(ordner, "subuid"),
    );
    let befehle: string[] = [];
    try {
      befehle = readFileSync(log, "utf8").trim().split("\n");
    } catch {
      // nothing was called
    }
    return { ...lauf, befehle };
  };

  it("adds sz-pforte without a login shell and lets its units linger", () => {
    const lauf = pforte(false, "runner:100000:65536\nsz-pforte:165536:65536\n");
    expect(lauf.code, lauf.fehler).toBe(0);
    expect(lauf.befehle).toEqual([
      expect.stringMatching(/^useradd .*--shell \/usr\/sbin\/nologin .* sz-pforte$/),
      "loginctl enable-linger sz-pforte",
    ]);
    expect(lauf.befehle[0]).toContain("--home-dir /home/sz-pforte");
  });

  it("keeps an existing sz-pforte when it runs again", () => {
    const lauf = pforte(true, "sz-pforte:165536:65536\n");
    expect(lauf.code).toBe(0);
    expect(lauf.befehle).toEqual(["loginctl enable-linger sz-pforte"]);
  });

  it("stops when sz-pforte has no subordinate ids for rootless Podman", () => {
    const lauf = pforte(true, "runner:100000:65536\n");
    expect(lauf.code).toBe(1);
    expect(lauf.fehler).toContain("sz-pforte has no subordinate ids");
  });
});

// BAULISTE.md Z-1102: with --nur-beobachten the script only adds the agent. Every step that
// changes the server is a shell function here that logs its name; the paths point into a
// temporary directory, so main runs whole without root. The whole script runs in CI's VMs.
describe("install.sh --nur-beobachten (Z-1102)", () => {
  const TOKEN = "einmal-token-1234567890";
  const SCHRITTE = [
    "schluessel_pruefen",
    "system_pruefen",
    "uhrzeit_pruefen",
    "pakete_installieren",
    "delegation_einrichten",
    "werkzeuge_pruefen",
    "server_einrichten",
    "pforte_einrichten",
    "beitreten",
    "dienst_einrichten",
  ];

  const lauf = (args: string[], vorher: Record<string, string> = {}) => {
    const ordner = mkdtempSync(join(tmpdir(), "sz-test-install-"));
    onTestFinished(() => rmSync(ordner, { recursive: true, force: true }));
    for (const [pfad, inhalt] of Object.entries(vorher)) {
      Bun.spawnSync(["mkdir", "-p", join(ordner, pfad, "..")]);
      writeFileSync(join(ordner, pfad), inhalt);
    }
    const log = join(ordner, "log");
    const stubs = SCHRITTE.map((s) => `${s}() { echo ${s} >>"$LOG"; }`).join("\n");
    const ergebnis = shell(
      `LOG="$1"; O="$2"; shift 2
       KONFIG="$O/etc"; ZUSTAND="$O/var"; BINARY="$O/agent"; ARCH=x64
       ${stubs}
       manifest_schluessel_ablegen() { :; }
       agent_laden() { echo binary >"$1/steuerzentrale-agent-linux-x64"; }
       agent_pruefen() { :; }
       main "$@"`,
      log,
      ordner,
      ...args,
    );
    let schritte: string[] = [];
    try {
      schritte = readFileSync(log, "utf8").trim().split("\n");
    } catch {
      // nothing ran
    }
    const modus = () => {
      try {
        return readFileSync(join(ordner, "etc/nur-beobachten"), "utf8");
      } catch {
        return null;
      }
    };
    return { ...ergebnis, schritte, modus: modus() };
  };

  it("installs no package, sets no sysctl, makes no Pforte and leaves the mode", () => {
    const r = lauf(["--token", TOKEN, "--nur-beobachten"]);
    expect(r.code, r.fehler).toBe(0);
    expect(r.schritte).toEqual([
      "schluessel_pruefen",
      "system_pruefen",
      "werkzeuge_pruefen",
      "uhrzeit_pruefen",
      "beitreten",
      "dienst_einrichten",
    ]);
    expect(r.modus).toBe("nur-beobachten\n");
  });

  it("sets up a managed server as before, without the mode", () => {
    const r = lauf(["--token", TOKEN]);
    expect(r.code, r.fehler).toBe(0);
    expect(r.schritte).toEqual([
      "schluessel_pruefen",
      "system_pruefen",
      "uhrzeit_pruefen",
      "pakete_installieren",
      "delegation_einrichten",
      "server_einrichten",
      "pforte_einrichten",
      "beitreten",
      "dienst_einrichten",
    ]);
    expect(r.modus).toBeNull();
  });

  it("keeps the mode when it runs again without the switch", () => {
    const r = lauf(["--token", TOKEN], { "etc/nur-beobachten": "nur-beobachten\n" });
    expect(r.code, r.fehler).toBe(0);
    expect(r.schritte).not.toContain("pakete_installieren");
    expect(r.schritte).not.toContain("pforte_einrichten");
    expect(r.modus).toBe("nur-beobachten\n");
  });

  it("does not switch a server that joined as a managed one, and changes nothing", () => {
    const r = lauf(["--token", TOKEN, "--nur-beobachten"], {
      "var/agent.pem": "-----BEGIN CERTIFICATE-----\n",
      "etc/agent.json": "{}",
    });
    expect(r.code).toBe(1);
    expect(r.fehler).toContain("joined as a managed one");
    expect(r.schritte).toEqual([]);
    expect(r.modus).toBeNull();
  });

  // docs/server-hinzufuegen.md, "Server nur beobachten": a missing tool stops the script before it
  // changed anything, so neither /etc/steuerzentrale nor the manifest key are there afterwards
  it("changes nothing when a tool is missing: the check comes before the first write", () => {
    const ordner = mkdtempSync(join(tmpdir(), "sz-test-install-"));
    onTestFinished(() => rmSync(ordner, { recursive: true, force: true }));
    // a PATH with what main needs up to the check, and without minisign
    const bin = join(ordner, "bin");
    Bun.spawnSync(["mkdir", "-p", bin]);
    for (const werkzeug of [
      "install",
      "mkdir",
      "grep",
      "sed",
      "mktemp",
      "rm",
      "curl",
      "sha256sum",
    ]) {
      const pfad = Bun.which(werkzeug);
      if (pfad) Bun.spawnSync(["ln", "-s", pfad, join(bin, werkzeug)]);
    }
    const log = join(ordner, "log");
    const r = shell(
      `LOG="$1"; O="$2"; PATH="$3"; shift 3
       KONFIG="$O/etc"; ZUSTAND="$O/var"; BINARY="$O/agent"; ARCH=x64
       schluessel_pruefen() { :; }
       system_pruefen() { :; }
       uhrzeit_pruefen() { echo uhrzeit_pruefen >>"$LOG"; }
       manifest_schluessel_ablegen() { echo manifest_schluessel_ablegen >>"$LOG"; }
       main "$@"`,
      log,
      ordner,
      bin,
      "--token",
      TOKEN,
      "--nur-beobachten",
    );
    expect(r.code).toBe(1);
    expect(r.fehler).toContain("installs no package; install first: minisign");
    expect(existsSync(log) ? readFileSync(log, "utf8") : "").toBe("");
    expect(existsSync(join(ordner, "etc"))).toBe(false);
  });

  it("stops when minisign, curl or sha256sum are missing, as it installs none", () => {
    const ordner = mkdtempSync(join(tmpdir(), "sz-test-install-"));
    onTestFinished(() => rmSync(ordner, { recursive: true, force: true }));
    const curl = Bun.which("curl");
    if (curl) Bun.spawnSync(["ln", "-s", curl, join(ordner, "curl")]);
    const r = shell('PATH="$1"; werkzeuge_pruefen', ordner);
    expect(r.code).toBe(1);
    expect(r.fehler).toContain("installs no package; install first: minisign");
    expect(r.fehler).toContain("sha256sum");
  });
});
