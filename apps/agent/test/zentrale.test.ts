import { TRENNUNG } from "@steuerzentrale/protokoll";
import { afterEach, describe, expect, it } from "vitest";
import { heartbeats } from "../../zentrale/src/db/schema.ts";
import { serverHinzufuegen } from "../../zentrale/src/testhilfen/agent.ts";
import { zentraleStarten } from "../../zentrale/src/testhilfen/bun-server.ts";
import { testServer } from "../../zentrale/src/testhilfen/server.ts";
import { testPforte } from "../../zentrale/src/testhilfen/testpforte.ts";
import { agentBeitreten, pforteTls } from "../../zentrale/src/testhilfen/tls.ts";
import { speicher } from "../src/beitritt/testhilfen.ts";
import { pfadeIn } from "../src/pfade.ts";
import { echtOeffnen } from "../src/verbindung/sockel.ts";
import { verbindungsSchleife } from "../src/verbindung/verbinden.ts";

/*
 * BAULISTE.md Z-303, agent and Zentrale together: the agent's real connection loop with Bun's
 * WebSocket and its client certificate, through the stand-in for the Pforte (TLS, certificate
 * check, fingerprint header) to the real Zentrale. Time runs a thousand times faster for the
 * agent's timers: a heartbeat every 30 ms, a backoff from half a millisecond.
 */
const RAFFUNG = 1000;
const aufraeumen: (() => void)[] = [];
afterEach(() => {
  for (const f of aufraeumen.splice(0).reverse()) f();
});

const aufgebaut = async () => {
  const zentrale = testServer();
  // the Zentrale's clock is the real one: TLS checks the certificates against it
  Object.defineProperty(zentrale.uhr, "ms", { get: () => Date.now() });
  const inhaber = await zentrale.inhaber();
  const { token } = await serverHinzufuegen(inhaber);
  const agent = await agentBeitreten(zentrale, token);
  const starten = (port = 0) => zentraleStarten(zentrale.app, port);
  let bun = starten();
  const port = bun.port ?? 0;
  const tls = await pforteTls();
  const pforte = testPforte({ ziel: port, ...tls, clientCas: [agent.ca] });
  const pfade = pfadeIn("/k", "/z");
  const fs = speicher({
    [pfade.schluessel]: agent.schluessel,
    [pfade.zertifikat]: agent.zertifikat,
  });
  const log: Record<string, unknown>[] = [];
  const schleife = verbindungsSchleife(
    {
      oeffnen: echtOeffnen,
      planen: (lauf, ms) => {
        const t = setTimeout(lauf, ms / RAFFUNG);
        return () => clearTimeout(t);
      },
      jetzt: Date.now,
      zufall: () => 0.5,
      log: (z) => log.push(JSON.parse(z)),
      dateien: fs.dateien,
      pfade,
      architektur: "amd64",
      serverCa: tls.ca,
    },
    `https://127.0.0.1:${pforte.port}`,
  );
  aufraeumen.push(
    () => bun.stop(true),
    () => pforte.stoppen(),
    () => schleife.stoppen(),
  );
  const herzschlaege = () => zentrale.db.select().from(heartbeats).all().length;
  return {
    zentrale,
    inhaber,
    agent,
    log,
    herzschlaege,
    stoppen: () => bun.stop(true),
    neuStarten: () => {
      bun = starten(port);
    },
  };
};

describe("agent and Zentrale", () => {
  it("connect through the Pforte, and the heartbeats arrive", async () => {
    const { inhaber, agent, log, herzschlaege } = await aufgebaut();
    await expect.poll(() => herzschlaege(), { timeout: 5000 }).toBeGreaterThanOrEqual(3);
    expect(log.filter((z) => z.msg === "connected")).toHaveLength(1);
    const { daten } = await inhaber.json(`/api/v1/server/${agent.serverId}`);
    expect(daten).toMatchObject({
      agentVersion: expect.any(String),
      agent: { zustand: "verbunden" },
    });
  });

  it("reconnect with backoff after the Zentrale went away and came back", async () => {
    const { log, herzschlaege, stoppen, neuStarten } = await aufgebaut();
    await expect.poll(() => herzschlaege(), { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    stoppen();
    await expect
      .poll(() => log.filter((z) => z.msg === "disconnected").length, { timeout: 5000 })
      .toBeGreaterThanOrEqual(5);
    const gewartet = log.filter((z) => z.msg === "disconnected").map((z) => z.wiederIn as number);
    // 750 ms, 1.5 s, 3 s, ... in the agent's time: the backoff grows with each failed attempt
    expect(gewartet.slice(0, 4)).toEqual([750, 1500, 3000, 6000]);
    const vorher = herzschlaege();
    neuStarten();
    await expect
      .poll(() => log.filter((z) => z.msg === "connected").length, { timeout: 10_000 })
      .toBe(2);
    await expect.poll(() => herzschlaege(), { timeout: 5000 }).toBeGreaterThan(vorher);
  });

  it("part for good when the certificate is revoked: the agent is refused at every attempt", async () => {
    const { inhaber, agent, log, herzschlaege } = await aufgebaut();
    await expect.poll(() => herzschlaege(), { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    await inhaber.json(`/api/v1/server/${agent.serverId}/sperren`, { body: { grund: "Test" } });
    await expect
      .poll(() => log.filter((z) => z.msg === "disconnected").length, { timeout: 5000 })
      .toBeGreaterThanOrEqual(4);
    expect(log.find((z) => z.msg === "disconnected")).toMatchObject({ code: TRENNUNG.gesperrt });
    expect(log.filter((z) => z.msg === "connected")).toHaveLength(1);
    const danach = herzschlaege();
    await new Promise((r) => setTimeout(r, 200));
    expect(herzschlaege()).toBe(danach);
  });
});
