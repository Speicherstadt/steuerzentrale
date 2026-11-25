import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EINRICHTUNG_AKTIONEN, type Einrichtung } from "@steuerzentrale/manifest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUSGABE } from "../../../scripts/beispiel-images.ts";
import { lastMesser } from "../src/fakten/last.ts";
import { echteQuellen } from "../src/fakten/quellen.ts";
import type { ZustandNachricht } from "../src/zustand/runde.ts";
import {
  type EchterAgent,
  EINRICHTUNG_BEREIT,
  echterAgent,
  ersetzen,
  signiert,
  wegraeumen,
} from "./einrichtung-hilfen.ts";
import { alsNutzer, lauf, muss } from "./pforte-hilfen.ts";
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-403, the agent's side, with real Podman and systemd (CI only, `bun run test:agent`):
 * installations set up by jobs as in einrichtung.agent.test.ts, then the agent's round of checks
 * (src/zustand) as it is sent in `zustand`. Checked: the example app 1.0.0 reports health green;
 * its broken build 2.1.0 (health route 500) health red; with the option `worker`, a stopped worker
 * unit is reported not active while the app's unit stays active; a manifest with `health: keine`
 * reports health without a check. Root's part goes through sudo (einrichtung-hilfen.ts).
 */
const podman = requirePodman(process.env.CI === "true");
if (podman !== null && process.env.CI === "true" && !EINRICHTUNG_BEREIT)
  throw new Error("SZ_TEST_EINRICHTUNG=1 must be set (ci.yml, job agent)");
const bereit = podman !== null && EINRICHTUNG_BEREIT;
if (podman !== null && !bereit)
  console.warn("SZ_TEST_EINRICHTUNG is not set: the state test is skipped (it runs in CI)");

const ZUFALL = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
const G = `test-g${ZUFALL}`;
const R = `test-r${ZUFALL}`;
const W = `test-w${ZUFALL}`;
const O = `test-o${ZUFALL}`;

// The example app's manifests as beispiel-setup.ts built and signed them with the test key
const manifest = (version: string) =>
  readFileSync(join(AUSGABE, "manifeste", version, "manifest.yml"), "utf8");
const signatur = (version: string) =>
  readFileSync(join(AUSGABE, "manifeste", version, "manifest.yml.minisig"), "utf8");

/** O: no health check, only a note */
const ohneHealth = (text: string) =>
  ersetzen(
    text,
    "health: { art: http, dienst: app, pfad: /health }",
    "health: { art: keine, hinweis: kein Endpunkt fuer den Test }",
  );

const einrichtung = (port: number, optionen: string[] = []): Einrichtung => ({
  installation: {
    kundeId: "k-test",
    optionen,
    httpPort: port,
    ports: { "app:9000": port + 1 },
    host: `${port}.sz-test.example`,
    ipv4: null,
  },
  einstellungen: { betreiber: {}, installation: {}, auto: { BEISPIEL_SCHLUESSEL: "test" } },
});

const einrichten = async (
  agent: EchterAgent,
  name: string,
  daten: Einrichtung,
  text: string,
  sig: string,
) => {
  const r = (await agent.auftrag({
    auftragId: `einrichten-${name}`,
    installationId: name,
    aktion: EINRICHTUNG_AKTIONEN.einrichten,
    argumente: {},
    manifest: text,
    signatur: sig,
    zeitlimitS: 1800,
    einrichtung: daten,
  })) as { ok: boolean; fehler?: string };
  // the reason, should it fail
  expect(r.ok ? "ok" : r.fehler).toBe("ok");
};

type Gemeldet = ZustandNachricht["installationen"][number];

/** Rounds of checks until the installation's report fits, a minute at most; the last report */
const bis = async (agent: EchterAgent, name: string, passt: (g: Gemeldet) => boolean) => {
  let letzte: Gemeldet | undefined;
  for (let i = 0; i < 60; i++) {
    letzte = (await agent.zustand()).installationen.find((g) => g.installationId === name);
    if (letzte && passt(letzte)) return letzte;
    await Bun.sleep(1000);
  }
  return letzte;
};

