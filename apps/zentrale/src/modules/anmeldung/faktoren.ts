import { and, eq, isNotNull } from "drizzle-orm";
import { account, passkey, user } from "../../db/auth-schema.ts";
import type { Db } from "../../db/oeffnen.ts";

/** What an account has to sign in with */
export type Faktoren = { passwort: boolean; totp: boolean; passkeys: number };

/**
 * Whether an account has its second factor (docs/plan.md, "Anmeldung an der Zentrale"): a passkey is
 * enough; an account with a password needs TOTP as well, whatever passkeys it has, because Better
 * Auth signs in with the password alone otherwise. Without it, an account reaches only the setup of
 * its second factor.
 */
export const zweiterFaktorVorhanden = (faktoren: Faktoren): boolean =>
  faktoren.passwort ? faktoren.totp : faktoren.passkeys > 0;

/** The factors of an account, read from Better Auth's tables */
export const faktorenVon = (db: Db, nutzerId: string): Faktoren => {
  const konto = db
    .select({ totp: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.id, nutzerId))
    .get();
  const passwort = db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, nutzerId),
        eq(account.providerId, "credential"),
        isNotNull(account.password),
      ),
    )
    .get();
  const passkeys = db
    .select({ id: passkey.id })
    .from(passkey)
    .where(eq(passkey.userId, nutzerId))
    .all().length;
  return { passwort: passwort !== undefined, totp: konto?.totp === true, passkeys };
};
