import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/*
 * The tables of Better Auth (accounts, sessions, organizations, members, passkeys, TOTP), as
 * better-auth 1.7.26 with the organization, twoFactor and passkey plugins expects them (its
 * getAuthTables). They belong to Better Auth, which writes them itself (src/auth/auth.ts): no
 * betreiber_id, the membership of an operator is the organization's (docs/plan.md, "Mandanten").
 * Every membership and role is mirrored into `mitglieder` through `schreiben`, so the audit log has
 * them. Layout from Speicherstadt/soll, apps/server/src/db/auth-schema.ts.
 */

const zeit = (name: string) => integer(name, { mode: "timestamp_ms" });
const ja = (name: string) => integer(name, { mode: "boolean" });

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: ja("email_verified").notNull(),
  image: text("image"),
  createdAt: zeit("created_at").notNull(),
  updatedAt: zeit("updated_at").notNull(),
  twoFactorEnabled: ja("two_factor_enabled").default(false),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: zeit("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: zeit("created_at").notNull(),
    updatedAt: zeit("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
  (t) => [index("session_user").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: zeit("access_token_expires_at"),
    refreshTokenExpiresAt: zeit("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: zeit("created_at").notNull(),
    updatedAt: zeit("updated_at").notNull(),
  },
  (t) => [index("account_user").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: zeit("expires_at").notNull(),
    createdAt: zeit("created_at").notNull(),
    updatedAt: zeit("updated_at").notNull(),
  },
  (t) => [index("verification_identifier").on(t.identifier)],
);

export const organization = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: zeit("created_at").notNull(),
  metadata: text("metadata"),
});

export const member = sqliteTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: zeit("created_at").notNull(),
  },
  (t) => [index("member_organization").on(t.organizationId), index("member_user").on(t.userId)],
);

export const invitation = sqliteTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull(),
  expiresAt: zeit("expires_at").notNull(),
  createdAt: zeit("created_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: ja("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: zeit("locked_until"),
  },
  (t) => [index("two_factor_user").on(t.userId)],
);

export const passkey = sqliteTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: ja("backed_up").notNull(),
    transports: text("transports"),
    createdAt: zeit("created_at"),
    aaguid: text("aaguid"),
  },
  (t) => [index("passkey_user").on(t.userId), index("passkey_credential").on(t.credentialID)],
);
