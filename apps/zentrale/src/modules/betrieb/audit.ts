import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { user } from "../../db/auth-schema.ts";
import type { Db } from "../../db/oeffnen.ts";
import { auditLog, server } from "../../db/schema.ts";
import {
  ausgelasseneSpalten,
  type TabellenName,
  tabellen,
  verschluesselteSpalten,
} from "../audit/tabellen.ts";
import { einer } from "./ereignisse.ts";
import { type Marke, type Seite, seiteBilden } from "./seite.ts";
import { type ZielVerweis, zielVerweise } from "./ziele.ts";

/*
 * The audit log page by page (BAULISTE.md Z-406), newest first by its number, which only grows: a
 * new entry never moves an old one to another page. What an entry holds is shown as `schreiben`
 * stored it, and once more filtered on the way out: a manifest's text and signature, the lines of a
 * log excerpt and every other column `schreiben` leaves out stay "[ausgelassen]", an encrypted one
 * "[verschlüsselt]", a token's hash too, and any text longer than AUSGELASSEN_AB, whatever an older
 * entry may hold.
 */

export type AuditFilter = { akteur?: string[]; aktion?: string[]; ziel?: string[] };

/** Who acted: a person of the operator, a server's agent, or the Zentrale itself */
export type Akteur =
  | { art: "person"; id: string; name: string }
  | { art: "server"; id: string; name: string }
  | { art: "zentrale"; id: string };

export type AuditZeile = {
  nummer: number;
  zeitpunkt: number;
  akteur: Akteur;
  aktion: string;
  ziel: string;
  /** The target's page and name, if it has one */
  verweis: ZielVerweis | null;
  grund: string;
  inhalt: unknown;
};

/** A text this long is no field a person reads in the log: a manifest, a certificate, lines */
export const AUSGELASSEN_AB = 1000;

/** Columns kept out of the answer besides those `schreiben` leaves out */
const AUCH_AUSGELASSEN: Partial<Record<TabellenName, readonly string[]>> = { tokens: ["hash"] };

const tabelleVon = (ziel: string): TabellenName | undefined => {
  const name = ziel.split(":")[0] ?? "";
  return name in tabellen ? (name as TabellenName) : undefined;
};

const ausgelassen = (tabelle: TabellenName | undefined): readonly string[] =>
  tabelle ? [...(ausgelasseneSpalten[tabelle] ?? []), ...(AUCH_AUSGELASSEN[tabelle] ?? [])] : [];

const wertZeigen = (tabelle: TabellenName | undefined, feld: string, wert: unknown): unknown => {
  if (tabelle && verschluesselteSpalten[tabelle]?.includes(feld)) return "[verschlüsselt]";
  if (ausgelassen(tabelle).includes(feld)) return "[ausgelassen]";
  if (typeof wert === "string" && wert.length > AUSGELASSEN_AB) return "[ausgelassen]";
  return wert;
};

const zeileZeigen = (tabelle: TabellenName | undefined, zeile: unknown): unknown =>
  zeile && typeof zeile === "object" && !Array.isArray(zeile)
    ? Object.fromEntries(
        Object.entries(zeile).map(([feld, wert]) => [feld, wertZeigen(tabelle, feld, wert)]),
      )
    : zeile;

/** An entry's content as the API shows it (`zeile` of an insert or delete, `werte` of a change) */
export const inhaltZeigen = (ziel: string, text: string): unknown => {
  const tabelle = tabelleVon(ziel);
  let inhalt: unknown;
  try {
    inhalt = JSON.parse(text);
  } catch {
    return "[ausgelassen]";
  }
  if (!inhalt || typeof inhalt !== "object" || Array.isArray(inhalt))
    return wertZeigen(undefined, "", inhalt);
  return Object.fromEntries(
    Object.entries(inhalt).map(([feld, wert]) => [
      feld,
      feld === "zeile" || feld === "werte"
        ? zeileZeigen(tabelle, wert)
        : wertZeigen(undefined, feld, wert),
    ]),
  );
};

/** How an agent names itself as the actor (modules/verbindung/sitzung.ts) */
const SERVER = "server:";

/** The names of the people and servers on a page, of this operator only */
const namen = (db: Db, betreiberId: string, akteure: string[]) => {
  const serverIds = akteure.filter((a) => a.startsWith(SERVER)).map((a) => a.slice(SERVER.length));
  const personen = akteure.filter((a) => !a.includes(":"));
  const sv = serverIds.length
    ? db
        .select({ id: server.serverId, name: server.name })
        .from(server)
        .where(and(eq(server.betreiberId, betreiberId), inArray(server.serverId, serverIds)))
        .all()
    : [];
  const pe = personen.length
    ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, personen)).all()
    : [];
  return {
    server: new Map(sv.map((s) => [s.id, s.name])),
    person: new Map(pe.map((p) => [p.id, p.name])),
  };
};

const akteurVon = (akteur: string, n: ReturnType<typeof namen>): Akteur => {
  if (akteur.startsWith(SERVER)) {
    const id = akteur.slice(SERVER.length);
    return { art: "server", id, name: n.server.get(id) ?? id };
  }
  const name = n.person.get(akteur);
  return name === undefined ? { art: "zentrale", id: akteur } : { art: "person", id: akteur, name };
};

export const auditSeite = (
  db: Db,
  betreiberId: string,
  filter: AuditFilter,
  marke: Marke | undefined,
  groesse: number,
): Seite<AuditZeile> => {
  const zeilen = db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.betreiberId, betreiberId),
        einer(auditLog.akteur, filter.akteur),
        einer(auditLog.aktion, filter.aktion),
        einer(auditLog.ziel, filter.ziel),
        marke === undefined ? undefined : lt(auditLog.nummer, marke.wert),
      ),
    )
    .orderBy(desc(auditLog.nummer))
    .limit(groesse + 1)
    .all();
  const n = namen(db, betreiberId, [...new Set(zeilen.map((z) => z.akteur))]);
  const verweise = zielVerweise(
    db,
    betreiberId,
    zeilen.map((z) => z.ziel),
  );
  return seiteBilden(
    zeilen,
    groesse,
    (z) => ({ wert: z.nummer, id: "" }),
    (z): AuditZeile => ({
      nummer: z.nummer,
      zeitpunkt: z.zeitpunkt,
      akteur: akteurVon(z.akteur, n),
      aktion: z.aktion,
      ziel: z.ziel,
      verweis: verweise.get(z.ziel) ?? null,
      grund: z.grund,
      inhalt: inhaltZeigen(z.ziel, z.inhalt),
    }),
  );
};
