import { AKTIONS_AUFTRAEGE } from "@steuerzentrale/manifest";
import type { Fehlschlag } from "../anmeldung/api.ts";
import type {
  AuftragDerInstallation,
  InstallationenQuelle,
  InstallationsAktion,
  LogAuszug,
} from "../daten/installationen.ts";
import { type Eintrag, nachAuftrag } from "./installationen-bestand.ts";
import { sperrzeit } from "./installationen-konfigurieren.ts";

/*
 * The actions of an installation in the demo (BAULISTE.md Z-405), answering as the Zentrale does
 * (apps/zentrale, modules/installationen/aktionen.ts): only for an installation that runs and an
 * action its app offers; a restart not in a freeze window, restart and "nur lesen" not while a job
 * of it is open. Without an agent a restart stays with the agent; a log excerpt comes back at once
 * with made-up lines, the values of secrets replaced as the agent does.
 */

const ENDE = ["erfolgreich", "gescheitert", "abgebrochen"];

const nein = (status: number, fehler: string, detail?: string): Fehlschlag => ({
  ok: false,
  status,
  fehler,
  ...(detail === undefined ? {} : { detail }),
});

const NAME: Record<InstallationsAktion, string> = {
  neustart: AKTIONS_AUFTRAEGE.neustart,
  log_auszug: AKTIONS_AUFTRAEGE.log_auszug,
  nur_lesen: "nur-lesen",
};

/** Lines as `journalctl -o short-iso` prints them, a secret already replaced */
export const demoZeilen = (e: Eintrag, t: number): string[] => {
  const zeit = new Date(t - 60_000).toISOString().replace(/\.\d+Z$/, "+0000");
  const unit = `${e.i.installationId}-app`;
  return [
    `${zeit} ${unit}[1]: started`,
    `${zeit} ${unit}[1]: config loaded, OIDC_CLIENT_SECRET=[geheim]`,
    `${zeit} ${unit}[1]: listening on :${e.i.httpPort ?? 8080}`,
    `${zeit} ${unit}[1]: GET /health 200 21ms`,
  ];
};

export type AktionImDemo = { ok: true; eintrag: Eintrag; logAuszug?: LogAuszug } | Fehlschlag;

export const demoAktion = (e: Eintrag, aktion: InstallationsAktion, t: number): AktionImDemo => {
  if (e.i.zustand !== "laeuft") return nein(409, "laeuft_nicht");
  if (!e.i.aktionen[aktion]) return nein(422, "nicht_angeboten");
  const sperre = aktion === "neustart" ? sperrzeit(e.i.app, t) : undefined;
  if (sperre) return nein(409, "sperrzeit", sperre.grund);
  const offen = e.i.auftraege.some((a) => !ENDE.includes(a.zustand));
  if (aktion !== "log_auszug" && offen) return nein(409, "auftrag_offen");
  const zustand = aktion === "log_auszug" ? "erfolgreich" : "zugestellt";
  const neu = nachAuftrag(e.i.installationId, NAME[aktion], zustand, t);
  const job = { ...neu, auftragId: `${neu.auftragId}-${e.i.auftraege.length}` };
  const eintrag = { ...e, i: { ...e.i, auftraege: [...e.i.auftraege, job] } };
  if (aktion !== "log_auszug") return { ok: true, eintrag };
  const { auftragId, aktion: name, angelegtAm } = job;
  const logAuszug: LogAuszug = {
    auftragId,
    aktion: name,
    zustand,
    angelegtAm,
    fehler: null,
    zeilen: demoZeilen(e, t),
    zeitpunkt: t,
  };
  return { ok: true, eintrag, logAuszug };
};

/** Where the actions find an installation of the demo and put it back changed */
export type DemoBestand = {
  finden: (id: string) => Eintrag | undefined;
  ersetzen: (alt: Eintrag, neu: Eintrag) => void;
};

export const demoAktionenQuelle = (
  bestand: DemoBestand,
  jetzt: () => number,
): Pick<InstallationenQuelle, "aktion" | "logAuszug"> => {
  // the log excerpts the demo answered, by job
  let auszuege: LogAuszug[] = [];
  return {
    aktion: async (id, aktion) => {
      const e = bestand.finden(id);
      if (!e) return nein(404, "keine_installation");
      const r = demoAktion(e, aktion, jetzt());
      if (!r.ok) return r;
      bestand.ersetzen(e, r.eintrag);
      if (r.logAuszug) auszuege = [...auszuege, r.logAuszug];
      const job = r.eintrag.i.auftraege.at(-1) as AuftragDerInstallation;
      const { auftragId, aktion: name, zustand, angelegtAm } = job;
      return { ok: true, status: 201, daten: { auftragId, aktion: name, zustand, angelegtAm } };
    },
    logAuszug: async (id, auftragId) => {
      const e = bestand.finden(id);
      const l = auszuege.find((a) => a.auftragId === auftragId);
      return e?.i.auftraege.some((a) => a.auftragId === auftragId) && l
        ? { ok: true, status: 200, daten: l }
        : nein(404, "kein_log_auszug");
    },
  };
};
