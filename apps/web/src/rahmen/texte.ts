import { m } from "@steuerzentrale/ui";
import type { Auftrag, Manifest, Rolle, Sla } from "../daten/typen.ts";
import type { Welle } from "../daten/wellen.ts";

/** Names of the values the data carries as codes, in the interface language */

const ROLLEN: Record<Rolle, () => string> = {
  inhaber: () => m.rolle_inhaber(),
  technik: () => m.rolle_technik(),
  support: () => m.rolle_support(),
};

export const rolleName = (rolle: Rolle): string => ROLLEN[rolle]();

/** The action of a job: "Update auf Haben 1.9.0", "Neustart", "Prüf-Restore" */
export const auftragName = (a: Auftrag, app: Manifest | undefined): string => {
  switch (a.aktion) {
    case "update":
      return m.auftrag_update({ app: app?.name ?? "", version: a.version ?? "" });
    case "neustart":
      return m.auftrag_neustart();
    case "neustart_server":
      return m.auftrag_neustart_server();
    case "pruef_restore":
      return m.auftrag_pruef_restore();
    case "backup":
      return m.auftrag_backup();
  }
};

const STAND: Record<Manifest["stand"], () => string> = {
  stabil: () => m.app_stand_stabil(),
  vorschau: () => m.app_stand_vorschau(),
  entwicklung: () => m.app_stand_entwicklung(),
};

export const standName = (stand: Manifest["stand"]): string => STAND[stand]();

/** Singular or plural by count, for the few texts that need it */
export const anzahl = (
  n: number,
  eins: () => string,
  viele: (p: { n: number }) => string,
): string => (n === 1 ? eins() : viele({ n }));

const WELLEN: Record<Welle, () => string> = {
  intern: () => m.welle_intern(),
  alle: () => m.welle_alle(),
};

export const welleName = (welle: Welle): string => WELLEN[welle]();

const SLAS: Record<Sla, { name: () => string; text: () => string }> = {
  basis: { name: () => m.sla_basis(), text: () => m.sla_basis_text() },
  plus: { name: () => m.sla_plus(), text: () => m.sla_plus_text() },
  ruhe: { name: () => m.sla_ruhe(), text: () => m.sla_ruhe_text() },
};

/** The SLA of a contract and what it means for updates (docs/plan.md, "SLA") */
export const slaName = (sla: Sla): string => SLAS[sla].name();
export const slaText = (sla: Sla): string => SLAS[sla].text();
