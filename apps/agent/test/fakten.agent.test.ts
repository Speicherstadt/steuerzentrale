import { mkdtempSync, rmSync } from "node:fs";
import { isIPv4, isIPv6 } from "node:net";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import { Fakten, PROTOKOLL_VERSION, VERSION } from "@steuerzentrale/protokoll";
import { afterAll, describe, expect, it } from "vitest";
import { ereignisse } from "../../zentrale/src/db/schema.ts";
import { serverZumFingerabdruck } from "../../zentrale/src/modules/server/index.ts";
import { sitzung } from "../../zentrale/src/modules/verbindung/sitzung.ts";
import { serverHinzufuegen } from "../../zentrale/src/testhilfen/agent.ts";
import { testServer } from "../../zentrale/src/testhilfen/server.ts";
import { agentBeitreten, fingerabdruckVon } from "../../zentrale/src/testhilfen/tls.ts";
import { speicher } from "../src/beitritt/testhilfen.ts";
import { type Anmeldung, anmeldungenFolgen, type Folgen } from "../src/ssh/anmeldungen.ts";
import { zeilenVon } from "../src/ssh/journal.ts";
import { podmanVersion as podmanAufDemRunner, requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-304 with real systems (runs in CI only, `bun run test:agent`):
 * - the compiled agent reads its facts inside a Debian 13 container and on the runner itself
 *   (Ubuntu 24.04 with Podman 4.9); the values are checked for plausibility against what the test
 *   knows of both;
 * - an SSH login in a systemd container (Debian 13, openssh-server, journald) is read from the
 *   journal by the agent's reader with its fixed argv, run through `podman exec`, and becomes an
 *   event in the Zentrale.
 */
const podman = requirePodman(process.env.CI === "true");
const hostTarget = process.arch === "arm64" ? "linux-arm64" : "linux-x64";

// debian:13 by digest (scripts/digest.ts: Registry docker.io, Tag 13, abgefragt am 2026-11-20)
const DEBIAN_13 =
  "docker.io/library/debian@sha256:9c6e381421d0f48d1b8133e573f33c185ee16cbf505eda9c4a8a4791b25ea8a6";

const aufraeumen: (() => void)[] = [];
afterAll(() => {
  for (const f of aufraeumen.splice(0).reverse()) f();
});

const binaryBauen = (): string => {
  const ordner = mkdtempSync(join(tmpdir(), "sz-test-fakten-"));
  aufraeumen.push(() => rmSync(ordner, { recursive: true, force: true }));
  const aus = join(ordner, "steuerzentrale-agent");
  const bau = Bun.spawnSync([
    "bun",
    "build",
    "--compile",
    `--target=bun-${hostTarget}`,
    join(import.meta.dirname, "../src/main.ts"),
    "--outfile",
    aus,
  ]);
  if (bau.exitCode !== 0) throw new Error(bau.stderr.toString());
  return aus;
};

const faktenVon = (argv: string[]) => {
  const lauf = Bun.spawnSync(argv, { timeout: 300_000 });
  if (lauf.exitCode !== 0)
    throw new Error(`${argv.join(" ")}: ${lauf.stdout.toString()}${lauf.stderr.toString()}`);
  return Fakten.parse(JSON.parse(lauf.stdout.toString()));
};

const ARCHITEKTUR = process.arch === "arm64" ? "arm64" : "amd64";

/** What holds on any Linux the agent runs on */
const plausibel = (f: ReturnType<typeof faktenVon>) => {
  expect(f.cpuKerne).toBeGreaterThanOrEqual(1);
  expect(f.ramMb).toBeGreaterThan(256);
  expect(f.architektur).toBe(ARCHITEKTUR);
  // a container shares the runner's kernel
  expect(f.kernel.laeuft).toBe(release());
  expect(f.platten?.map((p) => p.mount)).toContain("/");
  for (const p of f.platten ?? []) expect(p.freiMb).toBeLessThanOrEqual(p.gesamtMb);
  for (const ip of f.ipv4 ?? []) expect(isIPv4(ip) && !ip.startsWith("127."), ip).toBe(true);
  for (const ip of f.ipv6 ?? []) expect(isIPv6(ip) && ip !== "::1", ip).toBe(true);
  expect(Array.isArray(f.portsBelegt)).toBe(true);
  expect([true, false, null]).toContain(f.port25Ausgehend);
  expect(f.uhrzeitAbweichungMs).toBeNull();
};

describe.skipIf(podman === null)("facts on real systems (Z-304)", () => {
  let binary = "";

  it("are read by the compiled agent inside a Debian 13 container", () => {
    binary = binaryBauen();
    const f = faktenVon([
      "podman",
      "run",
      "--rm",
      "-v",
      `${binary}:/usr/local/bin/steuerzentrale-agent:ro`,
      DEBIAN_13,
      "steuerzentrale-agent",
      "fakten",
    ]);
    plausibel(f);
    expect(f.os).toEqual({ name: "Debian GNU/Linux", version: "13" });
    // the image has apt but no Podman; its package lists are empty, so nothing is pending
    expect(f.podman).toBeNull();
    expect(f.updatesAusstehend).toBe(0);
  }, 300_000);

  it("are read by the compiled agent on the runner, Podman included", () => {
    const f = faktenVon([binary || binaryBauen(), "fakten"]);
    plausibel(f);
    expect(f.os?.name).toBe("Ubuntu");
    expect(f.podman).toBe(podmanAufDemRunner());
    expect(f.updatesAusstehend).toBeGreaterThanOrEqual(0);
  }, 300_000);
});

const ausfuehren = (argv: string[]) => {
  const lauf = Bun.spawnSync(argv, { timeout: 120_000 });
  return { code: lauf.exitCode, aus: `${lauf.stdout.toString()}${lauf.stderr.toString()}` };
};

/** Waits until `bedingung` holds, checking every `ms`, at most `mal` times */
const warten = async (bedingung: () => boolean, mal: number, ms: number) => {
  for (let i = 0; i < mal && !bedingung(); i++) await Bun.sleep(ms);
  return bedingung();
};

/** A Debian 13 container booting systemd with journald and sshd */
const sshContainer = async (): Promise<string> => {
  const name = `sz-test-ssh-${crypto.randomUUID().slice(0, 8)}`;
  aufraeumen.push(() => Bun.spawnSync(["podman", "rm", "-f", "-t", "0", name]));
  const pakete = "systemd systemd-sysv openssh-server openssh-client";
  const start = ausfuehren([
    "podman",
    "run",
    "-d",
    "--name",
    name,
    "--systemd=always",
    DEBIAN_13,
    "sh",
    "-c",
    `apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ${pakete} >/dev/null && exec /lib/systemd/systemd`,
  ]);
  if (start.code !== 0) throw new Error(start.aus);
  const aktiv = await warten(
    () =>
      ausfuehren(["podman", "exec", name, "systemctl", "is-active", "ssh.service"]).aus.trim() ===
      "active",
    120,
    2000,
  );
  if (!aktiv) throw new Error(ausfuehren(["podman", "logs", name]).aus);
  const schluessel = ausfuehren([
    "podman",
    "exec",
    name,
    "sh",
    "-c",
    "mkdir -p -m 700 /root/.ssh && ssh-keygen -q -t ed25519 -N '' -f /root/.ssh/id_ed25519 && cat /root/.ssh/id_ed25519.pub > /root/.ssh/authorized_keys",
  ]);
  if (schluessel.code !== 0) throw new Error(schluessel.aus);
  return name;
};

/** The agent's journal reader, its argv run in the container instead of on this machine */
const imContainer =
  (name: string): Folgen =>
  (argv) => {
    const lauf = Bun.spawn(["podman", "exec", name, ...argv], { stdout: "pipe", stderr: "ignore" });
    return { zeilen: zeilenVon(lauf.stdout), stoppen: () => lauf.kill() };
  };

describe.skipIf(podman === null)("an SSH login in a container (Z-304)", () => {
  it("is read from journald and becomes an event in the Zentrale", async () => {
    const name = await sshContainer();
    const gemeldet: Anmeldung[] = [];
    const lauf = anmeldungenFolgen({
      folgen: imContainer(name),
      dateien: speicher().dateien,
      cursorPfad: "/z/ssh-cursor",
      melden: (a) => gemeldet.push(a),
    });
    aufraeumen.push(lauf.stoppen);
    // the reader takes new entries only: log in until it has seen one
    const gesehen = await warten(
      () => {
        if (gemeldet.length > 0) return true;
        ausfuehren([
          "podman",
          "exec",
          name,
          "ssh",
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=no",
          "root@127.0.0.1",
          "true",
        ]);
        return false;
      },
      20,
      3000,
    );
    expect(gesehen, ausfuehren(["podman", "exec", name, "journalctl", "-u", "ssh"]).aus).toBe(true);
    const anmeldung = gemeldet[0];
    expect(anmeldung).toMatchObject({ nutzer: "root", von: "127.0.0.1", methode: "publickey" });

    // the Zentrale's side: the message the agent sends becomes an event of its server
    const zentrale = testServer();
    const inhaber = await zentrale.inhaber();
    const { token } = await serverHinzufuegen(inhaber);
    const agent = await agentBeitreten(zentrale, token);
    const gefunden = serverZumFingerabdruck(zentrale.db, await fingerabdruckVon(agent.zertifikat));
    if (!gefunden) throw new Error("server not found");
    const s = sitzung(zentrale.deps, gefunden);
    s.offen({ senden: () => {}, schliessen: () => {} });
    const kopf = { protokoll: PROTOKOLL_VERSION, agentVersion: VERSION, zeit: 1 };
    await s.nachricht(JSON.stringify({ typ: "hallo", architektur: ARCHITEKTUR, ...kopf }));
    await s.nachricht(
      JSON.stringify({ typ: "ssh_anmeldung", protokoll: PROTOKOLL_VERSION, ...anmeldung }),
    );
    expect(zentrale.db.select().from(ereignisse).all()).toEqual([
      expect.objectContaining({
        art: "ssh_anmeldung",
        ziel: `server:${gefunden.server.serverId}`,
        text: expect.stringContaining("root von 127.0.0.1 (publickey)"),
      }),
    ]);
  }, 600_000);
});
