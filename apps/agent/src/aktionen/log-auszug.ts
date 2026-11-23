import type { InstallationsEintrag } from "../einrichtung/gedaechtnis.ts";
import type { Nutzer } from "../einrichtung/nutzer.ts";
import { type GeheimDeps, geheimeWerte, type ManifestAngaben } from "./geheimnisse.ts";
import type { ZeilenLesen } from "./journal.ts";
import { MAX_ZEILEN, suchwerte, zeilenSchwaerzen } from "./schwaerzen.ts";
import { zeilenSammler } from "./zeilen.ts";

/*
 * A log excerpt of an installation (BAULISTE.md Z-405; docs/plan.md, "Log-Auszug"): the values to
 * replace first (geheimnisse.ts; without them nothing is read), then the last 500 lines its user
 * wrote to the journal, `journalctl _UID=<uid> -n 500 -o short-iso --no-pager` as root (reading a
 * user's own journal depends on how journald stores it), each line kept up to LESE_ZEICHEN while it
 * is read, then replaced and cut (schwaerzen.ts). The lines go only to the caller, which sends them
 * to the Zentrale; never into a file, a log or a reason.
 */

/**
 * What is kept of a line while it is read: far more than the 2000 characters sent, so that a line
 * with values in it still has 2000 after replacing; a longer one is cut, and its end treated as the
 * start of a value where it can be one (schwaerzen.ts)
 */
export const LESE_ZEICHEN = 8192;

export const journalArgv = (n: Nutzer): string[] => [
  "journalctl",
  `_UID=${n.uid}`,
  "-n",
  String(MAX_ZEILEN),
  "-o",
  "short-iso",
  "--no-pager",
];

export type LogDeps = GeheimDeps & { journal: ZeilenLesen };

/** The lines, or the reason as the result says it: "abgelehnt: …" or "Log-Auszug gescheitert: …" */
export type LogGelesen = { ok: true; zeilen: string[] } | { ok: false; grund: string };

const gescheitert = (grund: string): LogGelesen => ({
  ok: false,
  grund: `Log-Auszug gescheitert: ${grund}`,
});

export const logAuszugLesen = async (
  deps: LogDeps,
  n: Nutzer,
  eintrag: InstallationsEintrag,
  units: readonly string[],
  m: ManifestAngaben,
  signal: AbortSignal,
): Promise<LogGelesen> => {
  const werte = await geheimeWerte(deps, n, eintrag, units, m, signal);
  if (!werte.ok) return { ok: false, grund: `abgelehnt: ${werte.grund}` };
  const sammler = zeilenSammler(MAX_ZEILEN, LESE_ZEICHEN);
  let code: number | null;
  try {
    ({ code } = await deps.journal(journalArgv(n), signal, sammler));
  } catch (fehler) {
    return gescheitert(`journalctl startete nicht: ${String(fehler).slice(0, 500)}`);
  }
  if (signal.aborted) return gescheitert("journalctl: Zeitlimit des Auftrags überschritten");
  if (code !== 0) return gescheitert(`journalctl endete mit Code ${code ?? "–"}`);
  return { ok: true, zeilen: zeilenSchwaerzen(sammler.ende(), suchwerte(werte.werte)) };
};
