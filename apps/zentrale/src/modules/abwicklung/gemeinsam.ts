import { randomUUID } from "node:crypto";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { type Kontext, type Schreiber, schreiben } from "../audit/index.ts";
import { auftragEinfuegen } from "../auftraege/anlegen.ts";
import { type AuftragDeps, zustellen } from "../auftraege/zustellen.ts";
import { naechsterVersuch } from "../dns/index.ts";
import { auftraegeDerInstallation } from "../installationen/lesen.ts";
import type { Kette } from "./auftraege.ts";
import { type Abwicklung, protokollVon } from "./lesen.ts";

/*
 * What every step after a contract's end shares (BAULISTE.md Z-604): its writer's context (actor
 * `system`), the next line of the deletion log, events, the jobs of a chain and a failure's backoff.
 */

export type AbwicklungDeps = AuftragDeps & { fetch: typeof fetch; neueId?: () => string };

export const GELOESCHT_ART = "installation_geloescht";
export const ARCHIV_GESCHEITERT_ART = "archiv_gescheitert";
export const LOESCHUNG_GESCHEITERT_ART = "loeschung_gescheitert";

export const systemKontext = (betreiberId: string, jetzt: number, grund: string): Kontext => ({
  betreiberId,
  akteur: "system",
  jetzt,
  grund,
});

export const mitEintrag = (
  a: Pick<Abwicklung, "protokoll">,
  schritt: string,
  z: number,
  detail: string,
) => JSON.stringify([...protokollVon(a), { schritt, zeitpunkt: z, detail }]);

const ziel = (installationId: string) => `installation:${installationId}`;

export const ereignis = (
  w: Schreiber,
  deps: AbwicklungDeps,
  a: { betreiberId: string; installationId: string },
  e: { art: string; schwere: "info" | "warn" | "fehler"; text: string; jetzt: number },
) =>
  w.einfuegen("ereignisse", {
    betreiberId: a.betreiberId,
    ereignisId: (deps.neueId ?? randomUUID)(),
    zeitpunkt: e.jetzt,
    art: e.art,
    schwere: e.schwere,
    ziel: ziel(a.installationId),
    text: e.text.slice(0, 2000),
  });

export const offenerAuftrag = (deps: AuftragDeps, betreiberId: string, installationId: string) =>
  auftraegeDerInstallation(deps.db, betreiberId, installationId).some(
    (a) => !ENDZUSTAENDE.has(a.zustand),
  );

/** Writes the chain's jobs in the change, then sends those that are ready */
export const kettenSchreiben = (
  deps: AbwicklungDeps,
  k: Kontext,
  aktion: string,
  kette: Extract<Kette, { ok: true }>,
  dazu: (w: Schreiber) => void,
) => {
  const geschrieben = schreiben(deps.schreibDb, k, aktion, (w) => {
    const zeilen = kette.zeilen.map((z) => auftragEinfuegen(w, z));
    dazu(w);
    return zeilen;
  });
  zustellen(deps, geschrieben);
};

/** A failed step: one more attempt later, an event on the first failure of a series */
export const fehlschlag = (
  deps: AbwicklungDeps,
  a: Abwicklung,
  jetzt: number,
  art: string,
  text: string,
  werte: Partial<Abwicklung> = {},
) => {
  const versuche = a.versuche + 1;
  schreiben(deps.schreibDb, systemKontext(a.betreiberId, jetzt, text), "abwicklung.fehler", (w) => {
    w.aendern(
      "abwicklungen",
      { installationId: a.installationId },
      {
        ...werte,
        versuche,
        naechsterVersuch: naechsterVersuch(versuche, jetzt),
        geaendertAm: jetzt,
      },
    );
    if (versuche === 1) ereignis(w, deps, a, { art, schwere: "fehler", text, jetzt });
  });
};
