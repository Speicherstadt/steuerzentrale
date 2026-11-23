import { QUADLET_LABEL, systemdWortLesen, unitLesen } from "@steuerzentrale/manifest";
import type { InstallationsEintrag } from "../einrichtung/gedaechtnis.ts";
import { UNITS } from "../einrichtung/haus.ts";
import type { Nutzer } from "../einrichtung/nutzer.ts";
import { secretsLesen } from "../einrichtung/secrets.ts";
import type { SystemDeps } from "../einrichtung/typen.ts";

/*
 * The values a log excerpt replaces (BAULISTE.md Z-405; docs/plan.md, "Log-Auszug"): the values of
 * the installation's Podman secrets, read back as before reconfiguring (secrets.ts), and the
 * values of its settings of typ `geheim` or ebene `auto` that stand as Environment= in its units.
 * The names of those settings come from the record (gedaechtnis.ts), kept at setup and
 * reconfiguring; the values are read from the units each time, never kept. A unit is read as
 * before reconfiguring: its folders checked first (no symlink), the file without following one.
 *
 * An entry from before Z-405 has no names. They are taken from the signed manifest of the job
 * (geheimeEinstellungen) only when every unit names that manifest's app and version in its labels:
 * then the units were rendered from exactly this manifest, and its names are the ones setup would
 * have kept. Otherwise the excerpt is refused. The values never appear in a reason.
 */

export type GeheimDeps = Pick<SystemDeps, "haus" | "lesen">;

/** What the job's signed manifest says, for an entry from before Z-405 */
export type ManifestAngaben = { id: string; version: string; geheim: readonly string[] };

export type WerteGelesen = { ok: true; werte: string[] } | { ok: false; grund: string };

type UnitAngaben = { umgebung: Map<string, string>; labels: Map<string, string> };

/** NAME=value of the words Environment= and Label= of a unit's [Container], as written */
const paare = (text: string, schluessel: string): Map<string, string> => {
  const werte = new Map<string, string>();
  for (const a of unitLesen(text).filter((x) => x.name === "Container"))
    for (const [k, w] of a.zeilen) {
      const wort = k === schluessel ? systemdWortLesen(w) : null;
      const gleich = wort?.indexOf("=") ?? -1;
      if (wort && gleich > 0) werte.set(wort.slice(0, gleich), wort.slice(gleich + 1));
    }
  return werte;
};

export const unitAngaben = (text: string): UnitAngaben => ({
  umgebung: paare(text, "Environment"),
  labels: paare(text, "Label"),
});

/** ~/.config/containers/systemd/<name>.container of each service, folders checked first */
const unitsLesen = async (
  deps: GeheimDeps,
  n: Nutzer,
  units: readonly string[],
): Promise<{ ok: true; units: UnitAngaben[] } | { ok: false; grund: string }> => {
  const teile = UNITS.split("/");
  for (let i = 1; i <= teile.length; i++)
    await deps.haus.verzeichnis(`${n.home}/${teile.slice(0, i).join("/")}`, 0o700, n);
  const gelesen: UnitAngaben[] = [];
  for (const unit of units) {
    const pfad = `${n.home}/${UNITS}/${unit.replace(/\.service$/, ".container")}`;
    const text = await deps.haus.dateiLesen(pfad);
    if (text === undefined) return { ok: false, grund: `${pfad} fehlt` };
    gelesen.push(unitAngaben(text));
  }
  return { ok: true, units: gelesen };
};

/** Every unit names the manifest's app and version in its labels: it was rendered from it */
const vonDiesemManifest = (units: readonly UnitAngaben[], m: ManifestAngaben): boolean =>
  units.length > 0 &&
  units.every(
    (u) =>
      u.labels.get(`${QUADLET_LABEL}.app`) === m.id &&
      u.labels.get(`${QUADLET_LABEL}.version`) === m.version,
  );

const nichtVon = (m: ManifestAngaben) =>
  `die Units sind nicht aus ${m.id} ${m.version}, dem Manifest des Auftrags`;

/**
 * Whether the installation runs the app and version of the job's manifest (review of Z-405): only
 * then does that manifest's `aktionen` say what the installation offers; another signed manifest
 * must not lend it an action its own does not offer
 */
export const installationVomManifest = async (
  deps: GeheimDeps,
  n: Nutzer,
  units: readonly string[],
  m: ManifestAngaben,
): Promise<{ ok: true } | { ok: false; grund: string }> => {
  let gelesen: Awaited<ReturnType<typeof unitsLesen>>;
  try {
    gelesen = await unitsLesen(deps, n, units);
  } catch (fehler) {
    return { ok: false, grund: String(fehler).slice(0, 500) };
  }
  if (!gelesen.ok) return gelesen;
  return vonDiesemManifest(gelesen.units, m) ? { ok: true } : { ok: false, grund: nichtVon(m) };
};

/** The names from the record, or from the manifest the units were rendered from */
const namenVon = (
  eintrag: InstallationsEintrag,
  units: readonly UnitAngaben[],
  m: ManifestAngaben,
): readonly string[] | undefined => {
  if (eintrag.geheim) return eintrag.geheim;
  return vonDiesemManifest(units, m) ? m.geheim : undefined;
};

export const geheimeWerte = async (
  deps: GeheimDeps,
  n: Nutzer,
  eintrag: InstallationsEintrag,
  units: readonly string[],
  m: ManifestAngaben,
  signal: AbortSignal,
): Promise<WerteGelesen> => {
  let gelesen: Awaited<ReturnType<typeof unitsLesen>>;
  try {
    gelesen = await unitsLesen(deps, n, units);
  } catch (fehler) {
    return { ok: false, grund: String(fehler).slice(0, 500) };
  }
  if (!gelesen.ok) return gelesen;
  const namen = namenVon(eintrag, gelesen.units, m);
  if (namen === undefined)
    return {
      ok: false,
      grund:
        "das Gedächtnis kennt die geheimen Einstellungen nicht (vor Z-405), und die Units sind nicht aus dem Manifest des Auftrags",
    };
  if (!vonDiesemManifest(gelesen.units, m)) return { ok: false, grund: nichtVon(m) };
  const secrets = await secretsLesen(deps.lesen, n, signal);
  if (!secrets.ok) return { ok: false, grund: `die Secrets sind nicht lesbar (${secrets.grund})` };
  const umgebung = gelesen.units.flatMap((u) =>
    namen.flatMap((name) => {
      const wert = u.umgebung.get(name);
      return wert === undefined ? [] : [wert];
    }),
  );
  return { ok: true, werte: [...secrets.werte.values(), ...umgebung] };
};
