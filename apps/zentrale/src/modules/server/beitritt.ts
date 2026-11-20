import type { BeitrittAnfrage, BeitrittAntwort } from "@steuerzentrale/protokoll";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { schreiben } from "../audit/index.ts";
import { agentCa } from "./ca.ts";
import { serverZumToken } from "./server.ts";
import { anfragePruefen, zertifikatAusstellen } from "./zertifikat.ts";

export type BeitrittDeps = { db: Db; schreibDb: SchreibDb; schluessel: Schluesselbund };

export type Beitritt =
  | { ok: true; antwort: BeitrittAntwort }
  | { ok: false; grund: "token_ungueltig" | "anfrage_ungueltig" };

/**
 * Exchanges a join token for the agent's certificate (BAULISTE.md Z-302). The token is checked,
 * then the certificate is made (which waits for WebCrypto), then in one synchronous transaction the
 * token is checked again and removed and the fingerprint recorded: of two requests with the same
 * token one wins, and the other's certificate is never handed out.
 */
export const beitreten = async (
  deps: BeitrittDeps,
  anfrage: BeitrittAnfrage,
  jetzt: number,
): Promise<Beitritt> => {
  const vorher = serverZumToken(deps.db, anfrage.token, jetzt);
  if (!vorher) return { ok: false, grund: "token_ungueltig" };
  const geprueft = await anfragePruefen(anfrage.csr);
  if (!geprueft.ok) return geprueft;
  const { betreiberId, serverId } = vorher;
  const akteur = `server:${serverId}`;
  const ca = await agentCa(deps.db, deps.schreibDb, deps.schluessel, {
    betreiberId,
    akteur,
    jetzt,
  });
  const ausgestellt = await zertifikatAusstellen(ca, geprueft.anfrage, serverId, jetzt);
  const kontext = { betreiberId, akteur, jetzt, grund: "Token-Tausch" };
  if (serverZumToken(deps.db, anfrage.token, jetzt)?.serverId !== serverId)
    return { ok: false, grund: "token_ungueltig" };
  schreiben(deps.schreibDb, kontext, "server.beitreten", (s) => {
    s.loeschen("tokens", { tokenId: serverId });
    s.aendern(
      "server",
      { serverId },
      {
        fingerabdruck: ausgestellt.fingerabdruck,
        zertifikatGueltigBis: ausgestellt.gueltigBis,
        beigetretenAm: jetzt,
        architektur: anfrage.architektur,
        agentVersion: anfrage.agentVersion,
      },
    );
  });
  return {
    ok: true,
    antwort: {
      serverId,
      zertifikat: ausgestellt.pem,
      ca: ca.zertifikat.toString("pem"),
      gueltigBis: ausgestellt.gueltigBis,
    },
  };
};
