import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { requirePodman } from "./podman.ts";

/*
 * Every rendered unit (the golden files of Z-205, packages/manifest/test/quadlets/) passes Podman's
 * own generator: `quadlet --user --dryrun` refuses an unknown key or a broken value and exits 1
 * (cmd/quadlet/main.go of containers/podman v4.9.0). Once with the runner's Podman 4.9
 * (ubuntu-24.04, the minimum, docs/plan.md "Podman"), once with Podman 5.x from Debian 13 in a
 * container. QUADLET_UNIT_DIRS points the generator at one folder (podman-systemd.unit(5),
 * "Debugging a limited set of unit files").
 */

const podman = requirePodman(process.env.CI === "true");
const GOLDEN = join(import.meta.dirname, "../../../packages/manifest/test/quadlets");

// Where the packages put the generator: Podman's Makefile installs it as $(LIBEXECPODMAN)/quadlet
// and links it as podman-user-generator and podman-system-generator
const GENERATOREN = [
  "/usr/libexec/podman/quadlet",
  "/usr/lib/systemd/user-generators/podman-user-generator",
  "/usr/lib/systemd/system-generators/podman-system-generator",
];

// debian:13 by digest (scripts/digest.ts: Registry docker.io, Tag 13, abgefragt am 2026-11-20)
const DEBIAN_13 =
  "docker.io/library/debian@sha256:9c6e381421d0f48d1b8133e573f33c185ee16cbf505eda9c4a8a4791b25ea8a6";

/** The cases that rendered units; a refused app has only abgelehnt.txt */
const faelle = existsSync(GOLDEN)
  ? readdirSync(GOLDEN).filter((fall) => existsSync(join(GOLDEN, fall, "units")))
  : [];

const ordner: string[] = [];
afterAll(() => {
  for (const o of ordner) rmSync(o, { recursive: true, force: true });
});

const generator = () => GENERATOREN.find((pfad) => existsSync(pfad));

const pruefen = (fall: string) => {
  const units = mkdtempSync(join(tmpdir(), "sz-test-quadlet-"));
  ordner.push(units);
  cpSync(join(GOLDEN, fall, "units"), units, { recursive: true });
  const programm = generator();
  if (!programm) throw new Error(`no Quadlet generator under ${GENERATOREN.join(", ")}`);
  const lauf = Bun.spawnSync([programm, "--user", "--dryrun"], {
    env: { ...process.env, QUADLET_UNIT_DIRS: units },
  });
  return {
    code: lauf.exitCode,
    aus: lauf.stdout.toString(),
    fehler: lauf.stderr.toString(),
    units,
  };
};

describe.skipIf(podman === null)("rendered Quadlet units with Podman's generator (Z-205)", () => {
  it("has cases to check", () => {
    expect(faelle.length).toBeGreaterThan(0);
  });

  it.each(faelle)("%s passes the runner's generator (Podman 4.9 on ubuntu-24.04)", (fall) => {
    const { code, aus, fehler, units } = pruefen(fall);
    expect(code, fehler).toBe(0);
    expect(fehler).not.toMatch(/converting|unsupported key/);
    // The dry run heads each unit with "---<name>.service---"; Podman 4.9.3 on the runner prints
    // the bare name, builds from source a path in front of it
    for (const datei of readdirSync(units).filter((d) => d.endsWith(".container")))
      expect(aus).toContain(`${datei.replace(/\.container$/, ".service")}---`);
    expect(aus).not.toContain("io.containers.autoupdate");
  });

  it("writes the network alias, the secrets and argv into podman run", () => {
    const haben = pruefen("haben").aus;
    expect(haben).toContain("--network=haben-k1:alias=app");
    expect(haben).toContain("--secret haben-k1-database-url,type=env,target=DATABASE_URL");
    expect(haben).toContain("--publish 127.0.0.1:20001:3000");
    const kontext = pruefen("kontext").aus;
    expect(kontext).toMatch(/@sha256:[0-9a-f]{64} redis-server --save --appendonly no$/m);
  });

  it("every case passes the generator of Podman 5.x (Debian 13)", () => {
    const skript = [
      "apt-get update -qq && apt-get install -y -qq --no-install-recommends podman >/dev/null",
      "podman --version",
      'for d in /quadlets/*/units; do QUADLET_UNIT_DIRS=$d /usr/libexec/podman/quadlet --user --dryrun >/dev/null || { echo "failed: $d"; exit 1; }; done',
    ].join(" && ");
    const lauf = Bun.spawnSync(
      ["podman", "run", "--rm", "-v", `${GOLDEN}:/quadlets:ro`, DEBIAN_13, "sh", "-c", skript],
      { timeout: 540_000 },
    );
    const aus = lauf.stdout.toString();
    expect(lauf.exitCode, `${aus}\n${lauf.stderr.toString()}`).toBe(0);
    expect(aus).toMatch(/podman version 5\./);
  }, 600_000);
});
