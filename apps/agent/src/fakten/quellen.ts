import { promises as dns } from "node:dns";
import { access, readdir, readFile, stat, statfs } from "node:fs/promises";
import { connect } from "node:net";
import { machine, type NetworkInterfaceInfo, networkInterfaces } from "node:os";

/*
 * Where the agent reads its server's facts from (BAULISTE.md Z-304), passed in so every fact can be
 * tested without a real server. Only files (/proc, /sys, /etc, /boot), system calls and commands as
 * a fixed argv: never a shell, never a command line as a string (CLAUDE.md, "Never").
 */

export type Ausgabe = { code: number; aus: string };

/** Runs a fixed argv with a time limit; undefined when it cannot start (not installed) */
export type Ausfuehren = (
  argv: readonly string[],
  timeoutMs: number,
) => Promise<Ausgabe | undefined>;

/** Whether a TCP connection to host and port opened within the limit; null when the name failed */
export type Verbinden = (host: string, port: number, timeoutMs: number) => Promise<boolean | null>;

export type FaktenQuellen = {
  /** A file's text, undefined when it is missing or unreadable */
  lesen: (pfad: string) => Promise<string | undefined>;
  /** The names in a directory, undefined when it is missing or unreadable */
  liste: (ordner: string) => Promise<string[] | undefined>;
  gibtEs: (pfad: string) => Promise<boolean>;
  /** When a file was last changed, in milliseconds; undefined when it is missing */
  geaendertAm: (pfad: string) => Promise<number | undefined>;
  /** Size and space available to unprivileged users of a mounted file system, in MiB */
  platz: (mount: string) => Promise<{ gesamtMb: number; freiMb: number } | undefined>;
  ausfuehren: Ausfuehren;
  /** The machine as uname(2) names it (x86_64, aarch64) */
  maschine: () => string;
  schnittstellen: () => Record<string, NetworkInterfaceInfo[] | undefined>;
  /** The names of an address (PTR); undefined when the lookup failed or found none */
  rueckwaerts: (ip: string) => Promise<string[] | undefined>;
  verbinden: Verbinden;
};

const MIB = 1024 * 1024;

export const echtAusfuehren: Ausfuehren = async (argv, timeoutMs) => {
  try {
    const lauf = Bun.spawn([...argv], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      timeout: timeoutMs,
      // the C locale: the parsers read the untranslated output
      env: { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C" },
    });
    const aus = await new Response(lauf.stdout).text();
    return { code: await lauf.exited, aus };
  } catch {
    return undefined;
  }
};

const mitZeitlimit = <T>(versprechen: Promise<T>, ms: number, sonst: T): Promise<T> =>
  Promise.race([versprechen, new Promise<T>((fertig) => setTimeout(() => fertig(sonst), ms))]);

export const echtVerbinden: Verbinden = (host, port, timeoutMs) =>
  new Promise((fertig) => {
    const sockel = connect({ host, port, timeout: timeoutMs });
    const ende = (ergebnis: boolean | null) => {
      sockel.destroy();
      fertig(ergebnis);
    };
    sockel.once("connect", () => ende(true));
    sockel.once("timeout", () => ende(false));
    sockel.once("error", (fehler: NodeJS.ErrnoException) =>
      ende(fehler.code === "ENOTFOUND" || fehler.code === "EAI_AGAIN" ? null : false),
    );
  });

export const echteQuellen = (): FaktenQuellen => ({
  lesen: (pfad) => readFile(pfad, "utf8").catch(() => undefined),
  liste: (ordner) => readdir(ordner).catch(() => undefined),
  gibtEs: (pfad) =>
    access(pfad).then(
      () => true,
      () => false,
    ),
  geaendertAm: (pfad) =>
    stat(pfad).then(
      (s) => Math.floor(s.mtimeMs),
      () => undefined,
    ),
  platz: async (mount) => {
    try {
      const s = await statfs(mount);
      return {
        gesamtMb: Math.floor((s.blocks * s.bsize) / MIB),
        freiMb: Math.floor((s.bavail * s.bsize) / MIB),
      };
    } catch {
      return undefined;
    }
  },
  ausfuehren: echtAusfuehren,
  maschine: machine,
  schnittstellen: networkInterfaces,
  rueckwaerts: (ip) =>
    mitZeitlimit(
      dns.reverse(ip).then(
        (namen) => (namen.length > 0 ? namen : undefined),
        () => undefined,
      ),
      3000,
      undefined,
    ),
  verbinden: echtVerbinden,
});
