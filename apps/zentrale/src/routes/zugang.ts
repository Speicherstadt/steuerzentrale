import type { Handler, Hono, MiddlewareHandler } from "hono";
import type { Auth } from "../auth/auth.ts";
import { darf, type Recht, ROLLEN, type Rolle } from "../auth/rollen.ts";
import type { Db } from "../db/oeffnen.ts";
import { faktorenVon, zweiterFaktorVorhanden } from "../modules/anmeldung/faktoren.ts";
import { type Mitglied, mitgliedschaftenVon, mitgliedVon } from "../modules/mitglieder/index.ts";
import { serverZumFingerabdruck } from "../modules/server/index.ts";
import { aktiverZugang } from "../modules/support/index.ts";
import { agentFingerabdruck, FINGERABDRUCK_HEADER } from "../modules/verbindung/herkunft.ts";

/**
 * Who calls, for which operator, in which role: set by the guard for every route with a right; for
 * an agent the server (`nutzerId` is `server:<id>`) and the fingerprint of its certificate
 */
export type Anfrage = {
  Variables: { nutzerId: string; betreiberId: string; rolle: string; fingerabdruck: string };
};

/**
 * Who may reach a route: everyone (the setup code, an invitation's token and a server's join token
 * are the key there),
 * any signed-in account, also one without its second factor (only the setup of that factor),
 * Better Auth itself (its own checks, AUTH_PFADE), a member whose role has the right, or an agent
 * with the client certificate of a server that is not revoked (the fingerprint from the Pforte).
 * `supportZugang`: a member whose role lacks the right reaches the route of an installation also
 * while a support access it started for that installation runs (Z-802).
 */
export type Zugang =
  | { art: "oeffentlich" }
  | { art: "agent" }
  | { art: "einrichtung" }
  | { art: "better-auth" }
  | { art: "recht"; recht: Recht; supportZugang?: true };

const oeffentlich = { art: "oeffentlich" } as const;
const einrichtung = { art: "einrichtung" } as const;
const betterAuth = { art: "better-auth" } as const;
const agent = { art: "agent" } as const;
const recht = (name: Recht) => ({ art: "recht", recht: name }) as const;
/** A right that a running support access to the route's installation stands in for (Z-802) */
const mitZugang = (name: Recht) => ({ art: "recht", recht: name, supportZugang: true }) as const;

/**
 * Every route of the Zentrale with who may reach it (BAULISTE.md Z-104). A route is registered only
 * through this list (`routenRegistrar`), and a test requests every route in every role
 * (zugang.test.ts), so a route without an entry cannot exist.
 */
