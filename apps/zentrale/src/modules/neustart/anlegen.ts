import { BACKUP_AKTIONEN, KEIN_MANIFEST, SERVER_NEUSTART_AKTION } from "@steuerzentrale/manifest";
import { sperrzeitAm } from "@steuerzentrale/planung";
import { ENDZUSTAENDE } from "@steuerzentrale/protokoll";
import { and, eq } from "drizzle-orm";
import { auftraege } from "../../db/schema.ts";
import { type Kontext, schreiben } from "../audit/index.ts";
import { auftragEinfuegen, auftragVorbereiten, type Vorbereitet } from "../auftraege/anlegen.ts";
import { type Auftrag, auftragLesen } from "../auftraege/lesen.ts";
import { type AuftragDeps, zustellen } from "../auftraege/zustellen.ts";
import { backupAuftragVorbereiten } from "../backups/auftraege.ts";
import { nurBeobachtet, type Server, serverFakten, serverLesen } from "../server/index.ts";
import { zuSichern } from "./lage.ts";
import { sperrzeitenAufServer } from "./sperrzeiten.ts";

/*
 * Making a reboot of a server (BAULISTE.md Z-701; docs/plan.md, "Backup vor dem Neustart",
 * "Neustart von Hand"), by the plan (planen.ts) or by hand, always with a reason: only of a joined
 * server that is not revoked, whose facts name the boot, with no job open on it, every running
 * installation with parts to back up set up for backups, and never in a freeze window of an app on
 * it. One change of the audit log: `installation_backup` for each of those installations, and
 * `server_neustart` for the boot of the facts, waiting for all of them.
 */

export type NeustartFehler =
  | "kein_server"
  | "nicht_beigetreten"
  | "server_gesperrt"
  | "nur_beobachten"
  | "unbekannt"
  | "auftrag_offen"
  | "backup_fehlt"
  | "sperrzeit"
  | "nicht_ausfuehrbar";

export type NeustartAngelegt =
  | { ok: true; backups: Auftrag[]; neustart: Auftrag }
  | { ok: false; grund: NeustartFehler; detail?: string };

type Fehler = Extract<NeustartAngelegt, { ok: false }>;
type Bereit = Extract<Vorbereitet, { ok: true }>;

const nein = (grund: NeustartFehler, detail?: string): Fehler => ({
  ok: false,
  grund,
  ...(detail === undefined ? {} : { detail }),
});

const offen = (deps: AuftragDeps, betreiberId: string, serverId: string): boolean =>
  deps.db
    .select({ zustand: auftraege.zustand })
    .from(auftraege)
    .where(and(eq(auftraege.betreiberId, betreiberId), eq(auftraege.serverId, serverId)))
    .all()
    .some((a) => !ENDZUSTAENDE.has(a.zustand));

/** Why the server cannot be rebooted now; its boot id when it can */
const pruefen = (
  deps: AuftragDeps,
  kontext: Kontext,
  sv: Server | undefined,
): Fehler | { ok: true; sv: Server; bootId: string } => {
  if (!sv) return nein("kein_server");
  if (sv.gesperrtAm !== null) return nein("server_gesperrt");
  if (sv.beigetretenAm === null) return nein("nicht_beigetreten");
  if (nurBeobachtet(sv)) return nein("nur_beobachten");
  const bootId = serverFakten(sv)?.bootId;
  if (!bootId) return nein("unbekannt");
  if (offen(deps, sv.betreiberId, sv.serverId)) return nein("auftrag_offen");
  const sperrzeit = sperrzeitAm(
    sperrzeitenAufServer(deps.db, sv.betreiberId, sv.serverId),
    kontext.jetzt,
  );
  if (sperrzeit) return nein("sperrzeit", sperrzeit.grund);
  return { ok: true, sv, bootId };
};

const vorbereitet = (v: Vorbereitet): Bereit | Fehler =>
  v.ok ? v : nein("nicht_ausfuehrbar", v.detail ?? v.grund);

/** The backups, then the reboot waiting for them, checked and unwritten */
const auftraegeVorbereiten = (
  deps: AuftragDeps,
  kontext: Kontext,
  sv: Server,
  bootId: string,
): { backups: Bereit[]; neustart: Bereit } | Fehler => {
  const sichern = zuSichern(deps.db, sv.betreiberId, sv.serverId);
  if (sichern.ohneBackup > 0) return nein("backup_fehlt", String(sichern.ohneBackup));
  const backups: Bereit[] = [];
  for (const i of sichern.bereit) {
    const b = vorbereitet(backupAuftragVorbereiten(deps, kontext, i, BACKUP_AKTIONEN.jetzt));
    if (!b.ok) return b;
    backups.push(b);
  }
  const vorab = backups.map((b) => b.zeile);
  const neustart = vorbereitet(
    auftragVorbereiten(
      deps,
      kontext,
      {
        serverId: sv.serverId,
        installationId: null,
        aktion: SERVER_NEUSTART_AKTION,
        argumente: { bootId },
        manifest: KEIN_MANIFEST,
        signatur: KEIN_MANIFEST,
        wartetAuf: vorab.map((z) => z.auftragId),
      },
      vorab,
    ),
  );
  return neustart.ok ? { backups, neustart } : neustart;
};

export const neustartAnlegen = (
  deps: AuftragDeps,
  kontext: Kontext,
  serverId: string,
): NeustartAngelegt => {
  const geprueft = pruefen(deps, kontext, serverLesen(deps.db, kontext.betreiberId, serverId));
  if (!geprueft.ok) return geprueft;
  const jobs = auftraegeVorbereiten(deps, kontext, geprueft.sv, geprueft.bootId);
  if ("ok" in jobs) return jobs;
  const geschrieben = schreiben(deps.schreibDb, kontext, "server.neustart", (w) => [
    ...jobs.backups.map((b) => auftragEinfuegen(w, b.zeile)),
    auftragEinfuegen(w, jobs.neustart.zeile),
  ]);
  zustellen(deps, geschrieben);
  // as they are now that the ready ones went out
  const jetzt = geschrieben.map((a) => auftragLesen(deps.db, a.betreiberId, a.auftragId) ?? a);
  const neustart = jetzt.at(-1);
  if (!neustart) throw new Error("reboot written without its job");
  return { ok: true, backups: jetzt.slice(0, -1), neustart };
};
