import type { ServerNeustartAuftrag } from "@steuerzentrale/manifest";
import type { Ergebnis, Spawn } from "../auftraege/ausfuehren.ts";

/*
 * The reboot of the server (BAULISTE.md Z-701; docs/plan.md, "Neustart als Auftrag", "Ende des
 * Neustarts"): the agent reboots only out of the boot the job names, with `systemctl reboot` as a
 * fixed argv, and keeps the job running in its record across the reboot. When it started again and
 * the Zentrale sends the job anew, the boot id tells whether the server rebooted. The boot id, the
 * process and the wait are passed in, so it is tested without a reboot.
 */

export type NeustartDeps = {
  /** The boot id now (fakten/betriebssystem.ts), null when unreadable */
  bootId: () => Promise<string | null>;
  spawn: Spawn;
  warten: (ms: number) => Promise<void>;
};

export const SYSTEMCTL_REBOOT = ["systemctl", "reboot"] as const;

/** systemd stops the services and the agent with them well within this; else it did not reboot */
export const NEUSTART_FRIST_MS = 5 * 60_000;

/** `systemctl reboot` only queues the reboot and answers at once */
const SYSTEMCTL_ZEITLIMIT_MS = 60_000;

const NICHT_ERFOLGT = "Neustart nicht erfolgt";

const nein = (fehler: string): Ergebnis => ({ ok: false, fehler });

/** Why the server may not reboot for this job now, or undefined when it may */
export const neustartAblehnen = async (
  deps: NeustartDeps,
  auftrag: ServerNeustartAuftrag,
): Promise<Ergebnis | undefined> => {
  const boot = await deps.bootId();
  if (boot === null) return nein("abgelehnt: the boot id is unreadable");
  if (boot !== auftrag.bootId)
    return nein("abgelehnt: the server booted anew since the job was made");
  return undefined;
};

/**
 * Asks systemd to reboot; returns only when that failed or the server still runs after the wait,
 * since a reboot that comes ends the agent before
 */
export const neustartAusloesen = async (deps: NeustartDeps): Promise<Ergebnis> => {
  const lauf = await deps
    .spawn(SYSTEMCTL_REBOOT, AbortSignal.timeout(SYSTEMCTL_ZEITLIMIT_MS))
    .catch((e: unknown) => ({ code: null, fehler: String(e).slice(0, 300) }));
  if (lauf.code !== 0)
    return nein(
      "fehler" in lauf ? `systemctl reboot: ${lauf.fehler}` : `systemctl reboot: exit ${lauf.code}`,
    );
  await deps.warten(NEUSTART_FRIST_MS);
  return nein(`${NICHT_ERFOLGT}: der Server lief nach 5 Minuten noch`);
};

/** A job the record kept running when the agent stopped: done if the server booted anew since */
export const neustartEnde = async (
  deps: NeustartDeps,
  auftrag: ServerNeustartAuftrag,
): Promise<Ergebnis> => {
  const boot = await deps.bootId();
  if (boot === null) return nein(`${NICHT_ERFOLGT}: the boot id is unreadable`);
  return boot === auftrag.bootId
    ? nein(`${NICHT_ERFOLGT}: Agent neu gestartet`)
    : { ok: true, daten: { bootId: boot } };
};
