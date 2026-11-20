import { z } from "zod";

/** The settings of the Zentrale from the environment; dev uses port 18300 (CLAUDE.md, "Working rules") */
const EnvSchema = z.object({
  STEUERZENTRALE_PORT: z.coerce.number().int().min(1).max(65535).default(8300),
  STEUERZENTRALE_HOST: z.string().min(1).default("127.0.0.1"),
  STEUERZENTRALE_DATA: z.string().min(1).default("data"),
});

/** `dataDir` holds the database `zentrale.db`; created on the first start */
export type Env = { port: number; host: string; dataDir: string };

export const parseEnv = (env: Record<string, string | undefined>): Env => {
  const parsed = EnvSchema.parse(env);
  return {
    port: parsed.STEUERZENTRALE_PORT,
    host: parsed.STEUERZENTRALE_HOST,
    dataDir: parsed.STEUERZENTRALE_DATA,
  };
};
