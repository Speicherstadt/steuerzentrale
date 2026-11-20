import { TRENNUNG } from "@steuerzentrale/protokoll";
import { z } from "zod";
import { kundeLesen } from "../modules/kunden/index.ts";
import {
  ARTEN,
  letzteHeartbeats,
  type Server,
  serverAnlegen,
  serverFakten,
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
    art: z.enum(ARTEN),
    kundeId: z.string().min(1).max(200).optional(),
    wartungsfenster,
    grund: z.string().trim().min(1).max(500),
  })
  .strict()
  // a server of its own and one at the customer belong to a customer; a shared one to none
  .refine((s) => (s.art === "gemeinsam") === (s.kundeId === undefined), {
    message: "kundeId with eigen and beim_kunden only",
  });

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
 * state of its agent from the open connection and the last heartbeat (Z-303), and its newest facts
 * with the instant they came (Z-304). Never the certificate or its fingerprint.
 */
export const serverAntwort = (
  sv: Server,
  verbundenSeit: number | undefined,
  letzterHeartbeat: number | undefined,
  jetzt: number,
) => ({
  serverId: sv.serverId,
  name: sv.name,
  art: sv.art,
  kundeId: sv.kundeId,
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
});

/** The command the interface shows once (docs/plan.md, "Ablauf: Server hinzufügen") */
export const installBefehl = (agentUrl: string, token: string): string =>
  `curl -fsSL ${agentUrl}/install.sh | sudo sh -s -- --token ${token}`;

/**
 * Adding a server (BAULISTE.md Z-302): the row, and the one-time token in the command, which the
 * answer carries this once; the Zentrale keeps only its hash
 */
export const serverRouten = (route: Registrar, deps: RoutenDeps): void => {
  const antwort = (sv: Server, letzter: number | undefined) =>
    serverAntwort(
      sv,
      deps.verbindungen.verbundenSeit(sv.betreiberId, sv.serverId),
      letzter,
      deps.now(),
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
    return c.json(antwort(sv, letzteHeartbeats(deps.db, betreiberId, serverId).get(serverId)));
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

  route("POST /api/v1/server", async (c) => {
    const angaben = await eingabe(c, anlegenSchema);
    if (!angaben) return c.json({ fehler: "ungueltig" }, 400);
    const { grund, ...neu } = angaben;
    // the customer must be one of the operator's own (Z-801): never another operator's
    if (neu.kundeId !== undefined && !kundeLesen(deps.db, c.get("betreiberId"), neu.kundeId))
      return c.json({ fehler: "kein_kunde" }, 404);
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
        art: server.art,
        gueltigBis,
        befehl: installBefehl(deps.agentUrl, token),
      },
      201,
    );
  });
};
