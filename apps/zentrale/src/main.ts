import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "@steuerzentrale/protokoll";
import { createApp } from "./app.ts";
import { oeffneDatenbank } from "./db/oeffnen.ts";
import { parseEnv } from "./env.ts";
import { aufbewahrungsSchleife } from "./modules/aufbewahrung/index.ts";

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

const openDatabase = (dataDir: string) => {
  try {
    mkdirSync(dataDir, { recursive: true });
    // Opening applies the migrations embedded in the binary; a changed one stops the start
    return oeffneDatenbank(join(dataDir, "zentrale.db"), Date.now());
  } catch (error) {
    return abbrechen([String((error as Error).message ?? error)]);
  }
};

const env = readEnv();
const { db, schreibDb } = openDatabase(env.dataDir);
aufbewahrungsSchleife(db, schreibDb, Date.now, (lauf, ms) => setInterval(lauf, ms), log);
const app = createApp({ log, now: Date.now, version: VERSION });
const server = Bun.serve({ port: env.port, hostname: env.host, fetch: app.fetch });
log(JSON.stringify({ msg: "listening", url: server.url.href, version: VERSION }));
