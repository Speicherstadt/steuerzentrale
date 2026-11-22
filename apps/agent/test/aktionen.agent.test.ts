import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AKTIONS_AUFTRAEGE,
  EINRICHTUNG_AKTIONEN,
  type Einrichtung,
} from "@steuerzentrale/manifest";
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
import { requirePodman } from "./podman.ts";

/*
 * BAULISTE.md Z-405 with real Podman, systemd and journald (CI only, `bun run test:agent`), as
 * konfigurieren.agent.test.ts: the example app set up by a job, in the test mode of its server
 * (BEISPIEL_AUSGEBEN in feste_env, manifeste/beispiel/app/server.ts) that writes a secret
 * (BEISPIEL_PASSWORT, a Podman secret) and a generated value of ebene auto (BEISPIEL_SCHLUESSEL,
 * Environment= in the unit) to its log at its start. Checked: the log excerpt, read by the agent
 * with journalctl as root, has the app's lines with [geheim] where the values were and neither
 * value anywhere; a restart brings the app back; a manifest with `neustart: nicht_unterstuetzt`
 * gets the restart refused. Root's part goes through sudo (einrichtung-hilfen.ts).
 */
const podman = requirePodman(process.env.CI === "true");
if (podman !== null && process.env.CI === "true" && !EINRICHTUNG_BEREIT)
  throw new Error("SZ_TEST_EINRICHTUNG=1 must be set (ci.yml, job agent)");
const bereit = podman !== null && EINRICHTUNG_BEREIT;
if (podman !== null && !bereit)
  console.warn(
    "SZ_TEST_EINRICHTUNG is not set: the test of the actions is skipped (it runs in CI)",
  );

const ZUFALL = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
const K = `test-l${ZUFALL}`;
const PORT = 29011;
const PASSWORT = `pw-${crypto.randomUUID()}`;
/** As the Zentrale generates it (zufall_32): 32 random bytes in base64 */
const AUTO = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

/** The example app's manifest 1.0.0 as beispiel-setup.ts built it, with the password and the test mode */
const MANIFEST = (aktionen?: string) => {
  const gebaut = readFileSync(join(AUSGABE, "manifeste", "1.0.0", "manifest.yml"), "utf8");
  const mitWerten = ersetzen(
    ersetzen(
      gebaut,
      "    env: [BEISPIEL_TITEL, BEISPIEL_SCHLUESSEL]",
      [
        "    env: [BEISPIEL_TITEL, BEISPIEL_SCHLUESSEL, BEISPIEL_PASSWORT]",
        '    feste_env: { BEISPIEL_AUSGEBEN: "BEISPIEL_SCHLUESSEL,BEISPIEL_PASSWORT" }',
      ].join("\n"),
    ),
    "  - { name: BEISPIEL_SCHLUESSEL, ebene: auto, erzeugen: zufall_32 }",
    [
      "  - { name: BEISPIEL_SCHLUESSEL, ebene: auto, erzeugen: zufall_32 }",
      "  - { name: BEISPIEL_PASSWORT, ebene: installation, typ: geheim }",
    ].join("\n"),
  );
  return aktionen === undefined
    ? mitWerten
    : ersetzen(
        mitWerten,
        "aktionen: { nur_lesen: nicht_unterstuetzt, export: { befehl: export } }",
        `aktionen: ${aktionen}`,
      );
};

const EINRICHTUNG: Einrichtung = {
  installation: {
    kundeId: "k-test",
    optionen: [],
    httpPort: PORT,
    ports: { "app:9000": PORT + 1 },
    host: `${PORT}.sz-test.example`,
    ipv4: null,
  },
  einstellungen: {
    betreiber: {},
    installation: { BEISPIEL_PASSWORT: PASSWORT },
    auto: { BEISPIEL_SCHLUESSEL: AUTO },
  },
};

