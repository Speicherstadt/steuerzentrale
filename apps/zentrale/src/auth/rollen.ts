import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * The roles of an operator (docs/plan.md, "Anmeldung an der Zentrale") and what each may do, as the
 * access control of Better Auth's organization plugin (statements and roles, as in
 * Speicherstadt/soll, apps/server/src/auth/rollen.ts). Better Auth stores the role at the member;
 * every route of the Zentrale names the right it needs (src/routes/zugang.ts), checked here.
 * Better Auth's own statements stay empty for every role: its organization routes are closed
 * (src/auth/auth.ts), memberships change only through the Zentrale's routes and the audit log.
 */
export const ROLLEN = ["inhaber", "technik", "support"] as const;

export type Rolle = (typeof ROLLEN)[number];

const ANWEISUNGEN = {
  ...defaultStatements,
  betreiber: ["lesen"],
  mitglieder: ["lesen", "einladen", "rolle", "entfernen"],
  kunden: ["lesen", "schreiben"],
  server: ["anlegen", "lesen", "sperren"],
  // log_auszug: the lines of an installation's journal (Z-405), customer data; Z-802 limits it to
  // support access later
  installationen: ["lesen", "schreiben", "log_auszug"],
} as const;

export const zugriff = createAccessControl(ANWEISUNGEN);

const KEINE_RECHTE_IN_BETTER_AUTH = {
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: [],
} as const;

export const ROLLEN_ZUGRIFF = {
  // the owner answers for the operator: invites, changes roles, removes members
  inhaber: zugriff.newRole({
    ...KEINE_RECHTE_IN_BETTER_AUTH,
    betreiber: ["lesen"],
    mitglieder: ["lesen", "einladen", "rolle", "entfernen"],
    kunden: ["lesen", "schreiben"],
    server: ["anlegen", "lesen", "sperren"],
    installationen: ["lesen", "schreiben", "log_auszug"],
  }),
  // servers, installations and updates (later items); sees who else works on the operator; takes
  // on customers and their contracts, which installing an app starts from (docs/plan.md, "Kunden")
  technik: zugriff.newRole({
    ...KEINE_RECHTE_IN_BETTER_AUTH,
    betreiber: ["lesen"],
    mitglieder: ["lesen"],
    kunden: ["lesen", "schreiben"],
    server: ["anlegen", "lesen", "sperren"],
    installationen: ["lesen", "schreiben", "log_auszug"],
  }),
  // support access to customers (later items); sees who else works on the operator, whom it
  // helps, the servers and installations they run on, but changes no customer, contract, server
  // or installation; takes a log excerpt (docs/plan.md, "Aktionen einer Installation")
  support: zugriff.newRole({
    ...KEINE_RECHTE_IN_BETTER_AUTH,
    betreiber: ["lesen"],
    mitglieder: ["lesen"],
    kunden: ["lesen"],
    server: ["lesen"],
    installationen: ["lesen", "log_auszug"],
  }),
} as const;

type Anweisungen = typeof ANWEISUNGEN;
type Bereich = Exclude<keyof Anweisungen, keyof typeof defaultStatements>;

/** A right of the Zentrale, written `bereich:aktion` */
export type Recht = {
  [B in Bereich]: `${B}:${Anweisungen[B][number]}`;
}[Bereich];

export const istRolle = (wert: unknown): wert is Rolle => ROLLEN.includes(wert as Rolle);

/** The roles of one member: Better Auth stores several joined by commas (its parseRoles) */
export const rollenVon = (rolle: string): string[] => rolle.split(",").map((teil) => teil.trim());

/** Whether a stored role grants a right; a member with several roles has the rights of each */
export const darf = (rolle: string, recht: Recht): boolean => {
  const [bereich, aktion] = recht.split(":") as [Bereich, string];
  return rollenVon(rolle).some(
    (teil) =>
      istRolle(teil) &&
      ROLLEN_ZUGRIFF[teil].authorize({ [bereich]: [aktion] } as never).success === true,
  );
};
