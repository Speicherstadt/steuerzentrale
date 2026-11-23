import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { oeffneDatenbank } from "../db/oeffnen.ts";
import { parseEnv } from "../env.ts";
import { agentCa } from "../modules/server/ca.ts";
import { testPforte } from "./testpforte.ts";
import { pforteTls } from "./tls.ts";

/*
 * For CI only (job `server`, docs/plan.md, "Testserver in der CI"): the Pforte in front of the
 * Zentrale on the runner, so the agent in an Incus VM connects as in production, over TLS with its
 * client certificate (the Zentrale believes the fingerprint header only from loopback and has no
 * test mode of its own for mTLS). It takes the operator's agent CA the join will issue from (made
 * now if there is none yet), writes the CA of its own server certificate to <ca-datei> for the VM
 * to trust, and passes everything on to the Zentrale on 127.0.0.1:STEUERZENTRALE_PORT. Started
 * again (after the Zentrale was restored on a "new server", Z-1002) it answers with the server
 * certificate it kept in <ca-datei>.tls.json, as Caddy would for the same hostname with one from a
 * public CA, and takes the agent CA from the restored database.
 *
 *   bun apps/zentrale/src/testhilfen/ci-pforte.ts <ip> <port> <ca-datei>
 */
const BETREIBER = "sz-test-ci";

const [ip = "", port = "", caDatei = ""] = process.argv.slice(2);
if (!ip || !/^\d+$/.test(port) || !caDatei) {
  console.error("usage: ci-pforte.ts <ip> <port> <ca-datei>");
  process.exit(2);
}

const env = parseEnv(process.env);
const { db, schreibDb, schliessen } = oeffneDatenbank(
  join(env.dataDir, "zentrale.db"),
  Date.now(),
  env.schluessel,
);
const ca = await agentCa(db, schreibDb, env.schluessel, {
  betreiberId: BETREIBER,
  akteur: "ci",
  jetzt: Date.now(),
});
schliessen();

const tlsDatei = `${caDatei}.tls.json`;
const tls: Awaited<ReturnType<typeof pforteTls>> = existsSync(tlsDatei)
  ? JSON.parse(readFileSync(tlsDatei, "utf8"))
  : await pforteTls(Date.now(), [ip]);
writeFileSync(tlsDatei, JSON.stringify(tls), { mode: 0o600 });
writeFileSync(caDatei, tls.ca);
const pforte = testPforte({
  ziel: env.port,
  zertifikat: tls.zertifikat,
  schluessel: tls.schluessel,
  clientCas: [ca.zertifikat.toString("pem")],
  hostname: ip,
  port: Number(port),
});
console.log(JSON.stringify({ msg: "pforte listening", ip, port: pforte.port }));
