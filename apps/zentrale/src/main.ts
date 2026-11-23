import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { TRENNUNG, VERSION } from "@steuerzentrale/protokoll";
import type { Server } from "bun";
import { websocket } from "hono/bun";
import { createApp } from "./app.ts";
import { createAuth } from "./auth/auth.ts";
import { oeffneDatenbank } from "./db/oeffnen.ts";
import type { Schluesselbund } from "./db/schluessel.ts";
import { parseEnv } from "./env.ts";
import { agentUpdateSchleife } from "./modules/agent-update/index.ts";
import { einrichtungscodeErzeugen } from "./modules/anmeldung/einrichtungscode.ts";
import { aufbewahrungsSchleife } from "./modules/aufbewahrung/index.ts";
import { backupSchleife } from "./modules/backups/index.ts";
import { bewertungsSchleife } from "./modules/bewertung/index.ts";
import { dnsSchleife } from "./modules/dns/index.ts";
import { rotieren } from "./modules/geheim/index.ts";
import { befehlImportieren, manifesteUebernehmen } from "./modules/manifeste/index.ts";
import { neustartSchleife } from "./modules/neustart/index.ts";
import { pruefRestoreSchleife } from "./modules/pruef-restore/index.ts";
import { pruefungsSchleife } from "./modules/pruefungen/index.ts";
import { auslieferung } from "./modules/server/index.ts";
import { supportSchleife } from "./modules/support/index.ts";
import { updateSchleife } from "./modules/updates/index.ts";
import { stilleSchleife } from "./modules/verbindung/stille.ts";
import { verbindungen } from "./modules/verbindung/verbindungen.ts";
import { versionen, versionsSchleife } from "./modules/versionen/index.ts";

const log = (line: string) => console.log(line);

const abbrechen = (reasons: string[]): never => {
  console.error(JSON.stringify({ msg: "refusing to start", reasons }));
  process.exit(1);
};

const readEnv = () => {
  try {
    return parseEnv(process.env);
  } catch (error) {
    // The reason names the variable, never its value
    const issues = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    return abbrechen(
      issues?.map((issue) => `${issue.path.join(".")}: ${issue.message}`) ?? [
        "invalid environment",
      ],
    );
  }
};

const openDatabase = (dataDir: string, schluessel: Schluesselbund) => {
  try {
    mkdirSync(dataDir, { recursive: true });
    // Opening applies the migrations embedded in the binary; a changed one stops the start
    return oeffneDatenbank(join(dataDir, "zentrale.db"), Date.now(), schluessel);
  } catch (error) {
    return abbrechen([String((error as Error).message ?? error)]);
  }
};

const env = readEnv();
const datenbank = openDatabase(env.dataDir, env.schluessel);

// `steuerzentrale schluessel-rotieren`: every secret anew with STEUERZENTRALE_SECRET_KEY, the old
// key in STEUERZENTRALE_SECRET_KEY_ALT; afterwards the old key can go
if (process.argv[2] === "schluessel-rotieren") {
  try {
    const anzahl = rotieren(datenbank, Date.now());
    log(
      JSON.stringify({
        msg: "key rotated",
        schluessel: env.schluessel.aktuell.id,
        geheimnisse: anzahl,
      }),
    );
    process.exit(0);
  } catch (error) {
    console.error(
      JSON.stringify({ msg: "rotation failed", reason: String((error as Error).message) }),
    );
    process.exit(1);
  }
}

// `steuerzentrale manifest importieren <pfad>` (Z-501): `<pfad>` and `<pfad>.minisig`, checked with
// the key in STEUERZENTRALE_AGENT_DATEIEN like an upload; the same text again changes nothing
if (process.argv[2] === "manifest" && process.argv[3] === "importieren") {
  const pfad = process.argv[4];
  if (!pfad) {
    console.error(JSON.stringify({ msg: "usage: steuerzentrale manifest importieren <pfad>" }));
    process.exit(2);
  }
  const schluessel = await auslieferung(env.agentDateien, env.agentUrl).manifestSchluessel();
  const r = befehlImportieren(datenbank, schluessel, pfad, Date.now());
  if (r.ok) {
    const { app, version } = r.eintrag;
    log(JSON.stringify({ msg: r.neu ? "manifest imported" : "manifest unchanged", app, version }));
    process.exit(0);
  }
  console.error(JSON.stringify({ msg: "manifest refused", grund: r.grund, detail: r.detail }));
  process.exit(1);
}

