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
 * BAULISTE.md Z-404 with real Podman and systemd (CI only, `bun run test:agent`), as
 * einrichtung.agent.test.ts: the example app set up by a job, an entry written over HTTP, then
 * `installation_konfigurieren` through the agent's job handling. Checked: a new BEISPIEL_TITEL is
 * in the container after the restart, the entry (the volume) is still there and the secret has its
 * value; a title the app refuses at its start (manifeste/beispiel/app/server.ts,
 * BEIM_START_SCHEITERN) makes the agent bring the old units and secret back, and the old state runs
 * again with the entry. Root's part goes through sudo (einrichtung-hilfen.ts).
 */
const podman = requirePodman(process.env.CI === "true");
if (podman !== null && process.env.CI === "true" && !EINRICHTUNG_BEREIT)
  throw new Error("SZ_TEST_EINRICHTUNG=1 must be set (ci.yml, job agent)");
const bereit = podman !== null && EINRICHTUNG_BEREIT;
if (podman !== null && !bereit)
  console.warn("SZ_TEST_EINRICHTUNG is not set: the reconfiguring test is skipped (it runs in CI)");

const ZUFALL = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
const K = `test-c${ZUFALL}`;
const PORT = 28911;
const GEHEIM = `geheim-${crypto.randomUUID()}`;
const ERSTER_TITEL = "Beispiel";
const NEUER_TITEL = `Neu-${ZUFALL}`;
const EINTRAG = `bleibt-${ZUFALL}`;
/** The title the example app refuses at its start (server.ts) */
const SCHEITERT = "beim-start-scheitern";

/** The example app's manifest 1.0.0 as beispiel-setup.ts built it, its key setting a secret */
const MANIFEST = () =>
  ersetzen(
    readFileSync(join(AUSGABE, "manifeste", "1.0.0", "manifest.yml"), "utf8"),
    "erzeugen: zufall_32 }",
    "erzeugen: zufall_32, typ: geheim }",
  );

const einrichtung = (titel: string): Einrichtung => ({
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
    installation: { BEISPIEL_TITEL: titel },
    auto: { BEISPIEL_SCHLUESSEL: GEHEIM },
  },
});

const auftrag = (agent: EchterAgent, aktion: string, auftragId: string, titel: string) => {
  const manifest = MANIFEST();
  return agent.auftrag({
    auftragId,
    installationId: K,
    aktion,
    argumente: {},
    manifest,
    signatur: signiert(manifest),
    zeitlimitS: 1800,
    einrichtung: einrichtung(titel),
  });
};

/** What the app shows at /, once it answers */
const stand = async (): Promise<{ titel?: string; eintraege?: { text: string }[] }> => {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(2000) });
      if (r.status === 200) return (await r.json()) as { titel?: string };
    } catch {
      // not yet
    }
    await Bun.sleep(500);
  }
  return {};
};

const imContainer = (variable: string) =>
  lauf(alsNutzer(`sz-${K}`)("podman", "exec", `${K}-app`, "printenv", variable)).aus.trim();

/** The value of the installation's secret as its user's Podman keeps it */
const secretWert = (): unknown =>
  (
    JSON.parse(
      lauf(
        alsNutzer(`sz-${K}`)(
          "podman",
          "secret",
          "inspect",
          "--showsecret",
          `${K}-beispiel-schluessel`,
        ),
      ).aus || "[]",
    ) as { SecretData?: string }[]
  )[0]?.SecretData;

describe.skipIf(!bereit)("reconfiguring the example app by a job (Z-404)", () => {
  let agent: EchterAgent;

  beforeAll(() => {
    agent = echterAgent();
  });

  afterAll(() => {
    wegraeumen(K);
    agent?.aufraeumen();
  });

  it("sets it up and keeps an entry written over HTTP", async () => {
    const r = (await auftrag(
      agent,
      EINRICHTUNG_AKTIONEN.einrichten,
      `einrichten-${K}`,
      ERSTER_TITEL,
    )) as { ok: boolean; fehler?: string };
    expect(r.ok ? "ok" : r.fehler).toBe("ok");
    expect((await stand()).titel).toBe(ERSTER_TITEL);
    const angelegt = await fetch(`http://127.0.0.1:${PORT}/eintraege`, {
      method: "POST",
      body: JSON.stringify({ text: EINTRAG }),
    });
    expect(angelegt.status).toBe(201);
  }, 900_000);

  it("restarts it with the new title, the entry and the secret kept", async () => {
    expect(
      await auftrag(agent, EINRICHTUNG_AKTIONEN.konfigurieren, `konfigurieren-${K}`, NEUER_TITEL),
    ).toEqual({
      ok: true,
      daten: { installation: K, geaendert: "konfiguriert", units: [`${K}-app.service`] },
    });
    const s = await stand();
    expect(s.titel).toBe(NEUER_TITEL);
    expect(s.eintraege?.map((e) => e.text)).toEqual([EINTRAG]);
    expect(imContainer("BEISPIEL_TITEL")).toBe(NEUER_TITEL);
    // the secret was removed and made anew from the job, with its value
    expect(secretWert()).toBe(GEHEIM);
    expect(agent.record()[K]).toMatchObject({ zustand: "fertig" });
  }, 900_000);

  it("brings the old state back when the app refuses the new one at its start", async () => {
    const r = (await auftrag(
      agent,
      EINRICHTUNG_AKTIONEN.konfigurieren,
      `scheitert-${K}`,
      SCHEITERT,
    )) as { ok: boolean; fehler?: string };
    expect(r).toEqual({
      ok: false,
      fehler: expect.stringMatching(
        /^Neu konfigurieren gescheitert: .+; alter Stand wiederhergestellt$/,
      ),
    });
    const s = await stand();
    expect(s.titel).toBe(NEUER_TITEL);
    expect(s.eintraege?.map((e) => e.text)).toEqual([EINTRAG]);
    // the secret read back before, made again with its old value
    expect(secretWert()).toBe(GEHEIM);
    expect(
      lauf(alsNutzer(`sz-${K}`)("systemctl", "--user", "is-active", `${K}-app.service`)).aus.trim(),
    ).toBe("active");
    expect(r.fehler).not.toContain(GEHEIM);
  }, 900_000);

  it("refuses to change the options", async () => {
    const manifest = MANIFEST();
    const mitWorker = einrichtung(NEUER_TITEL);
    mitWorker.installation.optionen = ["worker"];
    expect(
      await agent.auftrag({
        auftragId: `optionen-${K}`,
        installationId: K,
        aktion: EINRICHTUNG_AKTIONEN.konfigurieren,
        argumente: {},
        manifest,
        signatur: signiert(manifest),
        zeitlimitS: 1800,
        einrichtung: mitWorker,
      }),
    ).toMatchObject({ ok: false, fehler: expect.stringMatching(/^abgelehnt: die Units/) });
    expect((await stand()).titel).toBe(NEUER_TITEL);
  }, 120_000);
});
