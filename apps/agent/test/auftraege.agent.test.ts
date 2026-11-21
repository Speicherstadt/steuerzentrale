// biome-ignore-all lint/suspicious/noTemplateCurlyInString: argv placeholders are ${arg:…} as plain text
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pforteGrundkonfiguration, schluesselLesen } from "@steuerzentrale/manifest";
import { PROTOKOLL_VERSION } from "@steuerzentrale/protokoll";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { geheimenSchluesselLesen, signieren } from "../../../scripts/minisign.ts";
import { auftraegeAnnehmen } from "../src/auftraege/auftraege.ts";
import { echtSpawn } from "../src/auftraege/ausfuehren.ts";
import type { AuftragNachricht } from "../src/auftraege/pruefen.ts";
import { speicher, TEST_PUB } from "../src/beitritt/testhilfen.ts";
import { testCaddy } from "../src/pforte/testcaddy.ts";
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-305 with real Podman (runs in CI only, `bun run test:agent`): the agent's job
 * handling with its real spawn runs a signed manifest's command by `podman exec` in the container
 * named after installation and container, as a fixed argv; a job sent twice runs once, a changed
 * manifest runs nothing, and the time limit kills the command.
 */
const podman = requirePodman(process.env.CI === "true");

// debian:13 by digest (scripts/digest.ts: Registry docker.io, Tag 13, abgefragt am 2026-11-20)
const DEBIAN_13 =
  "docker.io/library/debian@sha256:9c6e381421d0f48d1b8133e573f33c185ee16cbf505eda9c4a8a4791b25ea8a6";

const INSTALLATION = `sz-test-a${crypto.randomUUID().slice(0, 6)}`;
const CONTAINER = `${INSTALLATION}-app`;

const aufraeumen: (() => void)[] = [];
afterAll(() => {
  for (const f of aufraeumen.splice(0).reverse()) f();
});

const MANIFEST = `schema: 1
id: auftrag
version: 1.0.0
lizenz: AGPL-3.0-only
quelle: https://github.com/Speicherstadt/steuerzentrale
container:
  - { name: app, image: "${DEBIAN_13}" }
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

const SIGNATUR = signieren(
  new TextEncoder().encode(MANIFEST),
  geheimenSchluesselLesen(
    readFileSync(join(import.meta.dirname, "../../../test/schluessel/test.key"), "utf8"),
  ),
  "manifest auftrag 1.0.0",
);

const imContainer = (...argv: string[]) =>
  Bun.spawnSync(["podman", "exec", CONTAINER, ...argv]).exitCode;

const containerStarten = () => {
  aufraeumen.push(() => Bun.spawnSync(["podman", "rm", "-f", "-t", "0", CONTAINER]));
  const start = Bun.spawnSync(
    ["podman", "run", "-d", "--name", CONTAINER, DEBIAN_13, "sleep", "infinity"],
    { timeout: 300_000 },
  );
  if (start.exitCode !== 0) throw new Error(start.stderr.toString());
};

const auftrag = (teil: Partial<AuftragNachricht>): AuftragNachricht => ({
  typ: "auftrag",
  protokoll: PROTOKOLL_VERSION,
  auftragId: "a1",
  installationId: INSTALLATION,
  aktion: "anlegen",
  argumente: { datei: "/tmp/beweis" },
  manifest: MANIFEST,
  signatur: SIGNATUR,
  zeitlimitS: 60,
  ...teil,
});

const agent = () => {
  const schluessel = schluesselLesen(TEST_PUB);
  if (!schluessel) throw new Error("test key");
  const gesendet: Record<string, unknown>[] = [];
  const a = auftraegeAnnehmen({
    dateien: speicher().dateien,
    pfad: "/z/auftraege.json",
    vertrauen: { schluessel, zweck: "test" },
    spawn: echtSpawn,
    pforte: { admin: testCaddy().admin, grund: pforteGrundkonfiguration() },
    planen: (lauf, ms) => {
      const t = setTimeout(lauf, ms);
      return () => clearTimeout(t);
    },
    jetzt: Date.now,
    log: () => {},
  });
  return {
    gesendet,
    empfangen: (n: AuftragNachricht) => a.empfangen(n, (t) => gesendet.push(JSON.parse(t))),
  };
};

describe.skipIf(podman === null)("jobs with real Podman (Z-305)", () => {
  beforeAll(containerStarten);

  it("run a signed command in the installation's container, once even when sent twice", async () => {
    const a = agent();
    await a.empfangen(auftrag({}));
    expect(a.gesendet.at(-1)).toMatchObject({ ergebnis: { ok: true, daten: { code: 0 } } });
    expect(imContainer("test", "-f", "/tmp/beweis")).toBe(0);
    // gone again, and the job sent once more: answered from the record, not run
    expect(imContainer("rm", "/tmp/beweis")).toBe(0);
    await a.empfangen(auftrag({}));
    expect(a.gesendet.at(-1)).toMatchObject({ ergebnis: { ok: true } });
    expect(imContainer("test", "-f", "/tmp/beweis")).not.toBe(0);
  });

  it("run nothing from a manifest changed in one byte", async () => {
    const a = agent();
    const geaendert = MANIFEST.replace("touch", "touci");
    await a.empfangen(
      auftrag({ auftragId: "a2", manifest: geaendert, argumente: { datei: "/tmp/zwei" } }),
    );
    expect(a.gesendet.at(-1)).toMatchObject({
      ergebnis: { ok: false, fehler: "abgelehnt: (signature): signature does not match" },
    });
    expect(imContainer("test", "-f", "/tmp/zwei")).not.toBe(0);
  });

  it("kill a command past its time limit", async () => {
    const a = agent();
    const beginn = Date.now();
    await a.empfangen(auftrag({ auftragId: "a3", aktion: "langsam", argumente: {} }));
    expect(a.gesendet.at(-1)).toMatchObject({
      ergebnis: { ok: false, fehler: "Zeitlimit von 1 s überschritten, Befehl beendet" },
    });
    expect(Date.now() - beginn).toBeLessThan(15_000);
  });
});
