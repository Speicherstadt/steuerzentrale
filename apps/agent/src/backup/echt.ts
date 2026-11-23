import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gruppeBeiAbbruch } from "../auftraege/ausfuehren.ts";
import { PATH } from "../einrichtung/nutzer.ts";
import type { ResticLauf } from "./sichern.ts";

/*
 * restic for real, as the installation's user (BAULISTE.md Z-601): Bun's spawn without a shell,
 * each process in a session of its own whose group the signal kills (auftraege/ausfuehren.ts).
 * Password and S3 access reach restic as descriptors 3 and 4 (restic.ts) of files that are gone
 * before restic starts: each is written 0600 into a new folder of the user's runtime directory
 * (tmpfs, 0700), opened, and its folder removed, so the value is never in an argv, an environment
 * or a file anyone could open by name. (A named pipe on descriptor 3 made Bun's spawn hang in a
 * test with Bun 1.4.4; a regular file does not.) A source's standard output is restic's standard
 * input; what either writes to standard error is dropped. Killing `podman run` leaves its
 * container running under conmon (restic retries an unreachable S3 for 15 minutes), so each
 * container gets a name of its own, and an aborted run removes it.
 */

/** restic's summary is its last line; a long run prints a status line every few seconds */
const MAX_AUSGABE = 64 * 1024;

/** The value as a descriptor of a file that has no name any more; the caller closes it */
export const namenloseDatei = (wert: string, ordner: string): number => {
  const verzeichnis = mkdtempSync(join(ordner, "sz-sichern-"));
  try {
    const pfad = join(verzeichnis, "wert");
    writeFileSync(pfad, wert, { mode: 0o600, flag: "wx" });
    return openSync(pfad, "r");
  } finally {
    rmSync(verzeichnis, { recursive: true, force: true });
  }
};

/** The end of the output, read until it closes or the signal aborts */
const endeLesen = async (strom: ReadableStream<Uint8Array>, signal: AbortSignal) => {
  const leser = strom.getReader();
  const aufhoeren = () => {
    leser.cancel().catch(() => {});
  };
  signal.addEventListener("abort", aufhoeren, { once: true });
  const text = new TextDecoder();
  let aus = "";
  try {
    for (;;) {
      const { done, value } = await leser.read();
      if (done) return aus;
      aus = (aus + text.decode(value, { stream: true })).slice(-MAX_AUSGABE);
    }
  } catch {
    return aus;
  } finally {
    signal.removeEventListener("abort", aufhoeren);
  }
};

/** What a process of the user needs of its environment: rootless Podman reads HOME and XDG_RUNTIME_DIR */
const umgebung = (): Record<string, string> => {
  const u: Record<string, string> = { PATH, LC_ALL: "C" };
  for (const n of ["HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "USER"])
    if (process.env[n]) u[n] = process.env[n] ?? "";
  return u;
};

/** `podman run` with a name of its own, so an aborted run can remove its container */
export const benannt = (argv: readonly string[], name: string): string[] =>
  argv[0] === "podman" && argv[1] === "run"
    ? ["podman", "run", "--name", name, ...argv.slice(2)]
    : [...argv];

const entfernen = (name: string, env: Record<string, string>) =>
  Bun.spawn(["podman", "rm", "--force", "--time", "0", name], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    cwd: "/",
    env,
  }).exited.catch(() => {});

export const echtRestic =
  (ordner: string = process.env.XDG_RUNTIME_DIR ?? tmpdir()): ResticLauf =>
  async (a, geheim, signal) => {
    const env = umgebung();
    const name = `sz-sichern-${crypto.randomUUID().slice(0, 13)}`;
    const passwort = namenloseDatei(`${geheim.passwort}\n`, ordner);
    let zugang: number | undefined;
    let quelle: ReturnType<typeof Bun.spawn> | undefined;
    let restic: ReturnType<typeof Bun.spawn>;
    try {
      zugang = namenloseDatei(geheim.zugang, ordner);
      quelle =
        a.quelle &&
        Bun.spawn(a.quelle, {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
          cwd: "/",
          detached: true,
          env,
        });
      restic = Bun.spawn(benannt(a.argv, name), {
        stdio: [quelle?.stdout ?? "ignore", "pipe", "ignore", passwort, zugang],
        cwd: "/",
        detached: true,
        env,
      });
    } catch (fehler) {
      quelle?.kill("SIGKILL");
      throw fehler;
    } finally {
      closeSync(passwort);
      if (zugang !== undefined) closeSync(zugang);
    }
    const aufheben = [restic, ...(quelle ? [quelle] : [])].map((p) => gruppeBeiAbbruch(p, signal));
    try {
      const aus = await endeLesen(restic.stdout as ReadableStream<Uint8Array>, signal);
      const code = (await restic.exited) ?? null;
      if (signal.aborted) await entfernen(name, env);
      if (!quelle) return { code, aus };
      return { code, aus, quelleCode: (await quelle.exited) ?? null };
    } finally {
      for (const f of aufheben) f();
    }
  };
