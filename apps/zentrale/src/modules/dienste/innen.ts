import {
  type BeobachteterDienst,
  type BeobachtetHealth,
  linuxNutzerGueltig,
  unitGueltig,
} from "@steuerzentrale/protokoll";
import type { z } from "zod";
import type { Db } from "../../db/oeffnen.ts";
import { nurBeobachtet, serverLesen } from "../server/index.ts";
import type { DienstZeile } from "./lesen.ts";

/*
 * What the agent reads inside of an observed service (BAULISTE.md Z-1103; docs/plan.md, "Vorhandene
 * Units lesen"): on one of the operator's servers that is only observed (Z-1102), the units of a
 * Linux user or of the system and, if wanted, a check on 127.0.0.1. The names are checked with the
 * protocol's patterns, the same the agent checks again; a server that is managed takes none, there
 * the agent reads only what a manifest describes.
 */

export type Health = z.output<typeof BeobachtetHealth>;

/** What the operator names for the inside of a service */
export type Innen = {
  serverId: string;
  /** null: units of the system */
  nutzer: string | null;
  units: string[];
  health: Health;
};

export type InnenFehler = "kein_server" | "server_verwaltet" | "ungueltig";

/** Whether the names pass the patterns; the schema of the API checks them too */
export const innenGueltig = (i: Innen): boolean =>
  (i.nutzer === null || linuxNutzerGueltig(i.nutzer)) &&
  i.units.length > 0 &&
  i.units.every(unitGueltig);

/** Checks the inside against the operator's servers: undefined when it may be read */
export const innenPruefen = (
  db: Db,
  betreiberId: string,
  innen: Innen | null,
): InnenFehler | undefined => {
  if (innen === null) return undefined;
  if (!innenGueltig(innen)) return "ungueltig";
  const sv = serverLesen(db, betreiberId, innen.serverId);
  if (!sv || sv.gesperrtAm !== null) return "kein_server";
  return nurBeobachtet(sv) ? undefined : "server_verwaltet";
};

const healthVon = (z: DienstZeile): Health =>
  z.healthPort === null
    ? { art: "keine" }
    : z.healthPfad === null
      ? { art: "tcp", port: z.healthPort }
      : { art: "http", port: z.healthPort, pfad: z.healthPfad };

const unitsVon = (text: string | null): string[] => {
  const liste: unknown = JSON.parse(text ?? "[]");
  return Array.isArray(liste) ? liste.filter((u): u is string => typeof u === "string") : [];
};

/** The inside as stored, or null for a service checked only from outside */
export const innenVon = (z: DienstZeile): Innen | null =>
  z.serverId === null
    ? null
    : { serverId: z.serverId, nutzer: z.nutzer, units: unitsVon(z.units), health: healthVon(z) };

/** The columns of a service for its inside */
export const innenSpalten = (innen: Innen | null) => ({
  serverId: innen?.serverId ?? null,
  nutzer: innen?.nutzer ?? null,
  units: innen ? JSON.stringify(innen.units) : null,
  healthPort: innen && innen.health.art !== "keine" ? innen.health.port : null,
  healthPfad: innen?.health.art === "http" ? innen.health.pfad : null,
});

/** The services a server's agent reads, as `beobachten` names them */
export const beobachtetAuf = (zeilen: readonly DienstZeile[]): BeobachteterDienst[] =>
  zeilen.flatMap((z) => {
    const innen = innenVon(z);
    if (!innen || !innenGueltig(innen)) return [];
    return [
      { dienstId: z.dienstId, nutzer: innen.nutzer, units: innen.units, health: innen.health },
    ];
  });
