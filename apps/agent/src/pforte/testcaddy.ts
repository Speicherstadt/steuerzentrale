import { GRUND_ID } from "@steuerzentrale/manifest";
import type { Admin } from "./admin.ts";

/*
 * A stand-in for Caddy's admin API in the agent's tests, with the answers of caddyserver/caddy
 * v2.11.9 (admin.go): /id/<id> is 404 for an unknown id (handleConfigID), PATCH replaces an object,
 * PUT …/routes/<i> inserts before index i, DELETE removes, POST /load replaces the whole config.
 * The real Caddy is tried in CI (apps/agent/test/pforte.agent.test.ts).
 */

type Objekt = Record<string, unknown> & { "@id"?: string };
type Server = Objekt & { routes: Objekt[] };

export const testCaddy = (antwort?: (methode: string, pfad: string) => number | undefined) => {
  let server: Server | null = null;
  const aufrufe: { methode: string; pfad: string; body?: unknown }[] = [];
  const geladen: unknown[] = [];
  const ok = (body: unknown = null) => ({ status: 200, text: JSON.stringify(body) });
  const fehlt = (id: string) => ({ status: 404, text: `{"error":"unknown object ID '${id}'"}` });

  const admin: Admin = async (methode, pfad, body) => {
    aufrufe.push({ methode, pfad, ...(body === undefined ? {} : { body }) });
    const anders = antwort?.(methode, pfad);
    if (anders !== undefined) return { status: anders, text: '{"error":"refused"}' };
    if (methode === "POST" && pfad === "/load") {
      geladen.push(body);
      const k = body as { apps: { http: { servers: Record<string, Server> } } };
      server = structuredClone(Object.values(k.apps.http.servers)[0] ?? null);
      return ok();
    }
    const id = /^\/id\/([^/]+)/.exec(pfad)?.[1] ?? "";
    if (id === GRUND_ID) {
      if (!server) return fehlt(id);
      if (methode === "GET") return ok(server);
      if (methode === "PUT" && pfad === `/id/${GRUND_ID}/routes/0`) {
        server.routes.unshift(body as Objekt);
        return ok();
      }
    }
    const i = server?.routes.findIndex((r) => r["@id"] === id) ?? -1;
    if (!server || i < 0) return fehlt(id);
    if (methode === "PATCH") server.routes[i] = body as Objekt;
    else if (methode === "DELETE") server.routes.splice(i, 1);
    else if (methode !== "GET") return { status: 405, text: "" };
    return ok();
  };

  return { admin, aufrufe, geladen, routen: () => server?.routes.map((r) => r["@id"]) ?? null };
};
