import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { tokens } from "../../db/schema.ts";
import type { Schreiber } from "../audit/index.ts";

/**
 * Tokens (join tokens of servers, later API tokens) are stored only as their SHA-256 (CLAUDE.md,
 * "Secrets"). 32 random bytes need no slow hash: guessing one is as hard as guessing the key.
 */
export const tokenHash = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

export const neuesToken = (): string => randomBytes(32).toString("base64url");

export type NeuesToken = {
  betreiberId: string;
  tokenId: string;
  zweck: string;
  gueltigBis: number | null;
  jetzt: number;
};

/** Stores a new token's hash and returns the token itself, the only time anyone sees it */
export const tokenAnlegen = (schreiber: Schreiber, neu: NeuesToken): string => {
  const token = neuesToken();
  schreiber.einfuegen("tokens", {
    betreiberId: neu.betreiberId,
    tokenId: neu.tokenId,
    zweck: neu.zweck,
    hash: tokenHash(token),
    gueltigBis: neu.gueltigBis,
    angelegtAm: neu.jetzt,
  });
  return token;
};

export type GefundenesToken = { betreiberId: string; tokenId: string; zweck: string };

/** The token a presented value stands for, if it exists, has this purpose and is still valid */
export const tokenFinden = (
  db: Db,
  token: string,
  zweck: string,
  jetzt: number,
): GefundenesToken | undefined => {
  const zeile = db
    .select()
    .from(tokens)
    .where(eq(tokens.hash, tokenHash(token)))
    .get();
  if (!zeile || zeile.zweck !== zweck) return undefined;
  if (zeile.gueltigBis !== null && zeile.gueltigBis <= jetzt) return undefined;
  return { betreiberId: zeile.betreiberId, tokenId: zeile.tokenId, zweck: zeile.zweck };
};
