import { INSTALLATIONS_NAME } from "@steuerzentrale/manifest";
import { z } from "zod";
import { dumpArgv, lsArgv, type Repo, resticGrund, zugangIni } from "../backup/restic.ts";
import type { Geheim, ResticLauf } from "../backup/sichern.ts";
import type { SpawnMitAusgabe } from "../zustand/pruefen.ts";

/*
 * One part played back as the target installation's user (BAULISTE.md Z-602; docs/plan.md,
 * "Prüf-Restore auf dem Server"): `steuerzentrale-agent zurueckspielen <ziel>`, started by the agent
 * (zurueckspielen.ts) with the part and the source's repository, access and password on its
 * standard input. restic runs as in `sichern` (backup/echt.ts: password and access on descriptors
 * 3 and 4 of files without a name, in the target's network) and finds the newest snapshot of the
 * part's tag and the source's host with `ls --json`, which also names the owner and mode of the
 * volume's folder. Then:
 * - `volume`: `restic dump --archive tar <snapshot>:/sicherung/<volume> /` into `podman volume import
 *   <volume> -`, then owner and mode of the volume's root as in the snapshot (`podman unshare chown`
 *   and `chmod`): tar has no entry for the root, and an imported volume is no longer empty, so
 *   Podman no longer gives it the owner of the image's folder on the first start;
 * - `pg_dump`: `restic dump <snapshot> /<file>` into `podman exec -i <container> pg_restore …`.
 * A reason names the step and an exit code, never what restic, Podman or pg_restore wrote. As root
 * it refuses: Podman would use root's storage.
 */

const wort = z.string().min(1).max(1000);

/** What the agent hands over on standard input */
export const SpielEingabe = z.object({
  /** The installation whose snapshots are played back: the host of its snapshots */
  quelle: z.string().regex(INSTALLATIONS_NAME),
  repository: wort,
  zugang: z.object({ schluesselId: wort, geheim: wort }),
  passwort: wort,
  teil: z.discriminatedUnion("art", [
    z.object({ art: z.literal("volume"), tag: wort, volume: wort, pfad: wort }),
    z.object({
      art: z.literal("pg_dump"),
      tag: wort,
      container: wort,
      datei: wort,
      argv: z.array(wort).min(1),
    }),
  ]),
});
export type SpielEingabe = z.output<typeof SpielEingabe>;

export type Gespielt =
  | { ok: true; snapshot: string }
  | { ok: false; grund: string; snapshot?: string | undefined };

export type SpielDeps = {
  restic: ResticLauf;
  /** A fixed argv of the user, its standard output read (Podman's answers) */
  lesen: SpawnMitAusgabe;
};

const SNAPSHOT = /^[0-9a-f]{64}$/;

type Wurzel = { uid: number; gid: number; modus: number };

/** The snapshot, and for a volume owner and mode of its folder in the snapshot */
type Gefunden = { snapshot: string; wurzel?: Wurzel };

/** The snapshot of `ls --json` (its first line) and the node of the volume's folder */
export const lsLesen = (aus: string, pfad: string): Gefunden | undefined => {
  let gefunden: Gefunden | undefined;
  for (const zeile of aus.split("\n")) {
    let n: Record<string, unknown>;
    try {
      n = JSON.parse(zeile);
    } catch {
      continue;
    }
    if (n.struct_type === "snapshot" && typeof n.id === "string" && SNAPSHOT.test(n.id))
      gefunden = { snapshot: n.id };
    else if (gefunden && n.struct_type === "node" && n.path === pfad && n.type === "dir") {
      const ganz = (x: unknown) => (Number.isSafeInteger(x) && (x as number) >= 0 ? x : undefined);
      const [uid, gid, modus] = [ganz(n.uid), ganz(n.gid), ganz(n.mode)] as (number | undefined)[];
      // Go's FileMode: the permission bits are the low nine (restic, data/node.go)
      if (uid !== undefined && gid !== undefined && modus !== undefined)
        return { ...gefunden, wurzel: { uid, gid, modus: modus & 0o777 } };
    }
  }
  return gefunden;
};

const elternOrdner = (pfad: string): string => pfad.slice(0, pfad.lastIndexOf("/")) || "/";

const nein = (grund: string, snapshot?: string): Gespielt => ({
  ok: false,
  grund,
  ...(snapshot === undefined ? {} : { snapshot }),
});

