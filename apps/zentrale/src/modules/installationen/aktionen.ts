import {
  AKTIONS_AUFTRAEGE,
  aktionAngeboten,
  type InstallationsAktion,
  type Manifest,
  manifestPruefen,
  nurLesenBefehl,
} from "@steuerzentrale/manifest";
import { sperrzeitAm } from "@steuerzentrale/planung";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { type Kontext, schreiben } from "../audit/index.ts";
import { type AnlageFehler, auftragEinfuegen, auftragVorbereiten } from "../auftraege/anlegen.ts";
import { type Auftrag, auftragLesen } from "../auftraege/lesen.ts";
import { type AuftragDeps, zustellen } from "../auftraege/zustellen.ts";
import { auftraegeDerInstallation, type Installation, installationLesen } from "./lesen.ts";

/*
 * The actions of an installation (BAULISTE.md Z-405; docs/plan.md, "Aktionen einer Installation",
 * "Neustart", "Log-Auszug"): restart and log excerpt as the built-in jobs, "nur lesen" as the
 * command its manifest names. Only what the manifest offers (aktionAngeboten, the agent checks the
 * same), only for an installation that runs, each with a reason that the audit log keeps with the
 * job. A restart, like "neu konfigurieren", never in a freeze window of the manifest and never
 * while another job of the installation is open; "nur lesen" changes the app and so waits for an
 * open job too; a log excerpt only reads and may run beside one.
 */

export type AktionAusgeloest =
  | { ok: true; auftrag: Auftrag }
  | {
      ok: false;
      grund:
        | "grund_fehlt"
        | "keine_installation"
        | "nicht_angeboten"
        | "laeuft_nicht"
        | "sperrzeit"
        | "auftrag_offen"
        | "nicht_ausfuehrbar";
      detail?: string;
    };

type Fehler = Extract<AktionAusgeloest, { ok: false }>;

/** The job's name: a built-in job, or the command of "nur lesen" */
const auftragsAktion = (m: Manifest, aktion: InstallationsAktion): string | undefined =>
  aktion === "nur_lesen" ? nurLesenBefehl(m) : AKTIONS_AUFTRAEGE[aktion];

/** Why the action cannot run now, or undefined */
const gesperrt = (
  deps: AuftragDeps,
  kontext: Kontext,
  i: Installation,
  m: Manifest,
  aktion: InstallationsAktion,
): Fehler | undefined => {
  if (i.zustand !== "laeuft") return { ok: false, grund: "laeuft_nicht" };
  if (aktion === "log_auszug") return undefined;
  const sperre = aktion === "neustart" ? sperrzeitAm(m.sperrzeiten, kontext.jetzt) : undefined;
  if (sperre) return { ok: false, grund: "sperrzeit", detail: sperre.grund };
  const offen = auftraegeDerInstallation(deps.db, kontext.betreiberId, i.installationId).some(
    (a) => !ENDZUSTAENDE.has(a.zustand),
  );
  return offen ? { ok: false, grund: "auftrag_offen" } : undefined;
};

const nichtAusfuehrbar = (grund: AnlageFehler, detail?: string): Fehler => ({
  ok: false,
  grund: "nicht_ausfuehrbar",
  detail: detail ?? grund,
});

export const aktionAusloesen = (
  deps: AuftragDeps,
  kontext: Kontext,
  installationId: string,
  aktion: InstallationsAktion,
): AktionAusgeloest => {
  if (kontext.grund.trim() === "") return { ok: false, grund: "grund_fehlt" };
  const i = installationLesen(deps.db, kontext.betreiberId, installationId);
  if (!i) return { ok: false, grund: "keine_installation" };
  const geprueft = manifestPruefen(i.manifest);
  if (!geprueft.ok) return nichtAusfuehrbar("manifest_ungueltig");
  const m = geprueft.manifest;
  const name = auftragsAktion(m, aktion);
  if (!aktionAngeboten(m, aktion) || name === undefined)
    return { ok: false, grund: "nicht_angeboten" };
  const nein = gesperrt(deps, kontext, i, m, aktion);
  if (nein) return nein;
  const vorbereitet = auftragVorbereiten(deps, kontext, {
    serverId: i.serverId,
    installationId,
    aktion: name,
    argumente: {},
    manifest: i.manifest,
    signatur: i.signatur,
  });
  if (!vorbereitet.ok) return nichtAusfuehrbar(vorbereitet.grund, vorbereitet.detail);
  const auftrag = schreiben(deps.schreibDb, kontext, `installation.${aktion}`, (w) =>
    auftragEinfuegen(w, vorbereitet.zeile),
  );
  zustellen(deps, [auftrag]);
  return {
    ok: true,
    auftrag: auftragLesen(deps.db, kontext.betreiberId, auftrag.auftragId) ?? auftrag,
  };
};

/** Which actions the installation's manifest offers, for its page */
export const angeboteneAktionen = (i: Installation): Record<InstallationsAktion, boolean> => {
  const m = manifestPruefen(i.manifest);
  const angeboten = (a: InstallationsAktion) => m.ok && aktionAngeboten(m.manifest, a);
  return {
    neustart: angeboten("neustart"),
    log_auszug: angeboten("log_auszug"),
    nur_lesen: angeboten("nur_lesen"),
  };
};
