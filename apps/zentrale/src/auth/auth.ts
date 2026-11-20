import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { organization, twoFactor } from "better-auth/plugins";
import { z } from "zod";
import * as authSchema from "../db/auth-schema.ts";
import type { SchreibDb } from "../db/oeffnen.ts";
import { ROLLEN, ROLLEN_ZUGRIFF, zugriff } from "./rollen.ts";

/** Set by src/app.ts from the socket (or the Pforte's) address; Better Auth counts only this one */
export const CLIENT_HEADER = "x-steuerzentrale-client";

export type AuthDeps = {
  schreibDb: SchreibDb;
  /** Where the Zentrale's interface is reached (STEUERZENTRALE_URL): origin and passkey domain */
  url: string;
  /** Better Auth's secret (src/db/schluessel.ts) */
  geheimnis: string;
};

/** A new account, made by the Zentrale for the first owner or an accepted invitation */
export type KontoAngaben = {
  email: string;
  name: string;
  /** Without one the account signs in with a passkey only */
  passwort?: string;
  betreiberId: string;
  /** Set for the first owner: the operator's organization is made with this name */
  betreiberName?: string;
  rolle: string;
};

const kontoSchema = z.object({
  email: z.string(),
  name: z.string(),
  passwort: z.string().optional(),
  betreiberId: z.string(),
  betreiberName: z.string().optional(),
  rolle: z.string(),
});

/**
 * The one way an account comes into being (sign-up is closed): a server-only endpoint, never on
 * the HTTP router, that makes the account, its membership and, for the first owner, the
 * organization with the reserved operator id, and starts a session with that operator active.
 * The session has no second factor yet, so it reaches only the setup (src/routes/zugang.ts).
 */
const kontoPlugin = () => ({
  id: "steuerzentrale-konto",
  endpoints: {
    zentraleKontoAnlegen: createAuthEndpoint.serverOnly(
      { method: "POST", body: kontoSchema },
      async (ctx) => {
        const { internalAdapter, adapter, password } = ctx.context;
        const angaben = ctx.body;
        if (await internalAdapter.findUserByEmail(angaben.email))
          throw new APIError("CONFLICT", { message: "email_vergeben" });
        const nutzer = await internalAdapter.createUser(
          { email: angaben.email, name: angaben.name, emailVerified: false },
          { method: angaben.betreiberName === undefined ? "einladung" : "einrichtungscode" },
        );
        if (angaben.passwort !== undefined)
          await internalAdapter.linkAccount({
            userId: nutzer.id,
            providerId: "credential",
            accountId: nutzer.id,
            password: await password.hash(angaben.passwort),
          });
        if (angaben.betreiberName !== undefined)
          await adapter.create({
            model: "organization",
            data: {
              id: angaben.betreiberId,
              name: angaben.betreiberName,
              slug: angaben.betreiberId,
              createdAt: new Date(),
            },
            forceAllowId: true,
          });
        await adapter.create({
          model: "member",
          data: {
            organizationId: angaben.betreiberId,
            userId: nutzer.id,
            role: angaben.rolle,
            createdAt: new Date(),
          },
        });
        const sitzung = await internalAdapter.createSession(nutzer.id, false, {
          activeOrganizationId: angaben.betreiberId,
        });
        await setSessionCookie(ctx, { session: sitzung, user: nutzer });
        return ctx.json({ nutzerId: nutzer.id });
      },
    ),
  },
});

/** A device trusted for 30 days would sign in with the password alone (docs/plan.md) */
const keinVertrautesGeraet = createAuthMiddleware(async (ctx) => {
  if (!ctx.path.startsWith("/two-factor/verify")) return;
  if ((ctx.body as { trustDevice?: unknown } | undefined)?.trustDevice)
    throw new APIError("BAD_REQUEST", { message: "trust_device_not_allowed" });
});

/**
 * Better Auth with one organization per operator, passkeys and TOTP (docs/plan.md, "Anmeldung an
 * der Zentrale"). It owns its tables and writes them on the writable connection; the Zentrale's own
 * rows (operator, membership) go through `schreiben`. Configured after Speicherstadt/soll,
 * apps/server/src/auth/auth.ts, and Speicherstadt/kennwort, apps/server/src/auth/better-auth.ts.
 */