export const ROUTEN = {
  "GET /health": oeffentlich,
  "GET /api/auth/*": betterAuth,
  "POST /api/auth/*": betterAuth,
  "GET /api/v1/erster-inhaber": oeffentlich,
  "POST /api/v1/erster-inhaber": oeffentlich,
  "POST /api/v1/einladung/ansehen": oeffentlich,
  "POST /api/v1/einladung/annehmen": oeffentlich,
  "GET /api/v1/einrichtung": einrichtung,
  "GET /api/v1/ich": recht("betreiber:lesen"),
  "GET /api/v1/mitglieder": recht("mitglieder:lesen"),
  "PATCH /api/v1/mitglieder/:nutzerId": recht("mitglieder:rolle"),
  "DELETE /api/v1/mitglieder/:nutzerId": recht("mitglieder:entfernen"),
  "GET /api/v1/einladungen": recht("mitglieder:einladen"),
  "POST /api/v1/einladungen": recht("mitglieder:einladen"),
  "DELETE /api/v1/einladungen/:einladungId": recht("mitglieder:einladen"),
  "GET /api/v1/kunden": recht("kunden:lesen"),
  "GET /api/v1/kunden/:kundeId": recht("kunden:lesen"),
  "POST /api/v1/kunden": recht("kunden:schreiben"),
  "PUT /api/v1/kunden/:kundeId": recht("kunden:schreiben"),
  "PUT /api/v1/kunden/:kundeId/kuendigung": recht("kunden:schreiben"),
  "DELETE /api/v1/kunden/:kundeId/kuendigung": recht("kunden:schreiben"),
  // Z-501: our own customers, offered pre-releases; only the owner marks one
  "PUT /api/v1/kunden/:kundeId/intern": recht("kunden:intern"),
  "GET /api/v1/server": recht("server:lesen"),
  "GET /api/v1/server/:serverId": recht("server:lesen"),
  "POST /api/v1/server": recht("server:anlegen"),
  "POST /api/v1/server/:serverId/sperren": recht("server:sperren"),
  "GET /api/v1/installationen": recht("installationen:lesen"),
  "GET /api/v1/installationen/:installationId": recht("installationen:lesen"),
  // the dialog's preview: reads only, so it takes no reason
  "POST /api/v1/installationen/platzierung": recht("installationen:lesen"),
  "POST /api/v1/installationen": recht("installationen:schreiben"),
  "DELETE /api/v1/installationen/:installationId": recht("installationen:schreiben"),
  "PUT /api/v1/installationen/:installationId/einstellungen": recht("installationen:schreiben"),
  // the actions of an installation (Z-405): support takes a log excerpt and restarts only during a
  // support access to the installation (Z-802), never "nur lesen"
  "POST /api/v1/installationen/:installationId/neustart": mitZugang("installationen:schreiben"),
  "POST /api/v1/installationen/:installationId/nur-lesen": recht("installationen:schreiben"),
  "POST /api/v1/installationen/:installationId/log-auszug": mitZugang("installationen:log_auszug"),
  "GET /api/v1/installationen/:installationId/log-auszuege/:auftragId": mitZugang(
    "installationen:log_auszug",
  ),
  // support accesses (Z-802): every role sees them and starts one for itself; its holder ends it,
  // owner and technik also another's (checked in the route)
  "GET /api/v1/support-zugaenge": recht("support:lesen"),
  "POST /api/v1/support-zugaenge": recht("support:starten"),
  "POST /api/v1/support-zugaenge/:zugangId/beenden": recht("support:starten"),
  // the operator's values of an app (Z-404): rights as for installations, which they serve
  "GET /api/v1/apps/:app/einstellungen": recht("installationen:lesen"),
  "PUT /api/v1/apps/:app/einstellungen": recht("installationen:schreiben"),
  // reading the operations (Z-406): every role sees overview, jobs and events; the audit log only
  // owner and technik
  "GET /api/v1/uebersicht": recht("betreiber:lesen"),
  "GET /api/v1/auftraege": recht("betreiber:lesen"),
  "GET /api/v1/ereignisse": recht("betreiber:lesen"),
  "GET /api/v1/audit": recht("audit:lesen"),
  // the operator's DNS (Z-407): every role sees domain and zone and whether a token is set
  "GET /api/v1/dns": recht("dns:lesen"),
  "PUT /api/v1/dns": recht("dns:schreiben"),
  // backups (Z-601): every role sees the runs and the S3 target without its admin access; owner
  // and technik set the target and start "Backup jetzt"
  "GET /api/v1/backups": recht("backups:lesen"),
  "GET /api/v1/backup-ziel": recht("backups:lesen"),
  "PUT /api/v1/backup-ziel": recht("backups:schreiben"),
  "GET /api/v1/installationen/:installationId/backups": recht("backups:lesen"),
  "POST /api/v1/installationen/:installationId/backup": recht("backups:schreiben"),
  // "Prüf-Restore jetzt" (Z-602), like "Backup jetzt"
  "POST /api/v1/installationen/:installationId/pruef-restore": recht("backups:schreiben"),
  // Z-603: restoring a run, with the backup of the current state before it
  "POST /api/v1/installationen/:installationId/wiederherstellen": recht("backups:schreiben"),
  // manifests and versions (Z-501): every role reads them and what each installation is offered;
  // owner and technik import a signed manifest and ask the registries now
  "GET /api/v1/apps": recht("manifeste:lesen"),
  "GET /api/v1/manifeste/:app/:version": recht("manifeste:lesen"),
  "POST /api/v1/manifeste": recht("manifeste:importieren"),
  "POST /api/v1/versionen/abfragen": recht("manifeste:abfragen"),
  // Z-503: every role sees offers, plan and the last update of each installation; owner and
  // technik update by hand with a reason, in a freeze window only the owner
  "GET /api/v1/updates": recht("installationen:lesen"),
  "POST /api/v1/installationen/:installationId/update": recht("installationen:schreiben"),
  // agent.<domain>: the install script, the binaries and the token's exchange; the token is the key
  "GET /install.sh": oeffentlich,
  "GET /agent/:datei": oeffentlich,
  "POST /api/v1/agent/beitreten": oeffentlich,
  // the agent's connection (WebSocket), with its client certificate (Z-303)
  "GET /api/v1/agent/verbindung": agent,
} as const satisfies Record<string, Zugang>;

export type RoutenName = keyof typeof ROUTEN;

/**
 * The paths of Better Auth reachable over HTTP, under /api/auth; every other one (sign-up, the
 * organization routes, account changes, disabling TOTP) answers 404. `sitzung` paths need a session
 * (Better Auth checks it), also one without a second factor: they set that factor up.
 */
export const AUTH_PFADE: Readonly<Record<string, "oeffentlich" | "sitzung">> = {
  "POST /sign-in/email": "oeffentlich",
  "GET /passkey/generate-authenticate-options": "oeffentlich",
  "POST /passkey/verify-authentication": "oeffentlich",
  "POST /two-factor/verify-totp": "oeffentlich",
  "POST /two-factor/verify-backup-code": "oeffentlich",
  // signing out without a session does nothing and answers 200
  "POST /sign-out": "oeffentlich",
  "GET /get-session": "sitzung",
  "GET /passkey/generate-register-options": "sitzung",
  "POST /passkey/verify-registration": "sitzung",
  "GET /passkey/list-user-passkeys": "sitzung",
  "POST /two-factor/enable": "sitzung",
};

