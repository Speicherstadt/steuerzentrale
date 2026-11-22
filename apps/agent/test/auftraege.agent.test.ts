// biome-ignore-all lint/suspicious/noTemplateCurlyInString: argv placeholders are ${arg:…} as plain text
import { join } from "node:path";
import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuftragNachricht } from "../src/auftraege/pruefen.ts";
import {
  type EchterAgent,
  EINRICHTUNG_BEREIT,
  echterAgent,
  nutzerLesen,
  signiert,
  wegraeumen,
} from "./einrichtung-hilfen.ts";
import { alsNutzer, lauf } from "./pforte-hilfen.ts";
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-305 with real Podman (runs in CI only, `bun run test:agent`): the agent's job
 * handling with its real spawn runs a signed manifest's command by `podman exec` in the container
 * named after installation and container, as a fixed argv; a job sent twice runs once, a changed
 * manifest runs nothing, and the time limit kills the command. Since Z-402 a command runs as the
 * installation's Linux user, in an installation the agent set up: so the installation is set up by
 * a setup job first (root's part through sudo, einrichtung-hilfen.ts), and its container runs under
 * sz-<installation>, no longer under the runner's user.
 */
const podman = requirePodman(process.env.CI === "true");
if (podman !== null && process.env.CI === "true" && !EINRICHTUNG_BEREIT)
  throw new Error("SZ_TEST_EINRICHTUNG=1 must be set (ci.yml, job agent)");
const bereit = podman !== null && EINRICHTUNG_BEREIT;

// debian:13 by digest (scripts/digest.ts: Registry docker.io, Tag 13, abgefragt am 2026-11-20)
const DEBIAN_13 =
  "docker.io/library/debian@sha256:9c6e381421d0f48d1b8133e573f33c185ee16cbf505eda9c4a8a4791b25ea8a6";

const INSTALLATION = `test-j${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`;
const CONTAINER = `${INSTALLATION}-app`;

const MANIFEST = `schema: 1
id: auftrag
version: 1.0.0
lizenz: AGPL-3.0-only
quelle: https://github.com/Speicherstadt/steuerzentrale
container:
  - { name: app, image: "${DEBIAN_13}", argv: [sleep, infinity] }
architektur: [amd64, arm64]
ressourcen: { ram_mb: 128, platte_gb: 1 }
netz: { http: { dienst: app, port: 8080 } }
anmeldung: eigen
health: { art: keine, hinweis: nur Tests }
befehle:
  anlegen:
    container: app
    argv: [touch, "\${arg:datei}"]
    argumente: { datei: { typ: text, muster: "/tmp/[a-z]+" } }
  langsam: { container: app, argv: [sleep, "30"], zeitlimit_s: 1 }
aktionen: { nur_lesen: nicht_unterstuetzt, export: nicht_unterstuetzt }
`;

const SIGNATUR = signiert(MANIFEST);

const imContainer = (...argv: string[]) =>
  lauf(alsNutzer(`sz-${INSTALLATION}`)("podman", "exec", CONTAINER, ...argv)).code;

const auftrag = (teil: Partial<AuftragNachricht>): Omit<AuftragNachricht, "typ" | "protokoll"> => ({
  auftragId: "a1",
  installationId: INSTALLATION,
  aktion: "anlegen",
  argumente: { datei: "/tmp/beweis" },
  manifest: MANIFEST,
  signatur: SIGNATUR,
  zeitlimitS: 60,
  ...teil,
});

describe.skipIf(!bereit)("jobs with real Podman (Z-305)", () => {
  let agent: EchterAgent;

  beforeAll(async () => {
    agent = echterAgent();
    const eingerichtet = await agent.auftrag(
      auftrag({
        auftragId: "einrichten",
        aktion: EINRICHTUNG_AKTIONEN.einrichten,
        argumente: {},
        zeitlimitS: 1800,
        einrichtung: {
          installation: {
            kundeId: "k-test",
            optionen: [],
            httpPort: 28711,
            ports: {},
            host: "auftrag.sz-test.example",
            ipv4: null,
          },
          einstellungen: { betreiber: {}, installation: {}, auto: {} },
        },
      }),
    );
    if (!(eingerichtet as { ok?: boolean } | undefined)?.ok)
      throw new Error(`setting up for the jobs failed: ${JSON.stringify(eingerichtet)}`);
  });

  afterAll(() => {
    wegraeumen(INSTALLATION);
    agent?.aufraeumen();
  });

  it("run a signed command in the installation's container, once even when sent twice", async () => {
    expect(await agent.auftrag(auftrag({}))).toMatchObject({ ok: true, daten: { code: 0 } });
    expect(imContainer("test", "-f", "/tmp/beweis")).toBe(0);
    // gone again, and the job sent once more: answered from the record, not run
    expect(imContainer("rm", "/tmp/beweis")).toBe(0);
    expect(await agent.auftrag(auftrag({}))).toMatchObject({ ok: true });
    expect(imContainer("test", "-f", "/tmp/beweis")).not.toBe(0);
  });

  it("run nothing from a manifest changed in one byte", async () => {
    const geaendert = MANIFEST.replace("touch", "touci");
    expect(
      await agent.auftrag(
        auftrag({ auftragId: "a2", manifest: geaendert, argumente: { datei: "/tmp/zwei" } }),
      ),
    ).toMatchObject({ ok: false, fehler: "abgelehnt: (signature): signature does not match" });
    expect(imContainer("test", "-f", "/tmp/zwei")).not.toBe(0);
  });

  it("kill a command past its time limit", async () => {
    const beginn = Date.now();
    expect(
      await agent.auftrag(auftrag({ auftragId: "a3", aktion: "langsam", argumente: {} })),
    ).toMatchObject({
      ok: false,
      fehler: "Zeitlimit von 1 s überschritten, Befehl beendet",
    });
    expect(Date.now() - beginn).toBeLessThan(15_000);
  });

  // Review of PR #24: SIGKILL reached runuser only; podman exec and the command in the container
  // (under conmon, outside the process group) ran on. As root, as the agent runs it
  it("leave nothing running past the time limit: neither podman exec nor the command", async () => {
    const nutzer = await nutzerLesen(`sz-${INSTALLATION}`);
    if (!nutzer) throw new Error(`no user sz-${INSTALLATION}`);
    const plan = {
      art: "befehl",
      aktion: "haengt",
      installationId: INSTALLATION,
      container: "app",
      argv: ["sleep", "297"],
      zeitlimitMs: 2000,
      idempotent: false,
    };
    const skript = join(import.meta.dirname, "zeitlimit-als-root.ts");
    const l = lauf(["sudo", "-n", process.execPath, "run", skript, JSON.stringify([plan, nutzer])]);
    expect(l.fehler).toBe("");
    expect(JSON.parse(l.aus)).toEqual({
      ok: false,
      fehler: "Zeitlimit von 2 s überschritten, Befehl beendet",
    });
    const execLaeuft = () =>
      lauf(["pgrep", "-f", `podman exec .*${CONTAINER} sleep 297`]).code === 0;
    const imContainerLaeuft = () =>
      lauf(alsNutzer(`sz-${INSTALLATION}`)("podman", "top", CONTAINER, "args")).aus.includes(
        "sleep 297",
      );
    let weg = false;
    for (let i = 0; i < 20 && !weg; i++) {
      weg = !execLaeuft() && !imContainerLaeuft();
      if (!weg) await Bun.sleep(250);
    }
    expect({ podmanExec: execLaeuft(), imContainer: imContainerLaeuft() }).toEqual({
      podmanExec: false,
      imContainer: false,
    });
  });
});
