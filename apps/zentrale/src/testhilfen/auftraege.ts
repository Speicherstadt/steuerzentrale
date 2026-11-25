import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRENNUNG } from "@steuerzentrale/protokoll";
import { testDatenbank } from "../db/test-db.ts";
import { schreiben } from "../modules/audit/index.ts";
import type { AuftragDeps, NeuerAuftrag } from "../modules/auftraege/index.ts";
import { type Sockel, verbindungen } from "../modules/verbindung/verbindungen.ts";

/*
 * For the tests of jobs (Z-305): a database with operators and servers, agents connected in
 * memory that keep what they get, and the test manifest signed with the public test key
 * (packages/manifest/test/auftrag.yml).
 */
const FIXTURES = join(import.meta.dirname, "../../../../packages/manifest/test");
export const MANIFEST = readFileSync(join(FIXTURES, "auftrag.yml"), "utf8");
export const SIGNATUR = readFileSync(join(FIXTURES, "auftrag.yml.minisig"), "utf8");

export const neuerAuftrag = (serverId: string, teil: Partial<NeuerAuftrag> = {}): NeuerAuftrag => ({
  serverId,
  installationId: "auftrag-k1",
  aktion: "migrieren",
  argumente: {},
  manifest: MANIFEST,
  signatur: SIGNATUR,
  ...teil,
});

export const auftragsUmgebung = () => {
  const datenbank = testDatenbank();
  const uhr = { ms: 1_800_000_000_000 };
  const log: string[] = [];
  const deps: AuftragDeps = {
    db: datenbank.db,
    schreibDb: datenbank.schreibDb,
    verbindungen: verbindungen(TRENNUNG.ersetzt),
    now: () => uhr.ms,
    log: (zeile) => log.push(zeile),
    schluessel: datenbank.schluessel,
  };
  const kontext = (betreiberId: string) => ({
    betreiberId,
    akteur: "nutzer-1",
    jetzt: uhr.ms,
    grund: "Test",
  });

  /** An operator with servers of these ids */
  const betreiber = (betreiberId: string, ...serverIds: string[]) =>
    schreiben(datenbank.schreibDb, kontext(betreiberId), "test", (w) => {
      w.einfuegen("betreiber", { betreiberId, name: betreiberId, angelegtAm: uhr.ms });
      for (const serverId of serverIds)
        w.einfuegen("server", {
          betreiberId,
          serverId,
          name: serverId,
          wartungsfenster: JSON.stringify({ tage: [0], von: "03:00", bis: "04:00" }),
          angelegtVon: "nutzer-1",
          angelegtAm: uhr.ms,
        });
    });

  /** The server's agent connected and greeted; what it gets, parsed */
  const verbinden = (betreiberId: string, serverId: string) => {
    const gesendet: Record<string, unknown>[] = [];
    const sockel: Sockel = {
      senden: (text) => gesendet.push(JSON.parse(text)),
      schliessen: () => {},
    };
    deps.verbindungen.anmelden(betreiberId, serverId, sockel, uhr.ms);
    deps.verbindungen.gruessen(betreiberId, serverId, sockel);
    return gesendet;
  };

  return { ...datenbank, deps, uhr, log, kontext, betreiber, verbinden };
};