/** The roles that reach a route; for a public one or the setup: every role; an agent's: none */
export const rollenFuer = (zugang: Zugang): readonly Rolle[] => {
  if (zugang.art === "agent") return [];
  return zugang.art === "recht" ? ROLLEN.filter((rolle) => darf(rolle, zugang.recht)) : ROLLEN;
};

/**
 * The operator of a request: the one active in the session, else the only one the account is a
 * member of; with several and none active there is none (a later item adds switching)
 */
const betreiberDerSitzung = (
  db: Db,
  sitzung: { nutzerId: string; betreiberId: string | null },
): string | undefined => {
  if (sitzung.betreiberId) return sitzung.betreiberId;
  const alle = mitgliedschaftenVon(db, sitzung.nutzerId);
  return alle.length === 1 ? alle[0] : undefined;
};

/** The socket's address of a request (Bun's requestIP; a fixed one in tests) */
export type SocketAdresse = (request: Request, env: unknown) => string | undefined;

/**
 * An agent's request: the certificate's fingerprint from the Pforte names a server that is not
 * revoked; a revoked one is refused at once, however valid its certificate still is
 */
const agentWache =
  (db: Db, socketAdresse: SocketAdresse): MiddlewareHandler<Anfrage> =>
  async (c, next) => {
    const fingerabdruck = agentFingerabdruck(
      socketAdresse(c.req.raw, c.env),
      c.req.header(FINGERABDRUCK_HEADER),
    );
    const gefunden = fingerabdruck ? serverZumFingerabdruck(db, fingerabdruck) : undefined;
    if (!fingerabdruck || !gefunden) return c.json({ fehler: "kein_zertifikat" }, 401);
    c.set("nutzerId", `server:${gefunden.server.serverId}`);
    c.set("betreiberId", gefunden.server.betreiberId);
    c.set("fingerabdruck", fingerabdruck);
    return next();
  };

/**
 * Whether a support access stands in for the right the role lacks: the route allows it, the role
 * may hold one, and one of the member's runs for the route's installation at this request's instant
 * (asked anew each time: an access that ran out or was ended opens nothing from that millisecond on)
 */
const perSupportZugang = (
  db: Db,
  zugang: Extract<Zugang, { art: "recht" }>,
  mitglied: Mitglied,
  installationId: string | undefined,
  jetzt: number,
): boolean =>
  zugang.supportZugang === true &&
  installationId !== undefined &&
  darf(mitglied.rolle, "support:starten") &&
  aktiverZugang(db, mitglied.betreiberId, mitglied.nutzerId, installationId, jetzt) !== undefined;

/** The guard of one route; the role comes from `mitglieder`, so a removed member loses access at once */
export const wache =
  (auth: Auth, db: Db, socketAdresse: SocketAdresse, now: () => number) =>
  (zugang: Zugang): MiddlewareHandler<Anfrage> =>
  async (c, next) => {
    if (zugang.art === "oeffentlich" || zugang.art === "better-auth") return next();
    if (zugang.art === "agent") return agentWache(db, socketAdresse)(c, next);
    const sitzung = await auth.sitzung(c.req.raw.headers);
    if (!sitzung) return c.json({ fehler: "nicht_angemeldet" }, 401);
    c.set("nutzerId", sitzung.nutzerId);
    if (zugang.art === "einrichtung") return next();
    if (!zweiterFaktorVorhanden(faktorenVon(db, sitzung.nutzerId)))
      return c.json({ fehler: "zweiter_faktor_fehlt" }, 403);
    const betreiberId = betreiberDerSitzung(db, sitzung);
    const mitglied = betreiberId ? mitgliedVon(db, betreiberId, sitzung.nutzerId) : undefined;
    if (!mitglied) return c.json({ fehler: "kein_betreiber" }, 403);
    if (!darf(mitglied.rolle, zugang.recht)) {
      // a support access is checked once the whole request is in (Hono keeps the body for the
      // route), so a body that arrives after the access ended opens nothing
      if (zugang.supportZugang === true) await c.req.text().catch(() => "");
      const installationId = c.req.param("installationId");
      if (!perSupportZugang(db, zugang, mitglied, installationId, now()))
        return c.json({ fehler: "keine_berechtigung" }, 403);
    }
    c.set("betreiberId", mitglied.betreiberId);
    c.set("rolle", mitglied.rolle);
    return next();
  };

export type Registrar = (name: RoutenName, handler: Handler<Anfrage>) => void;

/** Registers a route under its entry in ROUTEN, behind the guard of that entry */
export const routenRegistrar =
  (app: Hono<Anfrage>, schutz: (zugang: Zugang) => MiddlewareHandler<Anfrage>): Registrar =>
  (name, handler) => {
    const [methode, pfad] = name.split(" ") as [string, string];
    app.on(methode, pfad, schutz(ROUTEN[name]), handler);
  };
