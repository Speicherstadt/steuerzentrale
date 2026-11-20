import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "@steuerzentrale/protokoll";
import type { Server } from "bun";
import { createApp } from "./app.ts";
import { createAuth } from "./auth/auth.ts";
import { oeffneDatenbank } from "./db/oeffnen.ts";
import type { Schluesselbund } from "./db/schluessel.ts";
import { parseEnv } from "./env.ts";
import { einrichtungscodeErzeugen } from "./modules/anmeldung/einrichtungscode.ts";
import { aufbewahrungsSchleife } from "./modules/aufbewahrung/index.ts";
import { rotieren } from "./modules/geheim/index.ts";

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

const { db, schreibDb } = datenbank;
aufbewahrungsSchleife(db, schreibDb, Date.now, (lauf, ms) => setInterval(lauf, ms), log);
const auth = createAuth({ schreibDb, url: env.url, geheimnis: datenbank.anmeldeGeheimnis });
const app = createApp({
  log,
  now: Date.now,
  version: VERSION,
  db,
  schreibDb,
  auth,
  url: env.url,
  socketAdresse: (request, server) => (server as Server<unknown>).requestIP(request)?.address,
});
const server = Bun.serve({ port: env.port, hostname: env.host, fetch: app.fetch });
log(JSON.stringify({ msg: "listening", url: server.url.href, version: VERSION }));

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
