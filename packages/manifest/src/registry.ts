import { IMAGE } from "./schema.ts";

/*
 * What the registry of a manifest's image is asked with (OCI Distribution Spec, "Content
 * Discovery", `GET /v2/<name>/tags/list` with `Link` for the next page; token auth as docker.io and
 * ghcr.io answer it, distribution/distribution docs/spec/auth/token.md): the repository of an image
 * named by digest, the token request after a bearer challenge, the next page. Pure; the Zentrale
 * (modules/versionen, Z-501) and scripts/digest.ts (Z-203) do the requests.
 */

export type Repository = { registry: string; name: string };

/**
 * The registry and repository of an image the manifest names by digest (`IMAGE`); Docker Hub keeps
 * official images under library/ (distribution/reference, normalize.go)
 */
export const repositoryAusImage = (image: string): Repository | undefined => {
  if (!IMAGE.test(image)) return undefined;
  const ohneDigest = image.slice(0, image.indexOf("@"));
  const schnitt = ohneDigest.indexOf("/");
  const registry = ohneDigest.slice(0, schnitt);
  const name = ohneDigest.slice(schnitt + 1);
  return {
    registry,
    name: registry === "docker.io" && !name.includes("/") ? `library/${name}` : name,
  };
};

export type Challenge = { realm: string; parameter: Record<string, string> };

/** realm and parameters of a `WWW-Authenticate: Bearer …` challenge, or null for any other */
export const challengeLesen = (kopf: string | null): Challenge | null => {
  if (!kopf || !/^Bearer\s/i.test(kopf)) return null;
  const parameter: Record<string, string> = {};
  for (const [, schluessel, wert] of kopf.slice(7).matchAll(/([a-z]+)="([^"]*)"/gi))
    if (schluessel && wert !== undefined) parameter[schluessel.toLowerCase()] = wert;
  const { realm, ...rest } = parameter;
  return realm ? { realm, parameter: rest } : null;
};

/** Where to ask for an anonymous pull token: the realm with service and scope */
export const tokenUrl = (challenge: Challenge, name: string): string => {
  const url = new URL(challenge.realm);
  if (challenge.parameter.service) url.searchParams.set("service", challenge.parameter.service);
  url.searchParams.set("scope", challenge.parameter.scope ?? `repository:${name}:pull`);
  return url.toString();
};

/**
 * The next page of a tag list from its `Link` header (`<…?last=…&n=…>; rel="next"`), resolved
 * against the page's own URL and only on its origin; undefined on the last page
 */
export const naechsteSeite = (link: string | null, seite: string): string | undefined => {
  const treffer = link ? /<([^>]+)>\s*;\s*rel="?next"?/i.exec(link) : null;
  if (!treffer?.[1]) return undefined;
  const naechste = URL.parse(treffer[1], seite);
  return naechste && naechste.origin === new URL(seite).origin ? naechste.href : undefined;
};
