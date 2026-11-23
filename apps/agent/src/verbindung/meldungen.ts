import {
  FAKTEN_MS,
  Fakten,
  PROTOKOLL_VERSION,
  SshAnmeldung,
  schreiben,
  Zustand,
} from "@steuerzentrale/protokoll";
import type { FaktenNachricht } from "../fakten/lesen.ts";
import type { Anmeldung } from "../ssh/anmeldungen.ts";
import type { ZustandNachricht } from "../zustand/runde.ts";
import type { Planer } from "./verbinden.ts";

/*
 * What the agent reports on its own while connected (BAULISTE.md Z-304, Z-403): its facts right
 * after `willkommen` and then every 15 minutes (FAKTEN_MS), every SSH login from the journal, and
 * the state of its installations right after `willkommen` and then every 30 s (ZUSTAND_MS), and
 * the runs of their backups not yet reported, right after `willkommen` and then every minute
 * (BACKUP_STAND_MS, Z-601). All stop when the connection ends and start again with the next
 * `willkommen`.
 */

/**
 * The beat of `zustand` (docs/plan.md, "Health auf dem Server"); the Zentrale takes an installation
 * without a report for 90 s as unknown
 */
export const ZUSTAND_MS = 30_000;

/** How often the agent looks for new backup runs (src/backup/melden.ts) */
export const BACKUP_STAND_MS = 60_000;

export type MeldungenDeps = {
  planen: Planer;
  log: (msg: string, mehr?: Record<string, unknown>) => void;
  /** Reads all facts (src/fakten/lesen.ts) */
  fakten: (uhrzeitAbweichungMs: number | null) => Promise<FaktenNachricht>;
  /** Follows the SSH logins (src/ssh/anmeldungen.ts) until stopped */
  anmeldungen: (melden: (anmeldung: Anmeldung) => void) => { stoppen: () => void };
  /**
   * One round of checks of the installations (src/zustand/runde.ts, zustandMelder); undefined
   * when there is nothing to send, e.g. while the last round still runs. None without
   */
  zustand?: () => Promise<ZustandNachricht | undefined>;
  /**
   * One round of the backup runs not yet reported (src/backup/melden.ts); `senden` says whether
   * the message went out, `erste` marks the round at `willkommen`. None without
   */
  backups?: (senden: (text: string) => boolean, erste: boolean) => Promise<void>;
};

/** The backup runs every BACKUP_STAND_MS, a round never started while the last one still runs */
const backupTakt = (
  deps: MeldungenDeps,
  runde: NonNullable<MeldungenDeps["backups"]>,
  senden: (text: string) => void,
  istAktiv: () => boolean,
): (() => void) => {
  let abbrechen: (() => void) | undefined;
  let laeuft = false;
  let erste = true;
  const takt = () => {
    abbrechen = deps.planen(takt, BACKUP_STAND_MS);
    if (laeuft) return;
    laeuft = true;
    const sendenWennAktiv = (text: string) => {
      if (!istAktiv()) return false;
      senden(text);
      return true;
    };
    runde(sendenWennAktiv, erste)
      .catch((fehler) => deps.log("backup report failed", { fehler: String(fehler) }))
      .finally(() => {
        laeuft = false;
      });
    erste = false;
  };
  takt();
  return () => abbrechen?.();
};

/**
 * The state on a fixed beat: a round is due every ZUSTAND_MS whether the last one ended or not;
 * the reader itself skips a round while one still runs, so checks never run twice at once
 */
const zustandTakt = (
  deps: MeldungenDeps,
  lesen: () => Promise<ZustandNachricht | undefined>,
  senden: (text: string) => void,
  istAktiv: () => boolean,
): (() => void) => {
  let abbrechen: (() => void) | undefined;
  const runde = () => {
    abbrechen = deps.planen(runde, ZUSTAND_MS);
    lesen()
      .then((n) => {
        if (n && istAktiv()) senden(schreiben(Zustand, n));
      })
      .catch((fehler) => deps.log("state failed", { fehler: String(fehler) }));
  };
  runde();
  return () => abbrechen?.();
};

/** Starts the reports over `senden`; returns how to stop them */
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
  const zustandStoppen = deps.zustand
    ? zustandTakt(deps, deps.zustand, senden, () => aktiv)
    : () => {};
  const backupStoppen = deps.backups
    ? backupTakt(deps, deps.backups, senden, () => aktiv)
    : () => {};
  return () => {
    aktiv = false;
    abbrechen?.();
    ssh.stoppen();
    zustandStoppen();
    backupStoppen();
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
