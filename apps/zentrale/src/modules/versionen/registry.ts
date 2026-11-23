import { challengeLesen, naechsteSeite, type Repository, tokenUrl } from "@steuerzentrale/manifest";

/*
 * The tags of an image's repository from its registry (BAULISTE.md Z-501; docs/plan.md,
 * "Versionen aus den Registries (Z-501)"): `GET /v2/<name>/tags/list` of the OCI Distribution
 * Spec, page by page along `Link`, with an anonymous pull token when the registry answers 401 with
 * a bearer challenge (docker.io, ghcr.io). The model is scripts/digest.ts (Z-203). Only HTTPS,
 * Docker Hub on its API host; in tests `umleitung` (STEUERZENTRALE_REGISTRY_HTTP, only localhost)
 * names the stand-in or the test registry, which speak plain HTTP.
 */

export type RegistryDeps = {
  fetch: typeof fetch;
  /** The test registry's origin in place of every registry (tests only) */
  umleitung?: string | undefined;
};

export type Tags = { ok: true; tags: string[] } | { ok: false; fehler: string };

/** The most pages read of one repository; a registry that pages on and on is cut there */
export const MAX_SEITEN = 50;
const ZEITLIMIT_MS = 15_000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const registryBasis = (registry: string, umleitung?: string): string => {
  if (umleitung) return umleitung;
  return registry === "docker.io" ? "https://registry-1.docker.io" : `https://${registry}`;
};

/** A token realm the Zentrale may ask: HTTPS, plain HTTP only on localhost while redirected */
const realmErlaubt = (realm: string, umleitung?: string): boolean => {
  const url = URL.parse(realm);
  if (!url) return false;
  return url.protocol === "https:" || (!!umleitung && LOOPBACK.has(url.hostname));
};

const tokenHolen = async (
  antwort: Response,
  name: string,
  deps: RegistryDeps,
): Promise<string | { fehler: string }> => {
  const challenge = challengeLesen(antwort.headers.get("www-authenticate"));
  if (!challenge) return { fehler: "HTTP 401 ohne Bearer-Challenge" };
  if (!realmErlaubt(challenge.realm, deps.umleitung))
    return { fehler: `Token-Adresse nicht erlaubt: ${challenge.realm}` };
  const token = await deps.fetch(tokenUrl(challenge, name), {
    signal: AbortSignal.timeout(ZEITLIMIT_MS),
  });
  if (!token.ok) return { fehler: `Token: HTTP ${token.status}` };
  const inhalt = (await token.json()) as { token?: string; access_token?: string };
  return inhalt.token ?? inhalt.access_token ?? { fehler: "Token: keiner in der Antwort" };
};

type Seite = { tags: string[]; weiter: string | undefined; token: string | undefined };

const seiteHolen = async (
  url: string,
  name: string,
  token: string | undefined,
  deps: RegistryDeps,
): Promise<Seite | { fehler: string }> => {
  const holen = (t?: string) =>
    deps.fetch(url, {
      headers: { Accept: "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
    });
  let antwort = await holen(token);
  let neu = token;
  if (antwort.status === 401) {
    const geholt = await tokenHolen(antwort, name, deps);
    if (typeof geholt !== "string") return geholt;
    neu = geholt;
    antwort = await holen(neu);
  }
  if (!antwort.ok) return { fehler: `GET ${url}: HTTP ${antwort.status}` };
  const inhalt = (await antwort.json()) as { tags?: unknown };
  const tags = Array.isArray(inhalt.tags)
    ? inhalt.tags.filter((t): t is string => typeof t === "string")
    : [];
  return { tags, weiter: naechsteSeite(antwort.headers.get("link"), url), token: neu };
};

/** Every tag of the repository, or why the registry gave none */
export const tagsAbfragen = async (repo: Repository, deps: RegistryDeps): Promise<Tags> => {
  let url: string | undefined =
    `${registryBasis(repo.registry, deps.umleitung)}/v2/${repo.name}/tags/list`;
  let token: string | undefined;
  const tags: string[] = [];
  try {
    for (let n = 0; url !== undefined; n++) {
      if (n === MAX_SEITEN) return { ok: false, fehler: `mehr als ${MAX_SEITEN} Seiten Tags` };
      const seite: Seite | { fehler: string } = await seiteHolen(url, repo.name, token, deps);
      if ("fehler" in seite) return { ok: false, fehler: seite.fehler };
      tags.push(...seite.tags);
      token = seite.token;
      url = seite.weiter;
    }
  } catch (fehler) {
    return { ok: false, fehler: (fehler as Error).message };
  }
  return { ok: true, tags };
};
