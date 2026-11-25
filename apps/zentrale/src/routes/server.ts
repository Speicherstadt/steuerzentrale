import { PLATTEN_TAGE_MAX } from "@steuerzentrale/planung";
import { TRENNUNG } from "@steuerzentrale/protokoll";
import { z } from "zod";
import { kundeLesen } from "../modules/kunden/index.ts";
import { neustartAnlegen, neustartStand } from "../modules/neustart/index.ts";
import { pruefungenLesen } from "../modules/pruefungen/index.ts";
import {
  lastVerlauf,
  letzteHeartbeats,
  plattenVerlauf,
  type Server,
  serverAnlegen,
  serverFakten,
  serverLast,
  serverLesen,
  serverListe,
  serverSperren,
} from "../modules/server/index.ts";
import { verbindungsZustand } from "../modules/verbindung/zustand.ts";
import { eingabe, type RoutenDeps } from "./deps.ts";
import type { Registrar } from "./zugang.ts";

const uhrzeit = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const wartungsfenster = z
  .object({
    tage: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    von: uhrzeit,
    bis: uhrzeit,
  })
  .strict()
  .refine((f) => new Set(f.tage).size === f.tage.length, { message: "a weekday twice" });

const anlegenSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    wartungsfenster,
    grund: z.string().trim().min(1).max(500),
  })
  // every server is the operator's own for several customers: no kind, no customer (Z-1205)
  .strict();

/** `tage` as a whole number from 1 to the days the facts are kept, all of them without it */
const tageAusText = (text: string | undefined): number | undefined => {
  if (text === undefined) return PLATTEN_TAGE_MAX;
  if (!/^\d{1,2}$/.test(text)) return undefined;
  const tage = Number(text);
  return tage >= 1 && tage <= PLATTEN_TAGE_MAX ? tage : undefined;
};

const grundSchema = z.object({ grund: z.string().trim().min(1).max(500) }).strict();

/** The newest facts (Z-304) without the message's own fields, or null before the first */
const fakten = (sv: Server) => {
  const f = serverFakten(sv);
  if (!f) return null;
  const { typ: _typ, protokoll: _protokoll, ...werte } = f;
  return werte;
};

/**
 * A server as the API shows it: what the operator entered, what the agent reported at joining, the
 * state of its agent from the open connection and the last heartbeat (Z-303), its newest facts
 * with the instant they came (Z-304) and where its reboot stands (Z-701). Never the certificate or
 * its fingerprint.
 */
export const serverAntwort = (
  sv: Server,
  verbundenSeit: number | undefined,
  letzterHeartbeat: number | undefined,
  jetzt: number,
  neustart: ReturnType<typeof neustartStand>,
) => ({
  serverId: sv.serverId,
  name: sv.name,
  wartungsfenster: JSON.parse(sv.wartungsfenster) as unknown,
  angelegtAm: sv.angelegtAm,
  beigetretenAm: sv.beigetretenAm,
  architektur: sv.architektur,
  agentVersion: sv.agentVersion,
  zertifikatGueltigBis: sv.zertifikatGueltigBis,
  gesperrtAm: sv.gesperrtAm,
  agent: verbindungsZustand({ verbundenSeit, letzterHeartbeat }, jetzt),
  fakten: fakten(sv),
  faktenAm: sv.faktenAm,
  neustart,
});

/** The command the interface shows once (docs/plan.md, "Ablauf: Server hinzufügen") */
export const installBefehl = (agentUrl: string, token: string): string =>
  `curl -fsSL ${agentUrl}/install.sh | sudo sh -s -- --token ${token}`;

/**
 * Adding a server (BAULISTE.md Z-302): the row, and the one-time token in the command, which the
 * answer carries this once; the Zentrale keeps only its hash
 */
const STATUS: Record<string, 404 | 409 | 422> = {
  kein_server: 404,
  nicht_beigetreten: 409,
  server_gesperrt: 409,
  nur_beobachten: 409,
  unbekannt: 409,
  auftrag_offen: 409,
  backup_fehlt: 409,
  sperrzeit: 409,
  nicht_ausfuehrbar: 422,
};

/**
 * How full a server's disks were (the tab "Auslastung" of its page): per hour from the history of
 * its facts, only of a server of the session's operator; any other is 404
 */
