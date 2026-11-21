import type { Folgen } from "./anmeldungen.ts";

/*
 * The real journal for src/ssh/anmeldungen.ts: journalctl as a child process with the fixed argv
 * it is given, read line by line until the agent stops it.
 */

/** The lines of a byte stream, as they arrive; a last line without newline counts too */
export async function* zeilenVon(strom: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let rest = "";
  for await (const stueck of strom) {
    rest += decoder.decode(stueck, { stream: true });
    const teile = rest.split("\n");
    rest = teile.pop() ?? "";
    yield* teile;
  }
  rest += decoder.decode();
  if (rest) yield rest;
}

async function* nichts(): AsyncGenerator<string> {}

export const echtFolgen: Folgen = (argv) => {
  try {
    const lauf = Bun.spawn([...argv], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      env: { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C" },
    });
    return { zeilen: zeilenVon(lauf.stdout), stoppen: () => lauf.kill() };
  } catch {
    // without journalctl there is nothing to follow
    return { zeilen: nichts(), stoppen: () => {} };
  }
};
