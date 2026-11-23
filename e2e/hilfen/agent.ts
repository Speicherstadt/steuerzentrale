import { createHash, randomBytes, randomInt } from "node:crypto";
import { type APIRequestContext, expect } from "@playwright/test";
import { testAnfrage } from "../../apps/zentrale/src/testhilfen/agent.ts";
import { serverAnlegen } from "./server.ts";

/*
 * A stand-in for the agent of a server in the e2e tests (BAULISTE.md Z-402): it joins with the
 * one-time token of the dialog "Server hinzufügen" (Z-302), connects as an agent does (Z-303),
 * reports facts (Z-304) and so makes the server one an app can be placed on. It takes the jobs it
 * gets and runs none, so an installation stays "wird eingerichtet"; a setup whose host starts with
 * `kaputt` it reports failed, as the real agent does after cleaning up, one whose host starts with
 * `laeuft` done, and the Pforte's route of such a host too. A job `installation_konfigurieren`
 * (Z-404) it reports done as the real agent does (`geaendert: "konfiguriert"`). A restart (Z-405)
 * it reports done; for a log excerpt it sends the lines (`LOG_ZEILEN`, the secrets already
 * replaced as the real agent does) and then the result with their number. Setting up backups
 * (Z-601) it reports done; "Backup jetzt" it reports done after the run, as the real agent sends it
 * (`backup_stand` with a snapshot per part). It reports the state of installations and an SSH login
 * when a test tells it to (Z-403, Z-406). No Podman, no server.
 */

// The Zentrale of the e2e tests (playwright.config.ts): agents reach it directly, not through Vite
const ZENTRALE = "127.0.0.1:28300";
// What the Pforte hands the Zentrale (apps/zentrale, modules/verbindung/herkunft.ts)
const FINGERABDRUCK_HEADER = "x-sz-client-fingerabdruck";

/** One installation in a `zustand` message (packages/protokoll, nachrichten.ts) */
export type ZustandEintrag = {
  installationId: string;
  units: { name: string; aktiv: string }[];
  health: { zustand: "gruen" | "gelb" | "rot" | "unbekannt"; grund: string };
};

export type TestAgent = {
  serverId: string;
  name: string;
  /** Sends the state of installations, as the agent does every 30 s */
  melden: (installationen: ZustandEintrag[]) => void;
  /** Reports an SSH login from the journal (Z-304), which the Zentrale keeps as an event */
  sshAnmelden: (nutzer: string) => void;
  trennen: () => void;
};

type Nachricht = Record<string, unknown> & { typ: string };

/** Node's WebSocket (undici) takes headers besides the protocols; the DOM's type does not know it */
const NodeWebSocket = WebSocket as unknown as new (
  url: string,
  init: { headers: Record<string, string> },
) => WebSocket;

/** The SHA-256 of the certificate's DER bytes in hex, as the Pforte names it */
const fingerabdruck = (pem: string) =>
  createHash("sha256")
    .update(Buffer.from(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s/g, ""), "base64"))
    .digest("hex");

/**
 * Exchanges the token for a certificate. Each server comes from an address of its own, as the
 * Pforte reports it, so the joins of parallel tests do not share one bucket of the rate limit
 */
