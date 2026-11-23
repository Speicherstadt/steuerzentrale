import {
  type Manifest,
  manifestPruefen,
  type PlatzBefund,
  type PlatzServer,
  PRUEF_RESTORE_AKTION,
} from "@steuerzentrale/manifest";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/oeffnen.ts";
import { auftraege, backups } from "../../db/schema.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { auftragEinfuegen, auftragVorbereiten } from "../auftraege/anlegen.ts";
import { type Auftrag, auftragLesen } from "../auftraege/lesen.ts";
import { type AuftragDeps, zustellen } from "../auftraege/zustellen.ts";
import { backupEingerichtet } from "../backups/auftraege.ts";
import { einrichtungFuer } from "../installationen/einrichtung.ts";
import {
  auftraegeDerInstallation,
  type Installation,
  installationLesen,
  vergebenePorts,
} from "../installationen/lesen.ts";
import { platzPruefen } from "../installationen/platz.ts";
import { namensteil, portbedarf, portsVergeben, type Vergeben } from "../installationen/vergabe.ts";
import type { Zufall } from "../installationen/werte.ts";
import { kopieVergeben, portsAus, portsVormerken } from "./kopie.ts";

/*
 * Making a test restore (BAULISTE.md Z-602; docs/plan.md, "Prüf-Restore (Z-602)"), for the schedule
 * and for "Prüf-Restore jetzt": only for a running installation whose backups are set up and which
 * has a successful run, never while another job of it is open or another test restore runs on its
 * server, and only on its own server, when the placement of one more installation like it fits
 * there (or fits with notes). The copy gets the name `restore-<6>` and ports of its own, kept in
 * the same transaction as the job; its settings go into the job only when it is sent (kopie.ts).
 */

export type PruefDeps = AuftragDeps & {
  zufall: Zufall;
  verbunden: (betreiberId: string, serverId: string) => boolean;
};

export type PruefFehler =
  | "keine_installation"
  | "laeuft_nicht"
  | "nicht_eingerichtet"
  | "kein_backup"
  | "auftrag_offen"
  | "server_belegt"
  | "kein_platz"
  | "keine_ports"
  | "nicht_ausfuehrbar";

export type PruefAngelegt =
  | { ok: true; auftrag: Auftrag }
  | { ok: false; grund: PruefFehler; detail?: string; gruende?: PlatzBefund[] };

type Fehler = Extract<PruefAngelegt, { ok: false }>;

/** Whether the installation has a successful backup run at all */
export const hatErfolg = (db: Db, betreiberId: string, installationId: string): boolean =>
  db
    .select({ id: backups.backupId })
    .from(backups)
    .where(
      and(
        eq(backups.betreiberId, betreiberId),
        eq(backups.installationId, installationId),
        eq(backups.ok, true),
      ),
    )
    .get() !== undefined;

/** The operator's test restores on a server that have not ended */
export const offenAufServer = (db: Db, betreiberId: string, serverId: string): Auftrag[] =>
  db
    .select()
    .from(auftraege)
    .where(
      and(
        eq(auftraege.betreiberId, betreiberId),
        eq(auftraege.serverId, serverId),
        eq(auftraege.aktion, PRUEF_RESTORE_AKTION),
      ),
    )
    .all()
    .filter((a) => !ENDZUSTAENDE.has(a.zustand));

/** Why the installation cannot have a test restore now, before its placement */
const gesperrt = (db: Db, i: Installation | undefined): Fehler | undefined => {
  if (!i) return { ok: false, grund: "keine_installation" };
  if (i.zustand !== "laeuft") return { ok: false, grund: "laeuft_nicht" };
  if (!backupEingerichtet(db, i.betreiberId, i.installationId))
    return { ok: false, grund: "nicht_eingerichtet" };
  if (!hatErfolg(db, i.betreiberId, i.installationId)) return { ok: false, grund: "kein_backup" };
  const offen = auftraegeDerInstallation(db, i.betreiberId, i.installationId).some(
    (a) => !ENDZUSTAENDE.has(a.zustand),
  );
  if (offen) return { ok: false, grund: "auftrag_offen" };
  if (offenAufServer(db, i.betreiberId, i.serverId).length > 0)
    return { ok: false, grund: "server_belegt" };
  return undefined;
};

type Platz = { ok: true; manifest: Manifest; server: PlatzServer } | Fehler;

