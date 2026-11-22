import { MARKE, type Spawn, type SpawnOptionen } from "../auftraege/ausfuehren.ts";
import type { Besitzer, HausDateien } from "./haus.ts";
import type { Nutzer } from "./nutzer.ts";

/*
 * A server in memory for the tests of setting up (Z-402): users, their homes and files, lingering,
 * Podman secrets and started units, driven by the argv the agent runs. Every argv is recorded with
 * the user it ran as (runuser's prefix taken off) and its standard input; a test makes a step fail
 * by its exit code. Nothing here runs a process.
 */

export type Eintrag = { art: "verzeichnis" | "datei"; inhalt?: string; modus: number } & Besitzer;

export type Aufgerufen = {
  /** "root", or the user runuser ran it as */
  als: string;
  argv: string[];
  /** The environment `env -i` set, for a run as a user */
  umgebung: string[];
  eingabe?: string;
  /** The mark spawn was given; its `--env` is taken off `podman exec`'s argv when it matches */
  marke?: string;
};

export type TestSystemOptionen = {
  /** Users already there, as install.sh or someone else made them */
  nutzer?: Nutzer[];
  /** The exit code of a run, or undefined for the usual answer */
  scheitern?: (a: Aufgerufen) => number | undefined;
  /** A run that only ends when it is killed */
  haengt?: (a: Aufgerufen) => boolean;
  /** Writing this file throws */
  schreibenScheitert?: (pfad: string) => boolean;
  /** systemd's user manager never comes up after lingering */
  ohneBus?: boolean;
  /** useradd gives no subordinate ids (no /etc/subuid entry) */
  ohneSubuid?: boolean;
};

const SUB = ["/etc/subuid", "/etc/subgid"];

/** `podman exec --env STEUERZENTRALE_LAUF=<marke> …` without the mark, if it is spawn's */
const ohneMarke = (argv: string[], marke?: string): string[] =>
  marke !== undefined &&
  argv[0] === "podman" &&
  argv[1] === "exec" &&
  argv[2] === "--env" &&
  argv[3] === `${MARKE}=${marke}`
    ? ["podman", "exec", ...argv.slice(4)]
    : argv;

const ohnePraefix = (argv: readonly string[], o: SpawnOptionen = {}): Aufgerufen => {
  const mit = {
    ...(o.eingabe === undefined ? {} : { eingabe: o.eingabe }),
    ...(o.marke === undefined ? {} : { marke: o.marke }),
  };
  if (argv[0] !== "runuser") return { als: "root", argv: [...argv], umgebung: [], ...mit };
  const env = argv.indexOf("env");
  let i = env + 2;
  while (argv[i]?.includes("=")) i++;
  return {
    als: argv[2] ?? "",
    argv: ohneMarke(argv.slice(i), o.marke),
    umgebung: argv.slice(env + 2, i),
    ...mit,
  };
};

const ordnerVon = (pfad: string) => pfad.slice(0, pfad.lastIndexOf("/")) || "/";

/** Changes the lines of /etc/subuid and /etc/subgid alike */
const subIds = (
  z: { dateien: Map<string, Eintrag> },
  aendern: (zeilen: string[]) => string[],
): void => {
  for (const datei of SUB) {
    const zeilen = (z.dateien.get(datei)?.inhalt ?? "").split("\n").filter(Boolean);
    const inhalt = `${aendern(zeilen).join("\n")}\n`;
    z.dateien.set(datei, { art: "datei", inhalt, modus: 0o644, uid: 0, gid: 0 });
  }
};

/** The server's state: users, files, lingering, secrets and running units by user */
const zustandAnlegen = (vorher: Nutzer[]) => {
  const z = {
    nutzer: new Map<string, Nutzer>(vorher.map((n) => [n.name, n])),
    dateien: new Map<string, Eintrag>([
      ["/home", { art: "verzeichnis", modus: 0o755, uid: 0, gid: 0 }],
    ]),
    laeufe: [] as Aufgerufen[],
    linger: new Set<string>(),
    secrets: new Map<string, Map<string, string>>(),
    aktiv: new Map<string, Set<string>>(),
    naechsteUid: 2000,
  };
  subIds(z, (zeilen) => zeilen);
  for (const n of vorher) {
    z.dateien.set(n.home, { art: "verzeichnis", modus: 0o700, uid: n.uid, gid: n.gid });
    subIds(z, (zeilen) => [...zeilen, `${n.name}:${n.uid * 100_000}:65536`]);
  }
  return z;
};

type Zustand = ReturnType<typeof zustandAnlegen>;

const loeschen = (z: Zustand, wurzel: string) => {
  for (const pfad of [...z.dateien.keys()])
    if (pfad === wurzel || pfad.startsWith(`${wurzel}/`)) z.dateien.delete(pfad);
};

