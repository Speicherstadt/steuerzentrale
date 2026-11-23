import {
  PRUEF_RESTORE_HEALTH_S,
  PRUEF_RESTORE_KOPIE,
  type PruefRestoreDaten,
  type PruefRestoreTeil,
  type RestoreTeil,
} from "@steuerzentrale/manifest";
import { installationVomManifest, type ManifestAngaben } from "../aktionen/geheimnisse.ts";
import type { Ergebnis } from "../auftraege/ausfuehren.ts";
import { fertigeInstallation } from "../backup/auftrag.ts";
import { abbauen } from "../einrichtung/abbauen.ts";
import { type EinrichtungsDeps, fremd, mitZeitlimit } from "../einrichtung/auftrag.ts";
import { unitsStarten, vorbereiten } from "../einrichtung/einrichten.ts";
import { laeufer } from "../einrichtung/lauf.ts";
import type { Nutzer } from "../einrichtung/nutzer.ts";
import type { Einrichten } from "../einrichtung/typen.ts";
import { type Health, healthPruefen, type PruefDeps } from "../zustand/pruefen.ts";
import type { PruefZiel } from "../zustand/ziel.ts";
import { quelleLesen } from "./quelle.ts";
import {
  type TeilErgebnis,
  teileVorher,
  type ZurueckDeps,
  zurueckspielen,
} from "./zurueckspielen.ts";

/*
 * The Prüf-Restore on the agent (BAULISTE.md Z-602; docs/plan.md, "Prüf-Restore auf dem Server"),
 * after key, signature and pruefRestoreAuftragPruefen (auftraege/pruefen.ts), only for an
 * installation this agent set up and finished, whose units were rendered from the job's manifest
 * (their labels) and whose backup is set up here. The copy `restore-<6>` is set up like an
 * installation, without `schritte.einrichten` and without starting it (vorbereiten), the newest
 * snapshot of each part is played back into it (zurueckspielen.ts), its units are started and
 * must become active, and its health by the manifest must not be red within five minutes, on the
 * copy's own ports. Then the copy is torn down, always, also after a failure or the time limit:
 * its user, home, units, volumes and containers. The original is only read.
 *
 * The copy stands in the record of installations as `angelegt` while it exists, before useradd,
 * and is forgotten once it is torn down; it is never `fertig`, so no check, backup or action sees
 * it. If the agent stops in the middle, the copy stays `angelegt`: when the agent starts again,
 * and before every Prüf-Restore, resteAbbauen tears down every copy left `angelegt`. No
 * installation can have a copy's name (the agent refuses a setup job with one, pruefen.ts). A
 * Prüf-Restore that succeeded reports its parts and duration (PruefRestoreDaten, read by the
 * Zentrale with pruefRestoreDatenLesen); one that failed or was refused reports only its reason.
 */

export type PruefRestore = {
  art: "pruef_restore";
  original: string;
  /** The copy as a setup without steps, rendered from the signed manifest */
  kopie: Einrichten;
  teile: RestoreTeil[];
  netz: { name: string; unit: string };
  /** From the job's signed manifest, to compare with the original's units */
  manifest: ManifestAngaben;
};

export type PruefRestoreDeps = EinrichtungsDeps &
  ZurueckDeps &
  Pick<PruefDeps, "holen" | "verbinden"> & {
    jetzt: () => number;
    /**
     * Called while the copy runs and is healthy, before it is torn down: the agent test reads the
     * example app's entry through it (docs/plan.md, "Prüf-Restore auf dem Server"); unset on a server
     */
    waehrendKopie?: (k: { kopie: string; ziel: PruefZiel }) => Promise<void>;
  };

const fehler = (text: string): Ergebnis => ({ ok: false, fehler: text });

/** Between two health checks of the copy, five minutes long at most */
const HEALTH_WARTEN_MS = 2000;
const HEALTH_VERSUCHE = (PRUEF_RESTORE_HEALTH_S * 1000) / HEALTH_WARTEN_MS;

/** Tears down every copy left `angelegt` by a Prüf-Restore the agent did not finish */
export const resteAbbauen = async (
  deps: EinrichtungsDeps,
): Promise<{ ok: true; abgebaut: string[] } | { ok: false; grund: string }> => {
  const g = await deps.gedaechtnis.lesen();
  if (!g.ok) return g;
  const reste = [...g.stand]
    .filter(([name, e]) => PRUEF_RESTORE_KOPIE.test(name) && e.zustand === "angelegt")
    .map(([name]) => name);
  for (const name of reste) {
    const weg = await abbauen(deps, name, []);
    if (!weg.ok) return { ok: false, grund: `${name} nicht abgebaut: ${weg.grund}` };
    await deps.gedaechtnis.setzen(name, undefined);
  }
  return { ok: true, abgebaut: reste };
};

/** What must hold before anything is made: the original's, and the copy's name free */
const vorabPruefen = async (
  deps: PruefRestoreDeps,
  a: PruefRestore,
): Promise<string | undefined> => {
  const inst = await fertigeInstallation(deps, a.original);
  if (!inst.ok) return inst.grund.replace(/^abgelehnt: /, "");
  const passt = await installationVomManifest(deps, inst.n, inst.units, a.manifest);
  if (!passt.ok) return passt.grund;
  const q = await quelleLesen(deps.haus, inst.n, a.original);
  if (!q.ok) return q.grund;
  const g = await deps.gedaechtnis.lesen();
  if (!g.ok) return g.grund;
  if (g.stand.has(a.kopie.name)) return `${a.kopie.name} gibt es schon`;
  return (await fremd(deps, a.kopie.name))?.replace(/^abgelehnt: /, "");
};

