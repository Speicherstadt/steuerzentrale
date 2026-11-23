import { alleVersuchen, nacheinander } from "./einrichten.ts";
import type { Lauf } from "./lauf.ts";
import { alsNutzer, type Nutzer } from "./nutzer.ts";
import { gelungen, gescheitert, type Schrittergebnis, type SystemDeps } from "./typen.ts";

/*
 * The old state of an installation kept in memory before it changes, and brought back when the
 * change fails: reconfiguring (Z-404, konfigurieren.ts) and updating (Z-503, src/update). A file
 * the change writes either had a content, written back, or was not there, removed again; the
 * Podman secrets are replaced as a whole (`podman secret rm`, then `create` through the named pipe,
 * never in an argv). The values stay in memory: never in a file of the agent, a log or a result.
 */

/** A file as it was before: its content, or undefined when it was not there */
export type AlteDatei = { pfad: string; inhalt: string | undefined; modus: number };

export type AlterStand = { dateien: AlteDatei[]; secrets: ReadonlyMap<string, string> };

export const secretAnlegen = (lauf: Lauf, n: Nutzer, name: string, wert: string) => () =>
  lauf(`podman secret create ${name}`, alsNutzer(n, ["podman", "secret", "create", name, "-"]), {
    eingabe: wert,
  });

/** The old secrets removed, then the new ones created; the first failure ends it */
export const secretsErsetzen = (
  lauf: Lauf,
  n: Nutzer,
  alt: Iterable<string>,
  neu: Readonly<Record<string, string>>,
): Promise<Schrittergebnis> =>
  nacheinander([
    ...[...alt].map(
      (name) => () =>
        lauf(`podman secret rm ${name}`, alsNutzer(n, ["podman", "secret", "rm", name])),
    ),
    ...Object.entries(neu).map(([name, wert]) => secretAnlegen(lauf, n, name, wert)),
  ]);

const dateiZurueck = async (
  deps: Pick<SystemDeps, "haus">,
  n: Nutzer,
  d: AlteDatei,
): Promise<Schrittergebnis> => {
  try {
    if (d.inhalt === undefined) await deps.haus.entfernen(d.pfad);
    else await deps.haus.schreiben(d.pfad, d.inhalt, d.modus, n);
    return gelungen;
  } catch (fehler) {
    return gescheitert(String(fehler).slice(0, 500));
  }
};

/**
 * The old files and secrets back, each step also when one before failed; `neueSecrets` are the
 * names the change may have created. No daemon-reload, no restart: the caller's
 */
export const standZurueck = (
  deps: Pick<SystemDeps, "haus">,
  lauf: Lauf,
  n: Nutzer,
  alt: AlterStand,
  neueSecrets: readonly string[],
): Promise<Schrittergebnis> => {
  const namen = [...new Set([...alt.secrets.keys(), ...neueSecrets])];
  const weg = () =>
    namen.length === 0
      ? Promise.resolve(gelungen)
      : lauf(
          "podman secret rm --ignore",
          alsNutzer(n, ["podman", "secret", "rm", "--ignore", ...namen]),
        );
  return alleVersuchen([
    ...alt.dateien.map((d) => () => dateiZurueck(deps, n, d)),
    weg,
    ...[...alt.secrets].map(([name, wert]) => secretAnlegen(lauf, n, name, wert)),
  ]);
};
