import { type OeffentlicherSchluessel, signaturPruefen } from "./signatur.ts";

/*
 * The update of the agent itself (BAULISTE.md Z-504; docs/plan.md, "Update des Agenten"): built
 * into the Steuerzentrale like the jobs of the Pforte, with a fixed shape. No app's manifest
 * describes it, so in the place of the manifest the job carries the signed list of checksums of the
 * agent binaries (SHA256SUMS, as `sha256sum` writes it) and its minisign signature
 * (SHA256SUMS.minisig), both exactly as the Zentrale serves them under agent.<domain>/agent/, and
 * the version as its one argument. No address: the agent loads its binary from its own Zentrale
 * only. Pure: the Zentrale checks the shape when it makes a job (it does not sign), the agent the
 * signature with its own key and then the shape, before it loads anything.
 */

/** A command's name has no underscore (schema.ts, `name`), so no manifest can name it */
export const AGENT_UPDATE_AKTION = "agent_update";

/** Loading about 100 MB from the Zentrale, checking it and running `--version` */
export const AGENT_UPDATE_ZEITLIMIT_S = 600;

/** What the job's row names as its app (the jobs table keeps app and version of each) */
export const AGENT_APP = "steuerzentrale-agent";

/** The binary of each architecture, as install.sh loads it and the Zentrale serves it */
export const AGENT_DATEI = {
  amd64: "steuerzentrale-agent-linux-x64",
  arm64: "steuerzentrale-agent-linux-arm64",
} as const;

/** SemVer 2.0.0 without build metadata, as `VERSION` of packages/protokoll */
export const AGENT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

/** At most so many lines: a release lists the two binaries */
const MAX_ZEILEN = 50;
const ZEILE = /^([0-9a-f]{64}) {2}([A-Za-z0-9._-]{1,200})$/;

export type AgentUpdateAnfrage = {
  aktion: string;
  installationId: string | null;
  argumente: Readonly<Record<string, unknown>>;
  /** SHA256SUMS */
  manifest: string;
  /** SHA256SUMS.minisig */
  signatur: string;
  einrichtung?: unknown;
  backup?: unknown;
};

export type AgentUpdateAuftrag = {
  art: "agent_update";
  version: string;
  /** The checksum of each file SHA256SUMS lists, by its name */
  pruefsummen: Record<string, string>;
};

export type AgentUpdateGeprueft =
  | { ok: true; auftrag: AgentUpdateAuftrag }
  | { ok: false; grund: string };

type Summen = { ok: true; summen: Record<string, string> } | { ok: false; grund: string };

/** The lines of `sha256sum` (hash, two spaces, name); each name once, an agent binary among them */
export const pruefsummenLesen = (text: string): Summen => {
  const zeilen = text.split("\n").filter((z) => z !== "");
  if (zeilen.length > MAX_ZEILEN) return { ok: false, grund: "SHA256SUMS: too many lines" };
  const summen: Record<string, string> = {};
  for (const zeile of zeilen) {
    const treffer = ZEILE.exec(zeile);
    if (!treffer) return { ok: false, grund: "SHA256SUMS: a line is no checksum of sha256sum" };
    const [, summe = "", name = ""] = treffer;
    if (name in summen) return { ok: false, grund: `SHA256SUMS: ${name} twice` };
    summen[name] = summe;
  }
  if (!Object.values<string>(AGENT_DATEI).some((d) => d in summen))
    return { ok: false, grund: "SHA256SUMS: no agent binary" };
  return { ok: true, summen };
};

const nein = (grund: string): AgentUpdateGeprueft => ({ ok: false, grund });

/**
 * The job's shape and, given the key the agent trusts, the signature over SHA256SUMS first (with
 * the same rules as install.sh: the caller decides whether the key may be trusted at all)
 */
export const agentUpdateAuftragPruefen = (
  a: AgentUpdateAnfrage,
  schluessel?: OeffentlicherSchluessel,
): AgentUpdateGeprueft => {
  if (a.aktion !== AGENT_UPDATE_AKTION) return nein(`${a.aktion} is not the agent's update`);
  if (schluessel) {
    const signiert = signaturPruefen(new TextEncoder().encode(a.manifest), a.signatur, schluessel);
    if (!signiert.ok) return nein(`the signature of SHA256SUMS does not hold: ${signiert.grund}`);
  }
  if (a.installationId !== null) return nein("the agent's update belongs to no installation");
  if (a.einrichtung !== undefined || a.backup !== undefined)
    return nein("the agent's update carries no installation or backup data");
  const fremd = Object.keys(a.argumente).filter((n) => n !== "version");
  if (fremd.length > 0) return nein(`unknown argument ${fremd.join(", ")}`);
  const { version } = a.argumente;
  if (typeof version !== "string" || !AGENT_VERSION.test(version))
    return nein("argument version: a version as major.minor.patch");
  const summen = pruefsummenLesen(a.manifest);
  if (!summen.ok) return summen;
  return { ok: true, auftrag: { art: "agent_update", version, pruefsummen: summen.summen } };
};
