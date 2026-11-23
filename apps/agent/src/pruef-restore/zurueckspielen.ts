import type { RestoreTeil } from "@steuerzentrale/manifest";
import { z } from "zod";
import { imContainer } from "../auftraege/ausfuehren.ts";
import type { BackupDatei } from "../backup/datei.ts";
import { bisJa, type Lauf, laeufer } from "../einrichtung/lauf.ts";
import { alsNutzer, type Nutzer, nutzerName } from "../einrichtung/nutzer.ts";
import type { SystemDeps } from "../einrichtung/typen.ts";
import { quelleLesen } from "./quelle.ts";
import type { Gespielt, SpielEingabe } from "./spielen.ts";

/*
 * Playing back the newest snapshot of each part of a source installation's backup into the
 * volumes and the database of a target installation (BAULISTE.md Z-602; docs/plan.md,
 * "Prüf-Restore auf dem Server"), as root: the source's backup.json is only read (quelle.ts), the
 * target's units are started only as far as a part needs them, and each part is played back by
 * the agent's binary as the target's user (spielen.ts), the repository, access and password on its
 * standard input through a pipe without a name, never in an argv. The volumes first, before any
 * container of the target ran; a dump once its database container alone runs and its server
 * answers. A command's export is not played back and is named in the result. The first part that
 * fails ends it; the rest are `nicht_versucht`. The Prüf-Restore plays back into its copy;
 * restoring (Z-603, src/wiederherstellen) into the installation itself, with the snapshots of its
 * job instead of the newest, and each part in a transient unit of the user (`inUnit`).
 */

/**
 * A part after playing back: `zurueckgespielt`, `uebersprungen` (a command's export),
 * `gescheitert` with its reason, or `nicht_versucht` after an earlier part failed
 */
export type TeilErgebnis = {
  tag: string;
  art: RestoreTeil["art"];
  ergebnis: "zurueckgespielt" | "uebersprungen" | "gescheitert" | "nicht_versucht";
  snapshot?: string;
  grund?: string;
};

export type Zurueckgespielt = { ok: boolean; teile: TeilErgebnis[]; grund?: string };

export type ZurueckDeps = SystemDeps & {
  /** The agent's binary, run as the target's user (AGENT_BINARY) */
  agent: string;
};

export type Zurueckspielen = {
  quelle: string;
  ziel: string;
  teile: readonly RestoreTeil[];
  /** The target's network unit: restic runs in the target's network */
  netz: { unit: string };
  /** The snapshot of each part by its tag (restoring, Z-603); without, the newest of each */
  snapshots?: Readonly<Record<string, string>>;
  /**
   * The binary's argv as the target's user wrapped into a transient unit of its own (restoring,
   * Z-603), made when the part starts; without, the binary runs under the agent
   */
  inUnit?: (argv: readonly string[]) => string[];
};

/** A database's server answers within two minutes of its container's start */
const BEREIT_VERSUCHE = 120;
const BEREIT_WARTEN_MS = 1000;
const BEREIT_MS = 10_000;

const Antwort = z.union([
  z.object({ ok: z.literal(true), snapshot: z.string().regex(/^[0-9a-f]{64}$/) }),
  z.object({
    ok: z.literal(false),
    grund: z.string().min(1).max(500),
    snapshot: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  }),
]);

/** The last line of the binary's output, if it is an answer */
const antwortLesen = (aus: string): Gespielt | undefined => {
  try {
    const g = Antwort.safeParse(JSON.parse(aus.trim().split("\n").at(-1) ?? ""));
    return g.success ? g.data : undefined;
  } catch {
    return undefined;
  }
};

const eingabeVon = (
  a: Zurueckspielen,
  d: BackupDatei,
  t: RestoreTeil,
): SpielEingabe | undefined => {
  const snapshot = a.snapshots?.[t.tag];
  const zugang = {
    quelle: a.quelle,
    repository: d.repository,
    zugang: d.zugang,
    passwort: d.passwort,
    ...(snapshot === undefined ? {} : { snapshot }),
    ...(a.inUnit ? { unit: true as const } : {}),
  };
  if (t.art === "volume")
    return { ...zugang, teil: { art: "volume", tag: t.tag, volume: t.volume, pfad: t.pfad } };
  if (t.art === "pg_dump")
    return {
      ...zugang,
      teil: { art: "pg_dump", tag: t.tag, container: t.container, datei: t.datei, argv: t.argv },
    };
  return undefined;
};

type Kontext = {
  deps: ZurueckDeps;
  lauf: Lauf;
  n: Nutzer;
  a: Zurueckspielen;
  signal: AbortSignal;
};

