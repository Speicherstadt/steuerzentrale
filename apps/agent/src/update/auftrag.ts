import {
  EINRICHTUNG_ZEITLIMIT_S,
  UPDATE_HEALTH_S,
  UPDATE_ZEITLIMIT_S,
  type UpdateAuftrag,
  type UpdateDaten,
} from "@steuerzentrale/manifest";
import { versionVergleichen } from "@steuerzentrale/planung";
import { installationsVersion } from "../aktionen/geheimnisse.ts";
import type { Ergebnis } from "../auftraege/ausfuehren.ts";
import { fertigeInstallation } from "../backup/auftrag.ts";
import { mitZeitlimit } from "../einrichtung/auftrag.ts";
import { imagesDerUnits, nacheinander, schritteAusfuehren } from "../einrichtung/einrichten.ts";
import { type Lauf, laeufer } from "../einrichtung/lauf.ts";
import { neustarten } from "../einrichtung/neustarten.ts";
import { alsNutzer, type Nutzer } from "../einrichtung/nutzer.ts";
import { gelungen, gescheitert, type Schritt } from "../einrichtung/typen.ts";
import { healthAbwarten } from "../pruef-restore/auftrag.ts";
import { quelleLesen } from "../pruef-restore/quelle.ts";
import type { WiederherstellenDeps } from "../wiederherstellen/auftrag.ts";
import { backupAnhalten, timerStarten } from "../wiederherstellen/daten.ts";
import type { PruefZiel } from "../zustand/ziel.ts";
import { type Vorher, zuruecknehmen } from "./ruecknahme.ts";
import { neuenStandSchreiben, standSichern } from "./stand.ts";

/*
 * Updating an installation on the agent (BAULISTE.md Z-503; docs/plan.md, "Update auf dem Server
 * (Z-503)"), after key, signature and updateAuftragPruefen (auftraege/pruefen.ts), only for an
 * installation this agent set up and finished, whose backup is set up here (its backup.json) and
 * whose units were all rendered from an older version of the job's app (their labels). As its
 * user, within the forward part of the job's time limit:
 * 1. the backup's timer stopped, refused while a backup runs; the old state kept (stand.ts); the
 *    new images pulled by digest; until here nothing of the app changed;
 * 2. the old units stopped, the new version's files and secrets written, `daemon-reload`;
 * 3. the new units restarted until they are active and stay active, the commands of
 *    `schritte.nach_update` run with `podman exec` (argv from the signed manifest), the health by
 *    the new manifest not red within UPDATE_HEALTH_S.
 * It holds: the record keeps the new units, health target and secret names, the timer starts again,
 * `{ ergebnis: "aktualisiert" }`. A step of 1 fails: the timer starts again and the job fails
 * ("nichts geändert"). A step of 2 or 3 fails, or the time runs out: rolled back (ruecknahme.ts),
 * with the data of the backup before once the new version ran (3), and reported as
 * `zurueckgenommen` with the reason, or `ruecknahme_unvollstaendig` when the old version does not
 * run as before. Both are successful results carrying UpdateDaten: the job did what it should, and
 * the Zentrale reads how it ended (updateDatenLesen). Run in the line of the setup jobs, and not
 * again after a restart of the agent (pruefen.ts); the transient unit and the timer a stop left
 * are set right when the agent starts (wiederherstellen/aufraeumen.ts). Never AutoUpdate: the
 * units are rendered without it (packages/manifest).
 */

export type Update = Omit<UpdateAuftrag, "schritte"> & {
  /** The commands of `schritte.nach_update`, filled from the signed manifest */
  schritte: Schritt[];
  /** The new version's health check and secret settings, kept once the update holds */
  ziel: PruefZiel;
  geheim: string[];
  /** App and version of the job's signed manifest */
  manifest: { id: string; version: string };
};

export type UpdateDeps = WiederherstellenDeps;

type Installation = { n: Nutzer; units: string[]; ziel: PruefZiel };

/** How far the forward part came: nothing changed, the old units stopped, the new version ran */
type Stufe = "nichts" | "units" | "daten";

/** The forward part's share of the job's time limit; the rest is the rollback's */
const VORWAERTS = (EINRICHTUNG_ZEITLIMIT_S + UPDATE_HEALTH_S) / UPDATE_ZEITLIMIT_S;

const fehler = (text: string): Ergebnis => ({ ok: false, fehler: text });

const vorabPruefen = async (
  deps: UpdateDeps,
  a: Update,
): Promise<{ ok: true; inst: Installation } | { ok: false; grund: string }> => {
  const inst = await fertigeInstallation(deps, a.name);
  if (!inst.ok) return { ok: false, grund: inst.grund.replace(/^abgelehnt: /, "") };
  const v = await installationsVersion(deps, inst.n, inst.units);
  if (!v.ok) return v;
  if (v.id !== a.manifest.id)
    return { ok: false, grund: `die Units sind aus ${v.id}, nicht aus ${a.manifest.id}` };
  if (versionVergleichen(v.version, a.manifest.version) >= 0)
    return {
      ok: false,
      grund: `${a.name} hat ${v.version}; ein Update führt nur zu einer neueren Version als ${a.manifest.version}`,
    };
  const q = await quelleLesen(deps.haus, inst.n, a.name);
  if (!q.ok) return q;
  // only a part the new version adds may lack a snapshot: each the backup knows is rolled back
  const ohne = q.datei.teile.filter(
    (t) =>
      t.art !== "befehl" &&
      a.teile.some((x) => x.tag === t.tag) &&
      a.snapshots[t.tag] === undefined,
  );
  if (ohne.length > 0)
    return { ok: false, grund: `kein Snapshot von ${ohne.map((t) => t.tag).join(", ")}` };
  return { ok: true, inst };
};