const betterAuthFuer = ({ schreibDb, url, geheimnis }: AuthDeps) =>
  betterAuth({
    appName: "Steuerzentrale",
    baseURL: url,
    basePath: "/api/auth",
    secret: geheimnis,
    trustedOrigins: [new URL(url).origin],
    database: drizzleAdapter(schreibDb.verbindung, {
      provider: "sqlite",
      schema: authSchema,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    // whoever holds the Zentrale holds every customer: a working day, renewed while in use
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
    rateLimit: {
      enabled: true,
      storage: "memory",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/two-factor/*": { window: 60, max: 5 },
        "/passkey/verify-authentication": { window: 60, max: 10 },
        "/passkey/generate-authenticate-options": { window: 60, max: 20 },
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: [CLIENT_HEADER] } },
    telemetry: { enabled: false },
    hooks: { before: keinVertrautesGeraet },
    plugins: [
      passkey({
        rpID: new URL(url).hostname,
        rpName: "Steuerzentrale",
        origin: new URL(url).origin,
      }),
      twoFactor({ issuer: "Steuerzentrale" }),
      organization({
        creatorRole: "inhaber",
        allowUserToCreateOrganization: false,
        // Better Auth's access types are invariant in the statements; the roles come from rollen.ts
        ac: zugriff as never,
        roles: Object.fromEntries(ROLLEN.map((rolle) => [rolle, ROLLEN_ZUGRIFF[rolle]])) as never,
      }),
      kontoPlugin(),
    ],
  });

type Konto =
  | { ok: true; nutzerId: string; headers: Headers }
  | { ok: false; grund: "email_vergeben" };

/** What the Zentrale needs of Better Auth; the rest of the server sees only this */
export type Auth = {
  /** Better Auth's own routes under /api/auth */
  handler: (request: Request) => Promise<Response>;
  /** The signed-in account and the operator active in its session, or null */
  sitzung: (headers: Headers) => Promise<{ nutzerId: string; betreiberId: string | null } | null>;
  /** A new account with membership and session; `headers` carry the session cookie */
  kontoAnlegen: (angaben: KontoAngaben) => Promise<Konto>;
  emailVergeben: (email: string) => Promise<boolean>;
  /** Better Auth's member row follows the role in `mitglieder` */
  rolleSetzen: (betreiberId: string, nutzerId: string, rolle: string) => Promise<void>;
  mitgliedschaftEntfernen: (betreiberId: string, nutzerId: string) => Promise<void>;
};

const mitgliedWo = (betreiberId: string, nutzerId: string) => [
  { field: "organizationId", value: betreiberId },
  { field: "userId", value: nutzerId },
];

export const createAuth = (deps: AuthDeps): Auth => {
  const auth = betterAuthFuer(deps);
  return {
    handler: (request) => auth.handler(request),
    sitzung: async (headers) => {
      const ergebnis = await auth.api.getSession({ headers });
      if (!ergebnis) return null;
      const aktiv = (ergebnis.session as { activeOrganizationId?: string | null })
        .activeOrganizationId;
      return { nutzerId: ergebnis.user.id, betreiberId: aktiv ?? null };
    },
    kontoAnlegen: async (angaben) => {
      try {
        const { headers, response } = await auth.api.zentraleKontoAnlegen({
          body: angaben,
          returnHeaders: true,
        });
        return { ok: true, nutzerId: response.nutzerId, headers };
      } catch (fehler) {
        if ((fehler as { body?: { message?: string } }).body?.message === "email_vergeben")
          return { ok: false, grund: "email_vergeben" };
        throw fehler;
      }
    },
    emailVergeben: async (email) =>
      (await (await auth.$context).internalAdapter.findUserByEmail(email)) !== null,
    rolleSetzen: async (betreiberId, nutzerId, rolle) => {
      await (await auth.$context).adapter.update({
        model: "member",
        where: mitgliedWo(betreiberId, nutzerId),
        update: { role: rolle },
      });
    },
    mitgliedschaftEntfernen: async (betreiberId, nutzerId) => {
      await (await auth.$context).adapter.delete({
        model: "member",
        where: mitgliedWo(betreiberId, nutzerId),
      });
    },
  };
};
