import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLLEN, type Rolle } from "../auth/rollen.ts";
import { type TestServer, testServer } from "../testhilfen/server.ts";
import { AUTH_PFADE, ROUTEN, type RoutenName, rollenFuer } from "./zugang.ts";

/*
 * BAULISTE.md Z-104: every route checks its roles. The cases come from ROUTEN, the one list of all
 * routes: a route registered without an entry fails the first test, an entry fails in every role
 * whose answer does not match the list. Path parameters are filled with ids that exist nowhere, so
 * no request changes anything that another one needs.
 */
const NAMEN = Object.keys(ROUTEN) as RoutenName[];
const MIT_RECHT = NAMEN.filter((name) => ROUTEN[name].art === "recht");
const ABGEWIESEN = [
  "nicht_angemeldet",
  "zweiter_faktor_fehlt",
  "kein_betreiber",
  "keine_berechtigung",
];

const anfrage = (name: RoutenName) => {
  const [methode = "GET", pfad = ""] = name.split(" ");
  const ohneKoerper = methode === "GET" || methode === "DELETE";
  return {
    pfad: pfad.replace(/:\w+/g, "gibt-es-nicht").replace("*", "get-session"),
    init: { method: methode, ...(ohneKoerper ? {} : { body: { rolle: "support" } }) },
  };
};

type Person = Awaited<ReturnType<TestServer["eingeladen"]>>;
let server: TestServer;
const personen = {} as Record<Rolle, Pick<Person, "json">>;

beforeAll(async () => {
  server = testServer(afterAll);
  const inhaber = await server.inhaber();
  personen.inhaber = inhaber;
  personen.technik = await server.eingeladen(inhaber, "technik");
  personen.support = await server.eingeladen(inhaber, "support");
}, 60_000);

describe("the list of routes", () => {
  it("holds exactly the routes the app registers", () => {
    const registriert = new Set(
      server.app.routes
        .filter((route) => route.method !== "ALL")
        .map((route) => `${route.method} ${route.path}`),
    );
    expect([...registriert].sort()).toEqual([...NAMEN].sort());
  });

  it("gives every route that needs a right at least one role", () => {
    for (const name of MIT_RECHT) expect(rollenFuer(ROUTEN[name]).length, name).toBeGreaterThan(0);
  });
});

describe.each(MIT_RECHT)("%s", (name) => {
  const erlaubt = rollenFuer(ROUTEN[name]);

  it.each(ROLLEN)("as %s answers by the list", async (rolle) => {
    const { pfad, init } = anfrage(name);
    const { status, daten } = await personen[rolle].json(pfad, init);
    const fehler = (daten as { fehler?: string } | null)?.fehler;
    if (erlaubt.includes(rolle)) {
      expect(ABGEWIESEN, `${rolle}: ${status} ${fehler}`).not.toContain(fehler);
      expect(status, rolle).not.toBe(401);
    } else expect({ status, fehler }).toEqual({ status: 403, fehler: "keine_berechtigung" });
  });

  it("refuses a request without a session", async () => {
    const { pfad, init } = anfrage(name);
    const { status } = await server.browser().json(pfad, init);
    expect(status).toBe(401);
  });
});

/*
 * docs/sicherheit.md B-28: a page of another origin in the member's browser, e.g. an app under the
 * same domain, sends the session cookie along (SameSite=Lax only stops other sites) and can POST
 * text/plain without a preflight; a write needs the interface's own Origin
 */
const SCHREIBEND = NAMEN.filter((name) => ROUTEN[name].art === "recht" && !name.startsWith("GET "));

describe("a write from a page of another origin", () => {
  it.each(SCHREIBEND)("%s is refused, with the member's session", async (name) => {
    const { pfad, init } = anfrage(name);
    for (const origin of ["https://app.kunde.example", "null"]) {
      const { status, daten } = await personen.inhaber.json(pfad, {
        ...init,
        headers: { origin, "content-type": "text/plain;charset=UTF-8" },
      });
      expect({ origin, status, daten }).toEqual({
        origin,
        status: 403,
        daten: { fehler: "fremder_ursprung" },
      });
    }
  });
});

describe("the public routes", () => {
  it.each(NAMEN.filter((name) => ROUTEN[name].art === "oeffentlich"))(
    "%s answers without a session",
    async (name) => {
      const { pfad, init } = anfrage(name);
      const antwort = await server.browser().anfrage(pfad, init);
      expect(antwort.status).not.toBe(401);
      // Hono's own 404 is plain text; a route answers JSON (an unknown token: 404 too) or, for
      // install.sh and the agent's files, what it serves
      expect(antwort.headers.get("content-type")).toMatch(
        /^(application\/json|text\/x-shellscript|application\/octet-stream|text\/plain; charset=utf-8)/,
      );
      if (antwort.headers.get("content-type")?.startsWith("text/plain"))
        expect(await antwort.text()).not.toBe("404 Not Found");
    },
  );
});

describe("the agents' routes", () => {
  it.each(NAMEN.filter((name) => ROUTEN[name].art === "agent"))(
    "%s refuses a request without a certificate, also a signed-in person's",
    async (name) => {
      const { pfad, init } = anfrage(name);
      expect(await server.browser().json(pfad, init)).toEqual({
        status: 401,
        daten: { fehler: "kein_zertifikat" },
      });
      for (const rolle of ROLLEN)
        expect((await personen[rolle].json(pfad, init)).status, rolle).toBe(401);
    },
  );
});

describe("Better Auth's paths", () => {
  it.each(Object.keys(AUTH_PFADE))("%s is reachable", async (eintrag) => {
    const [methode = "GET", pfad = ""] = eintrag.split(" ");
    const antwort = await server.browser().anfrage(`/api/auth${pfad}`, {
      method: methode,
      ...(methode === "POST" ? { body: {} } : {}),
    });
    expect(antwort.status).not.toBe(404);
  });

  it("needs a session where the list says so", async () => {
    for (const [eintrag, art] of Object.entries(AUTH_PFADE)) {
      if (art !== "sitzung" || eintrag === "GET /get-session") continue;
      const [methode = "GET", pfad = ""] = eintrag.split(" ");
      const antwort = await server.browser().anfrage(`/api/auth${pfad}`, {
        method: methode,
        ...(methode === "POST" ? { body: {} } : {}),
      });
      // Better Auth checks the body before the session: an empty one may end there first
      expect([400, 401], eintrag).toContain(antwort.status);
    }
  });
});

/*
 * BAULISTE.md stage 2, phase 9: what was removed stays removed. Each path answers 404 to a member
 * with a session, in every role, and is in no entry of ROUTEN.
 */
const ENTFERNT: [string, string][] = [
  // Z-1201: the services per customer and month (Z-804), also as CSV
  ["GET", "/api/v1/leistungen"],
  ["GET", "/api/v1/leistungen?monat=2026-11&format=csv"],
  // Z-1203: the support accesses (Z-802)
  ["GET", "/api/v1/support-zugaenge"],
  ["POST", "/api/v1/support-zugaenge"],
  ["POST", "/api/v1/support-zugaenge/gibt-es-nicht/beenden"],
];

describe("removed routes", () => {
  it.each(ENTFERNT)("%s %s answers 404", async (method, pfad) => {
    for (const rolle of ROLLEN)
      expect((await personen[rolle].json(pfad, { method })).status, rolle).toBe(404);
    const ohneAbfrage = (pfad.split("?")[0] ?? "").replace("gibt-es-nicht", ":zugangId");
    expect(NAMEN.some((name) => name.endsWith(` ${ohneAbfrage}`))).toBe(false);
  });
});
