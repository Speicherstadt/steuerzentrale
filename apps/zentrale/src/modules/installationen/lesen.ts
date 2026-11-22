import type { Wert } from "@steuerzentrale/manifest";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import {
  appEinstellungen,
  auftraege,
  installationen,
  installationsPorts,
} from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import { vorgaengerVon } from "../auftraege/lesen.ts";
import { spalteEntschluesseln } from "../geheim/spalten.ts";

/*
 * Reading installations (BAULISTE.md Z-402), always within one operator: an installation of
 * another operator is unknown here, whoever asks.
 */

export type Installation = typeof installationen.$inferSelect;

/** Values by name, split into those that may be shown and the secret ones */
export type Werte = { offen: Record<string, Wert>; geheim: Record<string, Wert> };

export const installationLesen = (
  db: Db,
  betreiberId: string,
  installationId: string,
): Installation | undefined =>
  db
    .select()
    .from(installationen)
    .where(
      and(
        eq(installationen.betreiberId, betreiberId),
        eq(installationen.installationId, installationId),
      ),
    )
    .get();

/** The operator's installations, newest first */
export const installationenListe = (db: Db, betreiberId: string): Installation[] =>
  db
    .select()
    .from(installationen)
    .where(eq(installationen.betreiberId, betreiberId))
    .orderBy(desc(installationen.angelegtAm), asc(installationen.installationId))
    .all();

/** What stands on a server: its installations not removed */
export const installationenAufServer = (
  db: Db,
  betreiberId: string,
  serverId: string,
): Installation[] =>
  db
    .select()
    .from(installationen)
    .where(
      and(
        eq(installationen.betreiberId, betreiberId),
        eq(installationen.serverId, serverId),
        ne(installationen.zustand, "entfernt"),
      ),
    )
    .all();

/** A customer's installations not removed, on any server */
export const installationenDesKunden = (
  db: Db,
  betreiberId: string,
  kundeId: string,
): Installation[] =>
  db
    .select()
    .from(installationen)
    .where(
      and(
        eq(installationen.betreiberId, betreiberId),
        eq(installationen.kundeId, kundeId),
        ne(installationen.zustand, "entfernt"),
      ),
    )
    .all();

/** Whether an installation not removed already answers on this host */
export const hostVergeben = (db: Db, betreiberId: string, host: string): boolean =>
  db
    .select({ id: installationen.installationId })
    .from(installationen)
    .where(
      and(
        eq(installationen.betreiberId, betreiberId),
        eq(installationen.host, host),
        ne(installationen.zustand, "entfernt"),
      ),
    )
    .all().length > 0;

/** The ports the Zentrale assigned on a server */
export const vergebenePorts = (db: Db, betreiberId: string, serverId: string): number[] =>
  db
    .select({ port: installationsPorts.port })
    .from(installationsPorts)
    .where(
      and(
        eq(installationsPorts.betreiberId, betreiberId),
        eq(installationsPorts.serverId, serverId),
      ),
    )
    .all()
    .map((z) => z.port);

/** The ports of one installation, as `schreiben` deletes them */
export const portsDerInstallation = (
  db: Db,
  betreiberId: string,
  installationId: string,
): { serverId: string; port: number }[] =>
  db
    .select({ serverId: installationsPorts.serverId, port: installationsPorts.port })
    .from(installationsPorts)
    .where(
      and(
        eq(installationsPorts.betreiberId, betreiberId),
        eq(installationsPorts.installationId, installationId),
      ),
    )
    .all();

/** The jobs of an installation, oldest first; of two made together the one waited for first */
export const auftraegeDerInstallation = (db: Db, betreiberId: string, installationId: string) =>
  db
    .select({
      auftragId: auftraege.auftragId,
      aktion: auftraege.aktion,
      zustand: auftraege.zustand,
      wartetAuf: auftraege.wartetAuf,
      fortschritt: auftraege.fortschritt,
      ergebnis: auftraege.ergebnis,
      angelegtAm: auftraege.angelegtAm,
      geaendertAm: auftraege.geaendertAm,
    })
    .from(auftraege)
    .where(
      and(eq(auftraege.betreiberId, betreiberId), eq(auftraege.installationId, installationId)),
    )
    .all()
    .sort(
      (a, b) =>
        a.angelegtAm - b.angelegtAm ||
        Number(vorgaengerVon(a).includes(b.auftragId)) -
          Number(vorgaengerVon(b).includes(a.auftragId)),
    );

export type BetreiberWerte = { ok: true; werte: Werte } | { ok: false; grund: string };

/**
 * The operator's values for an app (level `betreiber`), the secret ones decrypted; a value no key
 * opens is an error, not a missing value
 */
export const betreiberWerteLesen = (
  db: Db,
  bund: Schluesselbund,
  betreiberId: string,
  app: string,
): BetreiberWerte => {
  const zeilen = db
    .select()
    .from(appEinstellungen)
    .where(and(eq(appEinstellungen.betreiberId, betreiberId), eq(appEinstellungen.app, app)))
    .all();
  const werte: Werte = { offen: {}, geheim: {} };
  for (const z of zeilen) {
    if (z.wertVerschluesselt !== null) {
      const klar = spalteEntschluesseln(
        bund,
        "appEinstellungen",
        betreiberId,
        z,
        z.wertVerschluesselt,
      );
      if (!klar.ok) return { ok: false, grund: `${z.name}: ${klar.grund}` };
      werte.geheim[z.name] = JSON.parse(klar.wert) as Wert;
    } else if (z.wert !== null) werte.offen[z.name] = JSON.parse(z.wert) as Wert;
  }
  return { ok: true, werte };
};