const useradd = (z: Zustand, o: TestSystemOptionen, rest: string[], name: string): number => {
  if (z.nutzer.has(name)) return 9;
  const home = rest[rest.indexOf("--home-dir") + 1] ?? `/home/${name}`;
  const neu = { name, uid: z.naechsteUid, gid: z.naechsteUid, home };
  z.naechsteUid++;
  z.nutzer.set(name, neu);
  // useradd's own mode, which the agent narrows
  z.dateien.set(home, { art: "verzeichnis", modus: 0o755, uid: neu.uid, gid: neu.gid });
  if (!o.ohneSubuid) subIds(z, (zeilen) => [...zeilen, `${name}:${neu.uid * 100_000}:65536`]);
  return 0;
};

const loginctl = (z: Zustand, o: TestSystemOptionen, was: string, n: Nutzer): number => {
  if (was === "enable-linger") {
    z.linger.add(n.name);
    const bus = { art: "datei" as const, modus: 0o666, uid: n.uid, gid: n.gid };
    if (!o.ohneBus) z.dateien.set(`/run/user/${n.uid}/bus`, bus);
    return 0;
  }
  if (was === "disable-linger") return z.linger.delete(n.name) ? 0 : 1;
  loeschen(z, `/run/user/${n.uid}`);
  z.aktiv.delete(n.name);
  return 0;
};

const alsRoot = (z: Zustand, o: TestSystemOptionen, argv: string[]): number => {
  const [programm, ...rest] = argv;
  const name = rest.at(-1) ?? "";
  const n = z.nutzer.get(name);
  if (programm === "useradd") return useradd(z, o, rest, name);
  if (programm === "rm") {
    loeschen(z, name);
    return 0;
  }
  if (!n) return programm === "userdel" ? 6 : 1;
  if (programm === "loginctl") return loginctl(z, o, rest[0] ?? "", n);
  if (programm !== "userdel") return 127;
  z.nutzer.delete(name);
  z.secrets.delete(name);
  subIds(z, (zeilen) => zeilen.filter((zeile) => !zeile.startsWith(`${name}:`)));
  loeschen(z, n.home);
  return 0;
};

const alsNutzer = (z: Zustand, a: Aufgerufen): number => {
  const [programm, x, y, ...rest] = a.argv;
  if (programm === "podman" && x === "secret" && y === "create") {
    const s = z.secrets.get(a.als) ?? new Map<string, string>();
    s.set(rest[0] ?? "", a.eingabe ?? "");
    z.secrets.set(a.als, s);
    return 0;
  }
  if (programm === "systemctl" && x === "--user") {
    const units = a.argv.slice(2).filter((w) => !w.startsWith("-") && w !== y);
    const laufend = z.aktiv.get(a.als) ?? new Set<string>();
    z.aktiv.set(a.als, laufend);
    if (y === "start") for (const u of units) laufend.add(u);
    if (y === "stop") for (const u of units) laufend.delete(u);
    if (y === "is-active") return units.every((u) => laufend.has(u)) ? 0 : 3;
    return 0;
  }
  return programm === "podman" ? 0 : 127;
};

const hausIn = (z: Zustand, o: TestSystemOptionen): HausDateien => {
  const elternDa = (pfad: string) => {
    if (z.dateien.get(ordnerVon(pfad))?.art !== "verzeichnis")
      throw new Error(`ENOENT: ${ordnerVon(pfad)}`);
  };
  return {
    lesen: async (pfad) => z.dateien.get(pfad)?.inhalt,
    existiert: async (pfad) => z.dateien.has(pfad),
    verzeichnis: async (pfad, modus, { uid, gid }) => {
      if (z.dateien.get(pfad)?.art === "datei") throw new Error(`${pfad} is not a folder`);
      elternDa(pfad);
      z.dateien.set(pfad, { art: "verzeichnis", modus, uid, gid });
    },
    schreiben: async (pfad, inhalt, modus, { uid, gid }) => {
      if (o.schreibenScheitert?.(pfad)) throw new Error(`EIO: ${pfad}`);
      elternDa(pfad);
      z.dateien.set(pfad, { art: "datei", inhalt, modus, uid, gid });
    },
  };
};

export const testSystem = (o: TestSystemOptionen = {}) => {
  const z = zustandAnlegen(o.nutzer ?? []);
  const spawn: Spawn = (argv, signal, mit) => {
    const a = ohnePraefix(argv, mit);
    z.laeufe.push(a);
    if (o.haengt?.(a))
      return new Promise((fertig) =>
        signal.addEventListener("abort", () => fertig({ code: null })),
      );
    const code = o.scheitern?.(a) ?? (a.als === "root" ? alsRoot(z, o, a.argv) : alsNutzer(z, a));
    return Promise.resolve({ code });
  };
  return {
    spawn,
    haus: hausIn(z, o),
    nutzerLesen: async (name: string) => z.nutzer.get(name),
    nutzer: z.nutzer,
    dateien: z.dateien,
    laeufe: z.laeufe,
    linger: z.linger,
    secrets: z.secrets,
    aktiv: z.aktiv,
    /** The paths under a folder */
    unter: (wurzel: string) => [...z.dateien.keys()].filter((p) => p.startsWith(`${wurzel}/`)),
  };
};

export type TestSystem = ReturnType<typeof testSystem>;

/** The user install.sh makes for the Pforte */
export const PFORTE: Nutzer = { name: "sz-pforte", uid: 1500, gid: 1500, home: "/home/sz-pforte" };
