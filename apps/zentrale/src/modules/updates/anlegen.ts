import {
  BACKUP_AKTIONEN,
  type Manifest,
  manifestPruefen,
  type OeffentlicherSchluessel,
  UPDATE_AKTION,
} from "@steuerzentrale/manifest";
import { sperrzeitAm, versionVergleichen, type Welle } from "@steuerzentrale/planung";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import type { UPDATE_ANLAESSE } from "../../db/schema.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { auftragEinfuegen, auftragVorbereiten, type Vorbereitet } from "../auftraege/anlegen.ts";
import { type Auftrag, auftragLesen } from "../auftraege/lesen.ts";
import { type AuftragDeps, zustellen } from "../auftraege/zustellen.ts";
import { backupAuftragVorbereiten, backupEingerichtet } from "../backups/auftraege.ts";
import { gewaehltesManifest } from "../installationen/anlegen.ts";
import { einrichtungAus } from "../installationen/einrichtung.ts";
import { konfigurationZeile } from "../installationen/konfiguration.ts";
import {
  auftraegeDerInstallation,
  type Installation,
  installationLesen,
} from "../installationen/lesen.ts";
import type { Zufall } from "../installationen/werte.ts";
import { updateAufServer } from "./lesen.ts";
import { type NeueWerte, updateWerte } from "./werte.ts";

/*
 * Making an update (BAULISTE.md Z-503; docs/plan.md, "Update in der Zentrale (Z-503)"), by hand or
 * by the plan (planung.ts), always with a reason: only of a running installation whose backups are
 * set up, that has no open job and whose server has no other update under way, to an imported
 * version newer than its own that it is offered (a pre-release only to an internal customer) and
 * whose signature holds. Its values must fit the new manifest (werte.ts) and render with it. Never
 * in a freeze window of the app (the old or the new manifest's), unless the owner passes over it by
 * hand (`sperrzeitUebergehen`), which the row keeps. Two jobs in one change of the audit log, as
 * for a restore: `installation_backup` keeps the current state, `installation_update` with the new
 * manifest waits for it and gets its snapshots when it ends (ende.ts). The asked values wait in
 * their own row until the update holds (modules/installationen, konfiguration.ts).
 */

export type UpdateFehler =
  | "keine_installation"
  | "laeuft_nicht"
  | "nicht_eingerichtet"
  | "auftrag_offen"
  | "server_belegt"
  | "kein_manifest"
  | "nicht_angeboten"
  | "signatur_ungueltig"
  | "manifest_ungueltig"
  | "sperrzeit"
  | NonNullable<Extract<NeueWerte, { ok: false }>["grund"]>
  | "nicht_ausfuehrbar";

export type UpdateAngelegt =
  | { ok: true; backup: Auftrag; update: Auftrag }
  | { ok: false; grund: UpdateFehler; detail?: string };

type Fehler = Extract<UpdateAngelegt, { ok: false }>;

export type UpdateDeps = AuftragDeps & { zufall: Zufall };

export type UpdateWunsch = {
  version: string;
  anlass: (typeof UPDATE_ANLAESSE)[number];
  welle?: Welle;
  /** Only the owner by hand, with a reason: an update in a freeze window of the app */
  sperrzeitUebergehen: boolean;
};

const nein = (grund: UpdateFehler, detail?: string): Fehler => ({
  ok: false,
  grund,
  ...(detail === undefined ? {} : { detail }),
});

/** Why the installation cannot be updated now, before its new version is looked at */
const gesperrt = (deps: UpdateDeps, i: Installation): Fehler | undefined => {
  if (i.zustand !== "laeuft") return nein("laeuft_nicht");
  if (!backupEingerichtet(deps.db, i.betreiberId, i.installationId))
    return nein("nicht_eingerichtet");
  const offen = auftraegeDerInstallation(deps.db, i.betreiberId, i.installationId).some(
    (a) => !ENDZUSTAENDE.has(a.zustand),
  );
  if (offen) return nein("auftrag_offen");
  return updateAufServer(deps.db, i.betreiberId, i.serverId) ? nein("server_belegt") : undefined;
};

type Gewaehlt = { manifest: Manifest; text: string; signatur: string };

