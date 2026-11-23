import type { Quadlets } from "@steuerzentrale/manifest";
import { nacheinander } from "../einrichtung/einrichten.ts";
import { type HausPlan, hausPlan, hausSchreiben, UNIT_MODUS, UNITS } from "../einrichtung/haus.ts";
import type { Lauf } from "../einrichtung/lauf.ts";
import { alsNutzer, type Nutzer } from "../einrichtung/nutzer.ts";
import { secretsLesen } from "../einrichtung/secrets.ts";
import { type AlteDatei, type AlterStand, secretsErsetzen } from "../einrichtung/stand.ts";
import { gescheitert, type Schrittergebnis, type SystemDeps } from "../einrichtung/typen.ts";

/*
 * The old version's files before an update and the new version's written (BAULISTE.md Z-503;
 * docs/plan.md, "Update auf dem Server (Z-503)"), as reconfiguring keeps them (Z-404,
 * einrichtung/stand.ts), with one difference: a new version may add or drop a container, a volume
 * or a file. So the agent keeps, in memory, every file in ~/.config/containers/systemd/ (each a
 * regular file, read without following a symlink; the folders checked first) and every file the
 * new version writes, as its content or as missing, and the values of the Podman secrets. The new
 * version's files are written, the units of the old one it no longer has removed (else Quadlet
 * would still make their services), the secrets replaced, then `daemon-reload`. Bringing the old
 * state back writes each kept file again and removes each that was missing (einrichtung/stand.ts).
 * A file of `dateien` the new version no longer names stays: no unit mounts it any more.
 */

export type Gesichert =
  | { ok: true; alt: AlterStand; entfallen: string[] }
  | { ok: false; grund: string };

/** The old state; `entfallen` are the old units the new version does not have */
export const standSichern = async (
  deps: Pick<SystemDeps, "haus" | "lesen">,
  n: Nutzer,
  quadlets: Quadlets,
  signal: AbortSignal,
): Promise<Gesichert> => {
  const plan: HausPlan = hausPlan(n.home, quadlets);
  let dateien: AlteDatei[];
  let entfallen: string[];
  try {
    for (const v of plan.verzeichnisse) await deps.haus.verzeichnis(v.pfad, v.modus, n);
    const ordner = `${n.home}/${UNITS}`;
    const neu = new Map(plan.dateien.map((d) => [d.pfad, d.modus]));
    const units = (await deps.haus.dateienIn(ordner)).map((name) => `${ordner}/${name}`);
    entfallen = units.filter((pfad) => !neu.has(pfad));
    const pfade = [...new Set([...units, ...neu.keys()])];
    dateien = [];
    for (const pfad of pfade)
      dateien.push({
        pfad,
        inhalt: await deps.haus.dateiLesen(pfad),
        modus: neu.get(pfad) ?? UNIT_MODUS,
      });
  } catch (fehler) {
    return { ok: false, grund: String(fehler).slice(0, 500) };
  }
  const secrets = await secretsLesen(deps.lesen, n, signal);
  if (!secrets.ok)
    return { ok: false, grund: `die alten Secrets sind nicht lesbar (${secrets.grund})` };
  return { ok: true, alt: { dateien, secrets: secrets.werte }, entfallen };
};

/** The new version's files written, the old units it drops removed, the secrets replaced, reloaded */
export const neuenStandSchreiben = async (
  deps: Pick<SystemDeps, "haus">,
  lauf: Lauf,
  n: Nutzer,
  quadlets: Quadlets,
  g: { alt: AlterStand; entfallen: readonly string[] },
): Promise<Schrittergebnis> => {
  try {
    await hausSchreiben(deps.haus, hausPlan(n.home, quadlets), n);
    for (const pfad of g.entfallen) await deps.haus.entfernen(pfad);
  } catch (fehler) {
    return gescheitert(String(fehler).slice(0, 500));
  }
  return nacheinander([
    () => secretsErsetzen(lauf, n, g.alt.secrets.keys(), quadlets.secrets),
    () => neuLaden(lauf, n),
  ]);
};

export const neuLaden = (lauf: Lauf, n: Nutzer) =>
  lauf("systemctl --user daemon-reload", alsNutzer(n, ["systemctl", "--user", "daemon-reload"]));
