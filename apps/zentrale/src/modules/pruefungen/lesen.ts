import {
  type PruefungName,
  type Serverpruefung,
  type Stufe,
  serverPruefen,
} from "@steuerzentrale/planung";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { ereignisse } from "../../db/schema.ts";
import type { Server } from "../server/index.ts";
import { pruefEingabe } from "./eingabe.ts";

/*
 * Reading the checks of a server (BAULISTE.md Z-702), always within its operator. Whether a finding
 * is open the events tell, as for a fault (docs/plan.md, "Offene Störung"): the newest event of the
 * check on the server, `pruefung_<name>` (warn or fehler) or `pruefung_<name>_behoben`; so a restart
 * of the Zentrale neither repeats nor forgets one.
 */

export const befundArt = (p: PruefungName) => `pruefung_${p}`;
export const behobenArt = (p: PruefungName) => `pruefung_${p}_behoben`;
export const zielVon = (serverId: string) => `server:${serverId}`;

const STUFE: Record<string, Stufe> = { warn: "gelb", fehler: "rot" };

export type Befund = { stufe: Stufe; seit: number };

const ereignisseDer = (sv: Pick<Server, "betreiberId" | "serverId">, arten: string[]) =>
  and(
    eq(ereignisse.betreiberId, sv.betreiberId),
    eq(ereignisse.ziel, zielVon(sv.serverId)),
    inArray(ereignisse.art, arten),
  );

/**
 * The open finding of a check: the level of its newest event and when it began (its first event
 * after the last fix); undefined when none is open. In the same millisecond a fix counts as later.
 */
export const offenerBefund = (
  db: Db,
  sv: Pick<Server, "betreiberId" | "serverId">,
  p: PruefungName,
): Befund | undefined => {
  const neuestes = db
    .select({ art: ereignisse.art, schwere: ereignisse.schwere, zeitpunkt: ereignisse.zeitpunkt })
    .from(ereignisse)
    .where(ereignisseDer(sv, [befundArt(p), behobenArt(p)]))
    // "pruefung_x_behoben" sorts after "pruefung_x": descending, the fix comes first
    .orderBy(desc(ereignisse.zeitpunkt), desc(ereignisse.art))
    .get();
  if (!neuestes || neuestes.art !== befundArt(p)) return undefined;
  const behoben = db
    .select({ zeitpunkt: ereignisse.zeitpunkt })
    .from(ereignisse)
    .where(ereignisseDer(sv, [behobenArt(p)]))
    .orderBy(desc(ereignisse.zeitpunkt))
    .get();
  const erstes = db
    .select({ zeitpunkt: ereignisse.zeitpunkt })
    .from(ereignisse)
    .where(
      and(
        ereignisseDer(sv, [befundArt(p)]),
        behoben ? gt(ereignisse.zeitpunkt, behoben.zeitpunkt) : undefined,
      ),
    )
    .orderBy(ereignisse.zeitpunkt)
    .get();
  return {
    stufe: STUFE[neuestes.schwere] ?? "gelb",
    seit: erstes?.zeitpunkt ?? neuestes.zeitpunkt,
  };
};

/** A check's result and since when its finding is open (null: none open) */
export type PruefungMitSeit = Serverpruefung & { seit: number | null };

/** Every check of the server as it stands now */
export const pruefungenLesen = (db: Db, sv: Server, jetzt: number): PruefungMitSeit[] =>
  serverPruefen(pruefEingabe(db, sv, jetzt)).map((p) => ({
    ...p,
    seit: offenerBefund(db, sv, p.pruefung)?.seit ?? null,
  }));
