import { type Context, Hono } from "hono";
import { type Auth, CLIENT_HEADER } from "./auth/auth.ts";
import type { Db, SchreibDb } from "./db/oeffnen.ts";
import type { Schluesselbund } from "./db/schluessel.ts";
import { formatRequestLog, type LogSink, redactUrl } from "./log.ts";
import { clientAdresse } from "./modules/anmeldung/adresse.ts";
import { datenbankAntwortet } from "./modules/aussen/index.ts";
import type { Versand } from "./modules/benachrichtigung/index.ts";
import type { Auslieferung } from "./modules/server/index.ts";
import type { Verbindungen } from "./modules/verbindung/verbindungen.ts";
import type { Versionen } from "./modules/versionen/index.ts";
import { abwicklungRouten } from "./routes/abwicklung.ts";
import { agentRouten } from "./routes/agent.ts";
import { aktionenRouten } from "./routes/aktionen.ts";
import { aussenRouten } from "./routes/aussen.ts";
import { backupRouten } from "./routes/backups.ts";
import { benachrichtigungRouten } from "./routes/benachrichtigungen.ts";
import { betriebRouten } from "./routes/betrieb.ts";
import { dnsRouten } from "./routes/dns.ts";
import { einladungRouten } from "./routes/einladungen.ts";
import { einstellungenRouten } from "./routes/einstellungen.ts";
import { ersterInhaberRouten } from "./routes/erster-inhaber.ts";
import { installationenRouten } from "./routes/installationen.ts";
import { kontoRouten } from "./routes/konto.ts";
import { kundenRouten } from "./routes/kunden.ts";
import { leistungenRouten } from "./routes/leistungen.ts";
import { manifesteRouten } from "./routes/manifeste.ts";
import { mitgliederRouten } from "./routes/mitglieder.ts";
import { serverRouten } from "./routes/server.ts";
import { supportRouten } from "./routes/support.ts";
import { updateRouten } from "./routes/updates.ts";
import { verbindungRouten } from "./routes/verbindung.ts";
import {
  type Anfrage,
  AUTH_PFADE,
  routenRegistrar,
  type SocketAdresse,
  wache,
} from "./routes/zugang.ts";

export type AppDeps = {
  log: LogSink;
  now: () => number;
  version: string;
  db: Db;
  schreibDb: SchreibDb;
  auth: Auth;
  /** Where the interface is reached (STEUERZENTRALE_URL), for invitation links */
  url: string;
  /** The keys the database was opened with (src/modules/geheim) */
  schluessel: Schluesselbund;
  /** Where agents reach the Zentrale (STEUERZENTRALE_AGENT_URL), for the install command */
  agentUrl: string;
  /** The install script and the agent binaries (src/modules/server/auslieferung.ts) */
  auslieferung: Auslieferung;
  /** The socket's address of a request (Bun's requestIP in main.ts; a fixed one in tests) */
  socketAdresse: SocketAdresse;
  /** The agents' open connections, in memory (src/modules/verbindung) */
  verbindungen: Verbindungen;
  /** What the registries said and the query "Registry abfragen" (modules/versionen, Z-501) */
  versionen: Versionen;
  /** Starts setting or deleting the DNS records that are due (modules/dns, Z-407) */
  dnsAnstossen?: () => void;
  /** Starts making or deleting the S3 accesses that are due (modules/backups, Z-601) */
  backupAnstossen?: () => void;
  /** Takes the next steps after contracts ended (modules/abwicklung, Z-604) */
  abwicklungAnstossen?: () => void;
  /** How notifications go out, for the test message (modules/benachrichtigung, Z-703) */
  versand?: Versand;
};

const AUTH_BASIS = "/api/auth";

/**
 * Better Auth's routes, only the paths in AUTH_PFADE, with the client's address in CLIENT_HEADER
 * for its rate limit; whatever a client put into that header itself is replaced
 */
const betterAuthRoute = (deps: AppDeps) => (c: Context<Anfrage>) => {
  const pfad = new URL(c.req.url).pathname.slice(AUTH_BASIS.length);
  if (!(`${c.req.method} ${pfad}` in AUTH_PFADE)) return c.json({ fehler: "nicht_gefunden" }, 404);
  const headers = new Headers(c.req.raw.headers);
  headers.delete(CLIENT_HEADER);
  const socket = deps.socketAdresse(c.req.raw, c.env);
  const adresse = clientAdresse(socket, headers.get("x-forwarded-for"));
  if (adresse) headers.set(CLIENT_HEADER, adresse);
  return deps.auth.handler(new Request(c.req.raw, { headers }));
};

/** The HTTP app of the Zentrale; routes stay thin, logic lives in src/modules (docs/plan.md) */
export const createApp = (deps: AppDeps): Hono<Anfrage> => {
  const app = new Hono<Anfrage>();

  app.use(async (c, next) => {
    const start = deps.now();
    await next();
    deps.log(
      formatRequestLog({
        time: new Date(start).toISOString(),
        method: c.req.method,
        path: redactUrl(c.req.url),
        status: c.res.status,
        ms: deps.now() - start,
      }),
    );
  });

  const route = routenRegistrar(app, wache(deps.auth, deps.db, deps.socketAdresse, deps.now));
  // For an external monitor (Z-704): no login, nothing but whether the Zentrale and its database
  // answer, and the version; 503 without a reason when the database does not
  route("GET /health", (c) =>
    datenbankAntwortet(deps.db)
      ? c.json({ status: "ok", version: deps.version })
      : c.json({ status: "fehler", version: deps.version }, 503),
  );
  route("GET /api/auth/*", betterAuthRoute(deps));
  route("POST /api/auth/*", betterAuthRoute(deps));
  ersterInhaberRouten(route, deps);
  kontoRouten(route, deps);
  mitgliederRouten(route, deps);
  einladungRouten(route, deps);
  kundenRouten(route, deps);
  serverRouten(route, deps);
  installationenRouten(route, deps);
  aktionenRouten(route, deps);
  aussenRouten(route, deps);
  einstellungenRouten(route, deps);
  betriebRouten(route, deps);
  dnsRouten(route, deps);
  backupRouten(route, deps);
  abwicklungRouten(route, deps);
  manifesteRouten(route, deps);
  updateRouten(route, deps);
  benachrichtigungRouten(route, deps);
  supportRouten(route, deps);
  leistungenRouten(route, deps);
  agentRouten(route, deps);
  verbindungRouten(route, deps);

  return app;
};
