import { join } from "node:path";
import { AGENT_UPDATE_AKTION, SERVER_NEUSTART_AKTION } from "@steuerzentrale/manifest";
import { and, desc, eq } from "drizzle-orm";
import { oeffneDatenbank } from "../db/oeffnen.ts";
import { auftraege, betreiber, ereignisse, server } from "../db/schema.ts";
import { parseEnv } from "../env.ts";
import { schreiben } from "../modules/audit/index.ts";
import { letzteHeartbeats, serverAnlegen, serverFakten } from "../modules/server/index.ts";

/*
 * For CI's test servers only (job `server` in .github/workflows/ci.yml, plan.md "Was sich in der CI
 * nicht echt testen lässt"): adds a server to the database of a running test Zentrale, as the
 * dialog would, and reads back the fingerprint its agent joined with. Signing in through the
 * interface (passkey or TOTP) would test nothing here that the e2e tests do not.
 *
 *   bun apps/zentrale/src/testhilfen/testserver.ts anlegen <name>     → {"serverId","befehl"}
 *   bun apps/zentrale/src/testhilfen/testserver.ts fingerabdruck <id> → the fingerprint
 *   bun apps/zentrale/src/testhilfen/testserver.ts wartungsfenster <id> → the window all day (Z-504)
 *   bun apps/zentrale/src/testhilfen/testserver.ts agent <id>         → {"version","update","ereignisse"}
 *   bun apps/zentrale/src/testhilfen/testserver.ts neustart <id>      → {"neustart","fakten",…} (Z-701)
 *
 * `agent` names the agent version of the last `hallo`, the newest job `agent_update` (version,
 * state, result) and the events of the server, for the test of the agent's update (Z-504).
 * `neustart` names the newest job `server_neustart` (state, result, when it ended), the boot id
 * and "reboot needed" of the newest facts and when they came, the last heartbeat and the events of
 * the server, for the test of the reboot (Z-701), and whether the facts say the server is only
 * observed (Z-1102).
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
  // the loops over every operator (the agents' update among them) see only those in `betreiber`
  const bekannt = db
    .select({ betreiberId: betreiber.betreiberId })
    .from(betreiber)
    .where(eq(betreiber.betreiberId, BETREIBER))
    .get();
  if (!bekannt)
    schreiben(schreibDb, kontext, "betreiber.anlegen", (w) =>
      w.einfuegen("betreiber", { betreiberId: BETREIBER, name: "CI", angelegtAm: kontext.jetzt }),
    );
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
} else if (befehl === "wartungsfenster") {
  const kontext = { betreiberId: BETREIBER, akteur: "ci", jetzt: Date.now(), grund: "CI" };
  // "00:00" to "00:00" ends on the next day: a window over the whole day
  const fenster = { tage: [0, 1, 2, 3, 4, 5, 6], von: "00:00", bis: "00:00" };
  schreiben(schreibDb, kontext, "server.wartungsfenster", (w) =>
    w.aendern("server", { serverId: wert }, { wartungsfenster: JSON.stringify(fenster) }),
  );
} else if (befehl === "agent") {
  const zeile = db
    .select({ version: server.agentVersion })
    .from(server)
    .where(and(eq(server.betreiberId, BETREIBER), eq(server.serverId, wert)))
    .get();
  const update = db
    .select({
      version: auftraege.version,
      zustand: auftraege.zustand,
      ergebnis: auftraege.ergebnis,
    })
    .from(auftraege)
    .where(
      and(
        eq(auftraege.betreiberId, BETREIBER),
        eq(auftraege.serverId, wert),
        eq(auftraege.aktion, AGENT_UPDATE_AKTION),
      ),
    )
    .orderBy(desc(auftraege.angelegtAm))
    .get();
  const arten = db
    .select({ art: ereignisse.art, text: ereignisse.text })
    .from(ereignisse)
    .where(and(eq(ereignisse.betreiberId, BETREIBER), eq(ereignisse.ziel, `server:${wert}`)))
    .all();
  console.log(
    JSON.stringify({ version: zeile?.version ?? null, update: update ?? null, ereignisse: arten }),
  );
} else if (befehl === "neustart") {
  const zeile = db
    .select()
    .from(server)
    .where(and(eq(server.betreiberId, BETREIBER), eq(server.serverId, wert)))
    .get();
  const neustart = db
    .select({
      zustand: auftraege.zustand,
      ergebnis: auftraege.ergebnis,
      argumente: auftraege.argumente,
      geaendertAm: auftraege.geaendertAm,
    })
    .from(auftraege)
    .where(
      and(
        eq(auftraege.betreiberId, BETREIBER),
        eq(auftraege.serverId, wert),
        eq(auftraege.aktion, SERVER_NEUSTART_AKTION),
      ),
    )
    .orderBy(desc(auftraege.angelegtAm))
    .get();
  const f = zeile ? serverFakten(zeile) : null;
  const arten = db
    .select({ art: ereignisse.art, text: ereignisse.text })
    .from(ereignisse)
    .where(and(eq(ereignisse.betreiberId, BETREIBER), eq(ereignisse.ziel, `server:${wert}`)))
    .all();
  console.log(
    JSON.stringify({
      neustart: neustart ?? null,
      fakten: f
        ? {
            bootId: f.bootId,
            neustartNoetig: f.neustartNoetig,
            nurBeobachten: f.nurBeobachten ?? false,
          }
        : null,
      faktenAm: zeile?.faktenAm ?? null,
      letzterHeartbeat: letzteHeartbeats(db, BETREIBER, wert).get(wert) ?? null,
      ereignisse: arten,
    }),
  );
} else {
  console.error(
    "usage: testserver.ts anlegen <name> | fingerabdruck | wartungsfenster | agent | neustart <serverId>",
  );
  process.exitCode = 2;
}
schliessen();
