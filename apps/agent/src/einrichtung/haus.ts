import { DATEIEN_VERZEICHNIS, type Quadlets } from "@steuerzentrale/manifest";

/*
 * What the agent writes into a user's home (docs/plan.md, "Einrichten auf dem Server"): the units
 * under ~/.config/containers/systemd/, the slice under ~/.config/systemd/user/ and the `dateien`
 * under DATEIEN_VERZEICHNIS, each owned by the user. The home itself is 0700, so no other user of
 * the server reads anything in it; units and folders are 0700/0600. A file of `dateien` is 0644: it
 * is mounted read-only into a container whose process runs under a subordinate id, not as the
 * owner, and must read it; the home around it keeps everyone else out. Pure: the plan only.
 */

export type Besitzer = { uid: number; gid: number };

/** The file system as root writes into a user's home, passed in so the logic is tested without one */
export type HausDateien = {
  lesen: (pfad: string) => Promise<string | undefined>;
  /**
   * Reads a regular file in a user's home, never through a symlink; undefined when it is missing,
   * throws when it is something else (Z-404: the old files before reconfiguring)
   */
  dateiLesen: (pfad: string) => Promise<string | undefined>;
  existiert: (pfad: string) => Promise<boolean>;
  /** Makes the folder if it is missing, then sets mode and owner; refuses a symlink */
  verzeichnis: (pfad: string, modus: number, besitzer: Besitzer) => Promise<void>;
  /**
   * Writes a new file, never through a symlink, with mode and owner and renames it into place, so
   * the file is complete or not there
   */
  schreiben: (pfad: string, inhalt: string, modus: number, besitzer: Besitzer) => Promise<void>;
};

export type HausPlan = {
  /** Parents before their children */
  verzeichnisse: { pfad: string; modus: number }[];
  dateien: { pfad: string; inhalt: string; modus: number }[];
};

export const UNITS = ".config/containers/systemd";
export const SYSTEMD_NUTZER = ".config/systemd/user";

const VERZEICHNIS = 0o700;
const UNIT = 0o600;
const DATEI = 0o644;

/** a/b/c → a, a/b, a/b/c; a relative path of names without "." or ".." */
const stufen = (relativ: string): string[] => {
  const teile = relativ.split("/");
  if (teile.some((t) => t === "" || t === "." || t === ".."))
    throw new Error(`not a plain relative path: ${relativ}`);
  return teile.map((_, i) => teile.slice(0, i + 1).join("/"));
};

const ordnerVon = (relativ: string): string => relativ.split("/").slice(0, -1).join("/");

/** The folders and files of an installation's home, rendered from its signed manifest */
export const hausPlan = (home: string, q: Quadlets): HausPlan => {
  const dateien: { relativ: string; inhalt: string; modus: number }[] = [
    ...Object.entries(q.units).map(([n, inhalt]) => ({
      relativ: `${UNITS}/${n}`,
      inhalt,
      modus: UNIT,
    })),
    ...Object.entries(q.systemd).map(([n, inhalt]) => ({
      relativ: `${SYSTEMD_NUTZER}/${n}`,
      inhalt,
      modus: UNIT,
    })),
    ...Object.entries(q.dateien).map(([n, inhalt]) => ({
      relativ: `${DATEIEN_VERZEICHNIS}/${n}`,
      inhalt,
      modus: DATEI,
    })),
  ];
  const ordner = [UNITS, SYSTEMD_NUTZER, ...dateien.map((d) => ordnerVon(d.relativ))];
  const verzeichnisse = [...new Set(ordner.flatMap(stufen))].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
  for (const d of dateien) stufen(d.relativ);
  return {
    verzeichnisse: verzeichnisse.map((v) => ({ pfad: `${home}/${v}`, modus: VERZEICHNIS })),
    dateien: dateien.map((d) => ({
      pfad: `${home}/${d.relativ}`,
      inhalt: d.inhalt,
      modus: d.modus,
    })),
  };
};

/** Writes the plan, folders first, everything owned by the user */
export const hausSchreiben = async (
  haus: HausDateien,
  plan: HausPlan,
  besitzer: Besitzer,
): Promise<void> => {
  for (const v of plan.verzeichnisse) await haus.verzeichnis(v.pfad, v.modus, besitzer);
  for (const d of plan.dateien) await haus.schreiben(d.pfad, d.inhalt, d.modus, besitzer);
};
