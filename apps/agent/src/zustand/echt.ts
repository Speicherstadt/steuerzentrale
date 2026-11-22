import { createConnection } from "node:net";
import { PATH } from "../einrichtung/nutzer.ts";
import type { SpawnMitAusgabe, Verbinden } from "./pruefen.ts";

/*
 * The real parts of the checks (Z-403): a fixed argv whose standard output is read (only for
 * `systemctl show`; never for a command of the manifest, whose output is dropped), and a TCP
 * connection that is closed as soon as it is open.
 */

/** systemctl show for a few units is far below this; more is cut off, never waited for */
const MAX_AUSGABE = 64 * 1024;

const ausgabeLesen = async (strom: ReadableStream<Uint8Array>): Promise<string> => {
  const text = new TextDecoder();
  let aus = "";
  for await (const stueck of strom) {
    aus += text.decode(stueck, { stream: true });
    if (aus.length > MAX_AUSGABE) return aus.slice(0, MAX_AUSGABE);
  }
  return aus;
};

/** Bun's spawn as in auftraege/ausfuehren.ts (no shell, no input, only PATH), its output read */
export const echtLesen: SpawnMitAusgabe = async (argv, signal) => {
  const lauf = Bun.spawn([...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    cwd: "/",
    signal,
    killSignal: "SIGKILL",
    env: { PATH, LC_ALL: "C" },
  });
  const aus = await ausgabeLesen(lauf.stdout);
  return { code: (await lauf.exited) ?? null, aus };
};

export const echtVerbinden: Verbinden = (host, port, signal) =>
  new Promise((ja, nein) => {
    const sockel = createConnection({ host, port, signal });
    sockel.once("connect", () => {
      sockel.destroy();
      ja();
    });
    sockel.once("error", (fehler) => {
      sockel.destroy();
      nein(fehler);
    });
  });
