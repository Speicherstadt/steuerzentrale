import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db, SchreibDb } from "../../db/oeffnen.ts";
import { server } from "../../db/schema.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { tokenAnlegen, tokenFinden } from "../geheim/index.ts";

/*
 * Adding a server (docs/server-hinzufuegen.md): the Zentrale makes the row and a one-time token of
 * 32 random bytes, stored only as its hash in `tokens` under the server's id, valid 24 hours and
 * once; the token's exchange for the agent's certificate removes it (beitritt.ts).
 */
export const BEITRITT_ZWECK = "server-beitritt";
export const BEITRITT_GUELTIG_MS = 24 * 60 * 60 * 1000;

export const ARTEN = ["gemeinsam", "eigen", "beim_kunden"] as const;
export type ServerArt = (typeof ARTEN)[number];

/** Weekdays (0 Sunday) and Berlin times "HH:MM", as packages/planung reads them */
export type Wartungsfenster = { tage: number[]; von: string; bis: string };

export type NeuerServer = {
  name: string;
  art: ServerArt;
  kundeId?: string | undefined;
  wartungsfenster: Wartungsfenster;
};

export type Server = typeof server.$inferSelect;

export const serverAnlegen = (
  schreibDb: SchreibDb,
  kontext: Kontext,
  neu: NeuerServer,
  neueId: () => string = randomUUID,
): { server: Server; token: string; gueltigBis: number } => {
  const serverId = neueId();
  const gueltigBis = kontext.jetzt + BEITRITT_GUELTIG_MS;
  return schreiben(schreibDb, kontext, "server.anlegen", (s) => {
    const zeile = s.einfuegen("server", {
      betreiberId: kontext.betreiberId,
      serverId,
      name: neu.name,
      art: neu.art,
      kundeId: neu.art === "gemeinsam" ? null : (neu.kundeId ?? null),
      wartungsfenster: JSON.stringify(neu.wartungsfenster),
      angelegtVon: kontext.akteur,
      angelegtAm: kontext.jetzt,
    });
    const token = tokenAnlegen(s, {
      betreiberId: kontext.betreiberId,
      tokenId: serverId,
      zweck: BEITRITT_ZWECK,
      gueltigBis,
      jetzt: kontext.jetzt,
    });
    return { server: zeile, token, gueltigBis };
  });
};

/** The server a join token stands for, while the token is valid and unused and no agent joined yet */
export const serverZumToken = (db: Db, token: string, jetzt: number): Server | undefined => {
  const gefunden = tokenFinden(db, token, BEITRITT_ZWECK, jetzt);
  if (!gefunden) return undefined;
  const zeile = db
    .select()
    .from(server)
    .where(and(eq(server.betreiberId, gefunden.betreiberId), eq(server.serverId, gefunden.tokenId)))
    .get();
  return zeile && zeile.fingerabdruck === null ? zeile : undefined;
};
