import {
  FAKTEN_MS,
  Fakten,
  PROTOKOLL_VERSION,
  SshAnmeldung,
  schreiben,
} from "@steuerzentrale/protokoll";
import type { FaktenNachricht } from "../fakten/lesen.ts";
import type { Anmeldung } from "../ssh/anmeldungen.ts";
import type { Planer } from "./verbinden.ts";

/*
 * What the agent reports on its own while connected (BAULISTE.md Z-304): its facts right after
 * `willkommen` and then every 15 minutes (FAKTEN_MS), and every SSH login from the journal. Both
 * stop when the connection ends and start again with the next `willkommen`.
 */

export type MeldungenDeps = {
  planen: Planer;
  log: (msg: string, mehr?: Record<string, unknown>) => void;
  /** Reads all facts (src/fakten/lesen.ts) */
  fakten: (uhrzeitAbweichungMs: number | null) => Promise<FaktenNachricht>;
  /** Follows the SSH logins (src/ssh/anmeldungen.ts) until stopped */
  anmeldungen: (melden: (anmeldung: Anmeldung) => void) => { stoppen: () => void };
};

/** Starts both reports over `senden`; returns how to stop them */
export const meldungenStarten = (
  deps: MeldungenDeps,
  senden: (text: string) => void,
  uhrzeitAbweichungMs: number | null,
): (() => void) => {
  let aktiv = true;
  let abbrechen: (() => void) | undefined;
  // the next round is planned once this one is read, so a slow read never piles up
  const runde = async () => {
    try {
      const n = await deps.fakten(uhrzeitAbweichungMs);
      if (aktiv) senden(schreiben(Fakten, n));
    } catch (fehler) {
      deps.log("facts failed", { fehler: String(fehler) });
    }
    if (aktiv) abbrechen = deps.planen(() => void runde(), FAKTEN_MS);
  };
  void runde();
  const ssh = deps.anmeldungen((a) => {
    if (aktiv)
      senden(schreiben(SshAnmeldung, { typ: "ssh_anmeldung", protokoll: PROTOKOLL_VERSION, ...a }));
  });
  return () => {
    aktiv = false;
    abbrechen?.();
    ssh.stoppen();
  };
};

/** One slot for the reports of the current connection: starting again stops those before */
export const meldungenPlatz = (deps: MeldungenDeps | undefined) => {
  let stoppen: (() => void) | undefined;
  return {
    starten: (senden: (text: string) => void, uhrzeitAbweichungMs: number | null) => {
      stoppen?.();
      stoppen = deps ? meldungenStarten(deps, senden, uhrzeitAbweichungMs) : undefined;
    },
    stoppen: () => {
      stoppen?.();
      stoppen = undefined;
    },
  };
};
