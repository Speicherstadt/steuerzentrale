/**
 * Translates an image tag into its digest through the registry's HTTP API (OCI Distribution Spec,
 * "Pulling manifests"; token auth as docker.io and ghcr.io answer it, distribution/distribution
 * docs/spec/auth/token.md). Manifests name images only by digest (CLAUDE.md, "Never"); the app
 * repositories name tags, so this records which digest a tag had and when (docs/plan.md,
 * "Entscheidungen", "Manifeste"; Z-203).
 *
 * `bun scripts/digest.ts ghcr.io/speicherstadt/haben:0.12.0 …` prints one line per image:
 * `<registry>/<name>@sha256:… | Registry <registry>, Tag <tag>, abgefragt am <YYYY-MM-DD> | <platforms>`.
 */
import { createHash } from "node:crypto";

export type Referenz = { registry: string; name: string; tag: string };
export type Quelle = { registry: string; tag: string; abgefragt_am: string };
export type Abfrage =
  | { ok: true; image: string; digest: string; quelle: Quelle; plattformen: string[] | null }
  | { ok: false; fehler: string };
export type Abhaengigkeiten = { fetch: typeof fetch; jetzt: () => Date };

/** Every manifest type a tag may point to; without them a registry may answer an older format */
export const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

// The first part is a registry only with a dot, a port or as localhost (distribution/reference,
// normalize.go), as packages/manifest's IMAGE demands; a tag as in the OCI Distribution Spec
const REFERENZ =
  /^((?:[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+|[a-z0-9][a-z0-9-]*:[0-9]+|localhost)(?::[0-9]+)?)\/([a-z0-9._/-]+):([A-Za-z0-9_][A-Za-z0-9._-]{0,127})$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export const referenzLesen = (
  text: string,
): { ok: true; referenz: Referenz } | { ok: false; fehler: string } => {
  const treffer = REFERENZ.exec(text);
  if (!treffer?.[1] || !treffer[2] || !treffer[3])
    return { ok: false, fehler: `${text}: expected <registry>/<name>:<tag>` };
  const [registry, name, tag] = [treffer[1], treffer[2], treffer[3]];
  // Docker Hub keeps official images under library/ (distribution/reference, normalize.go)
  const voll = registry === "docker.io" && !name.includes("/") ? `library/${name}` : name;
  return { ok: true, referenz: { registry, name: voll, tag } };
};

/** Docker Hub's API lives on another host; a local registry in tests speaks plain HTTP */
export const apiBasis = (registry: string): string => {
  if (registry === "docker.io") return "https://registry-1.docker.io";
  const host = registry.replace(/:[0-9]+$/, "");
  return host === "localhost" || host === "127.0.0.1"
    ? `http://${registry}`
    : `https://${registry}`;
};

/** realm and parameters of a `WWW-Authenticate: Bearer …` challenge, or null for any other */
export const challengeLesen = (
  kopf: string | null,
): { realm: string; parameter: Record<string, string> } | null => {
  if (!kopf || !/^Bearer\s/i.test(kopf)) return null;
  const parameter: Record<string, string> = {};
  for (const [, schluessel, wert] of kopf.slice(7).matchAll(/([a-z]+)="([^"]*)"/gi))
    if (schluessel && wert !== undefined) parameter[schluessel.toLowerCase()] = wert;
  const { realm, ...rest } = parameter;
  return realm ? { realm, parameter: rest } : null;
};

export const tokenUrl = (
  challenge: { realm: string; parameter: Record<string, string> },
  name: string,
): string => {
  const url = new URL(challenge.realm);
  if (challenge.parameter.service) url.searchParams.set("service", challenge.parameter.service);
  url.searchParams.set("scope", challenge.parameter.scope ?? `repository:${name}:pull`);
  return url.toString();
};

/** "os/arch" of each image in an index or manifest list; empty for a single manifest */
export const plattformenLesen = (manifest: unknown): string[] => {
  const eintraege = (manifest as { manifests?: unknown }).manifests;
  if (!Array.isArray(eintraege)) return [];
  const plattformen = eintraege.flatMap((e) => {
    const p = (e as { platform?: { os?: string; architecture?: string } }).platform;
    // Attestations (buildx provenance) carry "unknown/unknown"
    return p?.os && p.architecture && p.os !== "unknown" ? [`${p.os}/${p.architecture}`] : [];
  });
  return [...new Set(plattformen)];
};

export const quelleText = (q: Quelle): string =>
  `Registry ${q.registry}, Tag ${q.tag}, abgefragt am ${q.abgefragt_am}`;

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const tokenHolen = async (
  antwort: Response,
  name: string,
  f: typeof fetch,
): Promise<string | { fehler: string }> => {
  const challenge = challengeLesen(antwort.headers.get("www-authenticate"));
  if (!challenge) return { fehler: "HTTP 401 without a bearer challenge" };
  const token = await f(tokenUrl(challenge, name));
  if (!token.ok) return { fehler: `token: HTTP ${token.status}` };
  const inhalt = (await token.json()) as { token?: string; access_token?: string };
  return inhalt.token ?? inhalt.access_token ?? { fehler: "token: no token in the answer" };
};

type Methode = "HEAD" | "GET";

/** One request for a manifest, with a pull token when the registry asks for one */
const manifestHolen = async (
  r: Referenz,
  referenz: string,
  methode: Methode,
  f: typeof fetch,
): Promise<{ antwort: Response } | { fehler: string }> => {
  const url = `${apiBasis(r.registry)}/v2/${r.name}/manifests/${referenz}`;
  const holen = (token?: string) =>
    f(url, {
      method: methode,
      headers: { Accept: MANIFEST_ACCEPT, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  let antwort = await holen();
  if (antwort.status === 401) {
    const token = await tokenHolen(antwort, r.name, f);
    if (typeof token !== "string") return token;
    antwort = await holen(token);
  }
  return antwort.ok ? { antwort } : { fehler: `${methode} ${url}: HTTP ${antwort.status}` };
};

/** The manifest's bytes by digest, checked against it; its platforms, or null when unreadable */
const plattformenHolen = async (
  r: Referenz,
  digest: string,
  f: typeof fetch,
): Promise<string[] | null> => {
  const geholt = await manifestHolen(r, digest, "GET", f);
  if ("fehler" in geholt) return null;
  const bytes = new Uint8Array(await geholt.antwort.arrayBuffer());
  if (sha256(bytes) !== digest) return null;
  try {
    return plattformenLesen(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
};

/**
 * The digest a tag points to now, from `Docker-Content-Digest` of a HEAD request (Docker Hub
 * counts only GET against its rate limit), else the hash of the manifest a GET returns
 */
const digestHolen = async (r: Referenz, f: typeof fetch): Promise<string | { fehler: string }> => {
  const kopf = await manifestHolen(r, r.tag, "HEAD", f);
  if ("fehler" in kopf) return kopf;
  const digest = kopf.antwort.headers.get("docker-content-digest");
  if (digest !== null)
    return DIGEST.test(digest) ? digest : { fehler: `no sha256 digest: ${digest}` };
  const geholt = await manifestHolen(r, r.tag, "GET", f);
  if ("fehler" in geholt) return geholt;
  return sha256(new Uint8Array(await geholt.antwort.arrayBuffer()));
};

export const digestAbfragen = async (text: string, deps: Abhaengigkeiten): Promise<Abfrage> => {
  const gelesen = referenzLesen(text);
  if (!gelesen.ok) return gelesen;
  const r = gelesen.referenz;
  try {
    const digest = await digestHolen(r, deps.fetch);
    if (typeof digest !== "string") return { ok: false, fehler: `${text}: ${digest.fehler}` };
    return {
      ok: true,
      image: `${r.registry}/${r.name}@${digest}`,
      digest,
      quelle: {
        registry: r.registry,
        tag: r.tag,
        abgefragt_am: deps.jetzt().toISOString().slice(0, 10),
      },
      plattformen: await plattformenHolen(r, digest, deps.fetch),
    };
  } catch (fehler) {
    return { ok: false, fehler: `${text}: ${(fehler as Error).message}` };
  }
};

if (import.meta.main) {
  const referenzen = process.argv.slice(2);
  if (referenzen.length === 0) {
    console.error("usage: digest.ts <registry>/<name>:<tag> …");
    process.exit(2);
  }
  let fehler = 0;
  for (const text of referenzen) {
    const a = await digestAbfragen(text, { fetch, jetzt: () => new Date() });
    if (a.ok)
      console.log(`${a.image} | ${quelleText(a.quelle)} | ${a.plattformen?.join(", ") ?? "?"}`);
    else {
      fehler++;
      console.error(a.fehler);
    }
  }
  process.exit(fehler > 0 ? 1 : 0);
}
