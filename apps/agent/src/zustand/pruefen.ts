import type { NachrichtVomAgenten } from "@steuerzentrale/protokoll";
import { imContainer, type Spawn } from "../auftraege/ausfuehren.ts";
import { alsNutzer, type Nutzer } from "../einrichtung/nutzer.ts";
import type { Planer } from "../verbindung/verbinden.ts";
import type { PruefZiel } from "./ziel.ts";

/*
 * The checks of one installation (BAULISTE.md Z-403; docs/plan.md, "Health auf dem Server"): its
 * health by the target kept from the signed manifest (ziel.ts), and the ActiveState of its units.
 * `http` is a GET to 127.0.0.1 without following redirects, green at 200–399; `tcp` a connection to
 * 127.0.0.1; both within 5 s. `befehl` runs the named command with `podman exec` as the
 * installation's user, green at code 0, within its time limit (at most 30 s), its output dropped.
 * A reason is short and never holds what a command or a server wrote. Everything that reaches the
 * server is passed in, so the checks are tested without one.
 */

type Zustand = Extract<NachrichtVomAgenten, { typ: "zustand" }>["installationen"][number];
export type Health = Zustand["health"];
export type Unit = Zustand["units"][number];

/**
 * Runs a fixed argv; its exit code and the first bytes of its standard output. `eingabe` goes to its
 * standard input as with Spawn (the secrets a Prüf-Restore hands to its user, Z-602)
 */
export type SpawnMitAusgabe = (
  argv: readonly string[],
  signal: AbortSignal,
  o?: { eingabe?: string },
) => Promise<{ code: number | null; aus: string }>;

/** Opens a TCP connection and closes it again; throws when it cannot */
export type Verbinden = (host: string, port: number, signal: AbortSignal) => Promise<void>;

export type PruefDeps = {
  /** For `befehl`: output dropped (auftraege/ausfuehren.ts) */
  spawn: Spawn;
  /** For `systemctl show` */
  lesen: SpawnMitAusgabe;
  holen: (url: string, init: RequestInit) => Promise<Response>;
  verbinden: Verbinden;
  planen: Planer;
};

export const HTTP_MS = 5000;
export const TCP_MS = 5000;
/** systemctl answers at once; a user manager that does not is reported as not readable */
export const UNITS_MS = 10_000;

const HOST = "127.0.0.1";

type MitFrist<T> = { ok: true; wert: T } | { ok: false; abgelaufen: boolean };

/** Runs f with a signal that aborts after ms; whether it ended, ran out of time, or threw */
const mitFrist = async <T>(
  planen: Planer,
  ms: number,
  f: (signal: AbortSignal) => Promise<T>,
): Promise<MitFrist<T>> => {
  const abbruch = new AbortController();
  const aufheben = planen(() => abbruch.abort(), ms);
  try {
    const wert = await f(abbruch.signal);
    return abbruch.signal.aborted ? { ok: false, abgelaufen: true } : { ok: true, wert };
  } catch {
    return { ok: false, abgelaufen: abbruch.signal.aborted };
  } finally {
    aufheben();
  }
};

const gruen = (grund: string): Health => ({ zustand: "gruen", grund });
const rot = (grund: string): Health => ({ zustand: "rot", grund });
const unbekannt = (grund: string): Health => ({ zustand: "unbekannt", grund });

const sekunden = (ms: number) => `${ms / 1000} s`;

const httpPruefen = async (deps: PruefDeps, port: number, pfad: string): Promise<Health> => {
  const r = await mitFrist(deps.planen, HTTP_MS, async (signal) => {
    const antwort = await deps.holen(`http://${HOST}:${port}${pfad}`, {
      method: "GET",
      redirect: "manual",
      signal,
    });
    // the body is not read: the status decides
    await antwort.body?.cancel().catch(() => {});
    return antwort.status;
  });
  if (!r.ok)
    return rot(
      r.abgelaufen
        ? `keine Antwort in ${sekunden(HTTP_MS)}`
        : `keine Verbindung zu ${HOST}:${port}`,
    );
  return r.wert >= 200 && r.wert <= 399 ? gruen(`HTTP ${r.wert}`) : rot(`HTTP ${r.wert}`);
};

