import type { Context } from "hono";
import type { z } from "zod";
import type { Auth } from "../auth/auth.ts";
import type { Db, SchreibDb } from "../db/oeffnen.ts";
import type { Schluesselbund } from "../db/schluessel.ts";
import type { LogSink } from "../log.ts";
import type { Versand } from "../modules/benachrichtigung/index.ts";
import type { Auslieferung } from "../modules/server/index.ts";
import type { Verbindungen } from "../modules/verbindung/verbindungen.ts";
import type { Versionen } from "../modules/versionen/index.ts";
import type { SocketAdresse } from "./zugang.ts";

/** What the routes need; they stay thin and call into src/modules (docs/plan.md, "Projektstruktur") */
export type RoutenDeps = {
  db: Db;
  schreibDb: SchreibDb;
  auth: Auth;
  /** Where the interface is reached, for invitation links (STEUERZENTRALE_URL) */
  url: string;
  now: () => number;
  /** The keys of the database, for the secrets the routes write (the agents' CA) */
  schluessel: Schluesselbund;
  /** Where agents reach the Zentrale (STEUERZENTRALE_AGENT_URL), for the install command */
  agentUrl: string;
  /** The install script and the agent binaries (STEUERZENTRALE_AGENT_DATEIEN) */
  auslieferung: Auslieferung;
  /** The socket's address of a request, for the rate limit of the token exchange */
  socketAdresse: SocketAdresse;
  /** The agents' open connections (src/modules/verbindung) */
  verbindungen: Verbindungen;
  log: LogSink;
  /** What the registries said and the query "Registry abfragen" (modules/versionen, Z-501) */
  versionen: Versionen;
  /** Starts setting or deleting the DNS records that are due (modules/dns, Z-407) */
  dnsAnstossen?: () => void;
  /** Starts making or deleting the S3 accesses that are due (modules/backups, Z-601) */
  backupAnstossen?: () => void;
  /** Takes the next steps after contracts ended (modules/abwicklung, Z-604) */
  abwicklungAnstossen?: () => void;
  /** How notifications go out, for the test message (modules/benachrichtigung, Z-703) */
  versand?: Versand;
};

/** What a body says: its JSON, `{}` for none, null for what is no JSON */
const koerper = (text: string): unknown => {
  if (text === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * The request's JSON body parsed against `schema`, or undefined. No body counts as `{}`: the
 * reason is optional (Z-1207), so a write that carried nothing else needs no body.
 */
export const eingabe = async <S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<z.infer<S> | undefined> => {
  const geparst = schema.safeParse(koerper(await c.req.text()));
  return geparst.success ? geparst.data : undefined;
};

/** Hands the session cookie Better Auth set for a new account on to the response */
export const sitzungUebernehmen = (c: Context, headers: Headers): void => {
  for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
};