/** Owner and mode of the volume's root as in the snapshot, in the user's namespace */
const wurzelSetzen = async (
  deps: SpielDeps,
  volume: string,
  g: Wurzel,
  signal: AbortSignal,
): Promise<string | undefined> => {
  const ort = await deps.lesen(
    ["podman", "volume", "inspect", "--format", "{{.Mountpoint}}", volume],
    signal,
  );
  const pfad = ort.aus.trim();
  if (ort.code !== 0 || !pfad.startsWith("/") || pfad.includes("\n"))
    return `podman volume inspect endete mit Code ${ort.code ?? "–"}`;
  for (const argv of [
    ["podman", "unshare", "chown", `${g.uid}:${g.gid}`, "--", pfad],
    ["podman", "unshare", "chmod", g.modus.toString(8), "--", pfad],
  ]) {
    const r = await deps.lesen(argv, signal);
    if (r.code !== 0) return `${argv.slice(0, 3).join(" ")} endete mit Code ${r.code ?? "–"}`;
  }
  return undefined;
};

const ausgang = (code: number | null | undefined) => `Code ${code ?? "–"}`;

/** Plays the newest snapshot of the part back into the target `ziel`; never throws */
export const teilSpielen = async (
  deps: SpielDeps,
  ziel: string,
  e: SpielEingabe,
  signal: AbortSignal = new AbortController().signal,
): Promise<Gespielt> => {
  const r: Repo = { installation: e.quelle, repository: e.repository, netz: ziel };
  const geheim: Geheim = { passwort: e.passwort, zugang: zugangIni(e.zugang) };
  const t = e.teil;
  try {
    const ordner = t.art === "volume" ? elternOrdner(t.pfad) : "/";
    const ls = await deps.restic({ argv: lsArgv(r, t.tag, ordner) }, geheim, signal);
    if (ls.code !== 0) return nein(`Snapshot suchen: ${resticGrund(ls.code)}`);
    const g = lsLesen(ls.aus, t.art === "volume" ? t.pfad : "/");
    if (!g) return nein(`kein Snapshot mit ${t.tag}`);
    const s = g.snapshot;
    if (t.art === "pg_dump") {
      const d = await deps.restic(
        {
          argv: dumpArgv(r, s, t.datei, false),
          ziel: ["podman", "exec", "-i", t.container, ...t.argv],
        },
        geheim,
        signal,
      );
      if (d.code !== 0) return nein(`restic dump: ${resticGrund(d.code)}`, s);
      if (d.zielCode !== 0) return nein(`pg_restore endete mit ${ausgang(d.zielCode)}`, s);
      return { ok: true, snapshot: s };
    }
    if (!g.wurzel) return nein(`${t.pfad} fehlt im Snapshot`, s);
    const d = await deps.restic(
      { argv: dumpArgv(r, s, t.pfad, true), ziel: ["podman", "volume", "import", t.volume, "-"] },
      geheim,
      signal,
    );
    if (d.code !== 0) return nein(`restic dump: ${resticGrund(d.code)}`, s);
    if (d.zielCode !== 0) return nein(`podman volume import endete mit ${ausgang(d.zielCode)}`, s);
    const wurzel = await wurzelSetzen(deps, t.volume, g.wurzel, signal);
    return wurzel === undefined ? { ok: true, snapshot: s } : nein(wurzel, s);
  } catch {
    return nein("restic startete nicht");
  }
};

export type SpielBefehlDeps = SpielDeps & {
  uid: () => number;
  /** Standard input, read whole */
  eingabe: () => Promise<string>;
};

export const SPIELEN_USAGE =
  "usage: steuerzentrale-agent zurueckspielen <installation> < teil.json";

/** `steuerzentrale-agent zurueckspielen <ziel>`: the result as its last line of JSON */
export const spielenBefehl = async (
  args: string[],
  deps: SpielBefehlDeps,
): Promise<{ code: number; out: string }> => {
  const [ziel = "", ...rest] = args;
  if (!INSTALLATIONS_NAME.test(ziel) || rest.length > 0) return { code: 2, out: SPIELEN_USAGE };
  const antwort = (g: Gespielt) => ({ code: g.ok ? 0 : 1, out: JSON.stringify(g) });
  if (deps.uid() === 0) return antwort(nein("zurueckspielen runs as the installation's user"));
  let e: SpielEingabe;
  try {
    const g = SpielEingabe.safeParse(JSON.parse(await deps.eingabe()));
    if (!g.success) return antwort(nein("the input is no part to play back"));
    e = g.data;
  } catch {
    return antwort(nein("the input is no part to play back"));
  }
  return antwort(await teilSpielen(deps, ziel, e));
};