type Vorwaerts = { ok: true } | { ok: false; grund: string };

/** How far the forward part came, and the old state once it is kept; also when it throws */
type Fortschritt = { stufe: Stufe; vorher?: Vorher };

const pullen = (lauf: Lauf, n: Nutzer, a: Update) =>
  nacheinander(
    imagesDerUnits(a.quadlets.units).map(
      (image) => () => lauf(`podman pull ${image}`, alsNutzer(n, ["podman", "pull", image])),
    ),
  );

/** Steps 1 to 3, recording how far they came */
const vorwaerts = async (
  deps: UpdateDeps,
  a: Update,
  inst: Installation,
  f: Fortschritt,
  signal: AbortSignal,
): Promise<Vorwaerts> => {
  const lauf = laeufer(deps, signal);
  const { n } = inst;
  const angehalten = await backupAnhalten(deps, lauf, n, a.name, signal);
  if (!angehalten.ok) return angehalten;
  const g = await standSichern(deps, n, a.quadlets, signal);
  if (!g.ok) return g;
  f.vorher = { ...inst, alt: g.alt };
  const pull = await pullen(lauf, n, a);
  if (!pull.ok) return pull;
  f.stufe = "units";
  return nacheinander([
    () =>
      lauf("systemctl --user stop", alsNutzer(n, ["systemctl", "--user", "stop", ...inst.units])),
    () => neuenStandSchreiben(deps, lauf, n, a.quadlets, g),
    async () => {
      f.stufe = "daten";
      return neustarten(deps, lauf, n, a.units, signal);
    },
    () => schritteAusfuehren(lauf, n, a.name, a.schritte, "schritte.nach_update"),
    async () => {
      const h = await healthAbwarten(deps, a, n, signal, UPDATE_HEALTH_S);
      return h.zustand === "rot" ? gescheitert(`Health: ${h.grund}`) : gelungen;
    },
  ]);
};

const gemeldet = (daten: UpdateDaten): Ergebnis => ({ ok: true, daten });

/** The update failed: nothing to roll back, or rolled back to the old version */
const nachFehler = async (
  deps: UpdateDeps,
  a: Update,
  inst: Installation,
  v: Exclude<Vorwaerts, { ok: true }>,
  f: Fortschritt,
  t: { beginn: number; ende: number },
): Promise<Ergebnis> => {
  if (f.stufe === "nichts" || f.vorher === undefined) {
    const timer = await timerStarten(deps, inst.n);
    const zusatz = timer.ok ? "" : `; Backup-Timer nicht gestartet: ${timer.grund}`;
    return fehler(`Update gescheitert: ${v.grund}; nichts geändert${zusatz}`);
  }
  const r = await zuruecknehmen(deps, a, f.vorher, f.stufe === "daten", t.ende);
  const dauerMs = Math.max(0, deps.jetzt() - t.beginn);
  return r.ok
    ? gemeldet({ ergebnis: "zurueckgenommen", grund: v.grund, dauerMs })
    : gemeldet({
        ergebnis: "ruecknahme_unvollstaendig",
        grund: `${v.grund}; Rücknahme: ${r.grund}`,
        dauerMs,
      });
};

const durchfuehren = async (
  deps: UpdateDeps,
  a: Update,
  inst: Installation,
  zeitlimitMs: number,
): Promise<Ergebnis> => {
  const beginn = deps.jetzt();
  const f: Fortschritt = { stufe: "nichts" };
  let v: Vorwaerts;
  try {
    v = await mitZeitlimit(deps, Math.round(zeitlimitMs * VORWAERTS), (signal) =>
      vorwaerts(deps, a, inst, f, signal),
    );
  } catch (e) {
    v = { ok: false, grund: String(e).slice(0, 500) };
  }
  if (!v.ok) return nachFehler(deps, a, inst, v, f, { beginn, ende: beginn + zeitlimitMs });
  await deps.gedaechtnis.setzen(a.name, "fertig", { units: a.units, ziel: a.ziel }, a.geheim);
  // the version changed whatever the timer does; a missing backup shows in the checks (Z-702)
  await timerStarten(deps, inst.n);
  return gemeldet({ ergebnis: "aktualisiert", dauerMs: Math.max(0, deps.jetzt() - beginn) });
};

export const updateAusfuehren = async (
  deps: UpdateDeps,
  plan: { auftrag: Update; zeitlimitMs: number },
): Promise<Ergebnis> => {
  try {
    const v = await vorabPruefen(deps, plan.auftrag);
    if (!v.ok) return fehler(`abgelehnt: ${v.grund}`);
    return await durchfuehren(deps, plan.auftrag, v.inst, plan.zeitlimitMs);
  } catch (e) {
    // the record could not be written: say so rather than leave the job running
    return fehler(`Update: ${String(e).slice(0, 500)}`);
  }
};