/** One more installation like this one on its own server: fits, or fits with notes */
export const platzFuerKopie = (deps: PruefDeps, i: Installation): Platz => {
  const m = manifestPruefen(i.manifest);
  if (!m.ok) return { ok: false, grund: "nicht_ausfuehrbar", detail: "manifest_ungueltig" };
  const platz = platzPruefen(deps, i.betreiberId, {
    kundeId: i.kundeId,
    serverId: i.serverId,
    manifest: m.manifest,
    optionen: JSON.parse(i.optionen) as string[],
  });
  if (!platz.ok) return { ok: false, grund: "kein_platz", detail: platz.grund };
  if (platz.platzierung.art === "passt_nicht")
    return { ok: false, grund: "kein_platz", gruende: platz.platzierung.gruende };
  if (!platz.platzServer) return { ok: false, grund: "kein_platz", detail: "fakten_fehlen" };
  return { ok: true, manifest: m.manifest, server: platz.platzServer };
};

/** A name `restore-<6>` that no copy of the operator holds now */
const kopieName = (deps: PruefDeps, betreiberId: string): string | undefined => {
  for (let versuch = 0; versuch < 10; versuch++) {
    const name = `restore-${namensteil(deps.zufall)}`;
    if (
      !kopieVergeben(deps.db, betreiberId, name) &&
      !installationLesen(deps.db, betreiberId, name)
    )
      return name;
  }
  return undefined;
};

type Plan = { kopie: string; vergeben: Vergeben };

const planen = (
  deps: PruefDeps,
  i: Installation,
  p: Extract<Platz, { ok: true }>,
): Plan | Fehler => {
  const kopie = kopieName(deps, i.betreiberId);
  if (!kopie) return { ok: false, grund: "nicht_ausfuehrbar", detail: "kein_name" };
  const belegt = new Set([
    ...vergebenePorts(deps.db, i.betreiberId, i.serverId),
    ...p.server.portsBelegt.map((x) => x.port),
  ]);
  const vergeben = portsVergeben(
    portbedarf(p.manifest, JSON.parse(i.optionen) as string[]),
    belegt,
  );
  return vergeben ? { kopie, vergeben } : { ok: false, grund: "keine_ports" };
};

/** The copy's data with its ports, as the job will carry it when sent; only to check the job */
const einrichtungDerKopie = (deps: PruefDeps, i: Installation, vergeben: Vergeben) => {
  const e = einrichtungFuer(deps, i.betreiberId, i.installationId);
  if (!e.ok) return e;
  const installation = { ...e.einrichtung.installation, ...portsAus(vergeben) };
  return { ok: true as const, einrichtung: { ...e.einrichtung, installation } };
};

/** The job `installation_pruef_restore` for the installation, with the copy's ports kept */
export const pruefRestoreAnlegen = (
  deps: PruefDeps,
  kontext: Kontext,
  installationId: string,
): PruefAngelegt => {
  const i = installationLesen(deps.db, kontext.betreiberId, installationId);
  const nein = gesperrt(deps.db, i);
  if (nein || !i) return nein ?? { ok: false, grund: "keine_installation" };
  const platz = platzFuerKopie(deps, i);
  if (!platz.ok) return platz;
  const plan = planen(deps, i, platz);
  if ("ok" in plan) return plan;
  const kopie = einrichtungDerKopie(deps, i, plan.vergeben);
  if (!kopie.ok) return { ok: false, grund: "nicht_ausfuehrbar", detail: kopie.grund };
  const vorbereitet = auftragVorbereiten(deps, kontext, {
    serverId: i.serverId,
    installationId: i.installationId,
    aktion: PRUEF_RESTORE_AKTION,
    argumente: { kopie: plan.kopie },
    manifest: i.manifest,
    signatur: i.signatur,
    einrichtung: kopie.einrichtung,
  });
  if (!vorbereitet.ok)
    return {
      ok: false,
      grund: "nicht_ausfuehrbar",
      detail: vorbereitet.detail ?? vorbereitet.grund,
    };
  const auftrag = schreiben(deps.schreibDb, kontext, "installation.pruef-restore", (w) => {
    const ort = { betreiberId: i.betreiberId, serverId: i.serverId, installationId };
    portsVormerken(w, ort, plan.kopie, plan.vergeben);
    return auftragEinfuegen(w, vorbereitet.zeile);
  });
  zustellen(deps, [auftrag]);
  return {
    ok: true,
    auftrag: auftragLesen(deps.db, kontext.betreiberId, auftrag.auftragId) ?? auftrag,
  };
};
