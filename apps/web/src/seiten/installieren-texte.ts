import { m } from "@steuerzentrale/ui";
import type { Fehlschlag, Grund } from "../anmeldung/api.ts";
import type { AuftragsZustand } from "../daten/installationen.ts";

/*
 * The texts of installing (BAULISTE.md Z-402): every error code of the API and every reason of the
 * placement in the interface language, as the Zentrale hands them over as codes with values
 * (docs/plan.md, "Platzierung im Dialog"). An unknown code still shows, with its name.
 */

const FEHLER: Record<string, () => string> = {
  signatur_ungueltig: m.inst_fehler_signatur_ungueltig,
  manifest_ungueltig: m.inst_fehler_manifest_ungueltig,
  nicht_einrichtbar: m.inst_fehler_nicht_einrichtbar,
  kein_kunde: m.inst_fehler_kein_kunde,
  kein_server: m.inst_fehler_kein_server,
  keine_installation: m.inst_fehler_keine_installation,
  server_gesperrt: m.inst_fehler_server_gesperrt,
  passt_nicht: m.inst_fehler_passt_nicht,
  host_vergeben: m.inst_fehler_host_vergeben,
  keine_ports: m.inst_fehler_keine_ports,
  nicht_gescheitert: m.inst_fehler_nicht_gescheitert,
  entfernen_laeuft: m.inst_fehler_entfernen_laeuft,
  laeuft_nicht: m.inst_fehler_laeuft_nicht,
  sperrzeit: m.inst_fehler_sperrzeit,
  auftrag_offen: m.inst_fehler_auftrag_offen,
  kein_manifest: m.inst_fehler_kein_manifest,
  nur_intern: m.inst_fehler_nur_intern,
  version_vergeben: m.inst_fehler_version_vergeben,
  werte_unlesbar: m.inst_fehler_werte_unlesbar,
  einstellung_ungueltig: m.inst_fehler_einstellung_ungueltig,
  ungueltig: m.inst_fehler_ungueltig,
  kein_schluessel: m.inst_fehler_kein_schluessel,
  keine_berechtigung: m.fehler_keine_berechtigung,
  netz: m.fehler_netz,
};

/** The error of the API as one sentence, with the Zentrale's detail where it gave one */
export const installationsFehler = (f: Pick<Fehlschlag, "fehler" | "detail">): string => {
  const text = (FEHLER[f.fehler] ?? m.fehler_unbekannt)();
  return f.detail ? m.inst_fehler_mit_detail({ text, detail: f.detail }) : text;
};

type Werte = Grund["werte"];
const w = (werte: Werte, name: string) => String(werte[name] ?? "");

const GRUENDE: Record<string, (werte: Werte) => string> = {
  unbekannte_option: (x) => m.platz_unbekannte_option({ option: w(x, "option") }),
  server_anderer_betreiber: () => m.platz_server_anderer_betreiber(),
  agent_getrennt: () => m.platz_agent_getrennt(),
  kein_image: (x) => m.platz_kein_image({ container: w(x, "container") }),
  architektur: (x) =>
    x.option === undefined
      ? m.platz_architektur_container({ container: w(x, "container"), server: w(x, "server") })
      : m.platz_architektur_option({ option: w(x, "option"), server: w(x, "server") }),
  ram: (x) => m.platz_ram({ bedarf: w(x, "bedarf"), verfuegbar: w(x, "verfuegbar") }),
  ram_knapp: (x) => m.platz_ram_knapp({ prozent: w(x, "prozent") }),
  platte: (x) => m.platz_platte({ bedarf: w(x, "bedarf"), verfuegbar: w(x, "verfuegbar") }),
  platte_knapp: (x) => m.platz_platte_knapp({ prozent: w(x, "prozent") }),
  port_belegt: (x) => m.platz_port_belegt({ port: w(x, "port"), proto: w(x, "proto") }),
  keine_oeffentliche_ipv4: () => m.platz_keine_oeffentliche_ipv4(),
  kein_ptr: () => m.platz_kein_ptr(),
  port25_gesperrt: () => m.platz_port25_gesperrt(),
  braucht_server_fuer_sich: (x) => m.platz_braucht_server_fuer_sich({ andere: w(x, "andere") }),
  server_belegt_fuer_sich: () => m.platz_server_belegt_fuer_sich(),
  braucht_dienst: (x) => m.platz_braucht_dienst({ dienst: w(x, "dienst") }),
  betreiberwert_fehlt: (x) => m.platz_betreiberwert_fehlt({ name: w(x, "name") }),
  fakten_fehlen: (x) => m.platz_fakten_fehlen({ fakten: w(x, "fakten") }),
  nur_beobachten: () => m.platz_nur_beobachten(),
  installation_unlesbar: (x) =>
    m.platz_installation_unlesbar({ installation: w(x, "installation") }),
};

/** A reason or hint of the placement as one sentence */
export const grundText = (g: Grund): string =>
  GRUENDE[g.code]?.(g.werte) ?? m.platz_unbekannt({ code: g.code });

const AKTIONEN: Record<string, () => string> = {
  installation_einrichten: m.auftrag_installation_einrichten,
  installation_entfernen: m.auftrag_installation_entfernen,
  installation_konfigurieren: m.auftrag_installation_konfigurieren,
  installation_neustart: m.auftrag_installation_neustart,
  installation_log_auszug: m.auftrag_installation_log_auszug,
  installation_backup_einrichten: m.auftrag_installation_backup_einrichten,
  installation_backup: m.auftrag_installation_backup,
  installation_pruef_restore: m.auftrag_installation_pruef_restore,
  installation_wiederherstellen: m.auftrag_installation_wiederherstellen,
  pforte_route_setzen: m.auftrag_pforte_route_setzen,
  pforte_route_entfernen: m.auftrag_pforte_route_entfernen,
  server_neustart: m.auftrag_server_neustart,
};

/** The name of a job of an installation; a job the interface does not know keeps its code */
export const aktionsText = (aktion: string): string => AKTIONEN[aktion]?.() ?? aktion;

const AUFTRAGS_ZUSTAND: Record<AuftragsZustand, () => string> = {
  wartend: m.auftrag_z_wartend,
  bereit: m.auftrag_z_bereit,
  zugestellt: m.auftrag_z_zugestellt,
  bestaetigt: m.auftrag_z_bestaetigt,
  laeuft: m.auftrag_laeuft,
  erfolgreich: m.auftrag_z_erfolgreich,
  gescheitert: m.auftrag_gescheitert,
  abgebrochen: m.auftrag_z_abgebrochen,
};

export const auftragsZustandText = (z: AuftragsZustand): string => AUFTRAGS_ZUSTAND[z]();
