import { createConnection } from "node:net";
import { gruppeBeiAbbruch } from "../auftraege/ausfuehren.ts";
import { PATH } from "../einrichtung/nutzer.ts";
import type { SpawnMitAusgabe, Verbinden } from "./pruefen.ts";

/*
 * The real parts of the checks (Z-403): a fixed argv whose standard output is read (only for
 * `systemctl show`; never for a command of the manifest, whose output is dropped), and a TCP
 * connection that is closed as soon as it is open.
 */

/** systemctl show for a few units is far below this; more is cut off, never waited for */
const MAX_AUSGABE = 64 * 1024;

/**
 * Reads until the end of the output or the signal: runuser forks, so the signal kills runuser
 * while its child may keep the pipe open, and only stopping here keeps the time limit
 */
const ausgabeLesen = async (
  strom: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<string> => {
  const leser = strom.getReader();
  const aufhoeren = () => {
    leser.cancel().catch(() => {});
  };
  signal.addEventListener("abort", aufhoeren, { once: true });
  if (signal.aborted) aufhoeren();
  const text = new TextDecoder();
  let aus = "";
  try {
    for (;;) {
      const { done, value } = await leser.read();
      if (done) return aus;
      aus += text.decode(value, { stream: true });
      if (aus.length > MAX_AUSGABE) return aus.slice(0, MAX_AUSGABE);
    }
  } finally {
    signal.removeEventListener("abort", aufhoeren);
  }
};

/**
 * Bun's spawn as in auftraege/ausfuehren.ts (no shell, no input, only PATH, a session of its own
 * whose process group the signal kills, runuser's child with it), its output read
 */
export const echtLesen: SpawnMitAusgabe = async (argv, signal) => {
  const lauf = Bun.spawn([...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    cwd: "/",
    detached: true,
    env: { PATH, LC_ALL: "C" },
  });
  const aufheben = gruppeBeiAbbruch(lauf, signal);
  try {
    const aus = await ausgabeLesen(lauf.stdout, signal);
    return { code: (await lauf.exited) ?? null, aus };
  } finally {
    aufheben();
  }
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
