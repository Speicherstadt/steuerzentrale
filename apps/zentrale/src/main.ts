import { randomBytes } from "node:crypto";
import { promises as dnsPromises } from "node:dns";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pforteUnit } from "@steuerzentrale/manifest";
import { TRENNUNG, VERSION } from "@steuerzentrale/protokoll";
import type { Server } from "bun";
import { websocket } from "hono/bun";
import { createApp } from "./app.ts";
import { createAuth } from "./auth/auth.ts";
import { oeffneDatenbank } from "./db/oeffnen.ts";
import type { Schluesselbund } from "./db/schluessel.ts";
import { parseEnv } from "./env.ts";
import { abwicklungSchleife } from "./modules/abwicklung/index.ts";
import { agentUpdateSchleife } from "./modules/agent-update/index.ts";
import { einrichtungscodeErzeugen } from "./modules/anmeldung/einrichtungscode.ts";
import { aufbewahrungsSchleife } from "./modules/aufbewahrung/index.ts";
import { aussenSchleife, sonde, ZEITLIMIT_MS } from "./modules/aussen/index.ts";
import { backupSchleife } from "./modules/backups/index.ts";
import { benachrichtigungsSchleife, versandImBetrieb } from "./modules/benachrichtigung/index.ts";
import { bewertungsSchleife } from "./modules/bewertung/index.ts";
import { dnsSchleife } from "./modules/dns/index.ts";
import { rotieren } from "./modules/geheim/index.ts";
import { befehlImportieren, manifesteUebernehmen } from "./modules/manifeste/index.ts";
import { neustartSchleife } from "./modules/neustart/index.ts";
import { pruefRestoreSchleife } from "./modules/pruef-restore/index.ts";
import { pruefungsSchleife } from "./modules/pruefungen/index.ts";
import { auslieferung } from "./modules/server/index.ts";
import { DATEI, type Ergebnis, sichern, wiederherstellen } from "./modules/sicherung/index.ts";
import { updateSchleife } from "./modules/updates/index.ts";
import { stilleSchleife } from "./modules/verbindung/stille.ts";
import { verbindungen } from "./modules/verbindung/verbindungen.ts";
import { versionen, versionsSchleife } from "./modules/versionen/index.ts";
import { pforteKonfiguration, vorneArgumente } from "./modules/vorne/index.ts";

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
    return oeffneDatenbank(join(dataDir, DATEI), Date.now(), schluessel);
  } catch (error) {
    return abbrechen([String((error as Error).message ?? error)]);
  }
};

const env = readEnv();

/** The end of `sichern` and `wiederherstellen` (Z-1002): the path, never a secret, in the log */
const sicherungBeenden = (r: Ergebnis, msg: string, datei: string): never => {
  if (r.ok) {
    log(JSON.stringify({ msg, datei }));
    process.exit(0);
  }
  console.error(JSON.stringify({ msg: `${msg}: failed`, reason: r.grund }));
  process.exit(1);
};

const sicherungsDatei = (befehl: string): string => {
  const datei = process.argv[3];
  if (datei) return datei;
  console.error(JSON.stringify({ msg: `usage: steuerzentrale ${befehl} <datei>` }));
  return process.exit(2);
};

// `steuerzentrale wiederherstellen <datei>` (Z-1002): a backup into the empty data directory of a
// new server, before anything opens the database there, which would make an empty one
if (process.argv[2] === "wiederherstellen") {
  const datei = sicherungsDatei("wiederherstellen");
  const r = wiederherstellen(datei, env.dataDir, (pfad) =>
    oeffneDatenbank(pfad, Date.now(), env.schluessel),
  );
  sicherungBeenden(r, "restored", datei);
}
if (process.argv[2] === "sichern" && !existsSync(join(env.dataDir, DATEI)))
  abbrechen([`no database in ${env.dataDir} to back up`]);

const datenbank = openDatabase(env.dataDir, env.schluessel);