const { db, schreibDb } = datenbank;
const planen = (lauf: () => void, ms: number) => {
  setInterval(lauf, ms);
};
aufbewahrungsSchleife(db, schreibDb, Date.now, planen, log);
stilleSchleife(db, schreibDb, Date.now, planen, log);
bewertungsSchleife(db, schreibDb, Date.now, planen, log);
// The checks of every server (Z-702): an event when a finding begins, gets worse and ends
pruefungsSchleife(db, schreibDb, Date.now, planen, log);
// The end of every support access that ran out as an event for the customer (Z-802): every minute
supportSchleife(db, schreibDb, Date.now, planen, log);
// DNS records of installations at Cloudflare (Z-407): every 30 s and at once when some are due
const dns = dnsSchleife(
  {
    db,
    schreibDb,
    schluessel: env.schluessel,
    fetch,
    basis: env.cloudflareApi,
    now: Date.now,
    log,
  },
  planen,
);
// The agents' connections, shared by the routes and the backup check, which sends a job when it
// made an installation's S3 access (Z-601)
const agenten = verbindungen(TRENNUNG.ersetzt);
// The installations' own S3 accesses at MinIO (Z-601): every 30 s and at once when some are due
const backup = backupSchleife(
  {
    db,
    schreibDb,
    schluessel: env.schluessel,
    verbindungen: agenten,
    fetch,
    now: Date.now,
    log,
    dnsAnstossen: dns.anstossen,
  },
  planen,
);
// The weekly test restore of each installation on its own server (Z-602): checked every hour
pruefRestoreSchleife(
  {
    db,
    schreibDb,
    schluessel: env.schluessel,
    verbindungen: agenten,
    now: Date.now,
    log,
    zufall: (n) => new Uint8Array(randomBytes(n)),
    verbunden: (b, s) => agenten.verbundenSeit(b, s) !== undefined,
  },
  planen,
);
// The manifests of installations made before Z-501 go into `manifeste` where a version is missing
const ausgeliefert = auslieferung(env.agentDateien, env.agentUrl);
const manifestSchluessel = await ausgeliefert.manifestSchluessel();
if (manifestSchluessel) {
  const uebernahme = manifesteUebernehmen(datenbank, manifestSchluessel, Date.now());
  if (uebernahme.uebernommen > 0 || uebernahme.abgelehnt.length > 0)
    log(JSON.stringify({ msg: "manifests of installations taken over", ...uebernahme }));
}
// Updates in waves (Z-503): every 5 minutes, what is due in each operator's plan
updateSchleife(
  {
    db,
    schreibDb,
    schluessel: env.schluessel,
    verbindungen: agenten,
    now: Date.now,
    log,
    zufall: (n) => new Uint8Array(randomBytes(n)),
    dnsAnstossen: dns.anstossen,
    backupAnstossen: backup.anstossen,
    manifestSchluessel: async () => manifestSchluessel,
  },
  planen,
);
// The agents to the version of the agent files (Z-504): every minute, in each server's window
agentUpdateSchleife(
  {
    db,
    schreibDb,
    schluessel: env.schluessel,
    verbindungen: agenten,
    now: Date.now,
    log,
    agentStand: ausgeliefert.agentStand,
  },
  planen,
);
// The reboots of the servers (Z-701): every minute, in each server's window, backups first
neustartSchleife(
  {
    db,
    schreibDb,
    schluessel: env.schluessel,
    verbindungen: agenten,
    now: Date.now,
    log,
    dnsAnstossen: dns.anstossen,
    backupAnstossen: backup.anstossen,
  },
  planen,
);
// New versions from the registries (Z-501): at the start, then every 6 hours and on demand
const neueVersionen = versionen({
  db,
  schreibDb,
  fetch,
  umleitung: env.registryHttp,
  now: Date.now,
  log,
});
versionsSchleife(neueVersionen, planen, log);
const auth = createAuth({ schreibDb, url: env.url, geheimnis: datenbank.anmeldeGeheimnis });
const app = createApp({
  log,
  now: Date.now,
  version: VERSION,
  db,
  schreibDb,
  auth,
  url: env.url,
  schluessel: env.schluessel,
  agentUrl: env.agentUrl,
  auslieferung: ausgeliefert,
  socketAdresse: (request, server) => (server as Server<unknown>).requestIP(request)?.address,
  verbindungen: agenten,
  dnsAnstossen: dns.anstossen,
  backupAnstossen: backup.anstossen,
  versionen: neueVersionen,
});
// `websocket` carries the agents' connections (src/routes/verbindung.ts)
const server = Bun.serve({ port: env.port, hostname: env.host, fetch: app.fetch, websocket });
log(JSON.stringify({ msg: "listening", url: server.url.href, version: VERSION }));
if (!env.agentDateien)
  log(
    JSON.stringify({
      msg: "STEUERZENTRALE_AGENT_DATEIEN is not set: no install script for new servers",
    }),
  );

// Without any member the first owner comes in with this code (docs/plan.md, "Anmeldung an der
// Zentrale"): the one secret ever written to the log, once, valid 24 hours and once
const einrichtung = einrichtungscodeErzeugen(db, schreibDb, Date.now());
if (einrichtung)
  log(
    JSON.stringify({
      msg: "setup code for the first owner",
      code: einrichtung.code,
      gueltigBis: new Date(einrichtung.gueltigBis).toISOString(),
      url: `${env.url}/erster-inhaber`,
    }),
  );
