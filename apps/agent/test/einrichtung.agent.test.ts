import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EINRICHTUNG_AKTIONEN, type Einrichtung } from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUSGABE } from "../../../scripts/beispiel-images.ts";
import {
  type EchterAgent,
  EINRICHTUNG_BEREIT,
  echterAgent,
  ersetzen,
  signiert,
  wegraeumen,
} from "./einrichtung-hilfen.ts";
import { alsNutzer, lauf } from "./pforte-hilfen.ts";
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-402 with real Podman and systemd (CI only, `bun run test:agent`): the example app
 * installed by a setup job through the agent's job handling, with real useradd, lingering, runuser,
 * Quadlet units in the user's home, Podman secrets and the Pforte's unit under sz-pforte (ci.yml
 * makes that user as install.sh does). Checked: the app runs as its own user and answers on its
 * port; a job sent again sets up nothing; a secret reaches Podman and no file; a file of `dateien`
 * is readable in its container; one installation cannot read the files of another; a failing setup
 * step (a signed manifest whose `migrieren` fails) leaves no user, home, unit, process or container.
 * Root's part goes through sudo (einrichtung-hilfen.ts).
 */
const podman = requirePodman(process.env.CI === "true");
if (podman !== null && process.env.CI === "true" && !EINRICHTUNG_BEREIT)
  throw new Error("SZ_TEST_EINRICHTUNG=1 must be set (ci.yml, job agent)");
const bereit = podman !== null && EINRICHTUNG_BEREIT;
if (podman !== null && !bereit)
  console.warn("SZ_TEST_EINRICHTUNG is not set: the setup test is skipped (it runs in CI)");

const ZUFALL = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
const A = `test-a${ZUFALL}`;
const B = `test-b${ZUFALL}`;
const K = `test-k${ZUFALL}`;

// The example app's manifest 1.0.0 as beispiel-setup.ts built and signed it
const BEISPIEL = () => readFileSync(join(AUSGABE, "manifeste", "1.0.0", "manifest.yml"), "utf8");
const BEISPIEL_SIGNATUR = () =>
  readFileSync(join(AUSGABE, "manifeste", "1.0.0", "manifest.yml.minisig"), "utf8");

const GEHEIM = `geheim-${crypto.randomUUID()}`;
const DATEI = "nur fuer B";

/** B: its key setting a secret, and a file in its container */
const mitSecretUndDatei = (text: string) =>
  ersetzen(
    ersetzen(text, "erzeugen: zufall_32 }", "erzeugen: zufall_32, typ: geheim }"),
    "    env: [BEISPIEL_TITEL, BEISPIEL_SCHLUESSEL]\n",
    `    env: [BEISPIEL_TITEL, BEISPIEL_SCHLUESSEL]\n    dateien: [{ pfad: /etc/beispiel/titel.txt, inhalt: "${DATEI}" }]\n`,
  );

/** K: its setup step fails (the app's unknown mode exits with 2) */
const mitScheiterndemSchritt = (text: string) =>
  ersetzen(
    text,
    "migrieren: { container: app, argv: [bun, /app/server.ts, migrieren] }",
    "migrieren: { container: app, argv: [bun, /app/server.ts, scheitern] }",
  );

const einrichtung = (port: number): Einrichtung => ({
  installation: {
    kundeId: "k-test",
    optionen: [],
    httpPort: port,
    ports: { "app:9000": port + 1 },
    host: `${port}.sz-test.example`,
    ipv4: null,
  },
  einstellungen: { betreiber: {}, installation: {}, auto: { BEISPIEL_SCHLUESSEL: GEHEIM } },
});

const einrichten = (
  agent: EchterAgent,
  name: string,
  port: number,
  manifest: string,
  signatur: string,
  auftragId = `einrichten-${name}`,
) =>
  agent.auftrag({
    auftragId,
    installationId: name,
    aktion: EINRICHTUNG_AKTIONEN.einrichten,
    argumente: {},
    manifest,
    signatur,
    zeitlimitS: 1800,
    einrichtung: einrichtung(port),
  });

const health = async (port: number) => {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (r.status === 200) return r.status;
    } catch {
      // not yet
    }
    await Bun.sleep(500);
  }
  return 0;
};

const sudo = (...argv: string[]) => lauf(["sudo", "-n", ...argv]);
const homeVon = (name: string) => `/home/sz-${name}`;
const unitVon = (name: string) =>
  `${homeVon(name)}/.config/containers/systemd/${name}-app.container`;

