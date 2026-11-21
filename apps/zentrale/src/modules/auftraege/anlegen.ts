import { createHash, randomUUID } from "node:crypto";
import {
  type ArgumentWert,
  befehlFuellen,
  befehlZurAktion,
  INSTALLATIONS_NAME,
  istPforteAktion,
  type Manifest,
  manifestPruefen,
  PFORTE_ZEITLIMIT_S,
  pforteAuftragPruefen,
  STANDARD_ZEITLIMIT_S,
} from "@steuerzentrale/manifest";
import { type Kontext, schreiben } from "../audit/index.ts";
import { serverLesen } from "../server/index.ts";
import { startzustand, zyklusIn } from "./abhaengigkeiten.ts";
import { type Auftrag, auftragLesen, vorgaengerVon, zustaendeLesen } from "./lesen.ts";
import { type AuftragDeps, auftragNachricht, zustellen } from "./zustellen.ts";

/*
 * Making a job (BAULISTE.md Z-305), for now only from within the Zentrale (installing, updating and
 * the interface come with their items): the action must be a command of the manifest and the
 * arguments must fit it, checked here already so a wrong job never waits; the agent checks all of
 * it again, and the signature, before it runs anything. A job may wait for jobs of its operator on
 * any server; it is ready once they all succeeded and then goes to its agent at once. A job of the
 * Pforte (Z-401) is no command of the manifest but one of the Steuerzentrale's own, with a fixed
 * shape (packages/manifest, pforte/auftraege.ts).
 */

export type NeuerAuftrag = {
  serverId: string;
  /** The installation (its name, as in its units) whose container runs the command */
  installationId: string | null;
  /** The name of a command under `befehle` in the manifest, or a job of the Pforte */
  aktion: string;
  argumente: Record<string, ArgumentWert>;
  /** The manifest's exact text and its minisign signature (`manifest.yml.minisig`) */
  manifest: string;
  signatur: string;
  wartetAuf?: readonly string[];
  /** A caller's own id, so that making the same job again is refused instead of doubled */
  auftragId?: string;
};

export type AnlageFehler =
  | "server_unbekannt"
  | "server_gesperrt"
  | "manifest_ungueltig"
  | "aktion_unbekannt"
  | "argumente_ungueltig"
  | "installation_fehlt"
  | "vorgaenger_unbekannt"
  | "zyklus"
  | "auftrag_vorhanden"
  | "nachricht_ungueltig";

export type Angelegt =
  | { ok: true; auftrag: Auftrag }
  | { ok: false; grund: AnlageFehler; detail?: string };

type Geprueft =
  | { ok: true; manifest: Manifest; zeitlimitS: number }
  | { ok: false; grund: AnlageFehler; detail?: string };

/** The job against its manifest: a command it names, with arguments that fit */
const gegenManifest = (neu: NeuerAuftrag): Geprueft => {
  const geprueft = manifestPruefen(neu.manifest);
  if (!geprueft.ok)
    return { ok: false, grund: "manifest_ungueltig", detail: geprueft.fehler.join("; ") };
  if (istPforteAktion(neu.aktion)) {
    const pforte = pforteAuftragPruefen(geprueft.manifest, neu);
    return pforte.ok
      ? { ok: true, manifest: geprueft.manifest, zeitlimitS: PFORTE_ZEITLIMIT_S }
      : { ok: false, grund: "argumente_ungueltig", detail: pforte.grund };
  }
  const befehl = befehlZurAktion(geprueft.manifest, neu.aktion);
  if (!befehl) return { ok: false, grund: "aktion_unbekannt", detail: neu.aktion };
  const gefuellt = befehlFuellen(befehl, neu.argumente);
  if (!gefuellt.ok) return { ok: false, grund: "argumente_ungueltig", detail: gefuellt.grund };
  // a command runs in a container of an installation (docs/manifest.md, "Befehle")
  if (neu.installationId === null || !INSTALLATIONS_NAME.test(neu.installationId))
    return { ok: false, grund: "installation_fehlt" };
  return {
    ok: true,
    manifest: geprueft.manifest,
    zeitlimitS: befehl.zeitlimit_s ?? STANDARD_ZEITLIMIT_S,
  };
};

export const auftragAnlegen = (
  deps: AuftragDeps,
  kontext: Kontext,
  neu: NeuerAuftrag,
): Angelegt => {
  const { betreiberId, jetzt } = kontext;
  const server = serverLesen(deps.db, betreiberId, neu.serverId);
  if (!server) return { ok: false, grund: "server_unbekannt" };
  if (server.gesperrtAm !== null) return { ok: false, grund: "server_gesperrt" };
  const geprueft = gegenManifest(neu);
  if (!geprueft.ok) return geprueft;
  const auftragId = neu.auftragId ?? randomUUID();
  if (auftragLesen(deps.db, betreiberId, auftragId))
    return { ok: false, grund: "auftrag_vorhanden" };
  const wartetAuf = [...new Set(neu.wartetAuf ?? [])];
  const vorgaenger = (id: string) => {
    const a = auftragLesen(deps.db, betreiberId, id);
    return a ? vorgaengerVon(a) : [];
  };
  if (zyklusIn({ id: auftragId, wartetAuf }, vorgaenger)) return { ok: false, grund: "zyklus" };
  const zustaende = zustaendeLesen(deps.db, betreiberId, wartetAuf);
  const unbekannt = wartetAuf.filter((id) => !zustaende.has(id));
  if (unbekannt.length > 0)
    return { ok: false, grund: "vorgaenger_unbekannt", detail: unbekannt.join(", ") };
  const zeile = {
    betreiberId,
    auftragId,
    serverId: neu.serverId,
    installationId: neu.installationId,
    aktion: neu.aktion,
    app: geprueft.manifest.id,
    version: geprueft.manifest.version,
    manifestHash: createHash("sha256").update(neu.manifest, "utf8").digest("hex"),
    manifest: neu.manifest,
    signatur: neu.signatur,
    argumente: JSON.stringify(neu.argumente),
    zeitlimitS: geprueft.zeitlimitS,
    zustand: startzustand(wartetAuf.map((id) => zustaende.get(id) ?? "wartend")),
    wartetAuf: JSON.stringify(wartetAuf),
    angelegtVon: kontext.akteur,
    angelegtAm: jetzt,
    geaendertAm: jetzt,
  };
  // a job the protocol cannot carry (an id or a manifest too long) would stay ready for ever
  try {
    auftragNachricht({ ...zeile, fortschritt: null, fortschrittAm: null, ergebnis: null });
  } catch (fehler) {
    return { ok: false, grund: "nachricht_ungueltig", detail: String(fehler).slice(0, 500) };
  }
  const auftrag = schreiben(deps.schreibDb, kontext, "auftrag.anlegen", (w) =>
    w.einfuegen("auftraege", zeile),
  );
  zustellen(deps, [auftrag]);
  return { ok: true, auftrag: auftragLesen(deps.db, betreiberId, auftragId) ?? auftrag };
};
