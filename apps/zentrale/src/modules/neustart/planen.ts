import { SERVER_NEUSTART_AKTION } from "@steuerzentrale/manifest";
import { neustartPruefen, sperrzeitAm } from "@steuerzentrale/planung";
import { uebergang } from "@steuerzentrale/protokoll";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege, betreiber, server } from "../../db/schema.ts";
import type { Planer } from "../aufbewahrung/index.ts";
import { schreiben } from "../audit/index.ts";
import type { AuftragDeps } from "../auftraege/zustellen.ts";
import { neustartAnlegen } from "./anlegen.ts";
import { neustartFortschreiben } from "./ende.ts";
import { serverFakten } from "../server/index.ts";
import { neustartServer } from "./lage.ts";
import { neustartDarfHinaus, sperrzeitenAufServer, VON_DER_PLANUNG } from "./sperrzeiten.ts";

/*
 * The reboots of the servers (BAULISTE.md Z-701; docs/plan.md, "Wann ein Server neu startet",
 * "Neustart beim Zustellen"): every minute, for each joined server that is not revoked, the Zentrale
 * asks packages/planung `neustartPruefen` and, when it says now, makes the backups and the reboot
 * as the system (anlegen.ts). A reboot whose backups ran past the maintenance window or into a
 * freeze window, and which its agent has not acknowledged, it cancels instead of leaving it for
 * later. The jobs and the servers' rows are the state: a restart of the Zentrale changes nothing.
 */

export const NEUSTART_PLANUNG_MS = 60_000;

type ServerZeile = Pick<
  typeof server.$inferSelect,
  "betreiberId" | "serverId" | "wartungsfenster" | "fakten"
>;

const beigetretene = (db: Db, betreiberId: string): ServerZeile[] =>
  db
    .select({
      betreiberId: server.betreiberId,
      serverId: server.serverId,
      wartungsfenster: server.wartungsfenster,
      fakten: server.fakten,
    })
    .from(server)
    .where(
      and(
        eq(server.betreiberId, betreiberId),
        isNotNull(server.beigetretenAm),
        isNull(server.gesperrtAm),
      ),
    )
    .all();

/** Cancels the operator's reboots not yet acknowledged that may no longer go out */
const verpassteAbbrechen = (deps: AuftragDeps, betreiberId: string, jetzt: number): string[] => {
  const liegen = deps.db
    .select()
    .from(auftraege)
    .where(
      and(
        eq(auftraege.betreiberId, betreiberId),
        eq(auftraege.aktion, SERVER_NEUSTART_AKTION),
        inArray(auftraege.zustand, ["bereit", "zugestellt"]),
      ),
    )
    .all()
    .filter((a) => !neustartDarfHinaus(deps.db, a, jetzt));
  for (const a of liegen) {
    const u = uebergang(a.zustand, { art: "abbrechen" });
    if (!u.ok) continue;
    const sperre = sperrzeitAm(sperrzeitenAufServer(deps.db, betreiberId, a.serverId), jetzt);
    const fehler = sperre
      ? `Sperrzeit: ${sperre.grund}`
      : "das Wartungsfenster endete vor den Backups";
    const ergebnis = { ok: false as const, fehler };
    const kontext = { betreiberId, akteur: "system", jetzt, grund: fehler };
    schreiben(deps.schreibDb, kontext, "auftrag.abbrechen", (w) => {
      w.aendern(
        "auftraege",
        { auftragId: a.auftragId },
        { zustand: u.zustand, geaendertAm: jetzt, ergebnis: JSON.stringify(ergebnis) },
      );
      neustartFortschreiben(w, deps.db, a, u.zustand, ergebnis, jetzt);
    });
  }
  return liegen.map((a) => a.auftragId);
};

/** The reason in the audit log: what the facts say, with the kernels when they differ */
const grundFuer = (s: ServerZeile): string => {
  const k = serverFakten(s)?.kernel;
  return k?.installiert && k.laeuft && k.installiert !== k.laeuft
    ? `Neustart nötig: Kernel ${k.installiert} installiert, ${k.laeuft} läuft`
    : "Neustart nötig laut den Fakten des Agenten";
};

export type NeustartRunde = { angelegt: string[]; abgebrochen: string[] };

/** One round over every operator */
export const neustartsPlanen = (deps: AuftragDeps): NeustartRunde => {
  const jetzt = deps.now();
  const runde: NeustartRunde = { angelegt: [], abgebrochen: [] };
  const verbunden = (b: string, s: string) => deps.verbindungen.verbundenSeit(b, s) !== undefined;
  for (const { betreiberId } of deps.db
    .select({ betreiberId: betreiber.betreiberId })
    .from(betreiber)
    .all()) {
    runde.abgebrochen.push(...verpassteAbbrechen(deps, betreiberId, jetzt));
    for (const s of beigetretene(deps.db, betreiberId)) {
      if (neustartPruefen(neustartServer(deps.db, verbunden, s), jetzt).art !== "jetzt") continue;
      const kontext = { betreiberId, akteur: VON_DER_PLANUNG, jetzt, grund: grundFuer(s) };
      const r = neustartAnlegen(deps, kontext, s.serverId);
      if (r.ok) runde.angelegt.push(s.serverId);
      else
        deps.log(
          JSON.stringify({ msg: "reboot not made", serverId: s.serverId, grund: r.grund }),
        );
    }
  }
  return runde;
};

/** Every minute, from now on */
export const neustartSchleife = (deps: AuftragDeps, planen: Planer): void => {
  planen(() => {
    try {
      const r = neustartsPlanen(deps);
      if (r.angelegt.length > 0 || r.abgebrochen.length > 0)
        deps.log(JSON.stringify({ msg: "reboots planned", ...r }));
    } catch (fehler) {
      deps.log(JSON.stringify({ msg: "reboot planning failed", fehler: String(fehler) }));
    }
  }, NEUSTART_PLANUNG_MS);
};
