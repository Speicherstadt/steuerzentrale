import { nacheinander } from "./einrichten.ts";
import { type HausPlan, hausPlan, hausSchreiben } from "./haus.ts";
import { type Lauf, laeufer } from "./lauf.ts";
import { neustarten } from "./neustarten.ts";
import { alsNutzer, type Nutzer } from "./nutzer.ts";
import { secretsLesen } from "./secrets.ts";
import {
  gelungen,
  gescheitert,
  type Konfigurieren,
  type Schrittergebnis,
  type SystemDeps,
} from "./typen.ts";

/*
 * Reconfiguring an installation on its server (BAULISTE.md Z-404; docs/plan.md, "Neu
 * konfigurieren"), for one this agent set up and finished (auftrag.ts checks that and its units):
 * 1. keep the old state: the content of every unit, the slice and every file of `dateien` (each a
 *    regular file, read without following a symlink; a missing one means the files would change,
 *    which reconfiguring does not), and the values of the Podman secrets (secrets.ts), in memory;
 * 2. write the new units, slice and files, replace each secret (`podman secret rm`, then `create`
 *    through the named pipe), `daemon-reload`, `restart` of the units, wait until they are active
 *    and stay active for a while (Quadlet's units restart always: an app that fails at its start is
 *    active for a moment, then restarts until systemd's start limit makes it fail);
 * 3. if a step fails, bring the old state back the same way and restart it, each step with its own
 *    time limit (not the job's, which may have run out), going on when one fails.
 * Volumes and data are never touched; no image is pulled; `schritte.einrichten` do not run.
 */

const SCHRITT_MS = 60_000;

type AlterStand = { dateien: HausPlan["dateien"]; secrets: ReadonlyMap<string, string> };

export type Konfiguriert = { ok: true } | { ok: false; fehler: string };

const nein = (fehler: string): Konfiguriert => ({ ok: false, fehler });

/** The old content of the files the new state writes; the folders checked first (no symlink) */
const dateienSichern = async (
  deps: SystemDeps,
  plan: HausPlan,
  n: Nutzer,
): Promise<{ ok: true; dateien: HausPlan["dateien"] } | { ok: false; fehlt: string }> => {
  for (const v of plan.verzeichnisse) await deps.haus.verzeichnis(v.pfad, v.modus, n);
  const dateien: HausPlan["dateien"] = [];
  for (const d of plan.dateien) {
    const inhalt = await deps.haus.dateiLesen(d.pfad);
    if (inhalt === undefined) return { ok: false, fehlt: d.pfad };
    dateien.push({ ...d, inhalt });
  }
  return { ok: true, dateien };
};

/** daemon-reload, then reset-failed, restart and staying active (neustarten.ts) */
const neuLadenUndStarten = (
  deps: SystemDeps,
  lauf: Lauf,
  n: Nutzer,
  units: readonly string[],
  auftrag?: AbortSignal,
): Promise<Schrittergebnis> =>
  nacheinander([
    () =>
      lauf(
        "systemctl --user daemon-reload",
        alsNutzer(n, ["systemctl", "--user", "daemon-reload"]),
      ),
    () => neustarten(deps, lauf, n, units, auftrag),
  ]);

const secretAnlegen = (lauf: Lauf, n: Nutzer, name: string, wert: string) => () =>
  lauf(`podman secret create ${name}`, alsNutzer(n, ["podman", "secret", "create", name, "-"]), {
    eingabe: wert,
  });

const anwenden = async (
  deps: SystemDeps,
  a: Konfigurieren,
  n: Nutzer,
  alt: AlterStand,
  auftrag: AbortSignal,
): Promise<Schrittergebnis> => {
  const lauf = laeufer(deps, auftrag);
  try {
    await hausSchreiben(deps.haus, hausPlan(n.home, a.quadlets), n);
  } catch (fehler) {
    return gescheitert(String(fehler).slice(0, 500));
  }
  return nacheinander([
    ...[...alt.secrets.keys()].map(
      (name) => () =>
        lauf(`podman secret rm ${name}`, alsNutzer(n, ["podman", "secret", "rm", name])),
    ),
    ...Object.entries(a.quadlets.secrets).map(([name, wert]) => secretAnlegen(lauf, n, name, wert)),
    () => neuLadenUndStarten(deps, lauf, n, a.units, auftrag),
  ]);
};

/** Each step runs even when one before failed; the first failure is the answer */
const alleVersuchen = async (
  laeufe: (() => Promise<Schrittergebnis>)[],
): Promise<Schrittergebnis> => {
  let erster: Schrittergebnis = gelungen;
  for (const l of laeufe) {
    const r = await l();
    if (!r.ok && erster.ok) erster = r;
  }
  return erster;
};

const wiederherstellen = async (
  deps: SystemDeps,
  a: Konfigurieren,
  n: Nutzer,
  alt: AlterStand,
): Promise<Schrittergebnis> => {
  const lauf: Lauf = (schritt, argv, o = {}) =>
    laeufer(deps)(schritt, argv, { zeitlimitMs: SCHRITT_MS, ...o });
  const dateien = alt.dateien.map((d) => async () => {
    try {
      await deps.haus.schreiben(d.pfad, d.inhalt, d.modus, n);
      return gelungen;
    } catch (fehler) {
      return gescheitert(String(fehler).slice(0, 500));
    }
  });
  const namen = [...new Set([...alt.secrets.keys(), ...Object.keys(a.quadlets.secrets)])];
  const weg = () =>
    namen.length === 0
      ? Promise.resolve(gelungen)
      : lauf(
          "podman secret rm --ignore",
          alsNutzer(n, ["podman", "secret", "rm", "--ignore", ...namen]),
        );
  const secrets = [...alt.secrets].map(([name, wert]) => secretAnlegen(lauf, n, name, wert));
  const gesetzt = await alleVersuchen([...dateien, weg, ...secrets]);
  // started again even when something could not be brought back: as much of the app as can run
  const gestartet = await neuLadenUndStarten(deps, lauf, n, a.units);
  return gesetzt.ok ? gestartet : gesetzt;
};

export const konfigurieren = async (
  deps: SystemDeps,
  a: Konfigurieren,
  n: Nutzer,
  auftrag: AbortSignal,
): Promise<Konfiguriert> => {
  let dateien: Awaited<ReturnType<typeof dateienSichern>>;
  try {
    dateien = await dateienSichern(deps, hausPlan(n.home, a.quadlets), n);
  } catch (fehler) {
    return nein(`abgelehnt: ${String(fehler).slice(0, 500)}`);
  }
  if (!dateien.ok)
    return nein(
      `abgelehnt: ${dateien.fehlt} fehlt; neu konfigurieren ändert nicht, welche Dateien die Installation hat`,
    );
  const secrets = await secretsLesen(deps.lesen, n, auftrag);
  if (!secrets.ok)
    return nein(
      `Neu konfigurieren gescheitert: die alten Secrets sind nicht lesbar (${secrets.grund}); nichts geändert`,
    );
  const alt: AlterStand = { dateien: dateien.dateien, secrets: secrets.werte };
  const r = await anwenden(deps, a, n, alt, auftrag);
  if (r.ok) return { ok: true };
  const zurueck = await wiederherstellen(deps, a, n, alt);
  return nein(
    `Neu konfigurieren gescheitert: ${r.grund}; ${
      zurueck.ok
        ? "alter Stand wiederhergestellt"
        : `Wiederherstellung unvollständig: ${zurueck.grund}`
    }`,
  );
};
