/*
 * A stand-in for a container registry's tag list (Z-501; docs/plan.md, "Was sich in der CI nicht
 * echt testen lässt"): a Bun server on a free port of localhost, the repositories and their tags in
 * memory. It answers `GET /v2/<name>/tags/list` as the OCI Distribution Spec says ("Content
 * Discovery"): `{ name, tags }`, `n` tags per page in lexical order after `last`, a `Link` header
 * with rel="next" while more follow. With `token` it first answers 401 with a bearer challenge
 * whose realm is its own `/token`, as ghcr.io and docker.io do (distribution docs/spec/auth/
 * token.md), and wants that token. `scheitern(n)` fails the next n requests with 500; `anfragen`
 * keeps each path. Started by tests and the e2e run
 * (`bun apps/zentrale/src/testhilfen/registry.ts <port> <name>=<tag>,<tag> …`).
 */

export const TEST_REGISTRY_TOKEN = "registry-test-token-5b1d";

type Optionen = {
  port?: number;
  /** Repository → tags */
  repos?: Record<string, string[]>;
  /** Tags per page when the request names no `n` */
  seite?: number;
  /** Whether a pull token is needed */
  token?: boolean;
};

export const registryNachbau = (optionen: Optionen = {}) => {
  const repos = new Map(Object.entries(optionen.repos ?? {}));
  const seite = optionen.seite ?? 100;
  const anfragen: string[] = [];
  let scheitert = 0;

  const tagListe = (url: URL, name: string): Response => {
    const tags = repos.get(name);
    if (!tags)
      return Response.json(
        { errors: [{ code: "NAME_UNKNOWN", message: "repository name not known to registry" }] },
        { status: 404 },
      );
    const n = Number(url.searchParams.get("n") ?? seite);
    const last = url.searchParams.get("last");
    const sortiert = [...tags].sort();
    const ab = last === null ? 0 : sortiert.findIndex((t) => t > last);
    const teil = ab < 0 ? [] : sortiert.slice(ab, ab + n);
    const mehr = ab >= 0 && ab + n < sortiert.length;
    const kopf: Record<string, string> = mehr
      ? {
          link: `</v2/${name}/tags/list?last=${encodeURIComponent(teil.at(-1) ?? "")}&n=${n}>; rel="next"`,
        }
      : {};
    return Response.json({ name, tags: teil }, { headers: kopf });
  };

  const behandeln = (anfrage: Request): Response => {
    const url = new URL(anfrage.url);
    anfragen.push(url.pathname + url.search);
    if (scheitert > 0) {
      scheitert -= 1;
      return new Response("unavailable", { status: 500 });
    }
    if (url.pathname === "/token")
      return Response.json({ token: TEST_REGISTRY_TOKEN, access_token: TEST_REGISTRY_TOKEN });
    const treffer = /^\/v2\/(.+)\/tags\/list$/.exec(url.pathname);
    if (!treffer?.[1]) return new Response("not found", { status: 404 });
    if (optionen.token && anfrage.headers.get("authorization") !== `Bearer ${TEST_REGISTRY_TOKEN}`)
      return Response.json(
        { errors: [{ code: "UNAUTHORIZED", message: "authentication required" }] },
        {
          status: 401,
          headers: {
            "www-authenticate": `Bearer realm="${url.origin}/token",service="test-registry",scope="repository:${treffer[1]}:pull"`,
          },
        },
      );
    return tagListe(url, treffer[1]);
  };

  const server = Bun.serve({ port: optionen.port ?? 0, hostname: "127.0.0.1", fetch: behandeln });
  return {
    url: `http://127.0.0.1:${server.port}`,
    anfragen,
    /** Sets the tags of a repository, as a push of a new version would */
    tags: (name: string, liste: string[]) => {
      repos.set(name, liste);
    },
    scheitern: (anzahl: number) => {
      scheitert = anzahl;
    },
    stoppen: () => server.stop(true),
  };
};

export type RegistryNachbau = ReturnType<typeof registryNachbau>;

if (import.meta.main) {
  const [port = "0", ...paare] = process.argv.slice(2);
  const repos = Object.fromEntries(
    paare.map((paar) => {
      const [name = "", tags = ""] = paar.split("=");
      return [name, tags.split(",").filter(Boolean)];
    }),
  );
  const nachbau = registryNachbau({ port: Number(port), repos, token: true });
  console.log(JSON.stringify({ msg: "registry stand-in", url: nachbau.url }));
}
