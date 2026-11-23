import { createHash } from "node:crypto";
import { AGENT_DATEI, type AgentUpdateAuftrag } from "@steuerzentrale/manifest";
import { versionVergleichen } from "@steuerzentrale/planung";
import type { Ergebnis, Spawn } from "../auftraege/ausfuehren.ts";
import type { Binaer, Dateien } from "../dateien.ts";
import type { SpawnMitAusgabe } from "../zustand/pruefen.ts";
import { markeSchreiben } from "./marke.ts";
import { PRUEF_UNIT, PRUEFEN_BEFEHL, RUECKKEHR_FRIST_S } from "./rueckkehr.ts";

/*
 * The agent updates itself (BAULISTE.md Z-504; docs/plan.md, "Update des Agenten"), after its key,
 * the signature over SHA256SUMS and the job's shape (auftraege/pruefen.ts), the same checks as
 * install.sh's agent_laden and agent_pruefen:
 * 1. the version is newer than its own (an old signed release is never put back);
 * 2. it loads the binary of its architecture from its own Zentrale (`<zentrale>/agent/<name>`, the
 *    address of agent.json, never one from the job) and checks it against SHA256SUMS;
 * 3. it writes it beside itself as `<binary>.neu` and runs `<binary>.neu --version`, which must name
 *    the job's version and a protocol at least its own;
 * 4. it keeps itself as `<binary>.alt`, writes the mark (marke.ts) and starts the check
 *    (rueckkehr.ts) as a transient timer of systemd that runs the old binary;
 * 5. it renames the new binary into place, one step.
 * Until 5 nothing of the agent changed: a step that fails removes what it wrote and the job fails
 * ("abgelehnt: …" for a check, "Agent-Update gescheitert: …; nichts geändert" otherwise). After 5
 * the job succeeds with `{ version, vorher }`, and the agent restarts (auftraege.ts): systemd starts
 * the new binary.
 */

/** A release of the agent is about 100 MB; more is no binary of ours */
export const MAX_BINARY_BYTES = 512 * 1024 * 1024;
const LADEN_MS = 5 * 60_000;
const VERSION_MS = 30_000;
const SYSTEMD_MS = 30_000;

export type AgentUpdateDeps = {
  /** The agent's Zentrale (agent.json): the binary comes from there only */
  zentrale: string;
  architektur: "amd64" | "arm64";
  /** The agent's binary (AGENT_BINARY) */
  binary: string;
  /** The mark (pfade.ts, `agentUpdate`) */
  marke: string;
  /** This agent's version and protocol */
  version: string;
  protokoll: number;
  holen: (url: string, init: RequestInit) => Promise<Response>;
  dateien: Dateien;
  binaer: Binaer;
  lesen: SpawnMitAusgabe;
  spawn: Spawn;
  jetzt: () => number;
};

const abgelehnt = (grund: string): Ergebnis => ({ ok: false, fehler: `abgelehnt: ${grund}` });
const gescheitert = (grund: string): Ergebnis => ({
  ok: false,
  fehler: `Agent-Update gescheitert: ${grund}; nichts geändert`,
});

type Geladen = { ok: true; bytes: Uint8Array } | { ok: false; ergebnis: Ergebnis };

/** The binary from the Zentrale, checked against its line of SHA256SUMS */
const laden = async (deps: AgentUpdateDeps, datei: string, summe: string): Promise<Geladen> => {
  let bytes: Uint8Array;
  try {
    // no redirect: the binary comes from the agent's own Zentrale or not at all
    const antwort = await deps.holen(`${deps.zentrale}/agent/${datei}`, {
      redirect: "error",
      signal: AbortSignal.timeout(LADEN_MS),
    });
    if (!antwort.ok)
      return { ok: false, ergebnis: gescheitert(`${datei}: HTTP ${antwort.status}`) };
    if (Number(antwort.headers.get("content-length") ?? 0) > MAX_BINARY_BYTES)
      return {
        ok: false,
        ergebnis: abgelehnt(`${datei} is larger than ${MAX_BINARY_BYTES} bytes`),
      };
    bytes = new Uint8Array(await antwort.arrayBuffer());
  } catch (fehler) {
    return { ok: false, ergebnis: gescheitert(`${datei}: ${String(fehler).slice(0, 300)}`) };
  }
  if (bytes.byteLength > MAX_BINARY_BYTES)
    return { ok: false, ergebnis: abgelehnt(`${datei} is larger than ${MAX_BINARY_BYTES} bytes`) };
  const ist = createHash("sha256").update(bytes).digest("hex");
  if (ist !== summe)
    return { ok: false, ergebnis: abgelehnt(`the checksum of ${datei} does not match SHA256SUMS`) };
  return { ok: true, bytes };
};

