import { type AbwicklungAuftrag, LOESCHEN_BACKUP_MS } from "@steuerzentrale/manifest";
import type { Ergebnis } from "../auftraege/ausfuehren.ts";
import { type BackupDeps, fertigeInstallation } from "../backup/auftrag.ts";
import { backupDateiPfad } from "../backup/datei.ts";
import { neuesterLauf } from "../backup/stand.ts";
import { abbauen } from "../einrichtung/abbauen.ts";
import { mitZeitlimit } from "../einrichtung/auftrag.ts";
import { alsNutzer, homeVon } from "../einrichtung/nutzer.ts";

/*
 * The jobs after a contract ended on the agent (BAULISTE.md Z-604; docs/plan.md, "Kündigung und
 * Löschung"), after key, signature and abwicklungAuftragPruefen, only for an installation this
 * agent set up and finished:
 * - `installation_archiv` runs the agent's binary as the installation's user (`archivieren`), which
 *   writes and uploads the newest snapshot of each part with the user's own S3 access;
 * - `installation_loeschen` takes the installation down as a failed setup is (abbauen: units,
 *   linger, user and home), but only when its backup is not set up or a run of it went through in
 *   the last two hours: nothing is deleted without a backup first, whatever the Zentrale sends.
 */

export type AbwicklungPlan = { auftrag: AbwicklungAuftrag; zeitlimitMs: number };

const fehler = (text: string): Ergebnis => ({ ok: false, fehler: text });

/** The answer of `archivieren`, its last line of JSON */
const antwortLesen = (aus: string): { ok?: boolean; objekte?: unknown; grund?: string } => {
  try {
    return JSON.parse(aus.trim().split("\n").at(-1) ?? "{}");
  } catch {
    return {};
  }
};

const archiv = async (
  deps: BackupDeps,
  a: Extract<AbwicklungAuftrag, { art: "archiv" }>,
  zeitlimitMs: number,
): Promise<Ergebnis> => {
  const inst = await fertigeInstallation(deps, a.name);
  if (!inst.ok) return fehler(inst.grund);
  if (!(await deps.haus.existiert(backupDateiPfad(homeVon(a.name)))))
    return fehler(`abgelehnt: das Backup von ${a.name} ist nicht eingerichtet`);
  return mitZeitlimit(deps, zeitlimitMs, async (signal) => {
    const argv = alsNutzer(inst.n, [deps.agent, "archivieren", a.name, a.region]);
    const r = await deps.lesen(argv, signal).catch(() => ({ code: null, aus: "" }));
    const antwort = antwortLesen(r.aus);
    if (r.code === 0 && antwort.ok === true)
      return { ok: true, daten: { installation: a.name, objekte: antwort.objekte } };
    if (signal.aborted) return fehler("Archiv: Zeitlimit des Auftrags überschritten");
    return fehler(`Archiv: ${antwort.grund ?? `archivieren endete mit Code ${r.code ?? "–"}`}`);
  });
};

const loeschen = async (
  deps: BackupDeps,
  a: Extract<AbwicklungAuftrag, { art: "loeschen" }>,
): Promise<Ergebnis> => {
  const inst = await fertigeInstallation(deps, a.name);
  if (!inst.ok) return fehler(inst.grund);
  if (await deps.haus.existiert(backupDateiPfad(homeVon(a.name)))) {
    const lauf = await neuesterLauf(deps, inst.n, a.name, deps.jetzt() - LOESCHEN_BACKUP_MS);
    if (!lauf?.ok)
      return fehler(
        `abgelehnt: kein gelungenes Backup von ${a.name} in den letzten zwei Stunden; gelöscht wird erst danach`,
      );
  }
  const weg = await abbauen(deps, a.name, inst.units);
  if (!weg.ok) return fehler(`Abbau unvollständig: ${weg.grund}`);
  await deps.gedaechtnis.setzen(a.name, undefined);
  return { ok: true, daten: { installation: a.name, geaendert: "geloescht" } };
};

export const abwicklungAusfuehren = async (
  deps: BackupDeps,
  plan: AbwicklungPlan,
): Promise<Ergebnis> => {
  try {
    return plan.auftrag.art === "archiv"
      ? await archiv(deps, plan.auftrag, plan.zeitlimitMs)
      : await loeschen(deps, plan.auftrag);
  } catch (e) {
    return fehler(`Abwicklung: ${String(e).slice(0, 500)}`);
  }
};