/** The imported manifest of the version, newer than the installation's and offered to it */
const neueVersion = (
  deps: UpdateDeps,
  schluessel: OeffentlicherSchluessel,
  i: Installation,
  version: string,
): ({ ok: true } & Gewaehlt) | Fehler => {
  if (versionVergleichen(version, i.version) <= 0) return nein("nicht_angeboten");
  const g = gewaehltesManifest(deps.db, schluessel, i.betreiberId, { ...i, version });
  if (g.ok) return g;
  if (g.grund === "nur_intern" || g.grund === "kein_kunde") return nein("nicht_angeboten");
  if (g.grund === "signatur_ungueltig" || g.grund === "kein_manifest") return nein(g.grund);
  return nein("manifest_ungueltig", g.detail);
};

/** The freeze window now of the old or the new manifest, unless the owner passes over it */
const inSperrzeit = (
  i: Installation,
  neu: Manifest,
  jetzt: number,
): ReturnType<typeof sperrzeitAm> => {
  const alt = manifestPruefen(i.manifest);
  return sperrzeitAm([...(alt.ok ? alt.manifest.sperrzeiten : []), ...neu.sperrzeiten], jetzt);
};

type Bereit = Extract<Vorbereitet, { ok: true }>;

const vorbereitet = (v: Vorbereitet): Bereit | Fehler =>
  v.ok ? v : nein("nicht_ausfuehrbar", v.detail ?? v.grund);

/** Both jobs checked, unwritten: the backup, then the update waiting for it */
const auftraegeVorbereiten = (
  deps: UpdateDeps,
  kontext: Kontext,
  i: Installation,
  g: Gewaehlt,
  werte: Extract<NeueWerte, { ok: true }>,
): { backup: Bereit; update: Bereit } | Fehler => {
  const backup = vorbereitet(backupAuftragVorbereiten(deps, kontext, i, BACKUP_AKTIONEN.jetzt));
  if (!backup.ok) return backup;
  const einrichtung = einrichtungAus(
    { ...i, einstellungen: JSON.stringify(werte.offen) },
    werte.geheim,
  );
  const update = vorbereitet(
    auftragVorbereiten(
      deps,
      kontext,
      {
        serverId: i.serverId,
        installationId: i.installationId,
        aktion: UPDATE_AKTION,
        argumente: {},
        manifest: g.text,
        signatur: g.signatur,
        wartetAuf: [backup.zeile.auftragId],
        einrichtung,
      },
      [backup.zeile],
    ),
  );
  return update.ok ? { backup, update } : update;
};

export const updateAnlegen = (
  deps: UpdateDeps,
  kontext: Kontext,
  schluessel: OeffentlicherSchluessel,
  installationId: string,
  wunsch: UpdateWunsch,
): UpdateAngelegt => {
  const i = installationLesen(deps.db, kontext.betreiberId, installationId);
  if (!i) return nein("keine_installation");
  const sperre = gesperrt(deps, i);
  if (sperre) return sperre;
  const g = neueVersion(deps, schluessel, i, wunsch.version);
  if (!g.ok) return g;
  const sperrzeit = inSperrzeit(i, g.manifest, kontext.jetzt);
  if (sperrzeit && !wunsch.sperrzeitUebergehen) return nein("sperrzeit", sperrzeit.grund);
  const werte = updateWerte(deps, i, g.manifest);
  if (!werte.ok) return werte;
  const jobs = auftraegeVorbereiten(deps, kontext, i, g, werte);
  if ("ok" in jobs) return jobs;
  const ziel = { ...kontext, auftragId: jobs.update.zeile.auftragId, installationId };
  const geschrieben = schreiben(deps.schreibDb, kontext, "installation.update", (w) => {
    const b = auftragEinfuegen(w, jobs.backup.zeile);
    const u = auftragEinfuegen(w, jobs.update.zeile);
    w.einfuegen(
      "installationKonfigurationen",
      konfigurationZeile(deps.schluessel, ziel, werte.offen, werte.geheim),
    );
    w.einfuegen("updates", {
      betreiberId: i.betreiberId,
      auftragId: u.auftragId,
      backupAuftragId: b.auftragId,
      installationId,
      serverId: i.serverId,
      app: i.app,
      vonVersion: i.version,
      nachVersion: g.manifest.version,
      anlass: wunsch.anlass,
      welle: wunsch.welle ?? null,
      sperrzeitUebergangen: sperrzeit !== undefined,
      angefordertAm: kontext.jetzt,
    });
    return [b, u] as const;
  });
  zustellen(deps, geschrieben);
  const lesen = (a: Auftrag) => auftragLesen(deps.db, kontext.betreiberId, a.auftragId) ?? a;
  return { ok: true, backup: lesen(geschrieben[0]), update: lesen(geschrieben[1]) };
};
