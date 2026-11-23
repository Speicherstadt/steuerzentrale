import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import type { AuftragZustand } from "@steuerzentrale/protokoll";
import type { Db } from "../../db/oeffnen.ts";
import type { INSTALLATIONS_ZUSTAENDE } from "../../db/schema.ts";
import type { Schluesselbund } from "../../db/schluessel.ts";
import type { Schreiber } from "../audit/index.ts";
import { dnsNachEntfernen } from "../dns/index.ts";
import { konfigurationAbschliessen } from "./konfiguration.ts";
import { installationLesen, portsDerInstallation } from "./lesen.ts";

/*
 * What the end of a setup job means for its installation (BAULISTE.md Z-402): set up, it runs; failed
 * or cancelled, it failed; removed, it is gone and its ports are free again; configured anew
 * (Z-404), it runs with the asked values, after a failure with its old ones; removed, its DNS
 * records are due for deletion (Z-407). Runs inside the
 * transaction that records the job's end (modules/auftraege/melden.ts), so the installation's state
 * and the job's never disagree.
 */

type InstallationsZustand = (typeof INSTALLATIONS_ZUSTAENDE)[number];

/** The installation's new state after its setup job ended, or undefined when nothing changes */
export const zustandNach = (
  aktion: string,
  jetzt: InstallationsZustand,
  auftrag: AuftragZustand,
): InstallationsZustand | undefined => {
  if (aktion === EINRICHTUNG_AKTIONEN.einrichten && jetzt === "wird_eingerichtet") {
    if (auftrag === "erfolgreich") return "laeuft";
    if (auftrag === "gescheitert" || auftrag === "abgebrochen") return "gescheitert";
  }
  if (
    aktion === EINRICHTUNG_AKTIONEN.entfernen &&
    jetzt === "gescheitert" &&
    auftrag === "erfolgreich"
  )
    return "entfernt";
  return undefined;
};

export const installationFortschreiben = (
  w: Schreiber,
  deps: { db: Db; schluessel: Schluesselbund },
  a: { betreiberId: string; auftragId: string; installationId: string | null; aktion: string },
  auftrag: AuftragZustand,
  jetzt: number,
): void => {
  if (a.installationId === null) return;
  if (a.aktion === EINRICHTUNG_AKTIONEN.konfigurieren) {
    konfigurationAbschliessen(w, deps, a, auftrag === "erfolgreich", jetzt);
    return;
  }
  const { db } = deps;
  const i = installationLesen(db, a.betreiberId, a.installationId);
  const neu = i && zustandNach(a.aktion, i.zustand, auftrag);
  if (!i || !neu) return;
  w.aendern(
    "installationen",
    { installationId: i.installationId },
    {
      zustand: neu,
      geaendertAm: jetzt,
      ...(neu === "entfernt" ? dnsNachEntfernen(i.dns, jetzt) : {}),
    },
  );
  if (neu === "entfernt")
    for (const p of portsDerInstallation(db, a.betreiberId, i.installationId))
      w.loeschen("installationsPorts", p);
};