describe.skipIf(!bereit)("setting up the example app by a job (Z-402)", () => {
  let agent: EchterAgent;

  beforeAll(() => {
    agent = echterAgent();
  });

  afterAll(() => {
    for (const name of [A, B, K]) wegraeumen(name);
    agent?.aufraeumen();
  });

  it("installs it as its own Linux user from the signed manifest, and it answers on its port", async () => {
    expect(await einrichten(agent, A, 28611, BEISPIEL(), BEISPIEL_SIGNATUR())).toEqual({
      ok: true,
      daten: { installation: A, geaendert: "neu", units: [`${A}-app.service`] },
    });
    expect(await health(28611)).toBe(200);
    expect(sudo("stat", "-c", "%a %U", homeVon(A)).aus.trim()).toBe(`700 sz-${A}`);
    expect(sudo("stat", "-c", "%a %U", unitVon(A)).aus.trim()).toBe(`600 sz-${A}`);
    const alsA = alsNutzer(`sz-${A}`);
    expect(lauf(alsA("systemctl", "--user", "is-active", `${A}-app.service`)).aus.trim()).toBe(
      "active",
    );
    // the container runs under A's user, not the runner's or root's
    expect(lauf(["podman", "ps", "-a", "--format", "{{.Names}}"]).aus).not.toContain(A);
    expect(lauf(alsA("podman", "ps", "--format", "{{.Names}}")).aus).toContain(`${A}-app`);
    // the Pforte's unit, written and started under sz-pforte before an app behind it
    expect(
      lauf(
        alsNutzer("sz-pforte")("systemctl", "--user", "is-active", "sz-pforte.service"),
      ).aus.trim(),
    ).toBe("active");
    expect(agent.record()[A]).toMatchObject({ zustand: "fertig" });
  }, 900_000);

  it("sets up nothing again when the job comes twice, or as a new job", async () => {
    const start = sudo("stat", "-c", "%Y", unitVon(A)).aus;
    expect(await einrichten(agent, A, 28611, BEISPIEL(), BEISPIEL_SIGNATUR())).toMatchObject({
      ok: true,
      daten: { geaendert: "neu" },
    });
    expect(
      await einrichten(agent, A, 28611, BEISPIEL(), BEISPIEL_SIGNATUR(), `noch-einmal-${A}`),
    ).toEqual({ ok: true, daten: { installation: A, geaendert: "nichts" } });
    expect(sudo("stat", "-c", "%Y", unitVon(A)).aus).toBe(start);
  });

  it("runs a command of a job as the installation's user in its container", async () => {
    expect(
      await agent.auftrag({
        auftragId: `export-${A}`,
        installationId: A,
        aktion: "export",
        argumente: {},
        manifest: BEISPIEL(),
        signatur: BEISPIEL_SIGNATUR(),
        zeitlimitS: 60,
      }),
    ).toEqual({ ok: true, daten: { code: 0 } });
  });

  it("hands a secret to Podman and no file, and mounts a file readable in its container", async () => {
    const manifest = mitSecretUndDatei(BEISPIEL());
    expect(await einrichten(agent, B, 28621, manifest, signiert(manifest))).toMatchObject({
      ok: true,
    });
    const alsB = alsNutzer(`sz-${B}`);
    expect(lauf(alsB("podman", "secret", "ls", "--format", "{{.Name}}")).aus).toContain(
      `${B}-beispiel-schluessel`,
    );
    expect(sudo("grep", "-rlF", GEHEIM, homeVon(B), "--exclude-dir=.local").aus).toBe("");
    expect(lauf(alsB("podman", "exec", `${B}-app`, "cat", "/etc/beispiel/titel.txt")).aus).toBe(
      DATEI,
    );
  }, 900_000);

  it("keeps one installation out of the files of another", () => {
    const alsA = alsNutzer(`sz-${A}`);
    const alsB = alsNutzer(`sz-${B}`);
    const datei = `${homeVon(B)}/.config/steuerzentrale/dateien/app/etc/beispiel/titel.txt`;
    // B reads its own; A reads neither B's unit nor B's file nor lists B's home
    expect(lauf(alsB("cat", unitVon(B))).code).toBe(0);
    expect(lauf(alsB("cat", datei)).aus).toBe(DATEI);
    expect(lauf(alsA("cat", unitVon(B))).code).not.toBe(0);
    expect(lauf(alsA("cat", datei)).code).not.toBe(0);
    expect(lauf(alsA("ls", homeVon(B))).code).not.toBe(0);
    expect(lauf(alsB("ls", homeVon(A))).code).not.toBe(0);
  });

  it("leaves nothing behind when a setup step fails", async () => {
    const manifest = mitScheiterndemSchritt(BEISPIEL());
    expect(await einrichten(agent, K, 28631, manifest, signiert(manifest))).toEqual({
      ok: false,
      fehler:
        "Einrichten gescheitert: schritte.einrichten migrieren: endete mit Code 2; alles abgebaut",
    });
    const uid = agent.besitzer.get(homeVon(K));
    expect(uid).toBeGreaterThan(0);
    expect(lauf(["id", "-u", `sz-${K}`]).code).not.toBe(0);
    expect(sudo("test", "-e", homeVon(K)).code).not.toBe(0);
    expect(sudo("test", "-e", `/run/user/${uid}`).code).not.toBe(0);
    expect(lauf(["pgrep", "-u", String(uid)]).code).toBe(1);
    expect(await fetch("http://127.0.0.1:28631/health").catch(() => "weg")).toBe("weg");
    expect(agent.record()[K]).toBeUndefined();
  }, 900_000);
});
