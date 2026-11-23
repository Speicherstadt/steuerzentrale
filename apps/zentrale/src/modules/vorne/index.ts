import { type PforteOptionen, zentraleInPforte } from "@steuerzentrale/manifest";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { betreiber } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { agentCa } from "../server/ca.ts";

/*
 * The Zentrale behind the Pforte of its own server (BAULISTE.md Z-1004, docs/installation.md):
 * `steuerzentrale pforte <netz>… [--intern]` reads the Pforte's configuration on stdin (`GET /config/`
 * of its admin API, `null` while it has none) and prints it with the Zentrale's routes for
 * `POST /load` (packages/manifest, pforte/zentrale.ts). The CAs of all operators go in, each made
 * where it is missing, so a server that joins later connects without another run.
 */

type Zertifikate = NonNullable<PforteOptionen["zertifikate"]>;

export type Vorne = {
  db: Db;
  schreibDb: SchreibDb;
  schluessel: Schluesselbund;
  env: { url: string; agentUrl: string; port: number };
  jetzt: number;
};

export const vorneArgumente = (
  args: string[],
): { ok: true; uiNetze: string[]; zertifikate: Zertifikate } | { ok: false; grund: string } => {
  const zertifikate: Zertifikate = args.includes("--intern") ? "intern" : "acme";
  const netze = args.filter((a) => a !== "--intern");
  if (netze.length === 0 || netze.some((n) => n.startsWith("-")))
    return { ok: false, grund: "usage: steuerzentrale pforte <netz>… [--intern] < config.json" };
  return { ok: true, uiNetze: netze, zertifikate };
};

/** The agent CA of every operator, base64 DER as Caddy takes it (capools.go, inline) */
const alleCas = async (v: Vorne): Promise<string[]> => {
  const ids = v.db
    .select({ id: betreiber.betreiberId })
    .from(betreiber)
    .all()
    .map((b) => b.id);
  const cas: string[] = [];
  for (const betreiberId of ids) {
    const ca = await agentCa(v.db, v.schreibDb, v.schluessel, {
      betreiberId,
      akteur: "befehl",
      jetzt: v.jetzt,
    });
    cas.push(Buffer.from(ca.zertifikat.rawData).toString("base64"));
  }
  return cas;
};

export const pforteKonfiguration = async (
  v: Vorne,
  aktuell: unknown,
  optionen: { uiNetze: string[]; zertifikate: Zertifikate },
) =>
  zentraleInPforte(aktuell, {
    uiHost: new URL(v.env.url).hostname,
    agentHost: new URL(v.env.agentUrl).hostname,
    port: v.env.port,
    uiNetze: optionen.uiNetze,
    clientCas: await alleCas(v),
    zertifikate: optionen.zertifikate,
  });