const beitreten = async (befehl: string): Promise<string> => {
  const token = /--token (\S+)/.exec(befehl)?.[1] ?? "";
  const antwort = await fetch(`http://${ZENTRALE}/api/v1/agent/beitreten`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${randomInt(1, 255)}`,
    },
    body: JSON.stringify(await testAnfrage(token)),
  });
  expect(antwort.status).toBe(201);
  return ((await antwort.json()) as { zertifikat: string }).zertifikat;
};

/** The facts of a small Debian server with room for an app (packages/protokoll, beispiele-v1.ts) */
const fakten = (zeit: number) => ({
  typ: "fakten",
  protokoll: 1,
  zeit,
  cpuKerne: 4,
  ramMb: 8192,
  platten: [{ mount: "/", gesamtMb: 81920, freiMb: 61440 }],
  architektur: "amd64",
  os: { name: "Debian GNU/Linux", version: "13" },
  kernel: { laeuft: "6.12.0-1-amd64", installiert: "6.12.0-1-amd64" },
  neustartNoetig: false,
  updatesAusstehend: 0,
  podman: "5.4.2",
  ipv4: ["203.0.113.10"],
  ipv6: ["2001:db8::10"],
  ptr: { "203.0.113.10": "server-a.example.org" },
  portsBelegt: [{ port: 443, proto: "tcp" }],
  port25Ausgehend: false,
  uhrzeitAbweichungMs: 12,
});

/** What the stand-in agent reads from the journal of every installation */
export const LOG_ZEILEN = [
  "2026-11-22T10:31:02+0100 app[1]: started",
  "2026-11-22T10:31:02+0100 app[1]: config loaded, PROBE_KENNWORT=[geheim]",
  "2026-11-22T10:31:03+0100 app[1]: listening on :8080",
];

const ergebnis = (auftragId: string, e: Record<string, unknown>) =>
  JSON.stringify({ typ: "ergebnis", protokoll: 1, auftragId, zeit: Date.now(), ergebnis: e });

/** A run of the installation's backup as the agent reports it, one part with its snapshot */
const backupStand = (installationId: unknown) =>
  JSON.stringify({
    typ: "backup_stand",
    protokoll: 1,
    installationId,
    zeit: Date.now(),
    ok: true,
    teile: [{ tag: "volume-daten", snapshotId: randomBytes(4).toString("hex") }],
  });

/** Done as the real agent reports configuring anew (apps/agent, Z-404) */
const konfiguriert = (n: Nachricht) => ({
  ok: true,
  daten: { installation: n.installationId, geaendert: "konfiguriert", units: [] },
});

/**
 * Takes a job; a setup of a `kaputt…` host it reports failed, of a `laeuft…` host done, with its
 * route; configuring anew and a restart done, a log excerpt with its lines
 */
const auftragNehmen = (ws: WebSocket, n: Nachricht) => {
  const auftragId = n.auftragId as string;
  ws.send(JSON.stringify({ typ: "bestaetigt", protokoll: 1, auftragId }));
  const einrichtung = n.einrichtung as { installation?: { host?: string } } | undefined;
  const host = einrichtung?.installation?.host ?? (n.argumente as { host?: string }).host;
  if (n.aktion === "installation_konfigurieren")
    return ws.send(ergebnis(auftragId, konfiguriert(n)));
  if (n.aktion === "installation_neustart" || n.aktion === "installation_backup_einrichten")
    return ws.send(ergebnis(auftragId, { ok: true, daten: { installation: n.installationId } }));
  if (n.aktion === "installation_backup") {
    ws.send(backupStand(n.installationId));
    return ws.send(ergebnis(auftragId, { ok: true, daten: { installation: n.installationId } }));
  }
  if (n.aktion === "installation_log_auszug") {
    ws.send(JSON.stringify({ typ: "log_auszug", protokoll: 1, auftragId, zeilen: LOG_ZEILEN }));
    return ws.send(ergebnis(auftragId, { ok: true, daten: { zeilen: LOG_ZEILEN.length } }));
  }
  if (n.aktion !== "installation_einrichten" && n.aktion !== "pforte_route_setzen") return;
  if (host?.startsWith("kaputt"))
    ws.send(ergebnis(auftragId, { ok: false, fehler: "image ziehen: manifest unknown" }));
  if (host?.startsWith("laeuft")) ws.send(ergebnis(auftragId, { ok: true, daten: {} }));
};

const verbinden = (zertifikat: string): Promise<WebSocket> =>
  new Promise((bereit, fehler) => {
    const ws = new NodeWebSocket(`ws://${ZENTRALE}/api/v1/agent/verbindung`, {
      headers: { [FINGERABDRUCK_HEADER]: fingerabdruck(zertifikat) },
    });
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          typ: "hallo",
          protokoll: 1,
          agentVersion: "0.0.0",
          architektur: "amd64",
          zeit: Date.now(),
        }),
      );
    ws.onmessage = (event) => {
      const n = JSON.parse(String(event.data)) as Nachricht;
      if (n.typ === "willkommen") {
        ws.send(JSON.stringify(fakten(Date.now())));
        bereit(ws);
      }
      if (n.typ === "auftrag") auftragNehmen(ws, n);
    };
    ws.onerror = () => fehler(new Error("the agent's connection failed"));
  });

/** A shared server of the first owner's operator whose agent is connected and reported its facts */
export const agentVerbinden = async (
  request: APIRequestContext,
  name: string,
): Promise<TestAgent> => {
  const server = await serverAnlegen(request, name);
  const ws = await verbinden(await beitreten(server.befehl));
  await expect
    .poll(async () => {
      const s = await request.get(`/api/v1/server/${server.serverId}`);
      const sv = (await s.json()) as { agent: { zustand: string }; fakten: unknown };
      return sv.agent.zustand === "verbunden" && sv.fakten !== null;
    })
    .toBe(true);
  return {
    serverId: server.serverId,
    name: server.name,
    melden: (installationen) =>
      ws.send(JSON.stringify({ typ: "zustand", protokoll: 1, zeit: Date.now(), installationen })),
    sshAnmelden: (nutzer) =>
      ws.send(
        JSON.stringify({
          typ: "ssh_anmeldung",
          protokoll: 1,
          zeit: Date.now(),
          nutzer,
          von: "10.8.0.2",
          methode: "publickey",
        }),
      ),
    trennen: () => ws.close(),
  };
};
