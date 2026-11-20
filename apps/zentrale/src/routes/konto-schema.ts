import { z } from "zod";

/**
 * A new account's details: the e-mail address names it at sign-in; a password is optional (a
 * passkey alone is enough) and then needs TOTP before the account reaches anything (docs/plan.md)
 */
export const kontoSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.email().max(254).toLowerCase(),
    passwort: z.string().min(12).max(128).optional(),
  })
  .strict();
