import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { type APIRequestContext, expect } from "@playwright/test";
import { testAnfrage } from "../../apps/zentrale/src/testhilfen/agent.ts";
import { OHNE_HASH, signieren } from "../../packages/manifest/src/s3/sigv4.ts";
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
 * (`backup_stand` with a snapshot per part). A test restore (Z-602) it reports done with the
 * snapshot each part was restored from and its duration, as the real agent does, and so a restore
 * (Z-603), with the snapshot its job names. An update (Z-503) it reports as the real agent does in
 * `daten`: `aktualisiert`, or `zurueckgenommen` with its reason for a host that starts with
 * `laeuft-zurueck`. It reports the
 * state of installations and an SSH login when a test tells it to (Z-403, Z-406). A reboot of the
 * server (Z-701) of its current boot it answers as the real agent does: the connection ends, it
 * comes back on a new boot id, and the job the Zentrale sends again it reports done with that id.
 * After a contract (Z-604) it uploads the archive as the real agent does, with the access of the
 * installation's backup to the stand-in of MinIO, and reports a deletion done.
 * No Podman, no server.
 */

// The Zentrale of the e2e tests (playwright.config.ts): agents reach it directly, not through Vite;
// the one the install command names, so the Zentrale "Nur für mich" (Z-805) gets its own agents
const ZENTRALE = "127.0.0.1:28300";
const zentraleAus = (befehl: string): string => {
  const port = /:(\d+)\/install\.sh/.exec(befehl)?.[1];
  return port ? `127.0.0.1:${port}` : ZENTRALE;
};
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
  const antwort = await fetch(`http://${zentraleAus(befehl)}/api/v1/agent/beitreten`, {
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
const fakten = (zeit: number, bootId: string) => ({
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
  bootId,
  gestartetAm: zeit - 3 * 86_400_000,
  unattendedUpgrades: { installiert: true, aktiv: true, letzterLauf: zeit - 3600_000 },
  portsOffen: [
    { port: 22, proto: "tcp" },
    { port: 443, proto: "tcp" },
  ],
  zertifikate: [],
  uhrSynchron: true,
});

/**
 * The stand-in's connection and boot, both replaced by a reboot, and the facts it reports other
 * than the default ones (`anders`)
 */
type Lage = {
  ws: WebSocket;
  bootId: string;
  zertifikat: string;
  anders: Record<string, unknown>;
  /** host:port of the Zentrale the agent joined */
  zentrale: string;
};

/** What the stand-in agent reads from the journal of every installation */
export const LOG_ZEILEN = [
  "2026-11-22T10:31:02+0100 app[1]: started",
  "2026-11-22T10:31:02+0100 app[1]: config loaded, PROBE_KENNWORT=[geheim]",
  "2026-11-22T10:31:03+0100 app[1]: listening on :8080",
];

const ergebnis = (auftragId: string, e: Record<string, unknown>) =>
  JSON.stringify({ typ: "ergebnis", protokoll: 1, auftragId, zeit: Date.now(), ergebnis: e });

/** A run of the installation's backup as the agent reports it, one part with its snapshot */
const backupLauf = (installationId: unknown) => ({
  typ: "backup_stand",
  protokoll: 1,
  installationId,
  lauf: randomUUID(),
  beginn: Date.now() - 1000,
  ende: Date.now(),
  ok: true,
  teile: [{ tag: "volume:daten", ok: true, snapshot: randomBytes(32).toString("hex") }],
});

/** "Backup jetzt": the run as `backup_stand`, then the result (apps/agent, backup/auftrag.ts) */
const backupJetzt = (ws: WebSocket, n: Nachricht) => {
  const lauf = backupLauf(n.installationId);
  ws.send(JSON.stringify(lauf));
  const daten = { installation: n.installationId, lauf: lauf.lauf, teile: lauf.teile };
  ws.send(ergebnis(n.auftragId as string, { ok: true, daten }));
};

/** Setting up backups done, as the agent reports it for a repository it made */
const backupEingerichtet = (n: Nachricht) => ({
  ok: true,
  daten: {
    installation: n.installationId,
    repository: "angelegt",
    teile: ["volume:daten"],
    timer: "sz_backup.timer",
  },
});

/** A test restore done: each part of the manifest restored from its newest snapshot (Z-602) */
const pruefRestoreGelungen = (n: Nachricht) => ({
  ok: true,
  daten: {
    installation: n.installationId,
    kopie: (n.argumente as { kopie?: string }).kopie,
    teile: [
      { tag: "volume:daten", snapshot: randomBytes(32).toString("hex"), zurueckgespielt: true },
    ],
    dauerMs: 42_000,
  },
});

/** A restore done: each part played back from the snapshot the job names (Z-603) */
const wiederherstellenGelungen = (n: Nachricht) => ({
  ok: true,
  daten: {
    installation: n.installationId,
    teile: Object.entries(n.argumente as Record<string, string>).map(([schluessel, snapshot]) => ({
      tag: schluessel.replace(/^snapshot:/, ""),
      snapshot,
      zurueckgespielt: true,
    })),
    dauerMs: 37_000,
  },
});

/** How an update ended, as the agent reports it (packages/manifest, einrichtung/update.ts) */
const updateBeendet = (host: string | undefined) => ({
  ok: true,
  daten: host?.startsWith("laeuft-zurueck")
    ? { ergebnis: "zurueckgenommen", grund: "Health blieb rot: HTTP 502", dauerMs: 312_000 }
    : { ergebnis: "aktualisiert", dauerMs: 41_000 },
});

/** Done as the real agent reports configuring anew (apps/agent, Z-404) */
const konfiguriert = (n: Nachricht) => ({
  ok: true,
  daten: { installation: n.installationId, geaendert: "konfiguriert", units: [] },
});

/** What `installation_backup_einrichten` gave each installation: repository and S3 access */
type Zugang = { repository: string; zugang: { schluesselId: string; geheim: string } };
const zugaenge = new Map<string, Zugang>();

/** The archive as `archivieren` uploads it (apps/agent, abwicklung/archivieren.ts), one file */
const archivieren = async (ws: WebSocket, n: Nachricht) => {
  const z = zugaenge.get(n.installationId as string);
  const m = z && /^s3:(https?:\/\/[^/]+)\/(.+)$/.exec(z.repository);
  if (!z || !m)
    return ws.send(ergebnis(n.auftragId as string, { ok: false, fehler: "kein Backup" }));
  const datei = "volume-daten.tar";
  const url = new URL(`${m[1]}/${m[2]}/archiv/${datei}`);
  const inhalt = `Archiv von ${n.installationId as string}`;
  const koepfe = await signieren({
    methode: "PUT",
    url,
    inhaltHash: OHNE_HASH,
    zugang: { accessKey: z.zugang.schluesselId, secretKey: z.zugang.geheim },
    region: (n.argumente as { region: string }).region,
    jetzt: Date.now(),
  });
  const a = await fetch(url, { method: "PUT", headers: koepfe, body: inhalt });
  const objekte = [{ tag: "volume:daten", datei, bytes: inhalt.length }];
  ws.send(
    ergebnis(
      n.auftragId as string,
      a.status === 200
        ? { ok: true, daten: { installation: n.installationId, objekte } }
        : { ok: false, fehler: `upload HTTP ${a.status}` },
    ),
  );
};

/**
 * Takes a job; a setup of a `kaputt…` host it reports failed, of a `laeuft…` host done, with its
 * route; configuring anew and a restart done, a log excerpt with its lines
 */
const auftragNehmen = (lage: Lage, n: Nachricht) => {
  const { ws } = lage;
  const auftragId = n.auftragId as string;
  ws.send(JSON.stringify({ typ: "bestaetigt", protokoll: 1, auftragId }));
  if (n.aktion === "server_neustart") return neustarten(lage, n);
  const einrichtung = n.einrichtung as { installation?: { host?: string } } | undefined;
  const host = einrichtung?.installation?.host ?? (n.argumente as { host?: string }).host;
  if (n.aktion === "installation_konfigurieren")
    return ws.send(ergebnis(auftragId, konfiguriert(n)));
  if (n.aktion === "installation_neustart")
    return ws.send(ergebnis(auftragId, { ok: true, daten: { installation: n.installationId } }));
  if (n.aktion === "installation_backup_einrichten") {
    if (n.backup) zugaenge.set(n.installationId as string, n.backup as Zugang);
    return ws.send(ergebnis(auftragId, backupEingerichtet(n)));
  }
  if (n.aktion === "installation_archiv") return void archivieren(ws, n);
  if (n.aktion === "installation_loeschen")
    return ws.send(
      ergebnis(auftragId, {
        ok: true,
        daten: { installation: n.installationId, geaendert: "geloescht" },
      }),
    );
  if (n.aktion === "installation_backup") return backupJetzt(ws, n);
  if (n.aktion === "installation_pruef_restore")
    return ws.send(ergebnis(auftragId, pruefRestoreGelungen(n)));
  if (n.aktion === "installation_wiederherstellen")
    return ws.send(ergebnis(auftragId, wiederherstellenGelungen(n)));
  if (n.aktion === "installation_update") return ws.send(ergebnis(auftragId, updateBeendet(host)));
  if (n.aktion === "installation_log_auszug") {
    ws.send(JSON.stringify({ typ: "log_auszug", protokoll: 1, auftragId, zeilen: LOG_ZEILEN }));
    return ws.send(ergebnis(auftragId, { ok: true, daten: { zeilen: LOG_ZEILEN.length } }));
  }
  if (n.aktion !== "installation_einrichten" && n.aktion !== "pforte_route_setzen") return;
  if (host?.startsWith("kaputt"))
    ws.send(ergebnis(auftragId, { ok: false, fehler: "image ziehen: manifest unknown" }));
  if (host?.startsWith("laeuft")) ws.send(ergebnis(auftragId, { ok: true, daten: {} }));
};

/**
 * The reboot of its boot: running, then gone and back on a new boot; the job sent again for the old
 * boot is done (apps/agent, neustart/neustart.ts)
 */
const neustarten = (lage: Lage, n: Nachricht) => {
  const auftragId = n.auftragId as string;
  const { bootId } = n.argumente as { bootId: string };
  if (bootId !== lage.bootId)
    return lage.ws.send(ergebnis(auftragId, { ok: true, daten: { bootId: lage.bootId } }));
  lage.ws.send(
    JSON.stringify({
      typ: "fortschritt",
      protokoll: 1,
      auftragId,
      schritt: n.aktion,
      zeit: Date.now(),
    }),
  );
  lage.ws.close();
  lage.bootId = randomUUID();
  void verbinden(lage);
};

const verbinden = (lage: Lage): Promise<WebSocket> =>
  new Promise((bereit, fehler) => {
    const ws = new NodeWebSocket(`ws://${lage.zentrale}/api/v1/agent/verbindung`, {
      headers: { [FINGERABDRUCK_HEADER]: fingerabdruck(lage.zertifikat) },
    });
    lage.ws = ws;
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
        ws.send(JSON.stringify({ ...fakten(Date.now(), lage.bootId), ...lage.anders }));
        bereit(ws);
      }
      if (n.typ === "auftrag") auftragNehmen(lage, n);
    };
    ws.onerror = () => fehler(new Error("the agent's connection failed"));
  });

/**
 * A shared server of the first owner's operator whose agent is connected and reported its facts;
 * `anders` replaces some of them (Z-702: a full disk, a port no manifest names)
 */
export const agentVerbinden = async (
  request: APIRequestContext,
  name: string,
  anders: Record<string, unknown> = {},
): Promise<TestAgent> => {
  const server = await serverAnlegen(request, name);
  const zertifikat = await beitreten(server.befehl);
  const zentrale = zentraleAus(server.befehl);
  const lage = { bootId: randomUUID(), zertifikat, anders, zentrale } as Lage;
  await verbinden(lage);
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
      lage.ws.send(
        JSON.stringify({ typ: "zustand", protokoll: 1, zeit: Date.now(), installationen }),
      ),
    sshAnmelden: (nutzer) =>
      lage.ws.send(
        JSON.stringify({
          typ: "ssh_anmeldung",
          protokoll: 1,
          zeit: Date.now(),
          nutzer,
          von: "10.8.0.2",
          methode: "publickey",
        }),
      ),
    trennen: () => lage.ws.close(),
  };
};
