import type { Context } from "hono";
import type { z } from "zod";
import type { Auth } from "../auth/auth.ts";
import type { Db, SchreibDb } from "../db/oeffnen.ts";

/** What the routes need; they stay thin and call into src/modules (docs/plan.md, "Projektstruktur") */
export type RoutenDeps = {
  db: Db;
  schreibDb: SchreibDb;
  auth: Auth;
  /** Where the interface is reached, for invitation links (STEUERZENTRALE_URL) */
  url: string;
  now: () => number;
};

/** The request's JSON body parsed against `schema`, or undefined */
export const eingabe = async <S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<z.infer<S> | undefined> => {
  const geparst = schema.safeParse(await c.req.json().catch(() => null));
  return geparst.success ? geparst.data : undefined;
};

/** Hands the session cookie Better Auth set for a new account on to the response */
export const sitzungUebernehmen = (c: Context, headers: Headers): void => {
  for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
};