/** The copy's health until it is no longer red, five minutes at most */
const healthAbwarten = async (
  deps: PruefRestoreDeps,
  e: Einrichten,
  n: Nutzer,
  auftrag: AbortSignal,
): Promise<Health> => {
  const frist = new AbortController();
  const aufheben = deps.planen(() => frist.abort(), PRUEF_RESTORE_HEALTH_S * 1000);
  try {
    let h = await healthPruefen(deps, e.ziel, e.name, n);
    for (let i = 1; h.zustand === "rot" && i < HEALTH_VERSUCHE; i++) {
      if (auftrag.aborted || frist.signal.aborted) break;
      await deps.warten(HEALTH_WARTEN_MS);
      h = await healthPruefen(deps, e.ziel, e.name, n);
    }
    return h;
  } finally {
    aufheben();
  }
};

type Lauf = { grund?: string; teile: TeilErgebnis[]; health?: Health };

/** Set up, played back, started and checked; the first step that fails ends it */
const kopieLaufen = async (
  deps: PruefRestoreDeps,
  a: PruefRestore,
  signal: AbortSignal,
): Promise<Lauf> => {
  const lauf = laeufer(deps, signal);
  const v = await vorbereiten(deps, a.kopie, lauf, signal);
  if (!v.ok) return { grund: `Kopie einrichten: ${v.grund}`, teile: teileVorher(a.teile) };
  const z = await zurueckspielen(
    deps,
    { quelle: a.original, ziel: a.kopie.name, teile: a.teile, netz: a.netz },
    signal,
  );
  if (!z.ok) return { grund: `Zurückspielen: ${z.grund ?? ""}`, teile: z.teile };
  const start = await unitsStarten(deps, lauf, v.nutzer, a.kopie.units, signal);
  if (!start.ok) return { grund: `Start der Kopie: ${start.grund}`, teile: z.teile };
  const health = await healthAbwarten(deps, a.kopie, v.nutzer, signal);
  if (health.zustand === "rot") return { grund: `Health: ${health.grund}`, teile: z.teile, health };
  await deps.waehrendKopie?.({ kopie: a.kopie.name, ziel: a.kopie.ziel });
  return { teile: z.teile, health };
};

/** A part as the Zentrale reads it (pruefRestoreDatenLesen): its snapshot, played back or why not */
const gemeldet = (t: TeilErgebnis): PruefRestoreTeil => ({
  tag: t.tag,
  snapshot: t.snapshot ?? null,
  zurueckgespielt: t.ergebnis === "zurueckgespielt",
  grund:
    t.ergebnis === "uebersprungen"
      ? "die Ausgabe eines Befehls ist ein Export, kein Restore"
      : (t.grund ?? null),
});

const durchfuehren = async (
  deps: PruefRestoreDeps,
  a: PruefRestore,
  zeitlimitMs: number,
): Promise<Ergebnis> => {
  const beginn = deps.jetzt();
  // recorded before useradd: a copy the agent made is always one its record names
  await deps.gedaechtnis.setzen(a.kopie.name, "angelegt");
  let l: Lauf;
  try {
    l = await mitZeitlimit(deps, zeitlimitMs, (signal) => kopieLaufen(deps, a, signal));
  } catch (e) {
    l = { grund: String(e).slice(0, 500), teile: teileVorher(a.teile) };
  }
  // always, with its own time limits: also after a failure or the job's time limit
  const weg = await abbauen(deps, a.kopie.name, a.kopie.units);
  if (weg.ok) await deps.gedaechtnis.setzen(a.kopie.name, undefined);
  const gruende = [
    ...(l.grund === undefined ? [] : [l.grund]),
    ...(weg.ok ? [] : [`Abbau unvollständig: ${weg.grund}`]),
  ];
  if (gruende.length > 0) return fehler(`Prüf-Restore gescheitert: ${gruende.join("; ")}`);
  const daten: PruefRestoreDaten = {
    teile: l.teile.map(gemeldet),
    dauerMs: Math.max(0, deps.jetzt() - beginn),
  };
  return { ok: true, daten };
};

export const pruefRestoreAusfuehren = async (
  deps: PruefRestoreDeps,
  plan: { auftrag: PruefRestore; zeitlimitMs: number },
): Promise<Ergebnis> => {
  try {
    const reste = await resteAbbauen(deps);
    if (!reste.ok) return fehler(`abgelehnt: Reste eines Prüf-Restores: ${reste.grund}`);
    const grund = await vorabPruefen(deps, plan.auftrag);
    if (grund !== undefined) return fehler(`abgelehnt: ${grund}`);
    return await durchfuehren(deps, plan.auftrag, plan.zeitlimitMs);
  } catch (e) {
    // the record could not be written: say so rather than leave the job running
    return fehler(`Prüf-Restore: ${String(e).slice(0, 500)}`);
  }
};