describe.skipIf(!bereit)("the state of installations set up by jobs (Z-403)", () => {
  let agent: EchterAgent;

  beforeAll(() => {
    agent = echterAgent();
  });

  afterAll(() => {
    for (const name of [G, R, W, O]) wegraeumen(name);
    agent?.aufraeumen();
  });

  it("reports the example app 1.0.0 with health green and its unit active", async () => {
    await einrichten(agent, G, einrichtung(28811), manifest("1.0.0"), signatur("1.0.0"));
    expect(await bis(agent, G, (g) => g.health.zustand === "gruen")).toEqual({
      installationId: G,
      units: [{ name: `${G}-app.service`, aktiv: "active" }],
      health: { zustand: "gruen", grund: "HTTP 200" },
    });
  }, 900_000);

  // BAULISTE.md Z-1106: the memory of an installation's user, from its cgroup, higher while its
  // container runs than while it is stopped
  it("reads more memory of the example app's user while it runs than while it is stopped", async () => {
    const nutzer = [{ name: `sz-${G}`, uid: Number(muss(["id", "-u", `sz-${G}`])) }];
    const messen = lastMesser(echteQuellen());
    const app = `${G}-app.service`;
    expect(lauf(alsNutzer(`sz-${G}`)("systemctl", "--user", "stop", app)).code).toBe(0);
    await Bun.sleep(3000);
    const gestoppt = (await messen(nutzer, 2, Date.now())).nutzer[0]?.ramMb;
    expect(lauf(alsNutzer(`sz-${G}`)("systemctl", "--user", "start", app)).code).toBe(0);
    await bis(agent, G, (g) => g.health.zustand === "gruen");
    const laeuft = (await messen(nutzer, 2, Date.now())).nutzer[0]?.ramMb;
    console.log(`memory of sz-${G}: stopped ${gestoppt} MiB, running ${laeuft} MiB`);
    expect(gestoppt).toEqual(expect.any(Number));
    expect(laeuft).toBeGreaterThan(gestoppt ?? Number.POSITIVE_INFINITY);
  }, 900_000);

  it("reports the broken build 2.1.0 with health red, its unit running", async () => {
    await einrichten(agent, R, einrichtung(28821), manifest("2.1.0"), signatur("2.1.0"));
    expect(await bis(agent, R, (g) => g.health.grund === "HTTP 500")).toEqual({
      installationId: R,
      units: [{ name: `${R}-app.service`, aktiv: "active" }],
      health: { zustand: "rot", grund: "HTTP 500" },
    });
  }, 900_000);

  it("reports a stopped worker unit as not active, the app's unit still active", async () => {
    await einrichten(
      agent,
      W,
      einrichtung(28831, ["worker"]),
      manifest("1.0.0"),
      signatur("1.0.0"),
    );
    const worker = `${W}-worker.service`;
    expect(await bis(agent, W, (g) => g.units.every((u) => u.aktiv === "active"))).toMatchObject({
      units: [
        { name: `${W}-app.service`, aktiv: "active" },
        { name: worker, aktiv: "active" },
      ],
    });
    expect(lauf(alsNutzer(`sz-${W}`)("systemctl", "--user", "stop", worker)).code).toBe(0);
    const gestoppt = await bis(agent, W, (g) => g.units.some((u) => u.aktiv !== "active"));
    expect(gestoppt?.units.find((u) => u.name === `${W}-app.service`)?.aktiv).toBe("active");
    expect(gestoppt?.units.find((u) => u.name === worker)?.aktiv).not.toBe("active");
    expect(gestoppt?.units.find((u) => u.name === worker)?.aktiv).not.toBe("unknown");
  }, 900_000);

  it("reports health without a check for a manifest with health: keine", async () => {
    const text = ohneHealth(manifest("1.0.0"));
    await einrichten(agent, O, einrichtung(28841), text, signiert(text));
    expect(await bis(agent, O, (g) => g.units.every((u) => u.aktiv === "active"))).toEqual({
      installationId: O,
      units: [{ name: `${O}-app.service`, aktiv: "active" }],
      health: { zustand: "unbekannt", grund: "keine Prüfung" },
    });
  }, 900_000);
});
