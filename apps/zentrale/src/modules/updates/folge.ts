import {
  BACKUP_AKTIONEN,
  type Manifest,
  manifestPruefen,
  PFORTE_AKTIONEN,
} from "@steuerzentrale/manifest";
import type { Schreiber } from "../audit/index.ts";
import { auftragEinfuegen, auftragVorbereiten, type Vorbereitet } from "../auftraege/anlegen.ts";
import type { Auftrag } from "../auftraege/lesen.ts";
import type { AuftragDeps } from "../auftraege/zustellen.ts";
import { backupAuftragVorbereiten } from "../backups/auftraege.ts";
import { backupFeldFuer } from "../backups/feld.ts";
import type { Installation } from "../installationen/lesen.ts";

/*
 * What follows an update that holds (BAULISTE.md Z-503; docs/plan.md, "Folgeaufträge nach einem
 * Update (Z-503)"): the agent replaces the units but leaves the installation's backup.json and the
 * Pforte's route as they were. When the new manifest names other parts to back up, the Zentrale
 * sets the backups up anew with it (`installation_backup_einrichten`, its access added when sent);
 * when it names another HTTP service for the route, it sets the route anew
 * (`pforte_route_setzen` with the installation's host and assigned port, which an update keeps).
 * Both are made in the transaction that records the update's end and go out at once.
 */

const gleich = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const KONTEXT_GRUND = "Folgeauftrag nach dem Update";

const geschrieben = (w: Schreiber, v: Vorbereitet): Auftrag[] =>
  v.ok ? [auftragEinfuegen(w, v.zeile)] : [];

export const folgeauftraege = (
  w: Schreiber,
  deps: AuftragDeps,
  alt: Installation,
  neu: { manifest: string; signatur: string },
  jetzt: number,
): Auftrag[] => {
  const vorher = manifestPruefen(alt.manifest);
  const nachher = manifestPruefen(neu.manifest);
  if (!vorher.ok || !nachher.ok) return [];
  const i: Installation = { ...alt, manifest: neu.manifest, signatur: neu.signatur };
  const kontext = { betreiberId: alt.betreiberId, akteur: "system", jetzt, grund: KONTEXT_GRUND };
  return [
    ...backupNeu(w, deps, kontext, i, vorher.manifest, nachher.manifest),
    ...routeNeu(w, deps, kontext, i, vorher.manifest, nachher.manifest),
  ];
};

type Kontext = Parameters<typeof auftragVorbereiten>[1];

const backupNeu = (
  w: Schreiber,
  deps: AuftragDeps,
  kontext: Kontext,
  i: Installation,
  vorher: Manifest,
  nachher: Manifest,
): Auftrag[] => {
  if (gleich(vorher.backup, nachher.backup) || nachher.backup.length === 0) return [];
  const feld = backupFeldFuer(deps, i.betreiberId, i.installationId, i.serverId);
  if (!feld.ok) return [];
  return geschrieben(
    w,
    backupAuftragVorbereiten(deps, kontext, i, BACKUP_AKTIONEN.einrichten, feld.backup),
  );
};

const routeNeu = (
  w: Schreiber,
  deps: AuftragDeps,
  kontext: Kontext,
  i: Installation,
  vorher: Manifest,
  nachher: Manifest,
): Auftrag[] => {
  const route = (m: Manifest) => ({ proxy: m.proxy, http: m.netz.http });
  if (gleich(route(vorher), route(nachher)) || i.httpPort === null) return [];
  return geschrieben(
    w,
    auftragVorbereiten(deps, kontext, {
      serverId: i.serverId,
      installationId: i.installationId,
      aktion: PFORTE_AKTIONEN.setzen,
      argumente: { host: i.host, port: i.httpPort },
      manifest: i.manifest,
      signatur: i.signatur,
    }),
  );
};
