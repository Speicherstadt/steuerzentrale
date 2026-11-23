import { randomUUID } from "node:crypto";

/*
 * A stand-in for Cloudflare's API v4, DNS records of one zone (docs/plan.md, "Was sich in der CI
 * nicht echt testen lässt"; modules/dns/cloudflare.ts names the calls): a Bun server on a free port
 * of localhost, the records in memory. It answers in Cloudflare's envelope `{ success, errors,
 * result }`, wants `Authorization: Bearer <token>` and the zone's id, filters a list by `name`, and
 * refuses a CNAME beside other records of the name as Cloudflare does. `scheitern(n)` makes the next
 * n requests fail with 500; `anfragen` keeps every request for the tests to search. Started by tests
 * and by the e2e run (`bun apps/zentrale/src/testhilfen/cloudflare.ts <port>`).
 */

export type NachgebauterEintrag = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  comment: string | null;
};

export type Anfrage = { methode: string; pfad: string; autorisierung: string; body: string };

export const TEST_ZONE = "0123456789abcdef0123456789abcdef";
export const TEST_TOKEN = "cf-test-token-3f9a2c7e1b5d4a6f8e0c2b4d";

const antwort = (
  status: number,
  result: unknown,
  errors: { code: number; message: string }[] = [],
) => Response.json({ success: errors.length === 0, errors, messages: [], result }, { status });

const fehler = (status: number, code: number, message: string) =>
  antwort(status, null, [{ code, message }]);

export const cloudflareNachbau = (
  optionen: { port?: number; token?: string; zone?: string } = {},
) => {
  const token = optionen.token ?? TEST_TOKEN;
  const zone = optionen.zone ?? TEST_ZONE;
  const eintraege = new Map<string, NachgebauterEintrag>();
  const anfragen: Anfrage[] = [];
  let scheitert = 0;

  const anlegen = (neu: Partial<NachgebauterEintrag>): Response => {
    const name = String(neu.name ?? "").toLowerCase();
    const andere = [...eintraege.values()].filter((e) => e.name === name);
    if (neu.type === "CNAME" ? andere.length > 0 : andere.some((e) => e.type === "CNAME"))
      return fehler(400, 81053, "An A, AAAA, or CNAME record with that host already exists.");
    const e: NachgebauterEintrag = {
      id: randomUUID().replaceAll("-", ""),
      type: String(neu.type),
      name,
      content: String(neu.content),
      ttl: Number(neu.ttl ?? 1),
      proxied: neu.proxied === true,
      comment: neu.comment ?? null,
    };
    eintraege.set(e.id, e);
    return antwort(200, e);
  };

  const behandeln = async (anfrage: Request): Promise<Response> => {
    const url = new URL(anfrage.url);
    const body = anfrage.method === "GET" ? "" : await anfrage.text();
    const autorisierung = anfrage.headers.get("authorization") ?? "";
    anfragen.push({
      methode: anfrage.method,
      pfad: url.pathname + url.search,
      autorisierung,
      body,
    });
    if (scheitert > 0) {
      scheitert -= 1;
      return fehler(500, 10000, "Internal server error");
    }
    if (autorisierung !== `Bearer ${token}`) return fehler(403, 10000, "Authentication error");
    const teile = url.pathname.split("/").filter(Boolean);
    const ab = teile.indexOf("zones");
    if (ab < 0 || teile[ab + 2] !== "dns_records")
      return fehler(404, 7000, "No route for that URI");
    if (teile[ab + 1] !== zone)
      return fehler(
        404,
        7003,
        "Could not route to /zones, perhaps your object identifier is invalid?",
      );
    const id = teile[ab + 3];
    if (anfrage.method === "GET" && id === undefined) {
      const name = url.searchParams.get("name")?.toLowerCase();
      return antwort(
        200,
        [...eintraege.values()].filter((e) => name === undefined || e.name === name),
      );
    }
    if (anfrage.method === "POST" && id === undefined) return anlegen(JSON.parse(body));
    const e = id === undefined ? undefined : eintraege.get(id);
    if (!e) return fehler(404, 81044, "Record does not exist.");
    if (anfrage.method === "PATCH") {
      Object.assign(e, JSON.parse(body), { id: e.id });
      return antwort(200, e);
    }
    if (anfrage.method === "DELETE") {
      eintraege.delete(e.id);
      return antwort(200, { id: e.id });
    }
    return fehler(405, 10000, "Method not allowed");
  };

  const server = Bun.serve({ port: optionen.port ?? 0, hostname: "127.0.0.1", fetch: behandeln });
  return {
    url: `http://127.0.0.1:${server.port}/client/v4`,
    token,
    zone,
    anfragen,
    /** The records of the zone, as Cloudflare would list them */
    eintraege: () => [...eintraege.values()],
    /** A record set by someone else, e.g. a person in Cloudflare's dashboard */
    eintragen: (e: Omit<NachgebauterEintrag, "id">) => anlegen(e),
    scheitern: (anzahl: number) => {
      scheitert = anzahl;
    },
    stoppen: () => server.stop(true),
  };
};

export type CloudflareNachbau = ReturnType<typeof cloudflareNachbau>;

if (import.meta.main) {
  const nachbau = cloudflareNachbau({ port: Number(process.argv[2] ?? 0) });
  console.log(JSON.stringify({ msg: "cloudflare stand-in", url: nachbau.url }));
}