const auftrag = (
  agent: EchterAgent,
  aktion: string,
  auftragId: string,
  manifest = MANIFEST(),
  einrichtung?: Einrichtung,
) =>
  agent.auftrag({
    auftragId,
    installationId: K,
    aktion,
    argumente: {},
    manifest,
    signatur: signiert(manifest),
    zeitlimitS: 1800,
    einrichtung,
  });

const gesund = async (): Promise<number | undefined> => {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (r.status === 200) return r.status;
    } catch {
      // not yet
    }
    await Bun.sleep(500);
  }
  return undefined;
};

type Auszug = { typ: string; auftragId: string; zeilen: string[] };

/** Log excerpts until the app's start is in one (journald may write a moment later) */
const auszugMitStart = async (
  agent: EchterAgent,
): Promise<{ auszug: Auszug; ergebnis: unknown }> => {
  for (let i = 0; ; i++) {
    const id = `log-${K}-${i}`;
    const ergebnis = await auftrag(agent, AKTIONS_AUFTRAEGE.log_auszug, id);
    const auszug = agent.gesendet.find((g) => g.typ === "log_auszug" && g.auftragId === id) as
      | Auszug
      | undefined;
    const fertig = auszug?.zeilen.some((z) => z.includes("beispiel listening")) ?? false;
    if (fertig || i >= 30)
      return { auszug: auszug ?? { typ: "", auftragId: id, zeilen: [] }, ergebnis };
    await Bun.sleep(1000);
  }
};

describe.skipIf(!bereit)("restart and log excerpt of the example app by jobs (Z-405)", () => {
  let agent: EchterAgent;

  beforeAll(() => {
    agent = echterAgent();
  });

  afterAll(() => {
    wegraeumen(K);
    agent?.aufraeumen();
  });

  it("sets it up in the test mode that logs its secret values", async () => {
    const r = (await auftrag(
      agent,
      EINRICHTUNG_AKTIONEN.einrichten,
      `einrichten-${K}`,
      MANIFEST(),
      EINRICHTUNG,
    )) as { ok: boolean; fehler?: string };
    expect(r.ok ? "ok" : r.fehler).toBe("ok");
    expect(await gesund()).toBe(200);
  }, 900_000);

  it("sends the app's lines with [geheim] where the secret and the generated value were", async () => {
    const { auszug, ergebnis } = await auszugMitStart(agent);
    expect(auszug.zeilen.some((z) => z.includes("beispiel listening"))).toBe(true);
    expect(auszug.zeilen.some((z) => z.endsWith("beispiel test: BEISPIEL_PASSWORT=[geheim]"))).toBe(
      true,
    );
    expect(
      auszug.zeilen.some((z) => z.endsWith("beispiel test: BEISPIEL_SCHLUESSEL=[geheim]")),
    ).toBe(true);
    expect(ergebnis).toEqual({ ok: true, daten: { zeilen: auszug.zeilen.length } });
    const alles = JSON.stringify(agent.gesendet);
    expect(alles).not.toContain(PASSWORT);
    expect(alles).not.toContain(AUTO);
    expect(JSON.stringify(agent.record())).not.toContain(PASSWORT);
  }, 120_000);

  it("restarts it, and the app answers again", async () => {
    expect(await auftrag(agent, AKTIONS_AUFTRAEGE.neustart, `neustart-${K}`)).toEqual({
      ok: true,
      daten: { installation: K, units: [`${K}-app.service`] },
    });
    expect(await gesund()).toBe(200);
  }, 300_000);

  it("refuses the restart when the manifest does not offer it", async () => {
    const ohne = MANIFEST(
      "{ nur_lesen: nicht_unterstuetzt, export: { befehl: export }, neustart: nicht_unterstuetzt }",
    );
    expect(await auftrag(agent, AKTIONS_AUFTRAEGE.neustart, `ohne-neustart-${K}`, ohne)).toEqual({
      ok: false,
      fehler: "abgelehnt: the manifest does not offer neustart",
    });
  }, 60_000);
});
