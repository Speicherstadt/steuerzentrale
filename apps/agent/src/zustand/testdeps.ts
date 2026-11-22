import type { Planer } from "../verbindung/verbinden.ts";
import type { PruefDeps } from "./pruefen.ts";

/*
 * Fakes for the health and unit checks (Z-403): a clock whose timers a test runs by hand, and
 * spawn, output-reading spawn, fetch and socket that record what they were asked and answer what
 * the test says. A fake that "hangs" ends only when its signal aborts, as a killed process would.
 */

export const uhr = () => {
  const timer: { ms: number; lauf: () => void; weg: boolean }[] = [];
  const planen: Planer = (lauf, ms) => {
    const t = { ms, lauf, weg: false };
    timer.push(t);
    return () => {
      t.weg = true;
    };
  };
  /** Runs every timer still planned, as if its time had come */
  const ablaufen = () => {
    for (const t of timer.splice(0)) if (!t.weg) t.lauf();
  };
  const offen = () => timer.filter((t) => !t.weg).map((t) => t.ms);
  return { planen, ablaufen, offen };
};

/** A promise that ends with an AbortError once the signal aborts */
export const haengt = <T>(signal: AbortSignal): Promise<T> =>
  new Promise((_, nein) =>
    signal.addEventListener("abort", () => nein(new DOMException("aborted", "AbortError"))),
  );

export type Antworten = {
  /** Exit code of a spawned argv (`podman exec`), "haengt" to never end, or a throw */
  spawn?: (argv: readonly string[]) => number | "haengt" | Error;
  /** Exit code and output of `systemctl show` */
  lesen?: (argv: readonly string[]) => { code: number | null; aus: string } | "haengt";
  /** The response of a GET, "haengt", or a throw */
  holen?: (url: string) => Response | "haengt" | Error;
  /** A connection: "ok", "haengt", or a throw */
  verbinden?: (host: string, port: number) => "ok" | "haengt" | Error;
};

export const pruefDeps = (a: Antworten = {}) => {
  const u = uhr();
  const gerufen = {
    spawn: [] as string[][],
    lesen: [] as string[][],
    holen: [] as { url: string; init: RequestInit }[],
    verbinden: [] as { host: string; port: number }[],
  };
  const deps: PruefDeps = {
    planen: u.planen,
    spawn: async (argv, signal) => {
      gerufen.spawn.push([...argv]);
      const r = a.spawn?.(argv) ?? 0;
      if (r === "haengt") return haengt(signal);
      if (r instanceof Error) throw r;
      return { code: r };
    },
    lesen: async (argv, signal) => {
      gerufen.lesen.push([...argv]);
      const r = a.lesen?.(argv) ?? { code: 0, aus: "" };
      return r === "haengt" ? haengt(signal) : r;
    },
    holen: async (url, init) => {
      gerufen.holen.push({ url: String(url), init });
      const r = a.holen?.(String(url)) ?? new Response("ok");
      if (r === "haengt") return haengt(init.signal as AbortSignal);
      if (r instanceof Error) throw r;
      return r;
    },
    verbinden: async (host, port, signal) => {
      gerufen.verbinden.push({ host, port });
      const r = a.verbinden?.(host, port) ?? "ok";
      if (r === "haengt") return haengt(signal);
      if (r instanceof Error) throw r;
    },
  };
  return { deps, gerufen, uhr: u };
};
