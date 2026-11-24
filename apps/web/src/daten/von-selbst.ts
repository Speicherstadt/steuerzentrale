import type { InstallationsAngebot } from "./apps.ts";
import type { BackupZeile } from "./backups.ts";
import type { InstallationAnsicht } from "./installation-ansicht.ts";
import type { ServerAnsicht } from "./server-ansicht.ts";

/*
 * "Von selbst erledigt" of the overview (docs/plan.md, "Übersicht (Oberfläche 2026-11)"): what the
 * Zentrale did since yesterday evening without anyone: backups and test restores that succeeded,
 * updates applied by a wave, reboots its plan made, and the servers unattended-upgrades ran on.
 * Renewed certificates are not counted: the Pforte renews them and nothing reports when. Pure.
 */

export type ErledigtEingabe = {
  backups: {
    letzter: Pick<NonNullable<BackupZeile["letzter"]>, "zeitpunkt" | "ok"> | null;
    pruefRestore: { letzter: { zeitpunkt: number; ok: boolean } | null };
  }[];
  angebote: Pick<InstallationsAngebot, "installationId" | "update">[];
  server: Pick<ServerAnsicht, "neustartStand" | "unattended">[];
  installationen: Pick<InstallationAnsicht, "id" | "appName" | "kundeName">[];
};

export type ErledigtesUpdate = { appName: string; version: string; kunden: string[] };

export type Erledigt = {
  backups: number;
  pruefRestores: number;
  updates: ErledigtesUpdate[];
  neustarts: number;
  sicherheitsupdates: number;
};

const seit = (zeit: number | null | undefined, ab: number) =>
  zeit !== null && zeit !== undefined && zeit >= ab;

/** The updates that ended applied since `ab`, one line per app version */
const updates = (e: ErledigtEingabe, ab: number): ErledigtesUpdate[] => {
  const zeilen = new Map<string, ErledigtesUpdate>();
  for (const a of e.angebote) {
    const u = a.update.letzter;
    const i = e.installationen.find((x) => x.id === a.installationId);
    if (!u || !i || u.phase !== "aktualisiert" || !seit(u.endeAm, ab)) continue;
    const schluessel = `${i.appName} ${u.nachVersion}`;
    const da = zeilen.get(schluessel);
    if (da) da.kunden.push(i.kundeName);
    else
      zeilen.set(schluessel, { appName: i.appName, version: u.nachVersion, kunden: [i.kundeName] });
  }
  return [...zeilen.values()];
};

export const vonSelbst = (e: ErledigtEingabe, ab: number): Erledigt => ({
  backups: e.backups.filter((b) => b.letzter?.ok && seit(b.letzter.zeitpunkt, ab)).length,
  pruefRestores: e.backups.filter(
    (b) => b.pruefRestore.letzter?.ok && seit(b.pruefRestore.letzter.zeitpunkt, ab),
  ).length,
  updates: updates(e, ab),
  neustarts: e.server.filter((s) => {
    const n = s.neustartStand.letzter;
    return n?.zustand === "erfolgreich" && !n.vonHand && seit(n.geaendertAm, ab);
  }).length,
  sicherheitsupdates: e.server.filter((s) => seit(s.unattended?.letzterLauf, ab)).length,
});
