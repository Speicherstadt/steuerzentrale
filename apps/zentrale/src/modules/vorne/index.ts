import { type PforteOptionen, zentraleInPforte } from "@steuerzentrale/manifest";
import { asc } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { betreiber } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { agentCa } from "../server/ca.ts";

/*
 * The Zentrale behind the Pforte of its own server (BAULISTE.md Z-1004, docs/installation.md):
 * `steuerzentrale pforte <netz>… [--intern]` or `steuerzentrale pforte --tunnel [--intern]` (Z-1104:
 * the interface only from loopback, for cloudflared) reads the Pforte's configuration on stdin (`GET /config/`
 * of its admin API, `null` while it has none) and prints it with the Zentrale's routes for
 * `POST /load` (packages/manifest, pforte/zentrale.ts). The Agent-CA of the one operator goes in
 * (Z-1208), made where it is missing, so a server that joins later connects without another run.
 */

type Zertifikate = NonNullable<PforteOptionen["zertifikate"]>;

export type Vorne = {
  db: Db;
  schreibDb: SchreibDb;
  schluessel: Schluesselbund;
  env: { url: string; agentUrl: string; port: number };
  jetzt: number;
};

type Optionen = { uiNetze: string[]; zertifikate: Zertifikate; tunnel?: true };

const NUTZUNG =
  "usage: steuerzentrale pforte <netz>… [--intern] < config.json, or pforte --tunnel [--intern] < config.json";

export const vorneArgumente = (
  args: string[],
): ({ ok: true } & Optionen) | { ok: false; grund: string } => {
  const zertifikate: Zertifikate = args.includes("--intern") ? "intern" : "acme";
  const tunnel = args.includes("--tunnel");
  const netze = args.filter((a) => a !== "--intern" && a !== "--tunnel");
  if (netze.some((n) => n.startsWith("-")) || tunnel === netze.length > 0)
    return { ok: false, grund: NUTZUNG };
  return tunnel
    ? { ok: true, uiNetze: [], zertifikate, tunnel: true }
    : { ok: true, uiNetze: netze, zertifikate };
};

/** The agent CA of every operator, base64 DER as Caddy takes it (capools.go, inline) */
/** The Agent-CA of the one operator (Z-1208): the oldest row, should an older Zentrale have left more */
const agentCas = async (v: Vorne): Promise<string[]> => {
  const eins = v.db
    .select({ id: betreiber.betreiberId })
    .from(betreiber)
    .orderBy(asc(betreiber.angelegtAm), asc(betreiber.betreiberId))
    .limit(1)
    .get();
  if (eins === undefined) return [];
  const ca = await agentCa(v.db, v.schreibDb, v.schluessel, {
    betreiberId: eins.id,
    akteur: "befehl",
    jetzt: v.jetzt,
  });
  return [Buffer.from(ca.zertifikat.rawData).toString("base64")];
};

export const pforteKonfiguration = async (v: Vorne, aktuell: unknown, optionen: Optionen) =>
  zentraleInPforte(aktuell, {
    uiHost: new URL(v.env.url).hostname,
    agentHost: new URL(v.env.agentUrl).hostname,
    port: v.env.port,
    uiNetze: optionen.uiNetze,
    clientCas: await agentCas(v),
    zertifikate: optionen.zertifikate,
    ...(optionen.tunnel ? { tunnel: true } : {}),
  });
