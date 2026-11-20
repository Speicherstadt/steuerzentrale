import { z } from "zod";
import type { Schluesselbund } from "./db/schluessel.ts";
import { type Schluessel, schluesselAus } from "./modules/geheim/verschluesseln.ts";

const HINWEIS = "32 random bytes in base64 (openssl rand -base64 32)";

/** A key variable: parsed to a key, with a message that names the variable and never its value */
const schluesselFeld = (name: string) =>
  z.string({ error: `${name} is missing: ${HINWEIS}` }).transform((wert, ctx): Schluessel => {
    const geparst = schluesselAus(wert.trim());
    if (geparst.ok) return geparst.schluessel;
    ctx.addIssue({ code: "custom", message: `${name} must be ${HINWEIS}` });
    return z.NEVER;
  });

/** The settings of the Zentrale from the environment; dev uses port 18300 (CLAUDE.md, "Working rules") */
const EnvSchema = z.object({
  STEUERZENTRALE_PORT: z.coerce.number().int().min(1).max(65535).default(8300),
  STEUERZENTRALE_HOST: z.string().min(1).default("127.0.0.1"),
  STEUERZENTRALE_DATA: z.string().min(1).default("data"),
  STEUERZENTRALE_SECRET_KEY: schluesselFeld("STEUERZENTRALE_SECRET_KEY"),
  // The previous key, only while rotating (`steuerzentrale schluessel-rotieren`)
  STEUERZENTRALE_SECRET_KEY_ALT: schluesselFeld("STEUERZENTRALE_SECRET_KEY_ALT").optional(),
});

/** `dataDir` holds the database `zentrale.db`; created on the first start */
export type Env = { port: number; host: string; dataDir: string; schluessel: Schluesselbund };

export const parseEnv = (env: Record<string, string | undefined>): Env => {
  const parsed = EnvSchema.parse(env);
  const alt = parsed.STEUERZENTRALE_SECRET_KEY_ALT;
  return {
    port: parsed.STEUERZENTRALE_PORT,
    host: parsed.STEUERZENTRALE_HOST,
    dataDir: parsed.STEUERZENTRALE_DATA,
    schluessel: { aktuell: parsed.STEUERZENTRALE_SECRET_KEY, alt: alt ? [alt] : [] },
  };
};
