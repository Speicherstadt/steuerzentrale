import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { oeffneDatenbank } from "../db/oeffnen.ts";
import { server } from "../db/schema.ts";
import { parseEnv } from "../env.ts";
import { serverAnlegen } from "../modules/server/index.ts";

/*
 * For CI's test servers only (job `server` in .github/workflows/ci.yml, plan.md "Was sich in der CI
 * nicht echt testen lässt"): adds a server to the database of a running test Zentrale, as the
 * dialog would, and reads back the fingerprint its agent joined with. Signing in through the
 * interface (passkey or TOTP) would test nothing here that the e2e tests do not.
 *
 *   bun apps/zentrale/src/testhilfen/testserver.ts anlegen <name>     → {"serverId","befehl"}
 *   bun apps/zentrale/src/testhilfen/testserver.ts fingerabdruck <id> → the fingerprint
 *
 * It reads the Zentrale's environment (STEUERZENTRALE_DATA, _SECRET_KEY, _URL, _AGENT_URL).
 */
const BETREIBER = "sz-test-ci";

const env = parseEnv(process.env);
const { db, schreibDb, schliessen } = oeffneDatenbank(
  join(env.dataDir, "zentrale.db"),
  Date.now(),
  env.schluessel,
);
const [befehl, wert = ""] = process.argv.slice(2);

if (befehl === "anlegen") {
  const kontext = { betreiberId: BETREIBER, akteur: "ci", jetzt: Date.now(), grund: "CI" };
  const neu = serverAnlegen(schreibDb, kontext, {
    name: wert,
    art: "gemeinsam",
    wartungsfenster: { tage: [0, 1, 2, 3, 4, 5, 6], von: "03:30", bis: "04:30" },
  });
  const install = `curl -fsSL ${env.agentUrl}/install.sh | sh -s -- --token ${neu.token} --testmodus`;
  console.log(JSON.stringify({ serverId: neu.server.serverId, befehl: install }));
} else if (befehl === "fingerabdruck") {
  const zeile = db
    .select({ fingerabdruck: server.fingerabdruck })
    .from(server)
    .where(and(eq(server.betreiberId, BETREIBER), eq(server.serverId, wert)))
    .get();
  if (!zeile?.fingerabdruck) process.exitCode = 1;
  else console.log(zeile.fingerabdruck);
} else {
  console.error("usage: testserver.ts anlegen <name> | fingerabdruck <serverId>");
  process.exitCode = 2;
}
schliessen();