const spielen = async (k: Kontext, eingabe: SpielEingabe): Promise<Gespielt> => {
  const binary = [k.deps.agent, "zurueckspielen", k.a.ziel];
  const argv = alsNutzer(k.n, k.a.inUnit ? k.a.inUnit(binary) : binary);
  const r = await k.deps
    .lesen(argv, k.signal, { eingabe: JSON.stringify(eingabe) })
    .catch(() => ({ code: null, aus: "" }));
  const g = antwortLesen(r.aus);
  if (g && !k.signal.aborted) return g;
  return {
    ok: false,
    grund: k.signal.aborted
      ? "Zeitlimit des Auftrags überschritten"
      : `zurueckspielen endete mit Code ${r.code ?? "–"}`,
  };
};

/** Only the database's container, until its server answers on TCP (restoreTeile, `bereit`) */
const datenbankStarten = async (
  k: Kontext,
  t: Extract<RestoreTeil, { art: "pg_dump" }>,
): Promise<string | undefined> => {
  const start = await k.lauf(
    "systemctl --user start",
    alsNutzer(k.n, ["systemctl", "--user", "start", t.unit]),
  );
  if (!start.ok) return start.grund;
  const bereit = await bisJa(
    k.deps,
    BEREIT_VERSUCHE,
    BEREIT_WARTEN_MS,
    async () => {
      const { argv, marke } = imContainer(k.n, t.container, t.bereit);
      return (await k.lauf("pg_isready", argv, { zeitlimitMs: BEREIT_MS, marke })).ok;
    },
    k.signal,
  );
  return bereit ? undefined : `${t.container}: die Datenbank antwortet nicht`;
};

const teilSpielen = async (k: Kontext, d: BackupDatei, t: RestoreTeil) => {
  const eingabe = eingabeVon(k.a, d, t);
  if (eingabe === undefined) return undefined;
  if (t.art === "pg_dump") {
    const grund = await datenbankStarten(k, t);
    if (grund !== undefined) return { ok: false as const, grund };
  }
  return spielen(k, eingabe);
};

const ergebnis = (t: RestoreTeil, g: Gespielt | undefined): TeilErgebnis => {
  if (g === undefined) return { tag: t.tag, art: t.art, ergebnis: "uebersprungen" };
  const snapshot = g.snapshot === undefined ? {} : { snapshot: g.snapshot };
  return g.ok
    ? { tag: t.tag, art: t.art, ergebnis: "zurueckgespielt", ...snapshot }
    : {
        tag: t.tag,
        art: t.art,
        ergebnis: "gescheitert",
        grund: g.grund.slice(0, 500),
        ...snapshot,
      };
};

/** The parts before anything was played back: an export is skipped, the rest not tried yet */
export const teileVorher = (teile: readonly RestoreTeil[]): TeilErgebnis[] =>
  teile.map((t) =>
    t.art === "befehl"
      ? { tag: t.tag, art: t.art, ergebnis: "uebersprungen" }
      : { tag: t.tag, art: t.art, ergebnis: "nicht_versucht" },
  );

/** The volumes first, then the dumps; the result in the manifest's order */
const reihenfolge = (teile: readonly RestoreTeil[]): number[] => {
  const rang = { volume: 0, pg_dump: 1, befehl: 2 } as const;
  return teile
    .map((_, i) => i)
    .sort((a, b) => rang[teile[a]?.art ?? "befehl"] - rang[teile[b]?.art ?? "befehl"]);
};

export const zurueckspielen = async (
  deps: ZurueckDeps,
  a: Zurueckspielen,
  signal: AbortSignal,
): Promise<Zurueckgespielt> => {
  const teile = teileVorher(a.teile);
  const nein = (grund: string): Zurueckgespielt => ({ ok: false, teile, grund });
  const quelleNutzer = await deps.nutzer(nutzerName(a.quelle));
  if (!quelleNutzer) return nein(`${nutzerName(a.quelle)} fehlt`);
  const q = await quelleLesen(deps.haus, quelleNutzer, a.quelle);
  if (!q.ok) return nein(q.grund);
  const n = await deps.nutzer(nutzerName(a.ziel));
  if (!n) return nein(`${nutzerName(a.ziel)} fehlt`);
  const k: Kontext = { deps, lauf: laeufer(deps, signal), n, a, signal };
  const volumes = a.teile.flatMap((t) => (t.art === "volume" ? [t.unit] : []));
  // the network for restic, and the volumes, which `podman volume import` needs to be there
  const da = await k.lauf(
    "systemctl --user start",
    alsNutzer(n, ["systemctl", "--user", "start", a.netz.unit, ...volumes]),
  );
  if (!da.ok) return nein(da.grund);
  for (const i of reihenfolge(a.teile)) {
    const t = a.teile[i] as RestoreTeil;
    const g = await teilSpielen(k, q.datei, t);
    teile[i] = ergebnis(t, g);
    if (g && !g.ok) return nein(`${t.tag}: ${g.grund}`);
  }
  return { ok: true, teile };
};
