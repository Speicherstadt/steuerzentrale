import type { Ergebnis } from "../auftraege/ausfuehren.ts";
import { type EinrichtungsDeps, mitZeitlimit } from "../einrichtung/auftrag.ts";
import { laeufer } from "../einrichtung/lauf.ts";
import { neustarten } from "../einrichtung/neustarten.ts";
import { nutzerName } from "../einrichtung/nutzer.ts";
import { installationVomManifest, type ManifestAngaben } from "./geheimnisse.ts";
import type { ZeilenLesen } from "./journal.ts";
import { logAuszugLesen } from "./log-auszug.ts";

/*
 * The actions restart and log excerpt on the agent (BAULISTE.md Z-405; docs/plan.md, "Neustart",
 * "Log-Auszug"), after the job passed key, signature and aktionAngeboten (auftraege/pruefen.ts).
 * Only for an installation this agent set up and finished, whose units its record knows (Z-403),
 * as its user, and only when its units were rendered from the job's manifest (app and version in
 * their labels), whose `aktionen` decided the action is offered. Both run in the line of the setup jobs (auftraege.ts): a restart never meets a
 * setup or reconfiguring of the same installation, and a log excerpt never reads the secrets while
 * reconfiguring has replaced some of them. The lines of an excerpt go to `auszugSenden` before the
 * result, which tells only their number; nothing of them reaches a log or a reason.
 */

export type Aktion = {
  art: "neustart" | "log_auszug";
  name: string;
  /** From the job's signed manifest (geheimnisse.ts) */
  manifest: ManifestAngaben;
};

export type AktionsDeps = EinrichtungsDeps & { journal: ZeilenLesen };

const fehler = (text: string): Ergebnis => ({ ok: false, fehler: text });

export const aktionAusfuehren = async (
  deps: AktionsDeps,
  plan: { auftrag: Aktion; zeitlimitMs: number },
  auszugSenden: (zeilen: string[]) => void,
): Promise<Ergebnis> => {
  const a = plan.auftrag;
  const g = await deps.gedaechtnis.lesen();
  if (!g.ok) return fehler(`abgelehnt: ${g.grund}`);
  const eintrag = g.stand.get(a.name);
  if (eintrag?.zustand !== "fertig")
    return fehler(
      `abgelehnt: ${a.name} ist keine fertig eingerichtete Installation dieses Agenten`,
    );
  const units = eintrag.pruefung?.units;
  if (units === undefined)
    return fehler(`abgelehnt: das Gedächtnis kennt die Units von ${a.name} nicht (vor Z-403)`);
  const n = await deps.nutzer(nutzerName(a.name));
  if (!n) return fehler(`abgelehnt: ${nutzerName(a.name)} fehlt`);
  if (a.art === "neustart") {
    // the log excerpt checks the same while it reads the units (geheimnisse.ts)
    const passt = await installationVomManifest(deps, n, units, a.manifest);
    if (!passt.ok) return fehler(`abgelehnt: ${passt.grund}`);
    const r = await mitZeitlimit(deps, plan.zeitlimitMs, (signal) =>
      neustarten(deps, laeufer(deps, signal), n, units, signal),
    );
    return r.ok
      ? { ok: true, daten: { installation: a.name, units } }
      : fehler(`Neustart gescheitert: ${r.grund}`);
  }
  const r = await mitZeitlimit(deps, plan.zeitlimitMs, (signal) =>
    logAuszugLesen(deps, n, eintrag, units, a.manifest, signal),
  );
  if (!r.ok) return fehler(r.grund);
  auszugSenden(r.zeilen);
  return { ok: true, daten: { zeilen: r.zeilen.length } };
};
