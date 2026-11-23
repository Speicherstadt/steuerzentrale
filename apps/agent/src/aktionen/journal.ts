import { gruppeBeiAbbruch } from "../auftraege/ausfuehren.ts";
import { PATH } from "../einrichtung/nutzer.ts";
import type { ZeilenSammler } from "./zeilen.ts";

/*
 * Reading the journal for a log excerpt (Z-405): a fixed argv as root, its standard output read
 * into a collector of lines (zeilen.ts), which keeps only the last lines, each bounded; never into
 * a file or a log. Spawned as the checks read `systemctl show` (src/zustand/echt.ts): no shell, no
 * input, only PATH, a session of its own whose process group the signal kills. UTF-8 as the
 * locale, so journalctl prints letters beyond ASCII as they are; bytes that are no UTF-8 become
 * U+FFFD.
 */

/** Runs a fixed argv as root and hands its standard output to the collector; throws when it cannot start */
export type ZeilenLesen = (
  argv: readonly string[],
  signal: AbortSignal,
  sammler: ZeilenSammler,
) => Promise<{ code: number | null }>;

export const echtZeilenLesen: ZeilenLesen = async (argv, signal, sammler) => {
  const lauf = Bun.spawn([...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    cwd: "/",
    detached: true,
    env: { PATH, LC_ALL: "C.UTF-8" },
  });
  const aufheben = gruppeBeiAbbruch(lauf, signal);
  const leser = lauf.stdout.getReader();
  // a child that outlives a killed journalctl may keep the pipe open: stop reading at the signal
  const aufhoeren = () => {
    leser.cancel().catch(() => {});
  };
  signal.addEventListener("abort", aufhoeren, { once: true });
  if (signal.aborted) aufhoeren();
  const text = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await leser.read();
      if (done) break;
      sammler.hinzu(text.decode(value, { stream: true }));
    }
    sammler.hinzu(text.decode());
    return { code: (await lauf.exited) ?? null };
  } finally {
    signal.removeEventListener("abort", aufhoeren);
    aufheben();
  }
};
