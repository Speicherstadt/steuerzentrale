import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { type Server, serverLesen } from "./server.ts";

export type Gesperrt =
  | { ok: true; server: Server }
  | { ok: false; grund: "kein_server" | "schon_gesperrt" };

/**
 * Revokes a server's certificate (BAULISTE.md Z-303): from now on no fingerprint of the server is
 * accepted, a rotated one waiting included, and a join token it may still have is removed. The
 * fingerprint stays in the row, so the audit log and the page show which certificate it was. The
 * caller closes a running connection; the server comes back only when it is added anew.
 */
export const serverSperren = (
  db: Db,
  schreibDb: SchreibDb,
  kontext: Kontext,
  serverId: string,
): Gesperrt => {
  const vorher = serverLesen(db, kontext.betreiberId, serverId);
  if (!vorher) return { ok: false, grund: "kein_server" };
  if (vorher.gesperrtAm !== null) return { ok: false, grund: "schon_gesperrt" };
  return schreiben(schreibDb, kontext, "server.sperren", (s) => {
    if (s.vorhanden("tokens", { tokenId: serverId })) s.loeschen("tokens", { tokenId: serverId });
    const server = s.aendern(
      "server",
      { serverId },
      { gesperrtAm: kontext.jetzt, fingerabdruckNeu: null, zertifikatNeuGueltigBis: null },
    );
    return { ok: true, server };
  });
};
