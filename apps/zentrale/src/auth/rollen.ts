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
  // intern: marking a customer as our own (Z-501), which brings its installations pre-releases
  kunden: ["lesen", "schreiben", "intern"],
  // neustart: the reboot of a server by hand (Z-701)
  server: ["anlegen", "lesen", "sperren", "neustart"],
  // log_auszug: the lines of an installation's journal (Z-405), customer data; Z-802 limits it to
  // support access later; sperrzeit: an update by hand in a freeze window of the app (Z-503)
  installationen: ["lesen", "schreiben", "log_auszug", "sperrzeit"],
  // the audit log (Z-406): who changed what, with the content of each change
  audit: ["lesen"],
  // the operator's domain, zone and Cloudflare token (Z-407); the token itself is never read back
  dns: ["lesen", "schreiben"],
  // backups (Z-601): the runs of each installation and the S3 target, whose admin access is never
  // read back; writing sets the target and starts "Backup jetzt"
  backups: ["lesen", "schreiben"],
  // the imported manifests and the registries' versions (Z-501): every role reads; importing a
  // signed manifest and asking the registries now is for owner and technik
  manifeste: ["lesen", "importieren", "abfragen"],
  // notifications (Z-703): every role sees mail server, quiet hours, recipients and deliveries,
  // never the SMTP password or a webhook's URL and key; owner and technik change them and test
  benachrichtigungen: ["lesen", "schreiben"],
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
    kunden: ["lesen", "schreiben", "intern"],
    server: ["anlegen", "lesen", "sperren", "neustart"],
    installationen: ["lesen", "schreiben", "log_auszug", "sperrzeit"],
    audit: ["lesen"],
    dns: ["lesen", "schreiben"],
    backups: ["lesen", "schreiben"],
    manifeste: ["lesen", "importieren", "abfragen"],
    benachrichtigungen: ["lesen", "schreiben"],
  }),
  // servers, installations and updates (later items); sees who else works on the operator; takes
  // on customers and their contracts, which installing an app starts from (docs/plan.md, "Kunden")
  technik: zugriff.newRole({
    ...KEINE_RECHTE_IN_BETTER_AUTH,
    betreiber: ["lesen"],
    mitglieder: ["lesen"],
    kunden: ["lesen", "schreiben"],
    server: ["anlegen", "lesen", "sperren", "neustart"],
    installationen: ["lesen", "schreiben", "log_auszug"],
    audit: ["lesen"],
    dns: ["lesen", "schreiben"],
    backups: ["lesen", "schreiben"],
    manifeste: ["lesen", "importieren", "abfragen"],
    benachrichtigungen: ["lesen", "schreiben"],
  }),
  // support access to customers (later items); sees who else works on the operator, whom it
  // helps, the servers and installations they run on, but changes no customer, contract, server
  // or installation; takes a log excerpt (docs/plan.md, "Aktionen einer Installation"); reads
  // jobs and events, not the audit log (docs/plan.md, "Echte Daten (Z-406)")
  support: zugriff.newRole({
    ...KEINE_RECHTE_IN_BETTER_AUTH,
    betreiber: ["lesen"],
    mitglieder: ["lesen"],
    kunden: ["lesen"],
    server: ["lesen"],
    installationen: ["lesen", "log_auszug"],
    audit: [],
    dns: ["lesen"],
    backups: ["lesen"],
    manifeste: ["lesen"],
    benachrichtigungen: ["lesen"],
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
