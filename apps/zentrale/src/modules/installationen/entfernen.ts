import { EINRICHTUNG_AKTIONEN } from "@steuerzentrale/manifest";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import type { Kontext } from "../audit/index.ts";
import { type AnlageFehler, auftragAnlegen } from "../auftraege/anlegen.ts";
import type { Auftrag } from "../auftraege/lesen.ts";
import type { AuftragDeps } from "../auftraege/zustellen.ts";
import { auftraegeDerInstallation, installationLesen } from "./lesen.ts";

/*
 * Removing an installation whose setup failed (BAULISTE.md Z-402): the job `installation_entfernen`
 * takes away whatever the failed setup left; once it succeeded the installation is `entfernt`
 * (zustand.ts). An installation that was set up is removed only with its data after a backup
 * (Z-604), so it is refused here, and the agent refuses it again.
 */

export type Entfernt =
  | { ok: true; auftrag: Auftrag }
  | {
      ok: false;
      grund: "keine_installation" | "nicht_gescheitert" | "entfernen_laeuft" | AnlageFehler;
      detail?: string;
    };

export const installationEntfernen = (
  deps: AuftragDeps,
  kontext: Kontext,
  installationId: string,
): Entfernt => {
  const i = installationLesen(deps.db, kontext.betreiberId, installationId);
  if (!i) return { ok: false, grund: "keine_installation" };
  if (i.zustand !== "gescheitert") return { ok: false, grund: "nicht_gescheitert" };
  const laeuft = auftraegeDerInstallation(deps.db, kontext.betreiberId, installationId).some(
    (a) => a.aktion === EINRICHTUNG_AKTIONEN.entfernen && !ENDZUSTAENDE.has(a.zustand),
  );
  if (laeuft) return { ok: false, grund: "entfernen_laeuft" };
  return auftragAnlegen(deps, kontext, {
    serverId: i.serverId,
    installationId,
    aktion: EINRICHTUNG_AKTIONEN.entfernen,
    argumente: {},
    manifest: i.manifest,
    signatur: i.signatur,
  });
};
