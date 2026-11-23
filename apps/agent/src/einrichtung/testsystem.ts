import type { ZeilenLesen } from "../aktionen/journal.ts";
import { MARKE, type Spawn, type SpawnOptionen } from "../auftraege/ausfuehren.ts";
import type { SpawnMitAusgabe } from "../zustand/pruefen.ts";
import type { Besitzer, HausDateien } from "./haus.ts";
import type { Nutzer } from "./nutzer.ts";

/*
 * A server in memory for the tests of setting up (Z-402): users, their homes and files, lingering,
 * Podman secrets and started units, driven by the argv the agent runs. Every argv is recorded with
 * the user it ran as (runuser's prefix taken off) and its standard input; a test makes a step fail
 * by its exit code. What the agent reads (`lesen`: `podman secret ls` and `inspect --showsecret`,
 * Z-404) is recorded alike, marked `gelesen`. Nothing here runs a process.
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
  /** Run by `lesen`, its standard output read */
  gelesen?: true;
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
  /** The standard output of a run by `lesen`, instead of the usual one */
  ausgabe?: (a: Aufgerufen) => string | undefined;
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

const secretsVon = (z: Zustand, als: string): Map<string, string> => {
  const s = z.secrets.get(als) ?? new Map<string, string>();
  z.secrets.set(als, s);
  return s;
};

const alsNutzer = (z: Zustand, a: Aufgerufen): number => {
  const [programm, x, y, ...rest] = a.argv;
  if (programm === "podman" && x === "secret" && y === "create") {
    const s = secretsVon(z, a.als);
    // Podman refuses a name that is taken
    if (s.has(rest[0] ?? "")) return 125;
    s.set(rest[0] ?? "", a.eingabe ?? "");
    return 0;
  }
  if (programm === "podman" && x === "secret" && y === "rm") {
    // --ignore: a missing secret is no error
    const ignorieren = rest[0] === "--ignore";
    const namen = ignorieren ? rest.slice(1) : rest;
    const weg = namen.map((n) => secretsVon(z, a.als).delete(n));
    return ignorieren || weg.every(Boolean) ? 0 : 1;
  }
  if (programm === "systemctl" && x === "--user") {
    const units = a.argv.slice(2).filter((w) => !w.startsWith("-") && w !== y);
    const laufend = z.aktiv.get(a.als) ?? new Set<string>();
    z.aktiv.set(a.als, laufend);
    if (y === "start" || y === "restart") for (const u of units) laufend.add(u);
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
    dateiLesen: async (pfad) => {
      const e = z.dateien.get(pfad);
      if (e !== undefined && e.art !== "datei") throw new Error(`${pfad} is not a regular file`);
      return e?.inhalt;
    },
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

/** `podman secret ls --format {{.Name}}` and `podman secret inspect --showsecret`, as Podman 4.9 */
const secretAusgabe = (z: Zustand, a: Aufgerufen): { code: number; aus: string } => {
  const [programm, x, y, ...rest] = a.argv;
  if (programm !== "podman" || x !== "secret") return { code: 127, aus: "" };
  const s = secretsVon(z, a.als);
  if (y === "ls") return { code: 0, aus: [...s.keys()].map((n) => `${n}\n`).join("") };
  if (y !== "inspect" || rest[0] !== "--showsecret") return { code: 125, aus: "" };
  const namen = rest.slice(1);
  if (!namen.every((n) => s.has(n))) return { code: 125, aus: "[]\n" };
  const berichte = namen.map((n) => ({
    ID: n,
    Spec: { Name: n, Driver: { Name: "file" } },
    SecretData: s.get(n),
  }));
  return { code: 0, aus: `${JSON.stringify(berichte, null, 4)}\n` };
};

/**
 * What a user reads besides Podman's secrets: a file of its own (`cat`, the backup's stand, Z-601)
 * and the answer of `steuerzentrale-agent sichern … --repository-anlegen`, a new repository
 */
const nutzerAusgabe = (z: Zustand, a: Aufgerufen): { code: number; aus: string } => {
  const n = z.nutzer.get(a.als);
  if (a.argv[0] === "cat") {
    const e = z.dateien.get(a.argv.at(-1) ?? "");
    return e?.art === "datei" && e.uid === n?.uid
      ? { code: 0, aus: e.inhalt ?? "" }
      : { code: 1, aus: "" };
  }
  if (a.argv[1] === "sichern")
    return { code: 0, aus: '{"msg":"repository","ok":true,"repository":"angelegt"}\n' };
  return secretAusgabe(z, a);
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
  const lesen: SpawnMitAusgabe = async (argv) => {
    const a: Aufgerufen = { ...ohnePraefix(argv), gelesen: true };
    z.laeufe.push(a);
    const code = o.scheitern?.(a);
    if (code !== undefined) return { code, aus: o.ausgabe?.(a) ?? "" };
    const r = a.als === "root" ? { code: 127, aus: "" } : nutzerAusgabe(z, a);
    return { code: r.code, aus: o.ausgabe?.(a) ?? r.aus };
  };
  // the journal by _UID=<uid>, as journalctl prints it (Z-405); handed over in two pieces
  const journal = new Map<string, string>();
  const zeilenLesen: ZeilenLesen = async (argv, signal, sammler) => {
    const a: Aufgerufen = { ...ohnePraefix(argv), gelesen: true };
    z.laeufe.push(a);
    if (o.haengt?.(a))
      return new Promise((fertig) =>
        signal.addEventListener("abort", () => fertig({ code: null })),
      );
    const code = o.scheitern?.(a);
    if (code !== undefined) return { code };
    if (a.argv[0] !== "journalctl") return { code: 127 };
    const uid = a.argv.find((w) => w.startsWith("_UID="))?.slice("_UID=".length) ?? "";
    const text = journal.get(uid) ?? "-- No entries --\n";
    const mitte = Math.floor(text.length / 2);
    sammler.hinzu(text.slice(0, mitte));
    sammler.hinzu(text.slice(mitte));
    return { code: 0 };
  };
  return {
    spawn,
    lesen,
    zeilenLesen,
    journal,
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
