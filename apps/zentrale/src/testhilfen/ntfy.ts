/*
 * A ntfy server for the tests (BAULISTE.md Z-1105): a Bun server on a free port of localhost that
 * takes what the Zentrale publishes as JSON to its root (ntfy docs, "Publish as JSON") and keeps
 * each request with its Authorization header; `scheitern(n)` answers the next n requests with 503
 * as a server that is down, and `token` makes it answer 403 without that bearer token.
 */

export type NtfyEmpfang = {
  pfad: string;
  auth: string | null;
  json: Record<string, unknown> | null;
  status: number;
};

export const ntfyServer = (o: { token?: string } = {}) => {
  const empfangen: NtfyEmpfang[] = [];
  let scheitert = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (anfrage) => {
      const auth = anfrage.headers.get("authorization");
      const json = (await anfrage.json().catch(() => null)) as Record<string, unknown> | null;
      const erlaubt = o.token === undefined || auth === `Bearer ${o.token}`;
      const status = scheitert > 0 ? 503 : erlaubt ? 200 : 403;
      if (scheitert > 0) scheitert -= 1;
      empfangen.push({ pfad: new URL(anfrage.url).pathname, auth, json, status });
      return Response.json({ id: "n1" }, { status });
    },
  });
  return {
    /** The address of a topic, as the operator enters it */
    url: (thema = "sz-test-alarm") => `http://127.0.0.1:${server.port}/${thema}`,
    empfangen,
    scheitern: (n: number) => {
      scheitert = n;
    },
    stoppen: () => server.stop(true),
  };
};
