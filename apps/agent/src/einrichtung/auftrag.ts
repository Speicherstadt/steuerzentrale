import type { Ergebnis } from "../auftraege/ausfuehren.ts";
import { abbauen } from "./abbauen.ts";
import { einrichten } from "./einrichten.ts";
import type { Gedaechtnis, InstallationsStand } from "./gedaechtnis.ts";
import { laeufer } from "./lauf.ts";
import { homeVon, type Nutzer, nutzerName } from "./nutzer.ts";
import { pforteSicherstellen } from "./pforte.ts";
import type { Einrichten, Entfernen, SystemDeps } from "./typen.ts";

/*
 * The setup jobs on the agent (BAULISTE.md Z-402; docs/plan.md, "Scheitern beim Einrichten"),
 * decided by its record of installations (gedaechtnis.ts):
 * - setting up a `fertig` installation changes nothing: a job sent twice, or again after a restart,
 *   sets up once;
 * - one left `angelegt` (the agent stopped in the middle, or tearing down failed) is torn down
 *   first and set up anew;
 * - a user or home sz-<name> the record does not name is someone else's: refused, untouched;
 * - any failing step tears everything down before the result is sent; only if that fails too does
 *   the record keep the installation, as `angelegt`, so that removing it may try again;
 * - removing is only for an installation whose setup did not finish; one that runs has data, and
 *   removing it comes with Z-604 (backup first).
 * A command of a job runs only in an installation this agent set up and finished.
 */

export type EinrichtungsDeps = SystemDeps & { gedaechtnis: Gedaechtnis };

export type EinrichtungsAuftrag = { auftrag: Einrichten | Entfernen; zeitlimitMs: number };

const fehler = (text: string): Ergebnis => ({ ok: false, fehler: text });

/** sz-<name> or its home is there, though the agent did not make it */
const fremd = async (deps: EinrichtungsDeps, name: string): Promise<string | undefined> => {
  if (await deps.nutzer(nutzerName(name)))
    return `abgelehnt: ${nutzerName(name)} gibt es schon, nicht von diesem Agenten angelegt`;
  if (await deps.haus.existiert(homeVon(name)))
    return `abgelehnt: ${homeVon(name)} gibt es schon, nicht von diesem Agenten angelegt`;
  return undefined;
};

const mitZeitlimit = async <T>(
  deps: EinrichtungsDeps,
  ms: number,
  f: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const abbruch = new AbortController();
  const aufheben = deps.planen(() => abbruch.abort(), ms);
  try {
    return await f(abbruch.signal);
  } finally {
    aufheben();
  }
};

const neuEinrichten = async (
  deps: EinrichtungsDeps,
  a: Einrichten,
  zeitlimitMs: number,
): Promise<Ergebnis> => {
  let angelegt = false;
  const r = await mitZeitlimit(deps, zeitlimitMs, async (signal) => {
    const lauf = laeufer(deps, signal);
    if (a.quadlets.pforte !== null) {
      const pforte = await pforteSicherstellen(deps, lauf);
      if (!pforte.ok) return pforte;
    }
    // recorded before useradd: a user the agent made is always one its record names
    await deps.gedaechtnis.setzen(a.name, "angelegt");
    angelegt = true;
    return einrichten(deps, a, lauf, signal);
  });
  if (r.ok) {
    await deps.gedaechtnis.setzen(a.name, "fertig");
    return { ok: true, daten: { installation: a.name, geaendert: "neu", units: a.units } };
  }
  // the Pforte failed before anything was made: nothing to tear down, nothing recorded
  if (!angelegt) return fehler(`Einrichten gescheitert: ${r.grund}`);
  const weg = await abbauen(deps, a.name, a.units);
  if (!weg.ok)
    return fehler(`Einrichten gescheitert: ${r.grund}; Abbau unvollständig: ${weg.grund}`);
  await deps.gedaechtnis.setzen(a.name, undefined);
  return fehler(`Einrichten gescheitert: ${r.grund}; alles abgebaut`);
};

const einrichtenAuftrag = async (
  deps: EinrichtungsDeps,
  stand: InstallationsStand,
  a: Einrichten,
  zeitlimitMs: number,
): Promise<Ergebnis> => {
  const bekannt = stand.get(a.name);
  if (bekannt?.zustand === "fertig")
    return { ok: true, daten: { installation: a.name, geaendert: "nichts" } };
  if (bekannt === undefined) {
    const grund = await fremd(deps, a.name);
    if (grund) return fehler(grund);
  } else {
    // left from an attempt the agent did not finish: its own, torn down before anything else
    const weg = await abbauen(deps, a.name, a.units);
    if (!weg.ok) return fehler(`Abbau des letzten Versuchs unvollständig: ${weg.grund}`);
    await deps.gedaechtnis.setzen(a.name, undefined);
  }
  return neuEinrichten(deps, a, zeitlimitMs);
};

const entfernenAuftrag = async (
  deps: EinrichtungsDeps,
  stand: InstallationsStand,
  a: Entfernen,
): Promise<Ergebnis> => {
  const bekannt = stand.get(a.name);
  if (bekannt?.zustand === "fertig")
    return fehler(
      `abgelehnt: ${a.name} ist fertig eingerichtet; entfernt wird sie erst mit Backup (Z-604)`,
    );
  if (bekannt === undefined) {
    const grund = await fremd(deps, a.name);
    return grund
      ? fehler(grund)
      : { ok: true, daten: { installation: a.name, geaendert: "nichts" } };
  }
  const weg = await abbauen(deps, a.name, []);
  if (!weg.ok) return fehler(`Abbau unvollständig: ${weg.grund}`);
  await deps.gedaechtnis.setzen(a.name, undefined);
  return { ok: true, daten: { installation: a.name, geaendert: "entfernt" } };
};

export const einrichtungAusfuehren = async (
  deps: EinrichtungsDeps,
  plan: EinrichtungsAuftrag,
): Promise<Ergebnis> => {
  const g = await deps.gedaechtnis.lesen();
  // without its record the agent cannot tell its own users from someone else's
  if (!g.ok) return fehler(`abgelehnt: ${g.grund}`);
  try {
    return plan.auftrag.art === "einrichten"
      ? await einrichtenAuftrag(deps, g.stand, plan.auftrag, plan.zeitlimitMs)
      : await entfernenAuftrag(deps, g.stand, plan.auftrag);
  } catch (e) {
    // the record could not be written: say so rather than leave the job running
    return fehler(`Einrichtung: ${String(e).slice(0, 500)}`);
  }
};

/** The user a command of a job runs as: only that of an installation the agent set up and finished */
export const installationsNutzer = async (
  deps: Pick<EinrichtungsDeps, "gedaechtnis" | "nutzer">,
  installation: string,
): Promise<{ ok: true; nutzer: Nutzer } | { ok: false; grund: string }> => {
  const g = await deps.gedaechtnis.lesen();
  if (!g.ok) return g;
  if (g.stand.get(installation)?.zustand !== "fertig")
    return { ok: false, grund: `${installation} is no installation this agent set up` };
  const n = await deps.nutzer(nutzerName(installation));
  return n
    ? { ok: true, nutzer: n }
    : { ok: false, grund: `${nutzerName(installation)} is missing` };
};
