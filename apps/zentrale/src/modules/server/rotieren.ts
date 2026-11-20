import { ROTIEREN_VOR_MS } from "@steuerzentrale/protokoll";
import type { SchreibDb } from "../../db/oeffnen.ts";
import { schreiben } from "../audit/index.ts";
import type { BeitrittDeps } from "./beitritt.ts";
import { agentCa } from "./ca.ts";
import { type Server, serverLesen } from "./server.ts";
import { anfragePruefen, zertifikatAusstellen } from "./zertifikat.ts";

/*
 * Rotating an agent's certificate (BAULISTE.md Z-303): in the last 30 days of its certificate the
 * agent sends a new request over the connection the old one opened. The Zentrale issues the new
 * certificate and keeps its fingerprint beside the old one; both open the door until the agent
 * connects with the new one, which then replaces the old. An agent that lost the answer (a crash,
 * a dropped connection) still has its old certificate and asks again.
 */
const TAUSCH_GRUND = "Zertifikat rotieren";

export type Rotiert =
  | { ok: true; zertifikat: string; ca: string; gueltigBis: number }
  | { ok: false; grund: "zu_frueh" | "anfrage_ungueltig" | "gesperrt" };

/** Whether a certificate valid until `gueltigBis` may be rotated now */
export const rotierenErlaubt = (gueltigBis: number | null, jetzt: number): boolean =>
  gueltigBis !== null && gueltigBis - jetzt <= ROTIEREN_VOR_MS;

export const zertifikatRotieren = async (
  deps: BeitrittDeps,
  server: Server,
  csr: string,
  jetzt: number,
): Promise<Rotiert> => {
  if (!rotierenErlaubt(server.zertifikatGueltigBis, jetzt)) return { ok: false, grund: "zu_frueh" };
  const geprueft = await anfragePruefen(csr);
  if (!geprueft.ok) return geprueft;
  const { betreiberId, serverId } = server;
  const akteur = `server:${serverId}`;
  const ca = await agentCa(deps.db, deps.schreibDb, deps.schluessel, {
    betreiberId,
    akteur,
    jetzt,
  });
  const ausgestellt = await zertifikatAusstellen(ca, geprueft.anfrage, serverId, jetzt);
  // revoked while the certificate was being made: it is never recorded or handed out
  if (serverLesen(deps.db, betreiberId, serverId)?.gesperrtAm !== null)
    return { ok: false, grund: "gesperrt" };
  schreiben(
    deps.schreibDb,
    { betreiberId, akteur, jetzt, grund: TAUSCH_GRUND },
    "server.zertifikat-ausstellen",
    (s) =>
      s.aendern(
        "server",
        { serverId },
        {
          fingerabdruckNeu: ausgestellt.fingerabdruck,
          zertifikatNeuGueltigBis: ausgestellt.gueltigBis,
        },
      ),
  );
  return {
    ok: true,
    zertifikat: ausgestellt.pem,
    ca: ca.zertifikat.toString("pem"),
    gueltigBis: ausgestellt.gueltigBis,
  };
};

/** The agent connected with its rotated certificate: it replaces the old one, which stops working */
export const neuesZertifikatUebernehmen = (
  schreibDb: SchreibDb,
  server: Server,
  jetzt: number,
): Server =>
  schreiben(
    schreibDb,
    {
      betreiberId: server.betreiberId,
      akteur: `server:${server.serverId}`,
      jetzt,
      grund: TAUSCH_GRUND,
    },
    "server.zertifikat-rotiert",
    (s) =>
      s.aendern(
        "server",
        { serverId: server.serverId },
        {
          fingerabdruck: server.fingerabdruckNeu,
          zertifikatGueltigBis: server.zertifikatNeuGueltigBis,
          fingerabdruckNeu: null,
          zertifikatNeuGueltigBis: null,
        },
      ),
  );