const tcpPruefen = async (deps: PruefDeps, port: number): Promise<Health> => {
  const r = await mitFrist(deps.planen, TCP_MS, (signal) => deps.verbinden(HOST, port, signal));
  if (r.ok) return gruen(`Verbindung zu ${HOST}:${port}`);
  return rot(
    r.abgelaufen
      ? `keine Verbindung in ${sekunden(TCP_MS)}`
      : `keine Verbindung zu ${HOST}:${port}`,
  );
};

const befehlPruefen = async (
  deps: PruefDeps,
  ziel: Extract<PruefZiel, { art: "befehl" }>,
  installation: string,
  nutzer: Nutzer | undefined,
): Promise<Health> => {
  if (!nutzer) return unbekannt("Nutzer der Installation fehlt");
  // the container's name from its Quadlet unit, as for a command of a job; marked, so that at
  // its time limit the command under conmon is killed too (auftraege/beenden.ts)
  const { argv, marke } = imContainer(nutzer, `${installation}-${ziel.container}`, ziel.argv);
  const r = await mitFrist(
    deps.planen,
    ziel.zeitlimitMs,
    async (signal) => (await deps.spawn(argv, signal, { marke })).code,
  );
  if (r.ok)
    return r.wert === 0
      ? gruen("Befehl endete mit Code 0")
      : rot(`Befehl endete mit Code ${r.wert ?? "–"}`);
  // what it could not start on is not told: the error may carry what the command wrote
  return rot(
    r.abgelaufen
      ? `Befehl nach ${sekunden(ziel.zeitlimitMs)} abgebrochen`
      : "Befehl startete nicht",
  );
};

export const healthPruefen = (
  deps: PruefDeps,
  ziel: PruefZiel,
  installation: string,
  nutzer: Nutzer | undefined,
): Promise<Health> => {
  switch (ziel.art) {
    case "http":
      return httpPruefen(deps, ziel.port, ziel.pfad);
    case "tcp":
      return tcpPruefen(deps, ziel.port);
    case "befehl":
      return befehlPruefen(deps, ziel, installation, nutzer);
    case "keine":
      // the Zentrale then judges by the units alone (docs/plan.md, "Bewertung einer Installation")
      return Promise.resolve(unbekannt("keine Prüfung"));
    case "nicht_pruefbar":
      return Promise.resolve(unbekannt(ziel.grund));
  }
};

// The ActiveState values the protocol knows (packages/protokoll, `zustand`)
const AKTIV: ReadonlySet<string> = new Set<Unit["aktiv"]>([
  "active",
  "reloading",
  "inactive",
  "failed",
  "activating",
  "deactivating",
  "maintenance",
  "refreshing",
]);

/** `systemctl show` output: blocks of Key=Value lines, one block per unit, blank line between */
export const zustaendeLesen = (aus: string): Map<string, string> => {
  const zustaende = new Map<string, string>();
  for (const block of aus.split(/\n\s*\n/)) {
    const werte = new Map(
      block
        .split("\n")
        .filter((z) => z.includes("="))
        .map((z) => [z.slice(0, z.indexOf("=")), z.slice(z.indexOf("=") + 1)] as const),
    );
    const id = werte.get("Id");
    const aktiv = werte.get("ActiveState");
    if (id !== undefined && aktiv !== undefined) zustaende.set(id, aktiv);
  }
  return zustaende;
};

export const unitsLesen = async (
  deps: PruefDeps,
  units: readonly string[],
  nutzer: Nutzer | undefined,
): Promise<Unit[]> => {
  if (units.length === 0) return [];
  const unbekannte = () => units.map((name): Unit => ({ name, aktiv: "unknown" }));
  if (!nutzer) return unbekannte();
  const argv = alsNutzer(nutzer, [
    "systemctl",
    "--user",
    "show",
    "-p",
    "Id,ActiveState",
    "--",
    ...units,
  ]);
  const r = await mitFrist(deps.planen, UNITS_MS, (signal) => deps.lesen(argv, signal));
  if (!r.ok || r.wert.code !== 0) return unbekannte();
  const zustaende = zustaendeLesen(r.wert.aus);
  return units.map((name): Unit => {
    const aktiv = zustaende.get(name);
    return {
      name,
      aktiv: aktiv !== undefined && AKTIV.has(aktiv) ? (aktiv as Unit["aktiv"]) : "unknown",
    };
  });
};
