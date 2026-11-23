import type { Spawn } from "../auftraege/ausfuehren.ts";
import type { Binaer, Dateien } from "../dateien.ts";
import { markeLesen } from "./marke.ts";

/*
 * The check after an update of the agent (BAULISTE.md Z-504; docs/plan.md, "Rückkehr zum alten
 * Agenten"): `steuerzentrale-agent agent-update-pruefen`, run by systemd as root from the kept old
 * binary (`<binary>.alt`) RUECKKEHR_FRIST_S after the new one was put in place, in a transient
 * timer of its own, so it does not depend on the new binary at all. Confirmed (the new agent was
 * greeted by its Zentrale): the mark goes, nothing else changes. Not confirmed: the old binary goes
 * back into place, the mark goes and the agent's service restarts; the Zentrale then sees the old
 * version in `hallo` and writes an event.
 */

/** How long the new agent has to reach its Zentrale before the old one comes back */
export const RUECKKEHR_FRIST_S = 300;

/** The transient unit (timer and service) of the check */
export const PRUEF_UNIT = "steuerzentrale-agent-pruefen";

/** The agent's service, as install.sh writes it */
export const DIENST_UNIT = "steuerzentrale-agent.service";

export const PRUEFEN_BEFEHL = "agent-update-pruefen";

export type RueckkehrDeps = {
  dateien: Dateien;
  binaer: Binaer;
  /** The agent's binary (AGENT_BINARY); the old one lies beside it as `<binary>.alt` */
  binary: string;
  /** The mark (pfade.ts, `agentUpdate`) */
  marke: string;
  spawn: Spawn;
  uid: () => number;
};

export type RueckkehrErgebnis = { code: number; out: string };

const melden = (code: number, msg: string, mehr: Record<string, unknown> = {}) => ({
  code,
  out: JSON.stringify({ msg, ...mehr }),
});

export const updatePruefen = async (deps: RueckkehrDeps): Promise<RueckkehrErgebnis> => {
  if (deps.uid() !== 0) return melden(1, "agent-update-pruefen runs as root");
  const m = await markeLesen(deps.dateien, deps.marke);
  if (!m) {
    await deps.binaer.loeschen(deps.marke);
    return melden(0, "no agent update to check");
  }
  if (m.bestaetigt) {
    await deps.binaer.loeschen(deps.marke);
    return melden(0, "agent update confirmed", { version: m.neu });
  }
  const alt = await deps.binaer.lesen(`${deps.binary}.alt`);
  if (!alt || alt.byteLength === 0)
    return melden(1, "agent update not confirmed, no old binary to go back to", { version: m.neu });
  await deps.binaer.schreiben(deps.binary, alt, 0o755);
  await deps.binaer.loeschen(deps.marke);
  const neustart = await deps.spawn(
    ["systemctl", "restart", "--no-block", DIENST_UNIT],
    AbortSignal.timeout(30_000),
  );
  return melden(neustart.code === 0 ? 0 : 1, "agent update not confirmed: back to the old agent", {
    vorher: m.neu,
    version: m.vorher,
  });
};