// `steuerzentrale sichern <datei>` (Z-1002): a consistent copy of the database while the Zentrale
// runs, for restic to take to the S3 target; the key is never part of it
if (process.argv[2] === "sichern") {
  const datei = sicherungsDatei("sichern");
  sicherungBeenden(sichern(datenbank, datei), "backed up", datei);
}

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

// `steuerzentrale pforte <netz>… [--intern]` (Z-1004): the Pforte's configuration on stdin, printed
// with the Zentrale's routes and the operators' CAs for its admin API (docs/installation.md)
if (process.argv[2] === "pforte") {
  const args = vorneArgumente(process.argv.slice(3));
  if (!args.ok) {
    console.error(JSON.stringify({ msg: args.grund }));
    process.exit(2);
  }
  const text = (await Bun.stdin.text()).trim();
  const r = await pforteKonfiguration(
    { ...datenbank, schluessel: env.schluessel, env, jetzt: Date.now() },
    text === "" ? null : JSON.parse(text),
    args,
  );
  if (!r.ok) {
    console.error(JSON.stringify({ msg: "no configuration for the Pforte", grund: r.grund }));
    process.exit(1);
  }
  console.log(JSON.stringify(r.konfiguration));
  process.exit(0);
}
// `steuerzentrale pforte-unit` (Z-1004): the Pforte's Quadlet unit as the agent writes it, for the
// Zentrale's own server, whose Pforte must run before its agent can join (docs/installation.md)
if (process.argv[2] === "pforte-unit") {
  process.stdout.write(pforteUnit());
  process.exit(0);
}

const { db, schreibDb } = datenbank;
const planen = (lauf: () => void, ms: number) => {
  setInterval(lauf, ms);
};
aufbewahrungsSchleife(db, schreibDb, Date.now, planen, log);
stilleSchleife(db, schreibDb, Date.now, planen, log);
bewertungsSchleife(db, schreibDb, Date.now, planen, log);
// The check of every public address from outside (Z-704): every minute, independent of the agents;
// the resolver asks the name servers of /etc/resolv.conf itself, twice at most
if (env.aussenPruefung) {
  const aufloeser = new dnsPromises.Resolver({ timeout: 2_000, tries: 2 });
  aussenSchleife(
    {
      db,
      schreibDb,
      now: Date.now,
      log,
      sonde: sonde({
        aufloeser: {
          resolve4: (host) => aufloeser.resolve4(host),
          resolve6: (host) => aufloeser.resolve6(host),
        },
        port: 443,
        zeitlimitMs: ZEITLIMIT_MS,
      }),
    },
    planen,
  );
}
// The checks of every server (Z-702): an event when a finding begins, gets worse and ends
pruefungsSchleife(db, schreibDb, Date.now, planen, log);
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
// What follows a contract's end (Z-604): read only, archive, deletion after 90 days; every 30 s
// and at once after a notice or a job's end
const abwicklung = abwicklungSchleife(
  {
    db,
    schreibDb,
    schluessel: env.schluessel,
    verbindungen: agenten,
    fetch,
    now: Date.now,
    log,
    dnsAnstossen: dns.anstossen,
    backupAnstossen: backup.anstossen,
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
// Notifications (Z-703): every 15 s the new events to their recipients, by mail and webhook
const versand = versandImBetrieb(fetch);
benachrichtigungsSchleife(
  { db, schreibDb, schluessel: env.schluessel, versand, now: Date.now, url: env.url, log },
  planen,
);
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
  abwicklungAnstossen: abwicklung.anstossen,
  versionen: neueVersionen,
  versand,
  ...(env.web === undefined ? {} : { web: env.web }),
});
// `websocket` carries the agents' connections (src/routes/verbindung.ts)
const server = Bun.serve({ port: env.port, hostname: env.host, fetch: app.fetch, websocket });
log(JSON.stringify({ msg: "listening", url: server.url.href, version: VERSION }));
// As PID 1 of its container (Z-1004) a signal without a handler is ignored: `podman stop` would
// wait its 10 s and kill. Every write is a transaction of its own, so stopping at once is safe
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    log(JSON.stringify({ msg: "stopping", signal }));
    process.exit(0);
  });
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