export const serverPlattenRouten = (route: Registrar, deps: RoutenDeps): void => {
  route("GET /api/v1/server/:serverId/platten", (c) => {
    const betreiberId = c.get("betreiberId");
    const tage = tageAusText(c.req.query("tage"));
    if (tage === undefined) return c.json({ fehler: "ungueltig" }, 400);
    const sv = serverLesen(deps.db, betreiberId, c.req.param("serverId") ?? "");
    if (!sv) return c.json({ fehler: "kein_server" }, 404);
    return c.json({
      stunden: plattenVerlauf(deps.db, betreiberId, sv.serverId, tage, deps.now()),
    });
  });

  // Z-1106: CPU, load and memory, per hour the highest reading, from the same history
  route("GET /api/v1/server/:serverId/last", (c) => {
    const betreiberId = c.get("betreiberId");
    const tage = tageAusText(c.req.query("tage"));
    if (tage === undefined) return c.json({ fehler: "ungueltig" }, 400);
    const sv = serverLesen(deps.db, betreiberId, c.req.param("serverId") ?? "");
    if (!sv) return c.json({ fehler: "kein_server" }, 404);
    return c.json({
      stunden: serverLast(lastVerlauf(deps.db, betreiberId, sv.serverId, tage, deps.now())),
    });
  });
};

export const serverRouten = (route: Registrar, deps: RoutenDeps): void => {
  const verbunden = (b: string, s: string) => deps.verbindungen.verbundenSeit(b, s) !== undefined;
  const antwort = (sv: Server, letzter: number | undefined) =>
    serverAntwort(
      sv,
      deps.verbindungen.verbundenSeit(sv.betreiberId, sv.serverId),
      letzter,
      deps.now(),
      neustartStand(deps.db, verbunden, sv, deps.now()),
    );

  route("GET /api/v1/server", (c) => {
    const betreiberId = c.get("betreiberId");
    const letzte = letzteHeartbeats(deps.db, betreiberId);
    const server = serverListe(deps.db, betreiberId).map((sv) =>
      antwort(sv, letzte.get(sv.serverId)),
    );
    return c.json({ server });
  });

  route("GET /api/v1/server/:serverId", (c) => {
    const betreiberId = c.get("betreiberId");
    const serverId = c.req.param("serverId") ?? "";
    const sv = serverLesen(deps.db, betreiberId, serverId);
    if (!sv) return c.json({ fehler: "kein_server" }, 404);
    return c.json({
      ...antwort(sv, letzteHeartbeats(deps.db, betreiberId, serverId).get(serverId)),
      // its checks (Z-702), only on its own page: each reads its installations and backups
      pruefungen: pruefungenLesen(deps.db, sv, deps.now()),
    });
  });

  // Revoking (Z-303): the certificate is refused from now on, and a running connection ends now
  route("POST /api/v1/server/:serverId/sperren", async (c) => {
    const angaben = await eingabe(c, grundSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const betreiberId = c.get("betreiberId");
    const serverId = c.req.param("serverId") ?? "";
    const kontext = {
      betreiberId,
      akteur: c.get("nutzerId"),
      jetzt: deps.now(),
      grund: angaben.grund,
    };
    const gesperrt = serverSperren(deps.db, deps.schreibDb, kontext, serverId);
    if (!gesperrt.ok)
      return c.json({ fehler: gesperrt.grund }, gesperrt.grund === "kein_server" ? 404 : 409);
    deps.verbindungen.trennen(betreiberId, serverId, TRENNUNG.gesperrt, "certificate revoked");
    return c.json(
      antwort(gesperrt.server, letzteHeartbeats(deps.db, betreiberId, serverId).get(serverId)),
    );
  });

  // A reboot by hand (Z-701): backups first, never in a freeze window of an app on the server
  route("POST /api/v1/server/:serverId/neustart", async (c) => {
    const angaben = await eingabe(c, grundSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const kontext = {
      betreiberId: c.get("betreiberId"),
      akteur: c.get("nutzerId"),
      jetzt: deps.now(),
      grund: angaben.grund,
    };
    const r = neustartAnlegen(deps, kontext, c.req.param("serverId") ?? "");
    if (!r.ok)
      return c.json(
        { fehler: r.grund, ...(r.detail === undefined ? {} : { detail: r.detail }) },
        STATUS[r.grund] ?? 400,
      );
    const kurz = (a: (typeof r.backups)[number]) => ({
      auftragId: a.auftragId,
      aktion: a.aktion,
      zustand: a.zustand,
      installationId: a.installationId,
    });
    return c.json({ backups: r.backups.map(kurz), neustart: kurz(r.neustart) }, 201);
  });

  route("POST /api/v1/server", async (c) => {
    const angaben = await eingabe(c, anlegenSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const { grund, ...neu } = angaben;
    const kontext = {
      betreiberId: c.get("betreiberId"),
      akteur: c.get("nutzerId"),
      jetzt: deps.now(),
      grund,
    };
    const { server, token, gueltigBis } = serverAnlegen(deps.schreibDb, kontext, neu);
    return c.json(
      {
        serverId: server.serverId,
        name: server.name,
        gueltigBis,
        befehl: installBefehl(deps.agentUrl, token),
      },
      201,
    );
  });
};