/** What `<binary> --version` prints (cli.ts, versionLine) for the job's version */
const VERSION_ZEILE = /^steuerzentrale-agent (\S+) \(protokoll (\d+)\)$/;

/** The new binary runs here and names the job's version and a protocol at least this agent's */
const versionPruefen = async (
  deps: AgentUpdateDeps,
  pfad: string,
  version: string,
): Promise<string | undefined> => {
  let aus: { code: number | null; aus: string };
  try {
    aus = await deps.lesen([pfad, "--version"], AbortSignal.timeout(VERSION_MS));
  } catch (fehler) {
    return `the new binary does not start: ${String(fehler).slice(0, 300)}`;
  }
  const treffer = VERSION_ZEILE.exec(aus.aus.trim());
  if (aus.code !== 0 || !treffer) return "the new binary does not name its version";
  if (treffer[1] !== version)
    return `the new binary is version ${treffer[1]}, the job names ${version}`;
  if (Number(treffer[2]) < deps.protokoll)
    return `the new binary speaks protocol ${treffer[2]}, older than ${deps.protokoll}`;
  return undefined;
};

/** The check of rueckkehr.ts in RUECKKEHR_FRIST_S, run from the kept old binary */
const pruefungPlanen = async (deps: AgentUpdateDeps): Promise<boolean> => {
  const signal = () => AbortSignal.timeout(SYSTEMD_MS);
  // a check left by an earlier update would undo this one before its time
  await deps.spawn(["systemctl", "stop", `${PRUEF_UNIT}.timer`], signal()).catch(() => {});
  await deps
    .spawn(["systemctl", "reset-failed", `${PRUEF_UNIT}.service`], signal())
    .catch(() => {});
  const geplant = await deps
    .spawn(
      [
        "systemd-run",
        `--unit=${PRUEF_UNIT}`,
        `--on-active=${RUECKKEHR_FRIST_S}`,
        "--timer-property=AccuracySec=1s",
        "--collect",
        `${deps.binary}.alt`,
        PRUEFEN_BEFEHL,
      ],
      signal(),
    )
    .catch(() => ({ code: null }));
  return geplant.code === 0;
};

/** Steps 3 to 5; what they wrote goes again when one fails */
const einsetzen = async (
  deps: AgentUpdateDeps,
  auftragId: string,
  version: string,
  bytes: Uint8Array,
): Promise<Ergebnis> => {
  // `<binary>.neu` beside the binary: one file system, so the rename below is one step
  const neu = `${deps.binary}.neu`;
  const weg = async (...pfade: string[]) => {
    for (const p of pfade) await deps.binaer.loeschen(p).catch(() => {});
  };
  await deps.binaer.schreiben(neu, bytes, 0o755);
  const falsch = await versionPruefen(deps, neu, version);
  if (falsch) {
    await weg(neu);
    return abgelehnt(falsch);
  }
  const alt = await deps.binaer.lesen(deps.binary);
  if (!alt) {
    await weg(neu);
    return gescheitert(`${deps.binary} cannot be read`);
  }
  await deps.binaer.schreiben(`${deps.binary}.alt`, alt, 0o755);
  const marke = { auftragId, vorher: deps.version, neu: version, am: deps.jetzt() };
  await markeSchreiben(deps.dateien, deps.marke, { ...marke, bestaetigt: false });
  if (!(await pruefungPlanen(deps))) {
    await weg(neu, deps.marke);
    return gescheitert("systemd-run did not plan the check after the restart");
  }
  try {
    // the very file that named its version, renamed over the running one (rename(2), one step)
    await deps.dateien.umbenennen(neu, deps.binary);
  } catch (fehler) {
    await deps
      .spawn(["systemctl", "stop", `${PRUEF_UNIT}.timer`], AbortSignal.timeout(SYSTEMD_MS))
      .catch(() => {});
    await weg(neu, deps.marke);
    return gescheitert(`${deps.binary}: ${String(fehler).slice(0, 300)}`);
  }
  return { ok: true, daten: { version, vorher: deps.version } };
};

export const agentAktualisieren = async (
  deps: AgentUpdateDeps,
  auftragId: string,
  auftrag: AgentUpdateAuftrag,
): Promise<Ergebnis> => {
  if (versionVergleichen(auftrag.version, deps.version) <= 0)
    return abgelehnt(`version ${auftrag.version} is not newer than ${deps.version}`);
  const datei = AGENT_DATEI[deps.architektur];
  const summe = auftrag.pruefsummen[datei];
  if (summe === undefined) return abgelehnt(`SHA256SUMS has no checksum for ${datei}`);
  const geladen = await laden(deps, datei, summe);
  if (!geladen.ok) return geladen.ergebnis;
  try {
    return await einsetzen(deps, auftragId, auftrag.version, geladen.bytes);
  } catch (fehler) {
    return gescheitert(String(fehler).slice(0, 300));
  }
};
